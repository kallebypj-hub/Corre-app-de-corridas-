'use strict';
/**
 * PROVA INTEGRADA — o ciclo inteiro, ponta a ponta.
 *
 * Todo dado aqui e SINTETICO e esta marcado como tal em cada evento gravado
 * (`source: "SINTETICO_TESTE"`). Nenhuma chamada sai para o Google. O canal usado
 * e um canal de laboratorio, com conteudo proprio, apagado no fim.
 *
 * Passos: 1 hipotese, 2 producao aprovada, 3 publicacao simulada, 4 metricas
 * injetadas, 5 medicao automatica, 6 retencao e funil, 7 auditoria, 8
 * conhecimento, 9 o episodio seguinte consultando esse aprendizado.
 */
require('./env');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LAB = 'ch_integration_lab';
const SRC = path.join(ROOT, 'content', 'channels', 'ch_practical_discipline', 'episodes', 'ep_001');
const LAB_DIR = path.join(ROOT, 'content', 'channels', LAB);
process.env.EVOLUTION_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ymc-int-evo-'));
process.env.SCHEDULER_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ymc-int-sched-'));
process.env.BUDGET_LEDGER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ymc-int-budget-'));

const { EvolutionEngine } = require('./evolution/engine');
const cycle = require('./evolution/cycle');
const scheduler = require('./scheduler');
const knowledge = require('./evolution/knowledge');
const { VERDICT, KNOWLEDGE_TIER } = require('./evolution/states');

let pass = 0, fail = 0; const notes = [];
function step(n, name, fn) {
  return (async () => {
    try { const r = await fn(); pass++; console.log(`\x1b[32m  ${n}. ok\x1b[0m   ${name}`); if (r) notes.push(`${n}. ${r}`); return r; }
    catch (e) { fail++; console.log(`\x1b[31m  ${n}. FALHA\x1b[0m ${name}\n        ${e.stack ? e.stack.split('\n')[0] : e.message}`); throw e; }
  })();
}
function cleanup() {
  fs.rmSync(LAB_DIR, { recursive: true, force: true });
  fs.rmSync(process.env.EVOLUTION_DIR, { recursive: true, force: true });
  fs.rmSync(process.env.SCHEDULER_STATE_DIR, { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, 'var', 'channels', LAB), { recursive: true, force: true });
  fs.rmSync(process.env.BUDGET_LEDGER_DIR, { recursive: true, force: true });
}

/** Monta um episodio de laboratorio reaproveitando a estrutura real. */
function makeEpisode(epId, { hypothesis, variableValue, appliesLearning = [], baselineRole = null }) {
  const dir = path.join(LAB_DIR, 'episodes', epId);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['script_en.json', 'sources.json', 'claims.json', 'storyboard.json', 'narration_timeline.json',
    'quality_report.json', 'metadata.json', 'thumbnail_A.png', 'thumbnail_B.png']) {
    fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  }
  const brief = JSON.parse(fs.readFileSync(path.join(SRC, 'brief.json'), 'utf8'));
  brief.episode_id = epId;
  brief.channel_id = LAB;
  brief.working_title = `[SINTETICO] ${epId}`;
  brief.metadata.title = `[SINTETICO] ${epId}`;
  brief.experiment = { hypothesis, primary_variable: 'hook_style', variable_value: variableValue,
    applies_learning: appliesLearning, baseline_role: baselineRole,
    known_confounders: ['dado sintetico de teste; nenhuma inferencia real sai daqui'] };
  fs.writeFileSync(path.join(dir, 'brief.json'), JSON.stringify(brief, null, 2));
  return dir;
}
/** Coletor sintetico: nao fala com o Google e se identifica como teste. */
function syntheticCollector(metrics, { withCurve = true } = {}) {
  return async (channelId, { videoId, publishedAt, durationSeconds, milestone }) => {
    const curve = [];
    if (withCurve) for (let i = 0; i <= 40; i++) {
      const x = i / 40;
      curve.push({ ratio: x, audience: x < 0.08 ? 1 - x * 2.2 : Math.max(0.08, 0.82 - x * 0.75) });
    }
    const missing = Object.entries(metrics).filter(([, v]) => v === 'indisponivel').map(([k]) => k);
    return { status: 'COLETADO', video_id: videoId, milestone, source: 'SINTETICO_TESTE',
      window: { from: '2026-11-01', to: '2026-11-11' },
      metrics, missing_metrics: missing,
      // o que falta aqui falta por DECISAO (escopo monetario, Shorts sem referencia),
      // nao por atraso: a medida e final.
      completeness: { final: true, provisional_because: [],
        structural_gaps: missing.map((k) => `${k}: ausente por decisao de escopo neste laboratorio sintetico`) },
      retention_curve: withCurve ? curve : null, traffic_sources: [{ source: 'BROWSE', views: metrics.views || 0, share_pct: 100 }],
      notes: ['DADO SINTETICO DE TESTE — nao veio do YouTube'] };
  };
}

