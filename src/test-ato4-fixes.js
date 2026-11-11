'use strict';
/**
 * TESTES DIRIGIDOS — os seis ajustes finais do ATO 4.
 *
 * Tudo isolado em diretorio temporario. Nenhuma chamada sai para o Google: o
 * estado do OAuth e substituido por um espelho local, e todo dado esta marcado
 * como sintetico. Nada de producao e lido para escrita nem apagado.
 */
require('./env');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ymc-ato4-'));
const CFG = path.join(TMP, 'youtube-channels.json');
process.env.YT_CHANNELS_CONFIG = CFG;
process.env.EVOLUTION_DIR = path.join(TMP, 'evolution');
process.env.SCHEDULER_STATE_DIR = path.join(TMP, 'scheduler');
process.env.BUDGET_LEDGER_DIR = path.join(TMP, 'budget');
process.env.YT_TOKENS_DIR = path.join(TMP, 'tokens');
// o store tambem fica no temporario: nada em var/ de producao e tocado
process.env.YMC_VAR_DIR = path.join(TMP, 'var');

const KEY = 'ch_practical_discipline';
const OFFICIAL_ID = 'UCquietresolve0000000001';
const PERSONAL_ID = 'UCkallebyprado000000000x';

let pass = 0, fail = 0;
function t(name, fn) {
  return (async () => {
    try { await fn(); pass++; console.log(`\x1b[32m  ok   \x1b[0m ${name}`); }
    catch (e) { fail++; console.log(`\x1b[31m  FALHA\x1b[0m ${name}\n        ${e.message}`); }
  })();
}
function writeCfg({ bound = false, id = null } = {}) {
  fs.writeFileSync(CFG, JSON.stringify({
    official: { internal_key: KEY, expected_title: 'Quiet Resolve', expected_handle: '@QuietResolveDaily',
      youtube_channel_id: id, bound, bound_at: bound ? new Date().toISOString() : null },
    forbidden: [{ title: 'Kalleby Prado', handle: '@kallebyprado', youtube_channel_id: PERSONAL_ID,
      reason: 'canal PESSOAL do proprietario', hard_block: true }],
    authorized_not_in_use: [{ title: 'Caiu na Rede' }, { title: 'Sala 666' }], policy: []
  }, null, 2));
}
/** Troca o estado do OAuth por um espelho local: nada sai para o Google. */
const oauth = require('./youtube/oauth');
const realState = oauth.state;
function fakeChannel({ id, title, handle }) {
  oauth.state = async () => ({ status: 'AUTORIZADO', youtube_channel_id: id, channel_title: title, channel_handle: handle });
}
function noOauth() { oauth.state = async () => ({ status: 'PENDENTE_AUTORIZACAO', reason: 'espelho de teste' }); }

const guard = require('./youtube/channel-guard');
const reporting = require('./youtube/reporting');
const { EvolutionEngine } = require('./evolution/engine');
const cycle = require('./evolution/cycle');
const scheduler = require('./scheduler');

/** Coletor sintetico com completude declarada. */
function collector(metrics, { provisional = [], structural = [], curve = true } = {}) {
  return async (channelId, { videoId, milestone }) => {
    const c = [];
    if (curve) for (let i = 0; i <= 40; i++) { const x = i / 40; c.push({ ratio: x, audience: Math.max(0.08, 0.85 - x * 0.7) }); }
    return { status: 'COLETADO', video_id: videoId, milestone, source: 'SINTETICO_TESTE',
      window: { from: '2026-11-01', to: '2026-11-11' }, metrics,
      missing_metrics: Object.entries(metrics).filter(([, v]) => v === 'indisponivel').map(([k]) => k),
      completeness: { final: provisional.length === 0, provisional_because: provisional, structural_gaps: structural },
      retention_curve: curve ? c : null, traffic_sources: [{ source: 'BROWSE', views: metrics.views || 0, share_pct: 100 }],
      notes: ['DADO SINTETICO DE TESTE'] };
  };
}

