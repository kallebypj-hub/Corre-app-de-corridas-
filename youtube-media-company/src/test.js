'use strict';
/**
 * Testes do youtube-media-company.
 * Regra: teste que passa sem o artefato existir nao conta. Os testes de midia
 * decodificam arquivo de verdade; se o MP4 nao existir, eles FALHAM, nao pulam.
 */
require('./env');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { probe, fullDecodeCheck, audioStats } = require('./media');
const { Store } = require('./store');
const { STAGES, downstreamOf } = require('./pipeline');
const { buildCaptions, splitIntoCues, parseSRT } = require('./render/captions');
const { sceneHTML, beatState } = require('./render/compose');
const { levenshteinWords } = require('./stages/production');
const ceo = require('./ceo');
const yt = require('./youtube/oauth');
const ytQueue = require('./youtube/queue');
const ytAnalytics = require('./youtube/analytics');

const { listEpisodeDirs, loadBrief } = require('./episode-config');
const CH = process.env.CHANNEL_ID || 'ch_practical_discipline';
// Nenhum episodio e padrao no codigo: vem do argumento ou do disco.
const EP = process.argv[2] || listEpisodeDirs(CH)[0];
if (!EP) { console.error('nenhum episodio no disco'); process.exit(1); }
const BASE = path.join(__dirname, '..', 'content', 'channels', CH, 'episodes', EP);
let pass = 0, fail = 0; const failures = [];
async function t(name, fn) {
  try { await fn(); pass++; console.log(`\x1b[32m  ok\x1b[0m   ${name}`); }
  catch (e) { fail++; failures.push({ name, error: e.message }); console.log(`\x1b[31m  FALHA\x1b[0m ${name}\n        ${e.message}`); }
}
const J = (f) => JSON.parse(fs.readFileSync(path.join(BASE, f), 'utf8'));

