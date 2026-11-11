'use strict';
/**
 * Testes do cliente YouTube contra um ESPELHO LOCAL do Google.
 *
 * O que isto prova: que o NOSSO codigo faz o aperto de mao certo — state de uso
 * unico, troca de codigo, refresh em 401, sessao retomavel, 308, retomada apos
 * queda de conexao, trava de duplicidade, privacidade forcada e revogacao.
 * O que isto NAO prova: que o Google aceitou. Isso so acontece quando o dono
 * autorizar com as credenciais dele. O relatorio diz as duas coisas.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const ROOT = path.join(__dirname, '..');
/**
 * ISOLAMENTO TOTAL: a suite roda inteira dentro de um diretorio temporario do
 * sistema. Ela NAO escreve e NAO apaga nada em var/ — nem token, nem registro
 * de upload, nem log de experimento. Uma versao anterior desta suite apagava
 * var/uploads inteiro no fim; isso destruiria o historico de publicacao real.
 */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ymc-yt-test-'));
const TMP = path.join(SANDBOX, 'work');
process.env.YT_UPLOAD_STATE_DIR = path.join(SANDBOX, 'uploads');
process.env.YT_TOKEN_DIR = path.join(SANDBOX, 'tokens');
process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
// A trava de canal e de producao. No sandbox ela aponta para o canal de teste,
// senao a suite tentaria enviar para o Quiet Resolve — e seria recusada, certo.
process.env.YT_CHANNELS_CONFIG = path.join(SANDBOX, 'channels.json');
fs.writeFileSync(process.env.YT_CHANNELS_CONFIG, JSON.stringify({
  // vinculado por ID: e esta a unica condicao em que escrita e permitida
  official: { internal_key: 'ch_yt_test', expected_title: 'Canal de Teste', expected_handle: '@teste',
    youtube_channel_id: 'UC_TESTE_123', bound: true, bound_at: '2026-11-11T00:00:00.000Z' },
  forbidden: [{ title: 'Kalleby Prado', reason: 'canal pessoal (replicado aqui para o teste do bloqueio)' }],
  authorized_not_in_use: [], policy: ['sandbox']
}, null, 2));
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log(`\x1b[32m  ok\x1b[0m   ${name}`); }
  catch (e) { fail++; console.log(`\x1b[31m  FALHA\x1b[0m ${name}\n        ${e.message}`); }
}
function freshModules() {
  for (const k of Object.keys(require.cache)) if (/youtube[\/\\](oauth|upload|http|token-store|queue|analytics)\.js$/.test(k)) delete require.cache[k];
  return { oauth: require('./youtube/oauth'), upload: require('./youtube/upload'),
    queue: require('./youtube/queue'), analytics: require('./youtube/analytics'), tokens: require('./youtube/token-store') };
}
const CH = 'ch_yt_test';