(async () => {
  console.log('\n\x1b[1mATO 4 — ajustes finais, testes dirigidos\x1b[0m');

  /* ============ 1. PROTECAO DOS CANAIS ============ */
  console.log('\n\x1b[1m1. protecao dos canais\x1b[0m');

  await t('sem OAuth nenhuma escrita passa', async () => {
    writeCfg({ bound: false }); noOauth();
    await assert.rejects(() => guard.assertWritable(KEY, 'envio'), /SEM_OAUTH|sem autorizacao|PENDENTE/i);
  });

  await t('canal NAO vinculado: escrita recusada mesmo com titulo correto', async () => {
    writeCfg({ bound: false });
    fakeChannel({ id: OFFICIAL_ID, title: 'Quiet Resolve', handle: '@QuietResolveDaily' });
    const r = await guard.check(KEY, { purpose: 'write' });
    assert.strictEqual(r.writable, false, 'deixou escrever sem vinculo');
    assert.strictEqual(r.code, 'CANAL_NAO_VINCULADO');
    await assert.rejects(() => guard.assertWritable(KEY, 'envio privado'), /nao foi vinculado/i);
  });

  await t('canal vinculado com ID identico: escrita liberada', async () => {
    writeCfg({ bound: true, id: OFFICIAL_ID });
    fakeChannel({ id: OFFICIAL_ID, title: 'Quiet Resolve', handle: '@QuietResolveDaily' });
    const r = await guard.assertWritable(KEY, 'envio privado');
    assert.strictEqual(r.writable, true);
    assert.strictEqual(r.matched_by, 'id', 'tem que autorizar por ID, nao por titulo');
  });

  await t('MESMO titulo, ID diferente: recusado (titulo nao autoriza)', async () => {
    writeCfg({ bound: true, id: OFFICIAL_ID });
    fakeChannel({ id: 'UCoutrocanalqualquer0001', title: 'Quiet Resolve', handle: '@QuietResolveDaily' });
    const r = await guard.check(KEY, { purpose: 'write' });
    assert.strictEqual(r.writable, false);
    assert.strictEqual(r.code, 'CANAL_DIFERENTE_DO_VINCULADO');
  });

  await t('canal pessoal recusado por ID', async () => {
    writeCfg({ bound: true, id: OFFICIAL_ID });
    fakeChannel({ id: PERSONAL_ID, title: 'Outro Nome Qualquer', handle: '@outro' });
    const r = await guard.check(KEY, { purpose: 'write' });
    assert.strictEqual(r.code, 'CANAL_PROIBIDO');
    assert.strictEqual(r.matched_by, 'id');
  });

  await t('canal pessoal recusado por titulo', async () => {
    writeCfg({ bound: true, id: OFFICIAL_ID });
    fakeChannel({ id: 'UCidnovoqualquer00000001', title: 'Kalleby Prado', handle: '@seila' });
    const r = await guard.check(KEY, { purpose: 'write' });
    assert.strictEqual(r.code, 'CANAL_PROIBIDO');
    assert.strictEqual(r.matched_by, 'titulo');
  });

  await t('canal pessoal recusado por handle, mesmo renomeado', async () => {
    writeCfg({ bound: true, id: OFFICIAL_ID });
    fakeChannel({ id: 'UCidnovoqualquer00000002', title: 'Nome Totalmente Novo', handle: '@kallebyprado' });
    const r = await guard.check(KEY, { purpose: 'write' });
    assert.strictEqual(r.code, 'CANAL_PROIBIDO');
    assert.strictEqual(r.matched_by, 'handle');
  });

  await t('--force NAO contorna o canal pessoal', async () => {
    writeCfg({ bound: false });
    fakeChannel({ id: PERSONAL_ID, title: 'Kalleby Prado', handle: '@kallebyprado' });
    const r = await guard.bind(KEY, { force: true });
    assert.strictEqual(r.bound, false, 'FORCE VINCULOU O CANAL PESSOAL');
    assert.strictEqual(r.code, 'CANAL_PROIBIDO');
    assert.strictEqual(r.force_ignored, true);
    const after = JSON.parse(fs.readFileSync(CFG, 'utf8'));
    assert.strictEqual(after.official.bound, false, 'a configuracao foi alterada');
    assert.strictEqual(after.official.youtube_channel_id, null);
  });

  await t('--force tambem nao vincula canal pessoal sobre vinculo existente', async () => {
    writeCfg({ bound: true, id: OFFICIAL_ID });
    fakeChannel({ id: PERSONAL_ID, title: 'Kalleby Prado', handle: '@kallebyprado' });
    const r = await guard.bind(KEY, { force: true });
    assert.strictEqual(r.bound, false);
    assert.strictEqual(r.code, 'CANAL_PROIBIDO');
    const after = JSON.parse(fs.readFileSync(CFG, 'utf8'));
    assert.strictEqual(after.official.youtube_channel_id, OFFICIAL_ID, 'o vinculo oficial foi trocado');
  });

  await t('--force vincula quando o dono renomeou o canal (uso legitimo)', async () => {
    writeCfg({ bound: false });
    fakeChannel({ id: OFFICIAL_ID, title: 'Quiet Resolve Daily', handle: '@QuietResolveDaily' });
    const r = await guard.bind(KEY, { force: true });
    assert.strictEqual(r.bound, true);
    assert.strictEqual(JSON.parse(fs.readFileSync(CFG, 'utf8')).official.youtube_channel_id, OFFICIAL_ID);
  });

  await t('bind sem force recusa canal que nao e o esperado', async () => {
    writeCfg({ bound: false });
    fakeChannel({ id: 'UCsala666000000000000001', title: 'Sala 666', handle: '@sala666' });
    const r = await guard.bind(KEY, {});
    assert.strictEqual(r.bound, false);
    assert.strictEqual(r.code, 'CANAL_NAO_E_O_ESPERADO');
  });

  await t('status declara que escrita exige vinculo', async () => {
    writeCfg({ bound: false });
    assert.strictEqual(guard.status().writes_allowed, false);
    writeCfg({ bound: true, id: OFFICIAL_ID });
    assert.strictEqual(guard.status().writes_allowed, true);
  });

  /* ============ 2. REPORTING API ============ */
  console.log('\n\x1b[1m2. impressoes e CTR\x1b[0m');
  const H = 'date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr';

  await t('nomes oficiais reconhecidos', () => {
    const m = reporting.mapColumns(H.split(','));
    assert.strictEqual(m.map.impressions, 'video_thumbnail_impressions');
    assert.strictEqual(m.map.ctr, 'video_thumbnail_impressions_ctr');
    assert.strictEqual(m.official_names_used, true);
    assert.strictEqual(m.unresolved.length, 0);
  });

  await t('exemplo conhecido de 6,2% sai exato: 50.000 impressoes, 3.100 cliques', () => {
    const csv = `${H}\n20261101,UCx,VID1,20000,0.062\n20261102,UCx,VID1,30000,0.062\n`;
    const r = reporting.extractReach(csv, { videoId: 'VID1', origin: 'google_download' });
    assert.strictEqual(r.impressions, 50000);
    assert.strictEqual(r.impressions_ctr, 0.062, `fracao errada: ${r.impressions_ctr}`);
    assert.strictEqual(r.impressions_ctr_percent, 6.2, `porcentagem errada: ${r.impressions_ctr_percent}`);
    assert.strictEqual(r.estimated_clicks, 3100);
    assert.strictEqual(r.ctr_scale_in_file, 'fracao');
  });

  await t('6,2% com dias de peso diferente continua certo', () => {
    // 90.000 x 8% + 10.000 x 1,8% = 7.200 + 180 = 7.380 -> 7,38%
    const csv = `${H}\n20261101,UCx,VID1,90000,0.08\n20261102,UCx,VID1,10000,0.018\n`;
    const r = reporting.extractReach(csv, { videoId: 'VID1', origin: 'google_download' });
    assert.strictEqual(r.impressions, 100000);
    assert.strictEqual(r.impressions_ctr_percent, 7.38, `esperava 7.38, veio ${r.impressions_ctr_percent}`);
  });

  await t('coluna em porcentagem e detectada e convertida, nao aceita como 620%', () => {
    const csv = `${H}\n20261101,UCx,VID1,50000,6.2\n`;
    const r = reporting.extractReach(csv, { videoId: 'VID1', origin: 'google_download' });
    assert.strictEqual(r.impressions_ctr, 0.062);
    assert.strictEqual(r.impressions_ctr_percent, 6.2);
    assert.strictEqual(r.ctr_scale_in_file, 'porcentagem');
    assert.ok(/passa de 1/.test(r.ctr_scale_reason));
  });

  await t('unidade documentada e uma so', () => {
    assert.ok(/fracao de 0 a 1/.test(reporting.FACTS.ctr_unit), 'unidade nao documentada');
    assert.ok(/0\.062 = 6,2%/.test(reporting.FACTS.ctr_unit));
    assert.deepStrictEqual(reporting.FACTS.official_metric_names,
      ['video_thumbnail_impressions', 'video_thumbnail_impressions_ctr']);
  });

  await t('DADO SINTETICO NUNCA marca o mapeamento como verificado', () => {
    const csv = `${H}\n20261101,UCx,VID1,50000,0.062\n`;
    const r = reporting.extractReach(csv, { videoId: 'VID1', origin: 'sintetico' });
    assert.strictEqual(r.column_mapping_verified, false, 'dado sintetico verificou o mapeamento');
    assert.ok(/sintetico/i.test(r.verification_note));
    assert.strictEqual(r.impressions, 50000, 'o valor ainda deve sair, so nao verificado');
  });

  await t('origem nao declarada tambem nao verifica', () => {
    const csv = `${H}\n20261101,UCx,VID1,50000,0.062\n`;
    assert.strictEqual(reporting.extractReach(csv, { videoId: 'VID1' }).column_mapping_verified, false);
  });

  await t('arquivo do Google com nomes alternativos nao verifica, e registra o alias', () => {
    const csv = 'date,video_id,impressions,ctr\n20261101,VID1,50000,0.062\n';
    const r = reporting.extractReach(csv, { videoId: 'VID1', origin: 'google_download' });
    assert.strictEqual(r.column_mapping_verified, false);
    assert.strictEqual(r.official_names_used, false);
    assert.strictEqual(r.column_aliases_used.length, 2);
    assert.strictEqual(r.impressions_ctr_percent, 6.2);
  });

  await t('arquivo do Google com nomes oficiais verifica', () => {
    const csv = `${H}\n20261101,UCx,VID1,50000,0.062\n`;
    assert.strictEqual(reporting.extractReach(csv, { videoId: 'VID1', origin: 'google_download' }).column_mapping_verified, true);
  });

  await t('sem coluna de CTR nada e inventado', () => {
    const csv = 'date,video_id,video_thumbnail_impressions\n20261101,VID1,50000\n';
    const r = reporting.extractReach(csv, { videoId: 'VID1', origin: 'google_download' });
    assert.strictEqual(r.impressions_ctr, 'indisponivel');
    assert.strictEqual(r.impressions_ctr_percent, 'indisponivel');
    assert.ok(/CTR/i.test(r.reason));
  });

  await t('CSV do Studio usa a mesma unidade canonica', () => {
    const si = require('./youtube/studio-import');
    const f = path.join(TMP, 'studio.csv');
    fs.writeFileSync(f, 'Content,Impressions,Impressions click-through rate (%),Views\nVID1,50000,6.20,3100\n');
    const r = si.importFile(f, { videoId: 'VID1' });
    assert.strictEqual(r.metrics.impressions_ctr, 0.062);
    assert.strictEqual(r.metrics.impressions_ctr_percent, 6.2);
    assert.strictEqual(r.column_mapping_verified, false, 'planilha manual nao verifica mapeamento de API');
  });

  /* ============ 3. DATAS ============ */
  console.log('\n\x1b[1m3. envio privado x publicacao publica\x1b[0m');
  const LAB = 'ch_ato4_lab';
  const engine = new EvolutionEngine(LAB);
  engine.register('ep_priv', { hypothesis: 'Episodio sintetico que fica privado, para provar que privado nao e analisado.', variable: 'hook_style' });
  engine.register('ep_pub', { hypothesis: 'Episodio sintetico publicado, para provar que o relogio conta da publicacao publica.', variable: 'hook_style' });

  await t('envio privado grava uploaded_privately_at e NAO liga o relogio', () => {
    engine.recordPublication('ep_priv', { kind: 'upload_privado', video_id: 'SINT_PRIV',
      url: 'https://example.invalid/SINT_PRIV', privacy: 'private',
      uploaded_privately_at: new Date(Date.now() - 300 * 3600000).toISOString(), author: 'teste' });
    const x = engine.store.experiment('exp_ep_priv');
    assert.ok(x.publication.uploaded_privately_at, 'nao gravou a data do envio');
    assert.strictEqual(x.publication.published_publicly_at, null, 'inventou data de publicacao publica');
    const c = engine.audienceClock('ep_priv');
    assert.strictEqual(c.started, false);
    assert.ok(/privado/i.test(c.reason));
  });

  await t('video privado NAO e analisado pelo ciclo', async () => {
    const r = await cycle.runFor(LAB, 'ep_priv', { collector: collector({ views: 100 }) });
    assert.strictEqual(r.ran, false, 'analisou video privado');
    assert.strictEqual(r.audience_clock_started, false);
    const x = engine.store.experiment('exp_ep_priv');
    assert.strictEqual(x.measurements.length, 0, 'gravou medida de video privado');
  });

  await t('agendamento tambem nao liga o relogio', () => {
    engine.recordPublication('ep_priv', { kind: 'agendamento', video_id: 'SINT_PRIV', privacy: 'private',
      uploaded_privately_at: new Date(Date.now() - 300 * 3600000).toISOString(), author: 'teste' });
    assert.strictEqual(engine.audienceClock('ep_priv').started, false);
  });

  await t('publicacao publica sem confirmacao da API e recusada', () => {
    assert.throws(() => engine.recordPublication('ep_pub', { kind: 'publicacao_publica', video_id: 'SINT_PUB',
      privacy: 'public', published_publicly_at: new Date().toISOString(), privacy_confirmed_by_api: false }),
      /confirmacao vinda da API/i);
  });

  await t('publicacao publica com privacidade errada e recusada', () => {
    assert.throws(() => engine.recordPublication('ep_pub', { kind: 'publicacao_publica', video_id: 'SINT_PUB',
      privacy: 'private', published_publicly_at: new Date().toISOString(), privacy_confirmed_by_api: true }),
      /privacidade "public"/i);
  });

  await t('publicacao publica confirmada liga o relogio, e a data do envio nao se perde', () => {
    const up = new Date(Date.now() - 400 * 3600000).toISOString();
    const pubAt = new Date(Date.now() - 200 * 3600000).toISOString();
    engine.recordPublication('ep_pub', { kind: 'upload_privado', video_id: 'SINT_PUB',
      url: 'https://example.invalid/SINT_PUB', privacy: 'private', uploaded_privately_at: up, author: 'teste' });
    engine.recordPublication('ep_pub', { kind: 'publicacao_publica', video_id: 'SINT_PUB',
      url: 'https://example.invalid/SINT_PUB', privacy: 'public', uploaded_privately_at: up,
      published_publicly_at: pubAt, privacy_confirmed_by_api: true, author: 'teste' });
    const x = engine.store.experiment('exp_ep_pub');
    assert.strictEqual(x.publication.uploaded_privately_at, up, 'perdeu a data do envio privado');
    assert.strictEqual(x.publication.published_publicly_at, pubAt);
    assert.strictEqual(x.publication_steps.length, 2);
    const c = engine.audienceClock('ep_pub');
    assert.strictEqual(c.started, true);
    assert.strictEqual(c.at, pubAt);
  });

  await t('o marco conta da publicacao publica, nao do envio', async () => {
    const r = await cycle.runFor(LAB, 'ep_pub', { collector: collector({
      impressions: 20000, impressionsCtr: 0.062, views: 900, averageViewPercentage: 38,
      retention_0_30s: 0.62, retention_mid: 0.34, retention_end: 0.2 }) });
    assert.strictEqual(r.ran, true);
    // 200h desde a publicacao publica -> marco de 7 dias; 400h desde o envio seria 28 dias
    assert.strictEqual(r.milestone, 'd7', `marco errado: ${r.milestone}`);
    assert.ok(Math.abs(r.hours_since_publication - 200) < 1.5, `horas erradas: ${r.hours_since_publication}`);
  });

  await t('o agendador ignora o privado e lista o motivo', () => {
    const due = scheduler.dueTasks(engine, Date.now());
    assert.ok(due.every((d) => d.epId !== 'ep_priv'), 'o agendador pegou um video privado');
    assert.ok(due.some((d) => d.epId === 'ep_pub'), 'o agendador perdeu o video publico');
    const sk = scheduler.skipped(engine);
    const s = sk.find((x) => x.epId === 'ep_priv');
    assert.ok(s, 'nao declarou por que pulou');
    assert.ok(/privado/i.test(s.reason));
  });

  /* ============ 4. RETENTATIVAS ============ */
  console.log('\n\x1b[1m4. ausencia temporaria de metrica\x1b[0m');
  engine.register('ep_prov', { hypothesis: 'Episodio sintetico para provar que falta temporaria de dado nao fecha o marco.', variable: 'hook_style' });
  const provAt = new Date(Date.now() - 30 * 3600000).toISOString();
  engine.recordPublication('ep_prov', { kind: 'upload_privado', video_id: 'SINT_PROV', privacy: 'private',
    uploaded_privately_at: new Date(Date.now() - 50 * 3600000).toISOString(), author: 'teste' });
  engine.recordPublication('ep_prov', { kind: 'publicacao_publica', video_id: 'SINT_PROV', privacy: 'public',
    published_publicly_at: provAt, privacy_confirmed_by_api: true, author: 'teste' });

  const semAlcance = collector({ impressions: 'indisponivel', impressionsCtr: 'indisponivel', views: 300,
    averageViewPercentage: 31, retention_0_30s: 0.55, retention_mid: 0.3, retention_end: 0.17 },
    { provisional: ['impressoes e CTR ainda nao disponiveis: o relatorio em lote leva ate 48h'] });

  await t('sem impressoes o marco fica ABERTO, nao medido', async () => {
    const r = await cycle.runFor(LAB, 'ep_prov', { collector: semAlcance });
    assert.strictEqual(r.ran, true);
    assert.strictEqual(r.provisional, true, 'fechou o marco sem o dado');
    const m = engine.store.experiment('exp_ep_prov').measurement_by_milestone[r.milestone];
    assert.strictEqual(m.completeness, 'provisoria');
    assert.strictEqual(m.attempt, 1);
    assert.ok((m.provisional_because || []).length);
    assert.ok(engine.store.experiment('exp_ep_prov').open_milestones.includes(r.milestone));
  });

  await t('marco aberto e remedido, e a nova medida substitui sem apagar a antiga', async () => {
    const before = engine.store.experiment('exp_ep_prov').measurements.length;
    const r = await cycle.runFor(LAB, 'ep_prov', { collector: semAlcance });
    assert.strictEqual(r.ran, true, 'pulou um marco que estava aberto');
    assert.strictEqual(r.remeasured, true);
    const x = engine.store.experiment('exp_ep_prov');
    assert.strictEqual(x.measurements.length, before + 1, 'nao gravou a remedicao');
    const m = x.measurement_by_milestone[r.milestone];
    assert.strictEqual(m.attempt, 2);
    assert.ok(m.supersedes, 'nao apontou qual medida substituiu');
    assert.strictEqual(Object.keys(x.measurement_by_milestone).length, 1, 'duplicou o marco');
  });

  await t('quando o dado real aparece a medida vira FINAL', async () => {
    const r = await cycle.runFor(LAB, 'ep_prov', { collector: collector({
      impressions: 18000, impressionsCtr: 0.058, views: 320, averageViewPercentage: 32,
      retention_0_30s: 0.56, retention_mid: 0.31, retention_end: 0.18 },
      { structural: ['receita: escopo monetario nao pedido'] }) });
    assert.strictEqual(r.provisional, false, 'continuou provisoria com o dado completo');
    const x = engine.store.experiment('exp_ep_prov');
    const m = x.measurement_by_milestone[r.milestone];
    assert.strictEqual(m.completeness, 'final');
    assert.strictEqual(m.attempt, 3);
    assert.strictEqual(x.open_milestones.length, 0);
    assert.ok(x.final_milestones.includes(r.milestone));
  });

  await t('marco FINAL nunca e medido de novo', async () => {
    const before = engine.store.experiment('exp_ep_prov').measurements.length;
    const r = await cycle.runFor(LAB, 'ep_prov', { collector: semAlcance });
    assert.strictEqual(r.ran, false, 'remediu um marco ja fechado');
    assert.strictEqual(engine.store.experiment('exp_ep_prov').measurements.length, before, 'duplicou evento');
  });

  await t('falta estrutural (receita) nao impede fechar o marco', () => {
    const m = engine.store.experiment('exp_ep_prov').measurement_by_milestone.h24;
    assert.strictEqual(m.completeness, 'final');
    assert.ok((m.structural_gaps || []).length, 'nao registrou a falta estrutural');
  });

  await t('no agendador, remedicao nao gasta tentativa de erro', async () => {
    engine.register('ep_sched', { hypothesis: 'Episodio sintetico para provar a contagem do agendador em marco aberto.', variable: 'hook_style' });
    engine.recordPublication('ep_sched', { kind: 'publicacao_publica', video_id: 'SINT_SCHED', privacy: 'public',
      published_publicly_at: new Date(Date.now() - 30 * 3600000).toISOString(), privacy_confirmed_by_api: true, author: 'teste' });
    const t0 = Date.now();
    await scheduler.tick(LAB, { collector: semAlcance, now: t0 });
    const st1 = scheduler.loadState(LAB).tasks['ep_sched::milestone::h24'];
    assert.strictEqual(st1.status, 'provisoria', `status errado: ${st1.status}`);
    assert.strictEqual(st1.rechecks, 1);
    assert.strictEqual(st1.attempts, 0, 'gastou tentativa de erro numa remedicao');
    assert.ok(st1.next_attempt_at, 'nao marcou quando volta');
    // antes da hora, nao roda
    const mid = await scheduler.tick(LAB, { collector: semAlcance, now: t0 + 60000 });
    assert.ok(mid.actions.some((a) => a.key === 'ep_sched::milestone::h24' && /remedicao/.test(a.action)));
    assert.strictEqual(scheduler.loadState(LAB).tasks['ep_sched::milestone::h24'].rechecks, 1);
    // depois da cadencia, volta
    await scheduler.tick(LAB, { collector: semAlcance, now: t0 + (scheduler.RECHECK_MIN + 1) * 60000 });
    assert.strictEqual(scheduler.loadState(LAB).tasks['ep_sched::milestone::h24'].rechecks, 2);
  });

  await t('dado real fecha a tarefa do agendador', async () => {
    const t0 = Date.now() + (scheduler.RECHECK_MIN * 3) * 60000;
    await scheduler.tick(LAB, { collector: collector({ impressions: 9000, impressionsCtr: 0.051, views: 210,
      averageViewPercentage: 29, retention_0_30s: 0.5, retention_mid: 0.28, retention_end: 0.15 }), now: t0 });
    const st = scheduler.loadState(LAB).tasks['ep_sched::milestone::h24'];
    assert.strictEqual(st.status, 'done');
    assert.ok(st.result.rechecks_before_final >= 2, 'perdeu a contagem de remedicoes');
    assert.strictEqual(scheduler.status(LAB).open_milestones.length, 0);
  });

  /* ============ 5. AUTORIZACOES ============ */
  console.log('\n\x1b[1m5. autorizacoes separadas\x1b[0m');
  const pubmod = require('./youtube/publication');

  await t('as quatro transicoes declaram exigencia propria', () => {
    for (const k of ['upload_privado', 'agendar', 'publicar', 'iniciar_coleta']) {
      const tr = pubmod.TRANSITIONS[k];
      assert.ok(tr.requires.length && tr.does_not_grant.length, `transicao ${k} incompleta`);
    }
    assert.ok(pubmod.TRANSITIONS.agendar.requires.some((r) => /publication_schedule_authorized/.test(r)));
    assert.ok(pubmod.TRANSITIONS.iniciar_coleta.requires.some((r) => /audience_collection_authorized/.test(r)));
    assert.ok(pubmod.TRANSITIONS.upload_privado.does_not_grant.some((r) => /agendamento/.test(r)));
  });

  await t('aprovacao marca as quatro decisoes de forma independente', () => {
    const { Store, VAR } = require('./store');
    assert.ok(VAR.startsWith(TMP), `a suite teria escrito em ${VAR}, fora do temporario`);
    const s = new Store('ch_auth_lab');
    s.append('episode.created', { id: 'ep_x', title: 'sintetico' });
    s.append('approval.decided', { epId: 'ep_x', status: 'approved', by: 'teste', scheduled_upload_authorized: true });
    const a = s.episode('ep_x').approval;
    assert.strictEqual(a.scheduled_upload_authorized, true);
    assert.strictEqual(a.publication_schedule_authorized, false, 'envio autorizou agendamento');
    assert.strictEqual(a.public_release_authorized, false, 'envio autorizou publicacao');
    assert.strictEqual(a.audience_collection_authorized, false, 'envio autorizou coleta');
  });

  await t('agendar sem a marca de agendamento e recusado', async () => {
    const { Store } = require('./store');
    const s = new Store('ch_auth_lab2');
    s.append('episode.created', { id: 'ep_y', title: 'sintetico' });
    s.append('approval.decided', { epId: 'ep_y', status: 'approved', by: 'teste', scheduled_upload_authorized: true });
    writeCfg({ bound: true, id: OFFICIAL_ID });
    fakeChannel({ id: OFFICIAL_ID, title: 'Quiet Resolve', handle: '@QuietResolveDaily' });
    await assert.rejects(() => pubmod.schedule(s, 'ep_y', { publishAt: new Date(Date.now() + 86400000).toISOString(), by: 'teste' }),
      /autorizacao de AGENDAMENTO/i);
  });

  await t('iniciar coleta sem a marca de coleta e recusado', async () => {
    const { Store } = require('./store');
    const s = new Store('ch_auth_lab3');
    s.append('episode.created', { id: 'ep_z', title: 'sintetico' });
    s.append('approval.decided', { epId: 'ep_z', status: 'approved', by: 'teste',
      scheduled_upload_authorized: true, public_release_authorized: true });
    await assert.rejects(() => pubmod.startCollection(s, 'ep_z', { by: 'teste' }),
      /COLETA DE AUDIENCIA/i);
  });

  await t('com a marca de agendamento, a trava de canal ainda vale', async () => {
    const { Store } = require('./store');
    const s = new Store('ch_auth_lab4');
    s.append('episode.created', { id: 'ep_w', title: 'sintetico' });
    s.append('approval.decided', { epId: 'ep_w', status: 'approved', by: 'teste',
      scheduled_upload_authorized: true, publication_schedule_authorized: true });
    writeCfg({ bound: false });
    fakeChannel({ id: OFFICIAL_ID, title: 'Quiet Resolve', handle: '@QuietResolveDaily' });
    await assert.rejects(() => pubmod.schedule(s, 'ep_w', { publishAt: new Date(Date.now() + 86400000).toISOString(), by: 'teste' }),
      /agendamento recusada/i);
    oauth.state = realState;
  });

  await t('publicar exige a frase exata e a marca propria', () => {
    assert.strictEqual(pubmod.CONFIRM_PHRASE('ep_001'), 'PUBLICAR ep_001 EM PUBLICO');
    assert.ok(pubmod.TRANSITIONS.publicar.requires.some((r) => /frase de confirmacao exata/i.test(r)));
  });

  /* ============ 6. OAUTH ============ */
  console.log('\n\x1b[1m6. OAuth: um tipo de credencial\x1b[0m');
  oauth.state = realState;

  await t('tipo de credencial unico e declarado no codigo', () => {
    assert.strictEqual(oauth.CREDENTIAL_TYPE.google_console_type, 'Aplicativo da Web (Web application)');
    assert.ok(/desktop/i.test(oauth.CREDENTIAL_TYPE.never_use));
  });

  await t('o redirect padrao e compativel com o callback e com o tunel', () => {
    const v = oauth.validateRedirect();
    assert.strictEqual(v.ok, true, v.problems.join('; '));
    assert.strictEqual(v.loopback, true);
    assert.strictEqual(v.path, oauth.EXPECTED_CALLBACK_PATH);
  });

  await t('redirect fora de loopback e recusado', () => {
    const old = process.env.YOUTUBE_REDIRECT_URI;
    process.env.YOUTUBE_REDIRECT_URI = 'http://meu-vps.exemplo/api/youtube/oauth/callback';
    const v = oauth.validateRedirect();
    if (old === undefined) delete process.env.YOUTUBE_REDIRECT_URI; else process.env.YOUTUBE_REDIRECT_URI = old;
    assert.strictEqual(v.ok, false);
    assert.ok(v.problems.some((p) => /loopback/.test(p)));
  });

  await t('redirect com caminho ou porta errados e recusado', () => {
    const old = process.env.YOUTUBE_REDIRECT_URI;
    process.env.YOUTUBE_REDIRECT_URI = 'http://127.0.0.1:9999/callback';
    const v = oauth.validateRedirect();
    if (old === undefined) delete process.env.YOUTUBE_REDIRECT_URI; else process.env.YOUTUBE_REDIRECT_URI = old;
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.problems.length, 2, JSON.stringify(v.problems));
  });

  await t('o diagnostico nao divulga segredo', () => {
    const oldId = process.env.YOUTUBE_CLIENT_ID, oldS = process.env.YOUTUBE_CLIENT_SECRET;
    process.env.YOUTUBE_CLIENT_ID = '999-xyz.apps.googleusercontent.com';
    process.env.YOUTUBE_CLIENT_SECRET = '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R';
    const d = oauth.doctor();
    if (oldId === undefined) delete process.env.YOUTUBE_CLIENT_ID; else process.env.YOUTUBE_CLIENT_ID = oldId;
    if (oldS === undefined) delete process.env.YOUTUBE_CLIENT_SECRET; else process.env.YOUTUBE_CLIENT_SECRET = oldS;
    const s = JSON.stringify(d);
    assert.ok(!s.includes('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R'), 'VAZOU O SEGREDO');
    assert.ok(!s.includes('999-xyz.apps.googleusercontent.com'), 'vazou o client_id inteiro');
    assert.strictEqual(d.ok, true);
    assert.strictEqual(d.secrets_disclosed, false);
  });

  await t('nenhum escopo de escrita de canal e pedido', () => {
    assert.ok(!oauth.SCOPES.some((s) => /auth\/youtube$|force-ssl/.test(s)), 'pediu escopo de escrita');
  });

  await t('codigo e documentacao falam do MESMO tipo de credencial', () => {
    const doc = fs.readFileSync(path.join(ROOT, 'docs', 'youtube-oauth.md'), 'utf8');
    assert.ok(/Aplicativo da Web/.test(doc), 'a documentacao nao nomeia o tipo');
    assert.ok(/N[aã]o [eé] Aplicativo de desktop/i.test(doc), 'a documentacao nao descarta o tipo errado');
    assert.ok(doc.includes('http://127.0.0.1:3777/api/youtube/oauth/callback'), 'redirect ausente na documentacao');
    assert.ok(/ssh -L 3777:127\.0\.0\.1:3777/.test(doc), 'procedimento do tunel ausente');
    assert.ok(/youtube doctor/.test(doc), 'a validacao sem segredo nao esta no procedimento');
    assert.ok(!/senha|c[oó]digo por chat/i.test(doc) || /nunca pede/i.test(doc), 'a documentacao tem que dizer que nunca pede credencial por chat');
  });

  /* ============ fim ============ */
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fail ? `\n\x1b[31m${pass} aprovados, ${fail} falhas\x1b[0m\n` : `\n\x1b[32m${pass} aprovados, 0 falhas\x1b[0m\n`);
  process.exit(fail ? 1 : 0);
})();