(async () => {
  cleanup();
  fs.mkdirSync(LAB_DIR, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'content', 'channels', 'ch_practical_discipline', 'ideas.json'), path.join(LAB_DIR, 'ideas.json'));
  console.log('\n\x1b[1mPROVA INTEGRADA — dados sinteticos, nenhuma chamada ao Google\x1b[0m\n');
  const engine = new EvolutionEngine(LAB);

  // 1
  await step(1, 'hipotese registrada antes de produzir', () => {
    makeEpisode('ep_s01', { hypothesis: 'Linha de base sintetica do laboratorio: abertura seca estabelece a referencia do canal de teste.', variableValue: 'cold_statement', baselineRole: 'linha de base do laboratorio' });
    const ev = engine.register('ep_s01', { hypothesis: 'Linha de base sintetica do laboratorio: abertura seca estabelece a referencia do canal de teste.', variable: 'hook_style' });
    assert.ok(ev.hash, 'registro sem hash');
    const x = engine.store.experiment('exp_ep_s01');
    assert.strictEqual(x.registered_before_production, true);
    return `experimento exp_ep_s01 registrado (evento ${ev.seq})`;
  });

  // 2
  await step(2, 'producao anotada e aprovada tecnicamente', async () => {
    await engine.recordProduction('ep_s01', { gates: '32/32' });
    const x = engine.store.experiment('exp_ep_s01');
    assert.ok(x.production && x.production.variable_fingerprint, 'producao nao anotada');
    assert.strictEqual(x.production.gates, '32/32');
    assert.ok((x.production.thumbnails || []).length >= 1, 'miniatura nao medida');
    return `assinatura ${x.production.variable_fingerprint}, ${(x.production.thumbnails || []).length} miniatura(s) medida(s)`;
  });

  // 3
  await step(3, 'publicacao simulada, sem atingir o Google', () => {
    const up = new Date(Date.now() - 240 * 3600000).toISOString();
    const pub = new Date(Date.now() - 200 * 3600000).toISOString();
    engine.recordPublication('ep_s01', { kind: 'upload_privado', video_id: 'SINTETICO_VID_001',
      url: 'https://example.invalid/SINTETICO_VID_001', privacy: 'private',
      uploaded_privately_at: up, author: 'teste_integrado' });
    // antes de ficar publico, o relogio da audiencia NAO roda
    assert.strictEqual(engine.audienceClock('ep_s01').started, false, 'envio privado ligou o relogio');
    engine.recordPublication('ep_s01', { kind: 'publicacao_publica', video_id: 'SINTETICO_VID_001',
      url: 'https://example.invalid/SINTETICO_VID_001', privacy: 'public',
      uploaded_privately_at: up, published_publicly_at: pub, privacy_confirmed_by_api: true, author: 'teste_integrado' });
    const x = engine.store.experiment('exp_ep_s01');
    assert.strictEqual(x.publication.video_id, 'SINTETICO_VID_001');
    assert.strictEqual(x.publication.uploaded_privately_at, up, 'perdeu a data do envio privado');
    assert.strictEqual(x.publication.published_publicly_at, pub);
    assert.ok(!/youtube\.com/.test(x.publication.url), 'a URL sintetica nao pode parecer real');
    return 'envio privado 240h atras, publicacao publica confirmada 200h atras: o relogio conta da segunda';
  });

  // 4, 5, 6, 7, 8 — o ciclo faz tudo numa chamada
  let run;
  await step(4, 'metricas sinteticas injetadas e ciclo disparado numa chamada', async () => {
    run = await cycle.runFor(LAB, 'ep_s01', { collector: syntheticCollector({
      impressions: 14500, impressionsCtr: 0.052, views: 760, estimatedMinutesWatched: 2100,
      averageViewDuration: 166, averageViewPercentage: 35.4, subscribersGained: 22,
      retention_0_30s: 0.61, retention_mid: 0.33, retention_end: 0.19,
      top_traffic_source: 'BROWSE', shorts_referral_views: 'indisponivel', estimatedRevenue: 'indisponivel' }) });
    assert.strictEqual(run.ran, true, 'o ciclo nao rodou');
    return `marco ${run.milestone}, ${run.steps.length} passos`;
  });
  await step(5, 'medicao registrada automaticamente, com origem sintetica declarada', () => {
    const x = engine.store.experiment('exp_ep_s01');
    assert.strictEqual(x.measurements.length, 1);
    const m = x.measurements[0];
    assert.strictEqual(m.source, 'SINTETICO_TESTE', 'a origem sintetica precisa ficar gravada');
    assert.strictEqual(m.metrics.estimatedRevenue, null, 'metrica ausente virou valor');
    assert.ok(m.missing_metrics.includes('estimatedRevenue'));
    return `${Object.keys(m.metrics).length} metricas, ${m.missing_metrics.length} ausentes, origem ${m.source}`;
  });
  await step(6, 'retencao mapeada nas cenas e funil avaliado', () => {
    const x = engine.store.experiment('exp_ep_s01');
    assert.ok(x.retention, 'retencao nao registrada');
    assert.strictEqual(x.retention.available, true);
    assert.ok(x.retention.scenes.length >= 5);
    assert.ok(x.current_funnel, 'funil nao avaliado');
    const st = x.current_funnel.stages;
    assert.ok(st.early_retention, 'etapa de retencao inicial ausente');
    const nf = (x.retention.notable_drops || []).length;
    return `${x.retention.scenes.length} cenas mapeadas, ${nf} queda(s) notavel(is); funil: ${x.current_funnel.summary.note || x.current_funnel.summary.blameable_stages.join(', ')}`;
  });
  await step(7, 'conclusao submetida ao auditor metodologico', () => {
    const x = engine.store.experiment('exp_ep_s01');
    assert.ok(x.challenges.length >= 1, 'o auditor nao foi acionado');
    const v = x.current_verdict;
    assert.ok(v.audit, 'veredicto sem registro de auditoria');
    // primeiro episodio do canal: sem referencia, nao pode haver culpa
    assert.notStrictEqual(v.verdict, VERDICT.SUPPORTED, 'apoiou sem referencia para comparar');
    return `veredicto "${v.verdict}" (proposto "${v.proposed_verdict}"), ${x.challenges.length} passagem(ns) pelo auditor`;
  });
  await step(8, 'conhecimento persistido ou recusado, conforme a evidencia', () => {
    const base = knowledge.build(engine.store);
    const x = engine.store.experiment('exp_ep_s01');
    if (x.current_verdict.verdict === VERDICT.INCONCLUSIVE || x.current_verdict.verdict === VERDICT.AWAITING_DATA) {
      assert.strictEqual(base.length, 0, 'criou conhecimento a partir de veredicto inconclusivo');
      return 'nenhum conhecimento criado — o veredicto nao sustentava afirmacao. Isso e o comportamento certo.';
    }
    assert.ok(base.length >= 1);
    assert.ok(base[0].conditions, 'conhecimento sem condicoes');
    return `conhecimento "${base[0].knowledge_id}" na camada ${base[0].tier}`;
  });

  // segundo episodio, com referencia: agora o funil tem com o que comparar
  await step(9, 'segundo episodio consulta o aprendizado anterior antes de ser aceito', async () => {
    makeEpisode('ep_s02', { hypothesis: 'Abertura numerica sintetica prende mais que a abertura seca da linha de base.', variableValue: 'number_trio', appliesLearning: [] });
    // sem applies_learning, o estagio tem de RECUSAR
    const { experiment } = require('./stages/experiment');
    const paths = { base: path.join(LAB_DIR, 'episodes', 'ep_s02') };
    let refused = false;
    try { await experiment({ channelId: LAB, epId: 'ep_s02', paths }); }
    catch (e) { refused = /applies_learning/.test(e.message); }
    assert.ok(refused, 'o pipeline aceitou um segundo episodio sem citar aprendizado anterior');

    // agora com o aprendizado citado
    makeEpisode('ep_s02', { hypothesis: 'Abertura numerica sintetica prende mais que a abertura seca da linha de base.', variableValue: 'number_trio',
      appliesLearning: ['exp_ep_s01: retencao inicial medida em 61% no marco de 28 dias; esta e a referencia que este episodio tenta superar.'] });
    const out = await experiment({ channelId: LAB, epId: 'ep_s02', paths });
    assert.ok(out.mode === 'real');
    const saved = JSON.parse(fs.readFileSync(path.join(paths.base, 'experiment.json'), 'utf8'));
    assert.ok(saved.knowledge_consulted, 'o estagio nao consultou a base de conhecimento');
    assert.strictEqual(saved.prior_experiments, 1, 'nao enxergou o experimento anterior');
    assert.ok(saved.applies_learning.length >= 1);

    // e o ciclo do segundo agora tem referencia: o funil consegue comparar
    const up2 = new Date(Date.now() - 240 * 3600000).toISOString();
    const pub2 = new Date(Date.now() - 200 * 3600000).toISOString();
    engine.recordPublication('ep_s02', { kind: 'upload_privado', video_id: 'SINTETICO_VID_002',
      url: 'https://example.invalid/SINTETICO_VID_002', privacy: 'private', uploaded_privately_at: up2, author: 'teste_integrado' });
    engine.recordPublication('ep_s02', { kind: 'publicacao_publica', video_id: 'SINTETICO_VID_002',
      url: 'https://example.invalid/SINTETICO_VID_002', privacy: 'public', uploaded_privately_at: up2,
      published_publicly_at: pub2, privacy_confirmed_by_api: true, author: 'teste_integrado' });
    await engine.recordProduction('ep_s02', { gates: '32/32' });
    const run2 = await cycle.runFor(LAB, 'ep_s02', { collector: syntheticCollector({
      impressions: 15000, impressionsCtr: 0.049, views: 820, estimatedMinutesWatched: 2600,
      averageViewDuration: 190, averageViewPercentage: 41.2, subscribersGained: 31,
      retention_0_30s: 0.78, retention_mid: 0.41, retention_end: 0.24,
      top_traffic_source: 'BROWSE', shorts_referral_views: 'indisponivel', estimatedRevenue: 'indisponivel' }) });
    const x2 = engine.store.experiment('exp_ep_s02');
    assert.ok(x2.current_funnel, 'segundo ciclo sem funil');
    const er = x2.current_funnel.stages.early_retention;
    assert.ok(er.baseline !== undefined && er.baseline !== null, 'o segundo episodio deveria ter referencia do primeiro');
    return `ep_s02 comparado contra a referencia do ep_s01 (retencao inicial ${(er.value * 100).toFixed(0)}% contra ${(er.baseline * 100).toFixed(0)}%), veredicto "${run2.verdict}"`;
  });

  await step(10, 'idempotencia: rodar o ciclo de novo nao duplica medicao nem evento', async () => {
    const before = engine.store.reload().events.length;
    const again = await cycle.runFor(LAB, 'ep_s01', { collector: syntheticCollector({ impressions: 1, views: 1 }) });
    const after = engine.store.reload().events.length;
    assert.strictEqual(again.ran, false, 'rodou de novo um marco ja medido');
    assert.strictEqual(before, after, `gravou ${after - before} evento(s) a mais`);
    const x = engine.store.experiment('exp_ep_s01');
    assert.strictEqual(x.measurements.length, 1, 'duplicou medicao');
    return 'segundo disparo nao gravou nada';
  });

  await step(11, 'agendador encontra as tarefas vencidas e nao repete as concluidas', async () => {
    const t1 = await scheduler.tick(LAB, { collector: syntheticCollector({ impressions: 9, views: 9 }) });
    assert.ok(t1.due_found >= 2, `esperava tarefas vencidas, achei ${t1.due_found}`);
    const t2 = await scheduler.tick(LAB, { collector: syntheticCollector({ impressions: 9, views: 9 }) });
    const repetidas = t2.actions.filter((a) => a.action === 'concluido').length;
    assert.strictEqual(repetidas, 0, `o agendador repetiu ${repetidas} tarefa(s) ja concluida(s)`);
    const st = scheduler.status(LAB);
    return `${t1.due_found} tarefa(s) vencida(s); segunda passagem repetiu 0; estado: ${JSON.stringify(st.by_status)}`;
  });

  await step(12, 'o conhecimento gerado pelo ep_s02 aparece para o episodio SEGUINTE', async () => {
    const base = knowledge.build(engine.store);
    assert.ok(base.length >= 1, 'o veredicto "apoiado" do ep_s02 nao gerou conhecimento');
    const k = base[0];
    assert.ok(k.conditions && k.conditions.channel, 'conhecimento sem condicoes');
    assert.ok(k.supporting_experiments.includes('exp_ep_s02') || k.contradicting_experiments.includes('exp_ep_s02'));

    // terceiro episodio: o estagio precisa ENTREGAR esse aprendizado na mao do diretor editorial
    makeEpisode('ep_s03', { hypothesis: 'Terceiro episodio sintetico, para provar que o aprendizado anterior chega ate aqui.', variableValue: 'question',
      appliesLearning: [`${k.knowledge_id}: ${k.statement}`] });
    const { experiment } = require('./stages/experiment');
    const paths = { base: path.join(LAB_DIR, 'episodes', 'ep_s03') };
    await experiment({ channelId: LAB, epId: 'ep_s03', paths });
    const saved = JSON.parse(fs.readFileSync(path.join(paths.base, 'experiment.json'), 'utf8'));
    const briefing = saved.knowledge_consulted;
    const todas = [].concat(briefing.must_apply, briefing.worth_testing, briefing.do_not_repeat_blindly);
    assert.ok(todas.length >= 1, 'o briefing entregue ao terceiro episodio veio vazio');
    assert.ok(todas.some((t) => t.includes(k.statement.slice(0, 40))),
      'o aprendizado do ep_s02 nao chegou ao briefing do ep_s03');
    assert.ok(todas.every((t) => /valido apenas em/.test(t)),
      'o conhecimento foi citado sem as condicoes coladas');
    assert.strictEqual(saved.prior_experiments, 2, 'nao enxergou os dois experimentos anteriores');
    return `ep_s03 recebeu ${todas.length} item(ns) de conhecimento, todos com as condicoes coladas; ${saved.prior_experiments} experimentos anteriores visiveis`;
  });

  await step(13, 'o registro imutavel sobreviveu ao ciclo inteiro', () => {
    const chain = engine.stats().chain;
    assert.ok(chain.ok, chain.reason);
    return `${chain.events} eventos, corrente integra`;
  });

  console.log('\n\x1b[1mResumo\x1b[0m');
  notes.forEach((n) => console.log('  ' + n));
  cleanup();
  console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} passos ok, ${fail} falhas\x1b[0m`);
  if (fail) process.exit(1);
})().catch((e) => { try { cleanup(); } catch (_) {} console.error('\nERRO NA PROVA:', e.stack || e.message); process.exit(1); });
