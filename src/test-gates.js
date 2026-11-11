'use strict';
/**
 * TESTES NEGATIVOS — provam que o sistema BLOQUEIA o que precisa bloquear.
 * Cada caso injeta um defeito real num episodio de laboratorio e verifica que a
 * entrega e recusada. Teste que so prova o caminho feliz nao prova governanca.
 */
require('./env');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');
const PORT = Number(process.env.GATES_TEST_PORT || 3896);
const { Store } = require('./store');
const { factcheck } = require('./stages/audit');
const { media_rights } = require('./stages/production');
const yt = require('./youtube/oauth');
const ytQueue = require('./youtube/queue');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'content', 'channels', 'ch_practical_discipline', 'episodes', 'ep_001');
const LAB = path.join(ROOT, 'content', 'channels', 'ch_lab_content', 'episodes', 'ep_bad');
const LAB_CH = 'ch_lab_gates';
// canal/episodio de laboratorio no disco, para os estagios que carregam config por episodio
const LAB_CH_EP = 'ch_lab_content';
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log(`\x1b[32m  ok\x1b[0m   ${name}`); }
  catch (e) { fail++; console.log(`\x1b[31m  FALHA\x1b[0m ${name}\n        ${e.message}`); }
}
function freshLab() {
  // o laboratorio vira um canal de verdade no disco, para o carregador por episodio achar os 4 arquivos
  fs.rmSync(LAB, { recursive: true, force: true });
  fs.mkdirSync(LAB, { recursive: true });
  for (const f of ['brief.json', 'script_en.json', 'sources.json', 'claims.json', 'storyboard.json'])
    fs.copyFileSync(path.join(SRC, f), path.join(LAB, f));
  return { base: LAB, work: LAB, scenes: LAB, shorts: LAB, audio: LAB, stills: LAB };
}
const req = (method, p, body, channel) => new Promise((res, rej) => {
  const d = body ? JSON.stringify(body) : null;
  const r = http.request({ hostname: '127.0.0.1', port: PORT, path: p, method,
    headers: { ...(d ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } : {}), ...(channel ? { 'x-channel': channel } : {}) } },
    (x) => { let b = ''; x.on('data', (c) => (b += c)); x.on('end', () => { try { res({ status: x.statusCode, body: JSON.parse(b) }); } catch (_) { res({ status: x.statusCode, body: b }); } }); });
  r.on('error', rej); if (d) r.write(d); r.end();
});