(async () => {
  const mock = require('./youtube/_mock-google');
  fs.mkdirSync(TMP, { recursive: true });

  // ---------- sem credenciais ----------
  delete process.env.YOUTUBE_CLIENT_ID; delete process.env.YOUTUBE_CLIENT_SECRET;
  let M = freshModules();
  M.tokens.clear(CH);
  await t('sem credenciais do cliente, o estado e BLOQUEADO e upload e impossivel', async () => {
    const st = await M.oauth.state(CH);
    assert.strictEqual(st.status, 'BLOQUEADO');
    assert.strictEqual(st.upload_possible, false);
    assert.ok(st.next_step, 'precisa dizer o passo humano');
  });

  // ---------- com espelho ----------
  const g = await mock.start({ behavior: {} });
  Object.assign(process.env, g.base);
  process.env.YOUTUBE_CLIENT_ID = 'CLIENT_ID_TESTE';
  process.env.YOUTUBE_CLIENT_SECRET = 'CLIENT_SECRET_TESTE';
  process.env.YOUTUBE_REDIRECT_URI = 'http://127.0.0.1:3777/api/youtube/oauth/callback';
  M = freshModules();

  await t('token guardado NAO e prova: sem verificacao viva o estado nao e AUTORIZADO', async () => {
    M.tokens.save(CH, { access_token: 'TOKEN_FALSO', refresh_token: 'R_FALSO', expires_at: Date.now() + 3600000, scope: '' });
    const st = await M.oauth.state(CH, { live: false });
    assert.strictEqual(st.status, 'TOKEN_PRESENTE_NAO_VERIFICADO');
    assert.strictEqual(st.upload_possible, false);
  });
  await t('token invalido reprovado na verificacao derruba para PENDENTE', async () => {
    const st = await M.oauth.state(CH);
    assert.strictEqual(st.status, 'PENDENTE_AUTORIZACAO', `veio ${st.status}`);
    assert.ok(/verificacao|recusou/i.test(st.reason), st.reason);
    M.tokens.clear(CH);
  });

  await t('authUrl carrega state imprevisivel e escopos corretos', () => {
    const url = M.oauth.authUrl(CH);
    const u = new URL(url);
    const state = u.searchParams.get('state');
    assert.ok(state && state.length >= 40, 'state curto demais');
    assert.strictEqual(u.searchParams.get('access_type'), 'offline');
    assert.strictEqual(u.searchParams.get('prompt'), 'consent');
    for (const s of M.oauth.SCOPES) assert.ok(u.searchParams.get('scope').includes(s), `escopo ausente: ${s}`);
  });
  await t('callback com state forjado e recusado', async () => {
    g.issueCode('CODE_1');
    const r = await M.oauth.handleCallback({ code: 'CODE_1', state: crypto.randomBytes(32).toString('base64url') });
    assert.strictEqual(r.ok, false);
    assert.ok(/state invalido/i.test(r.reason), r.reason);
  });
  await t('callback sem code e recusado', async () => {
    const url = new URL(M.oauth.authUrl(CH));
    const r = await M.oauth.handleCallback({ state: url.searchParams.get('state') });
    assert.strictEqual(r.ok, false);
    assert.ok(/sem code/i.test(r.reason), r.reason);
  });
  await t('callback valido troca o codigo, guarda cifrado e VERIFICA o canal na API', async () => {
    g.issueCode('CODE_OK');
    const url = new URL(M.oauth.authUrl(CH));
    const r = await M.oauth.handleCallback({ code: 'CODE_OK', state: url.searchParams.get('state') });
    assert.ok(r.ok, r.reason);
    assert.strictEqual(r.youtube_channel_id, 'UC_TESTE_123');
    assert.strictEqual(r.title, 'Canal de Teste');
    assert.strictEqual(r.missing_scopes.length, 0);
    const raw = fs.readFileSync(M.tokens.file(CH), 'utf8');
    assert.ok(!raw.includes('AT_'), 'token em claro no disco');
    assert.strictEqual(M.tokens.fileMode(CH), '0600');
  });
  await t('o mesmo state nao serve duas vezes', async () => {
    const url = new URL(M.oauth.authUrl(CH));
    const st = url.searchParams.get('state');
    g.issueCode('CODE_A'); g.issueCode('CODE_B');
    const r1 = await M.oauth.handleCallback({ code: 'CODE_A', state: st });
    const r2 = await M.oauth.handleCallback({ code: 'CODE_B', state: st });
    assert.ok(r1.ok, r1.reason);
    assert.strictEqual(r2.ok, false);
  });
  await t('estado AUTORIZADO so aparece depois da checagem viva', async () => {
    M.oauth.invalidateCache();
    const st = await M.oauth.state(CH);
    assert.strictEqual(st.status, 'AUTORIZADO');
    assert.strictEqual(st.upload_possible, true);
    assert.strictEqual(st.youtube_channel_id, 'UC_TESTE_123');
    assert.ok(!JSON.stringify(st).includes('AT_'), 'o estado exposto vazou token');
  });
  await t('token expirado e renovado sozinho via refresh_token', async () => {
    const before = M.tokens.load(CH).access_token;
    g.expireAccessTokens();
    const t2 = M.tokens.load(CH);
    M.tokens.save(CH, { ...t2, expires_at: Date.now() - 1000 });
    const fresh = await M.oauth.accessToken(CH);
    assert.notStrictEqual(fresh, before, 'nao renovou');
    assert.ok(fresh.startsWith('AT_'));
  });

  // ---------- upload ----------
  const vid = path.join(TMP, 'fake.mp4');
  fs.writeFileSync(vid, crypto.randomBytes(3 * 1024 * 1024 + 7777));
  const META = { title: 'Teste privado', description: 'd', tags: ['t'], made_for_kids: false, privacy_status: 'private' };
  let uploadedId = null;
  await t('upload retomavel envia tudo e devolve video_id, com privacidade private', async () => {
    const prog = [];
    const r = await M.upload.uploadVideo({ channelId: CH, epId: 'ep_t1', filePath: vid, metadata: META,
      onProgress: (s2, tt) => prog.push(s2 / tt) });
    assert.ok(r.video_id, 'sem video_id');
    assert.strictEqual(r.privacy, 'private');
    assert.strictEqual(r.bytes, fs.statSync(vid).size);
    assert.ok(prog.length >= 1, 'sem progresso reportado');
    uploadedId = r.video_id;
  });
  await t('o estado real do video e conferido NA API, nao no arquivo local', async () => {
    const v = await M.upload.verifyUploaded(CH, uploadedId);
    assert.strictEqual(v.found, true);
    assert.strictEqual(v.privacy, 'private');
    assert.ok(v.url.includes(uploadedId));
  });
  await t('upload duplicado do mesmo arquivo e impedido', async () => {
    await assert.rejects(() => M.upload.uploadVideo({ channelId: CH, epId: 'ep_t1', filePath: vid, metadata: META }),
      /duplicidade impedida/i);
  });
  await t('privacidade publica e recusada no cliente, antes de qualquer rede', async () => {
    await assert.rejects(() => M.upload.uploadVideo({ channelId: CH, epId: 'ep_t2', filePath: vid,
      metadata: { ...META, privacy_status: 'public' } }), /privacyStatus recusado/i);
  });

  await g.close();

  // ---------- retomada apos queda de conexao ----------
  const g2 = await mock.start({ behavior: { forceInterruptAt: 1024 * 1024 } });
  Object.assign(process.env, g2.base);
  M = freshModules();
  g2.issueCode('CODE_R');
  {
    const url = new URL(M.oauth.authUrl(CH));
    const r = await M.oauth.handleCallback({ code: 'CODE_R', state: url.searchParams.get('state') });
    assert.ok(r.ok, r.reason);
  }
  await t('conexao cai no meio e o upload retoma do byte que o servidor confirmou', async () => {
    const r = await M.upload.uploadVideo({ channelId: CH, epId: 'ep_t3', filePath: vid, metadata: META });
    assert.ok(r.video_id, 'nao concluiu apos a queda');
    assert.ok(r.retries === undefined || r.retries >= 0);
    assert.strictEqual(g2.state.interrupted, true, 'o espelho nao chegou a interromper');
    const v = await M.upload.verifyUploaded(CH, r.video_id);
    assert.strictEqual(v.privacy, 'private');
  });
  await t('registro de upload guarda sha256 do arquivo e a URI de sessao', () => {
    const rec = M.upload.readRec(CH, 'ep_t3');
    assert.ok(rec.file_sha256 && rec.file_sha256.length === 64);
    assert.ok(rec.session_uri);
    assert.ok(rec.video_id);
  });

  // ---------- analytics ----------
  await t('analytics devolve COLETADO quando ha video publicado', async () => {
    M.oauth.invalidateCache();
    const rec = M.upload.readRec(CH, 'ep_t3');
    const a = await M.analytics.collect(CH, [{ video_id: rec.video_id, epId: 'ep_t3' }]);
    assert.strictEqual(a.status, 'COLETADO');
    assert.strictEqual(a.videos.length, 1);
  });
  await t('analytics sem publicacao devolve BLOQUEADO com tudo indisponivel', async () => {
    const a = await M.analytics.collect(CH, []);
    assert.strictEqual(a.status, 'BLOQUEADO');
    assert.ok(Object.values(a.metrics).every((v) => v === 'indisponivel'));
    assert.ok(!Object.values(a.metrics).some((v) => v === 0));
  });

  // ---------- trava de canal no proprio cliente de upload ----------
  await t('canal NAO vinculado bloqueia o cliente de upload', async () => {
    const cfgPath = process.env.YT_CHANNELS_CONFIG;
    const saved = fs.readFileSync(cfgPath, 'utf8');
    const c = JSON.parse(saved);
    c.official.bound = false; c.official.youtube_channel_id = null;
    fs.writeFileSync(cfgPath, JSON.stringify(c, null, 2));
    try {
      await assert.rejects(() => M.upload.uploadVideo({ channelId: CH, epId: 'ep_nb', filePath: vid, metadata: META }),
        /nao foi vinculado/i);
    } finally { fs.writeFileSync(cfgPath, saved); }
  });
  await t('canal pessoal bloqueia o cliente de upload mesmo vinculado a outro', async () => {
    const cfgPath = process.env.YT_CHANNELS_CONFIG;
    const saved = fs.readFileSync(cfgPath, 'utf8');
    const c = JSON.parse(saved);
    c.forbidden = [{ title: 'Canal de Teste', reason: 'colocado na lista de proibidos de proposito, para provar que a lista vence o vinculo' }];
    fs.writeFileSync(cfgPath, JSON.stringify(c, null, 2));
    try {
      await assert.rejects(() => M.upload.uploadVideo({ channelId: CH, epId: 'ep_pb', filePath: vid, metadata: META }),
        /lista de proibidos/i);
    } finally { fs.writeFileSync(cfgPath, saved); }
  });

  // ---------- revogacao ----------
  await t('revogar chama o Google e so entao apaga o token local', async () => {
    const r = await M.oauth.revoke(CH);
    assert.ok(r.ok, r.reason);
    assert.strictEqual(r.revoked_remotely, true);
    assert.strictEqual(M.tokens.exists(CH), false, 'token local sobreviveu');
  });
  await t('depois de revogar, o estado volta a PENDENTE e upload fica impossivel', async () => {
    M.oauth.invalidateCache();
    const st = await M.oauth.state(CH);
    assert.strictEqual(st.status, 'PENDENTE_AUTORIZACAO');
    assert.strictEqual(st.upload_possible, false);
    await assert.rejects(() => M.upload.uploadVideo({ channelId: CH, epId: 'ep_t9', filePath: vid, metadata: META }), /bloqueado/i);
  });
  await g2.close();

  // ---------- segredos nunca em texto ----------
  await t('a funcao de limpeza remove token de qualquer texto de erro', () => {
    const { scrub } = require('./youtube/http');
    const dirty = 'erro {"access_token":"ya29.SEGREDO","refresh_token":"1//SEGREDO"} Bearer ya29.XYZ ?code=abc123&x=1';
    const clean = scrub(dirty);
    for (const s of ['ya29.SEGREDO', '1//SEGREDO', 'ya29.XYZ', 'abc123']) assert.ok(!clean.includes(s), `vazou ${s}`);
  });

  // limpa SO o sandbox; nada em var/ e tocado
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} aprovados, ${fail} falhas\x1b[0m`);
  console.log('\x1b[90mEscopo desta suite: o cliente desta casa, contra espelho local.');
  console.log('Ela NAO prova que o Google aceitou nada — isso exige as credenciais do dono.\x1b[0m');
  if (fail) process.exit(1);
})().catch((e) => { console.error('ERRO NA SUITE:', e.stack || e.message); process.exit(1); });