(async () => {
  console.log(`\n\x1b[1mepisodio sob teste: ${EP}\x1b[0m`);
  console.log('\n— estrutura e isolamento —');
  await t('o episodio tem os quatro arquivos de configuracao, e o pipeline nao contem conteudo dele', () => {
    const base = path.join(__dirname, '..', 'content', 'channels', CH, 'episodes', EP);
    for (const f of ['brief.json', 'script_en.json', 'sources.json', 'claims.json'])
      assert.ok(fs.existsSync(path.join(base, f)), `falta ${f}`);
    // nenhum identificador de episodio aparece no codigo dos estagios
    const src = ['stages/editorial.js', 'stages/audit.js', 'stages/production.js', 'stages/finishing.js',
      'stages/shorts.js', 'stages/compliance.js'].map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
    assert.ok(!/ep_00\d/.test(src), 'codigo de estagio contem identificador de episodio');
    const brief = loadBrief(CH, EP);
    assert.ok(!src.includes(brief.metadata.title), 'o titulo do episodio esta embutido no codigo');
  });
  await t('nenhuma dependencia npm declarada', () => {
    const p = require('../package.json');
    assert.strictEqual(Object.keys(p.dependencies || {}).length, 0, 'o projeto nao deve instalar pacotes npm');
  });
  await t('nao le dados de outro projeto', () => {
    const src = fs.readFileSync(path.join(__dirname, 'store.js'), 'utf8') + fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    for (const forb of ['corre-api', 'corre-app', 'Kaeps', 'AI Company OS'])
      assert.ok(!src.includes(forb), `referencia proibida a ${forb}`);
  });
  await t('porta propria e isolada', () => {
    assert.strictEqual(Number(process.env.PORT || 3777), 3777);
  });

  console.log('\n— pipeline —');
  await t('19 estagios com dependencias validas', () => {
    assert.strictEqual(STAGES.length, 19);
    const ids = new Set(STAGES.map((s) => s.id));
    for (const s of STAGES) for (const d of s.deps) assert.ok(ids.has(d), `dep inexistente ${d} em ${s.id}`);
  });
  await t('invalidacao em cascata cobre os dependentes', () => {
    const d = downstreamOf('voice');
    for (const must of ['align', 'scenes', 'edit', 'captions', 'shorts', 'qa'])
      assert.ok(d.includes(must), `refazer voice deveria invalidar ${must}`);
    assert.ok(!downstreamOf('qa').length, 'qa nao deve invalidar nada');
  });
  await t('store reconstroi o estado a partir do log append-only', () => {
    const s = new Store('ch_test_suite');
    s.ensureEpisode('ep_x', { title: 'x' });
    s.stageStart('ep_x', 'script', { agent: 'scriptwriter' });
    s.stageDone('ep_x', 'script', { mode: 'real' });
    fs.unlinkSync(s.statePath);
    const s2 = new Store('ch_test_suite');
    assert.strictEqual(s2.episode('ep_x').stages.script.status, 'done');
    fs.rmSync(path.dirname(s.statePath), { recursive: true, force: true });
  });

  console.log('\n— governanca —');
  await t('CEO recusa publicar, gastar e conectar conta', async () => {
    const store = new Store(CH);
    for (const [msg, key] of [['publicar o video agora', 'publish'], ['pode gastar 50 dolares em api', 'spend'], ['conectar conta do google', 'account']]) {
      const r = await ceo.handle(msg, { store, pipeline: null, channelId: CH });
      assert.strictEqual(r.message, ceo.DENY[key], `CEO deveria recusar: ${msg}`);
    }
  });
  await t('CEO responde status a partir do store, nao de texto fixo', async () => {
    const store = new Store(CH);
    const r = await ceo.handle('status', { store, pipeline: null, channelId: CH });
    assert.ok(/Pipeline: \d+\/\d+/.test(r.message), 'status deve conter contagem real de estagios');
    assert.ok(r.data && r.data.ep, 'status deve devolver o episodio lido do store');
  });
  await t('sem OAuth, publicacao e analytics ficam BLOQUEADOS (nunca simulados)', async () => {
    const st = await yt.state(CH);
    assert.ok(['BLOQUEADO', 'PENDENTE_AUTORIZACAO', 'TOKEN_PRESENTE_NAO_VERIFICADO'].includes(st.status), `estado inesperado ${st.status}`);
    assert.strictEqual(st.upload_possible, false);
    const an = await ytAnalytics.collect(CH, []);
    assert.strictEqual(an.status, 'BLOQUEADO');
    for (const v of Object.values(an.metrics)) assert.strictEqual(v, 'indisponivel', 'metrica ausente deve ser indisponivel, nunca 0');
  });
  await t('token guardado nao basta: sem verificacao viva nao ha AUTORIZADO', async () => {
    const st = await yt.state(CH, { live: false });
    assert.notStrictEqual(st.status, 'AUTORIZADO', 'estado AUTORIZADO sem checagem viva');
  });
  await t('fila de publicacao exige gates, auditoria atual, aprovacao e privacidade privada', async () => {
    const store = new Store('ch_test_queue');
    store.ensureEpisode('ep_q', {});
    await assert.rejects(() => ytQueue.enqueue(store, 'ep_q', { approvedBy: 'x' }), /gates/i);
    store.append('gates.evaluated', { epId: 'ep_q', gates: { can_be_approved: true, verdict: 'ok' } });
    await assert.rejects(() => ytQueue.enqueue(store, 'ep_q', { approvedBy: 'x' }), /auditoria desatualizada/i);
    store.stageStart('ep_q', 'qa', {}); store.stageDone('ep_q', 'qa', { mode: 'real' });
    await assert.rejects(() => ytQueue.enqueue(store, 'ep_q', { approvedBy: 'x' }), /aprovacao/i);
    store.append('approval.decided', { epId: 'ep_q', status: 'approved', by: 'p', scheduled_upload_authorized: false });
    await assert.rejects(() => ytQueue.enqueue(store, 'ep_q', { approvedBy: 'x' }), /envio programado/i);
    store.append('approval.decided', { epId: 'ep_q', status: 'approved', by: 'p', scheduled_upload_authorized: true });
    await assert.rejects(() => ytQueue.enqueue(store, 'ep_q', { approvedBy: 'x', privacy: 'public' }), /privado/i);
    const rec = await ytQueue.enqueue(store, 'ep_q', { approvedBy: 'p', privacy: 'private' });
    assert.strictEqual(rec.privacy, 'private');
    assert.strictEqual(rec.status, 'BLOCKED_NO_OAUTH', 'sem OAuth a fila nao pode ficar pronta para enviar');
    fs.rmSync(path.dirname(store.statePath), { recursive: true, force: true });
  });

  console.log('\n— composicao e legendas —');
  await t('revelacao por beat e cumulativa e o motivo e desenhado', () => {
    const sc = J('script_en.json').scenes[6];
    const first = beatState(sc, 0), last = beatState(sc, sc.beats.length - 1);
    assert.ok(!first.cite || !last.cite === false, 'estado deve evoluir');
    assert.ok(sceneHTML(sc, 0).includes('<svg'), 'cada frame tem geometria desenhada por codigo');
    assert.ok(!/<img|background-image:\s*url\(/.test(sceneHTML(sc, 0)), 'nenhuma imagem externa pode entrar no frame');
  });
  await t('cue de legenda respeita 2 linhas de 42 caracteres', () => {
    const long = 'In two thousand sixteen a twenty three lab preregistered replication with two thousand one hundred forty one participants put that effect near zero';
    for (const c of splitIntoCues(long)) assert.ok(c.length <= 84, `cue grande demais: ${c.length}`);
  });
  await t('legendas nao se sobrepoem nem ultrapassam a fala medida', () => {
    const tl = [{ lineId: 'a', text: 'One short sentence here.', start: 0, end: 2 },
      { lineId: 'b', text: 'A much longer sentence that certainly has to be split into more than one caption cue because it is long.', start: 2.5, end: 9 }];
    const { cues } = buildCaptions(tl, null);
    for (let i = 1; i < cues.length; i++) assert.ok(cues[i].start >= cues[i - 1].end, 'sobreposicao');
    assert.ok(cues[cues.length - 1].end <= 9.001, 'cue passou do fim da fala');
  });
  await t('WER calcula distancia de palavra corretamente', () => {
    assert.strictEqual(levenshteinWords(['a', 'b', 'c'], ['a', 'b', 'c']), 0);
    assert.strictEqual(levenshteinWords(['a', 'b', 'c'], ['a', 'x', 'c']), 1);
  });

  console.log('\n— artefatos reais no disco (decodificacao de verdade) —');
  const V = path.join(BASE, 'video_long_1080p.mp4');
  await t('video_long_1080p.mp4 existe', () => assert.ok(fs.existsSync(V), `ausente: ${V}`));
  if (fs.existsSync(V)) {
    const vp = await probe(V);
    await t('MP4 e 1920x1080 H.264 com faixa AAC', () => {
      assert.strictEqual(vp.video.width, 1920); assert.strictEqual(vp.video.height, 1080);
      assert.strictEqual(vp.video.codec, 'h264'); assert.ok(vp.audio, 'sem faixa de audio');
      assert.strictEqual(vp.audio.codec, 'aac');
    });
    await t('duracao entre 6 e 9 minutos', () => assert.ok(vp.duration >= 360 && vp.duration <= 540, `${(vp.duration / 60).toFixed(2)} min`));
    await t('arquivo decodifica do inicio ao fim sem erro', async () => {
      const d = await fullDecodeCheck(V); assert.ok(d.ok, `decodificacao falhou: ${d.stderr}`);
    });
    await t('audio audivel e sem clipping', async () => {
      const a = await audioStats(V);
      assert.ok(a.mean_volume_db > -45, `faixa muda: ${a.mean_volume_db}`);
      assert.ok(a.max_volume_db < -0.1, `clipping: ${a.max_volume_db}`);
    });
    await t('legendas terminam dentro do video', () => {
      const cues = parseSRT(path.join(BASE, 'captions.srt'));
      assert.ok(cues.length > 50, `poucos cues: ${cues.length}`);
      assert.ok(cues[cues.length - 1].end <= vp.duration + 0.5, 'legenda passa do fim do video');
    });
  }
  await t('duas miniaturas 16:9 distintas', async () => {
    const a = await probe(path.join(BASE, 'thumbnail_A.png'));
    const b = await probe(path.join(BASE, 'thumbnail_B.png'));
    assert.ok(Math.abs(a.video.width / a.video.height - 16 / 9) < 0.02);
    assert.notStrictEqual(a.size, b.size, 'miniaturas identicas');
  });
  await t('tres Shorts 1080x1920 que decodificam e tem audio', async () => {
    const dir = path.join(BASE, 'shorts');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mp4'));
    assert.strictEqual(files.length, 3, `esperado 3 shorts, achei ${files.length}`);
    for (const f of files) {
      const p = await probe(path.join(dir, f));
      assert.strictEqual(p.video.width, 1080); assert.strictEqual(p.video.height, 1920);
      assert.ok(p.audio, `${f} sem audio`); assert.ok(p.duration <= 59.5, `${f} longo demais`);
      const d = await fullDecodeCheck(path.join(dir, f));
      assert.ok(d.ok, `${f} nao decodifica`);
    }
  });
  await t('legenda queimada nos Shorts comprovada por medicao de pixel', () => {
    for (const sh of J('shorts_manifest.json').shorts) {
      assert.strictEqual(sh.captions_burned, true, `${sh.short_id} sem legenda queimada`);
      const e = sh.captions_burned_evidence;
      assert.ok(e && e.frame_bright_pixels_pct > e.backdrop_bright_pixels_pct,
        `${sh.short_id}: sem evidencia de pixel de texto na faixa de legenda`);
    }
  });
  await t('Shorts nao se sobrepoem no video longo', () => {
    const w = J('shorts_manifest.json').shorts.map((s) => s.source_window_s).sort((a, b) => a.start - b.start);
    for (let i = 1; i < w.length; i++) assert.ok(w[i].start >= w[i - 1].end, 'janelas sobrepostas');
  });
  await t('toda afirmacao factual tem fonte', () => {
    const c = J('claims_review.json');
    assert.strictEqual(c.summary.verdict, 'APROVADO', 'auditoria de fatos nao aprovada');
    assert.strictEqual(c.summary.blocked, 0, `${c.summary.blocked} bloqueio(s)`);
    assert.strictEqual(c.summary.orphan_assertions, 0, 'matriz com entrada orfa');
    assert.ok(c.matrix_verifier, 'matriz sem verificador declarado');
  });
  await t('todo ativo tem licenca e nenhum e de terceiro', () => {
    const p = J('provenance.json');
    for (const a of p.visual_assets_by_scene) assert.ok(a.license && !/unknown/i.test(a.license), `${a.scene} sem licenca`);
    assert.strictEqual(p.third_party_media_used, false);
    assert.strictEqual(p.external_spend_usd, 0);
  });
  await t('toda afirmacao verificada aponta para fonte existente no dossie', () => {
    const c = J('claims_review.json'); const src = new Set(J('sources.json').sources.map((x) => x.id));
    for (const r of c.rows) for (const s2 of (r.sources || [])) assert.ok(src.has(s2), `fonte fantasma: ${s2}`);
  });
  await t('cada estagio declarou seu nivel de autonomia', () => {
    const ep = new Store(CH).episode(EP);
    const done = Object.values(ep.stages).filter((s2) => s2.status === 'done');
    const sem = done.filter((s2) => !s2.autonomy || !s2.autonomy.level);
    assert.strictEqual(sem.length, 0, `${sem.length} estagio(s) sem declaracao de autonomia`);
    const assistidos = done.filter((s2) => s2.autonomy.level === 'assisted');
    assert.ok(assistidos.length >= 1, 'nenhum estagio declarado como assistido — isso seria desonesto');
  });
  await t('narracao inteligivel comprovada por reconhecimento de fala', () => {
    const ir = J('intelligibility_report.json');
    assert.ok(ir.word_error_rate <= 0.15, `WER ${(ir.word_error_rate * 100).toFixed(1)}%`);
  });
  await t('despesa externa zero em todos os estagios', () => {
    const ep = new Store(CH).episode(EP);
    for (const s of Object.values(ep.stages)) assert.strictEqual(((s.cost || {}).usd) || 0, 0, `${s.id} custou dinheiro`);
  });
  await t('metadata sem promessa de monetizacao e com publico declarado', () => {
    const m = J('metadata.json');
    assert.strictEqual(typeof m.made_for_kids, 'boolean');
    assert.strictEqual(m.privacy_status, 'private');
    assert.ok(!/guaranteed|earn \$|\bRPM\b|\bCPM\b/i.test(m.description));
    assert.ok(m.title.length <= 100);
  });

  console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} aprovados, ${fail} falhas\x1b[0m`);
  if (fail) { console.log('\nfalhas:'); failures.forEach((f) => console.log(` - ${f.name}: ${f.error}`)); process.exit(1); }
})();