let SRV = null;
(async () => {
  // a suite nao depende de servidor ja rodando: ela sobe o seu, em porta propria
  SRV = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')],
    { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', API_KEY: '' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 2500));
  console.log('\n— um fato sem fonte impede a entrega —');
  await t('afirmacao factual nova sem fonte REPROVA o estagio de auditoria', async () => {
    const paths = freshLab();
    const s = JSON.parse(fs.readFileSync(path.join(LAB, 'script_en.json'), 'utf8'));
    s.scenes[0].beats.push({ text: 'A two thousand twenty one study at Stanford found that ninety four percent of people quit by day three.', screen: 'hold' });
    fs.writeFileSync(path.join(LAB, 'script_en.json'), JSON.stringify(s));
    await assert.rejects(() => factcheck({ channelId: LAB_CH_EP, epId: 'ep_bad', paths }), /reprovou/i, 'o verificador deveria ter reprovado');
    const rp = path.join(LAB, 'claims_review.json');
    if (fs.existsSync(rp)) {
      const review = JSON.parse(fs.readFileSync(rp, 'utf8'));
      assert.ok(review.summary.blocked > 0, 'o relatorio deveria registrar o bloqueio');
      assert.ok(review.problems.some((x) => x.kind === 'SEM_ENTRADA_NA_MATRIZ'), 'faltou apontar a afirmacao sem entrada');
    }
  });
  await t('citacao atribuida a pessoa real sem fonte e detectada', async () => {
    const paths = freshLab();
    const s = JSON.parse(fs.readFileSync(path.join(LAB, 'script_en.json'), 'utf8'));
    s.scenes[0].beats.push({ text: 'As Marcus Aurelius wrote in two thousand eighteen, you must simply begin before dawn.', screen: 'hold' });
    fs.writeFileSync(path.join(LAB, 'script_en.json'), JSON.stringify(s));
    await assert.rejects(() => factcheck({ channelId: LAB_CH_EP, epId: 'ep_bad', paths }), /reprovou/i);
  });

  console.log('\n— midia com direito incerto impede a entrega —');
  await t('ativo com licenca desconhecida REPROVA o estagio de direitos', async () => {
    const paths = freshLab();
    const sb = JSON.parse(fs.readFileSync(path.join(LAB, 'storyboard.json'), 'utf8'));
    sb.scenes[2].asset.license = 'unknown';
    fs.writeFileSync(path.join(LAB, 'storyboard.json'), JSON.stringify(sb));
    await assert.rejects(() => media_rights({ channelId: LAB_CH_EP, epId: 'ep_bad', paths }), /licenca indefinida/i);
  });
  await t('ativo de terceiro fica registrado e visivel no manifesto', async () => {
    const paths = freshLab();
    const sb = JSON.parse(fs.readFileSync(path.join(LAB, 'storyboard.json'), 'utf8'));
    sb.scenes[1].asset.third_party_media = true;
    sb.scenes[1].asset.source = 'clipe de terceiro sem contrato';
    fs.writeFileSync(path.join(LAB, 'storyboard.json'), JSON.stringify(sb));
    const r = await media_rights({ channelId: LAB_CH_EP, epId: 'ep_bad', paths });
    const out = JSON.parse(fs.readFileSync(path.join(LAB, 'media_rights.json'), 'utf8'));
    assert.strictEqual(out.third_party_assets, 1, 'o manifesto precisa expor o ativo de terceiro');
    assert.ok(/third_party/.test(JSON.stringify(out)), 'ativo de terceiro deve aparecer no manifesto');
  });

  console.log('\n— aprovacao e publicacao travadas —');
  await t('API recusa aprovar episodio com gates reprovados (HTTP 412)', async () => {
    // canal de laboratorio proprio: teste nunca escreve no canal de producao
    const store = new Store(LAB_CH);
    store.ensureEpisode('ep_lab_block', { title: 'laboratorio' });
    store.append('gates.evaluated', { epId: 'ep_lab_block', gates: { verdict: 'BLOQUEADO', can_be_approved: false, blocking_failures: ['mp4_decodifica_inteiro'] } });
    const r = await req('POST', '/api/episodes/ep_lab_block/approval', { status: 'approved', by: 'teste' }, LAB_CH);
    assert.strictEqual(r.status, 412, `esperado 412, veio ${r.status}`);
    assert.ok(/gates/i.test(JSON.stringify(r.body)));
  });
  await t('aprovacao e recusada quando a auditoria esta DESATUALIZADA', async () => {
    const store = new Store(LAB_CH);
    store.ensureEpisode('ep_lab_stale', { title: 'auditoria velha' });
    store.append('gates.evaluated', { epId: 'ep_lab_stale', gates: { verdict: 'APROVADO_PARA_REVISAO_HUMANA', can_be_approved: true, blocking_failures: [] } });
    store.stageStart('ep_lab_stale', 'qa', {}); store.stageDone('ep_lab_stale', 'qa', { mode: 'real' });
    store.append('stage.invalidated', { epId: 'ep_lab_stale', stageIds: ['qa'], cause: 'voice' });
    const r = await req('POST', '/api/episodes/ep_lab_stale/approval', { status: 'approved', by: 'teste' }, LAB_CH);
    assert.strictEqual(r.status, 412, `esperado 412, veio ${r.status}`);
    assert.ok(/desatualizada/i.test(JSON.stringify(r.body)), 'a recusa deve dizer que a auditoria esta velha');
  });
  await t('fila de publicacao recusa episodio sem gates', async () => {
    const r = await req('POST', '/api/youtube/queue', { epId: 'ep_lab_block', privacy: 'private' }, LAB_CH);
    assert.strictEqual(r.status, 412, `esperado 412, veio ${r.status}`);
  });
  await t('fila recusa publicacao publica mesmo com tudo aprovado', async () => {
    const store = new Store('ch_lab_public');
    store.ensureEpisode('ep_p', {});
    store.append('gates.evaluated', { epId: 'ep_p', gates: { can_be_approved: true } });
    store.stageStart('ep_p', 'qa', {}); store.stageDone('ep_p', 'qa', { mode: 'real' });
    store.append('approval.decided', { epId: 'ep_p', status: 'approved', by: 'p', scheduled_upload_authorized: true });
    await assert.rejects(() => ytQueue.enqueue(store, 'ep_p', { approvedBy: 'p', privacy: 'public' }), /privado/i);
    fs.rmSync(path.dirname(store.statePath), { recursive: true, force: true });
  });
  await t('aprovar um video NAO autoriza o proximo', async () => {
    const store = new Store('ch_lab_scope');
    store.ensureEpisode('ep_a', {}); store.ensureEpisode('ep_b', {});
    store.append('gates.evaluated', { epId: 'ep_a', gates: { can_be_approved: true } });
    store.append('gates.evaluated', { epId: 'ep_b', gates: { can_be_approved: true } });
    for (const e of ['ep_a', 'ep_b']) { store.stageStart(e, 'qa', {}); store.stageDone(e, 'qa', { mode: 'real' }); }
    store.append('approval.decided', { epId: 'ep_a', status: 'approved', by: 'p', scheduled_upload_authorized: true });
    assert.strictEqual(store.episode('ep_b').approval.status, 'pending', 'aprovacao vazou para outro episodio');
    await assert.rejects(() => ytQueue.enqueue(store, 'ep_b', { approvedBy: 'p' }), /aprovacao/i);
    fs.rmSync(path.dirname(store.statePath), { recursive: true, force: true });
  });

  fs.rmSync(path.join(ROOT, 'content', 'channels', 'ch_lab_content'), { recursive: true, force: true });
  if (SRV) SRV.kill();
  fs.rmSync(path.join(ROOT, 'var', 'channels', LAB_CH), { recursive: true, force: true });
  console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} bloqueios comprovados, ${fail} falhas\x1b[0m`);
  if (fail) process.exit(1);
})();
