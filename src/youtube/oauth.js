'use strict';
/**
 * OAuth 2.0 do Google para YouTube Data v3 + YouTube Analytics.
 *
 * Principios:
 *  - A EXISTENCIA DE ARQUIVO NAO E PROVA DE TOKEN VALIDO. O estado AUTORIZADO
 *    so e declarado depois de uma chamada real a API que confirme o canal.
 *  - state imprevisivel (32 bytes), com expiracao e uso unico.
 *  - refresh automatico com folga de 60s; falha de refresh derruba para PENDENTE.
 *  - revogacao chama o endpoint do Google e so entao apaga o token local.
 *  - nenhum token volta pela API do painel.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { request, apiError, ENDPOINTS, scrub } = require('./http');
const store = require('./token-store');
const { Logger } = require('../log');

const log = new Logger('youtube.oauth');
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly'
];
const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_FILE = path.join(store.DIR, 'oauth-state.json');

/**
 * UM UNICO TIPO DE CREDENCIAL, em todo o projeto e em toda a documentacao:
 * "Aplicativo da Web" (Web application) no Google Cloud.
 *
 * Por que este e nao "Aplicativo de desktop":
 *  - este sistema atende num endereco FIXO e num caminho FIXO
 *    (http://127.0.0.1:3777/api/youtube/oauth/callback), porque o painel ja e
 *    um servidor HTTP. O tipo Aplicativo da Web e o unico em que se cadastra o
 *    redirect exato no console — e redirect cadastrado e redirect que casa.
 *  - o Google exige HTTPS nos redirects de aplicativo web, com UMA excecao
 *    explicita: endereco de loopback (localhost e 127.0.0.1). O nosso e loopback,
 *    entao http e aceito.
 *  - o tipo Aplicativo de desktop foi desenhado para porta efemera sorteada na
 *    hora e nao tem campo de redirect no console, o que nao combina com um
 *    caminho fixo e abre espaco para redirect_uri_mismatch.
 *  - o tunel SSH nao muda nada disso: do lado do Google o redirect continua
 *    sendo 127.0.0.1:3777, que e o que esta cadastrado.
 */
const CREDENTIAL_TYPE = {
  google_console_type: 'Aplicativo da Web (Web application)',
  reason: 'o callback tem endereco e caminho fixos; apenas o tipo Aplicativo da Web permite cadastrar o redirect exato',
  redirect_must_be_registered: true,
  http_allowed_because: 'loopback (127.0.0.1 e localhost) e a excecao do Google a exigencia de HTTPS no redirect',
  works_through_ssh_tunnel: 'sim: o Google so ve 127.0.0.1:3777, que e o endereco cadastrado',
  never_use: 'Aplicativo de desktop — porta efemera, sem redirect cadastrado, incompativel com caminho fixo'
};

const EXPECTED_CALLBACK_PATH = '/api/youtube/oauth/callback';

/**
 * Confere se o redirect configurado e utilizavel: loopback, caminho do callback
 * e porta igual a do servidor. Nao imprime nem devolve segredo nenhum.
 */
function validateRedirect() {
  const uri = redirectUri();
  const problems = [];
  let u = null;
  try { u = new URL(uri); } catch (_) { return { ok: false, redirect_uri: uri, problems: ['nao e uma URL valida'], credential_type: CREDENTIAL_TYPE }; }
  const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  if (!loopback) problems.push(`o host "${u.hostname}" nao e loopback; o Google exigiria HTTPS e o tunel SSH nao serviria`);
  if (loopback && u.protocol !== 'http:' && u.protocol !== 'https:') problems.push(`protocolo "${u.protocol}" invalido`);
  if (u.pathname !== EXPECTED_CALLBACK_PATH) problems.push(`o caminho e "${u.pathname}" mas o servidor atende em "${EXPECTED_CALLBACK_PATH}"`);
  const serverPort = String(process.env.PORT || 3777);
  if (u.port && u.port !== serverPort) problems.push(`a porta do redirect (${u.port}) nao e a porta do servidor (${serverPort})`);
  return { ok: problems.length === 0, redirect_uri: uri, host: u.hostname, port: u.port || null,
    path: u.pathname, loopback, problems, credential_type: CREDENTIAL_TYPE,
    register_in_console: uri,
    note: problems.length === 0
      ? 'cadastre exatamente este endereco em "URIs de redirecionamento autorizados" da credencial Aplicativo da Web'
      : 'corrija os pontos acima antes de autorizar' };
}

/**
 * Diagnostico do procedimento inteiro, SEM divulgar segredo.
 * De cada credencial informa apenas presenca, tamanho e impressao digital curta.
 */
function doctor() {
  const fp = (v) => (v ? crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 12) : null);
  const id = process.env.YOUTUBE_CLIENT_ID || '';
  const secret = process.env.YOUTUBE_CLIENT_SECRET || '';
  const checks = [];
  const add = (name, ok, detail) => checks.push({ check: name, ok, detail });
  add('YOUTUBE_CLIENT_ID presente', !!id, id ? `${id.length} caracteres, impressao ${fp(id)}` : 'ausente no .env');
  add('formato do client_id', !id || /\.apps\.googleusercontent\.com$/.test(id), id ? (/\.apps\.googleusercontent\.com$/.test(id) ? 'termina em .apps.googleusercontent.com' : 'NAO termina em .apps.googleusercontent.com: provavelmente nao e um client_id') : 'sem id para conferir');
  add('YOUTUBE_CLIENT_SECRET presente', !!secret, secret ? `${secret.length} caracteres, impressao ${fp(secret)}` : 'ausente no .env');
  const red = validateRedirect();
  add('redirect utilizavel', red.ok, red.ok ? `${red.redirect_uri} (loopback, caminho e porta corretos)` : red.problems.join(' | '));
  add('escopos pedidos', true, SCOPES.join(' '));
  add('nenhum escopo de escrita de canal', !SCOPES.some((s) => /auth\/youtube$|force-ssl/.test(s)),
    'o projeto nao pede permissao para alterar identidade, descricao ou privacidade de canal');
  return { ok: checks.every((c) => c.ok), credential_type: CREDENTIAL_TYPE, checks,
    redirect: { uri: red.redirect_uri, register_in_console: red.register_in_console },
    secrets_disclosed: false,
    secrets_note: 'nenhum valor de credencial aparece aqui: apenas presenca, tamanho e impressao digital de 12 caracteres.',
    tunnel: 'do Windows: ssh -L 3777:127.0.0.1:3777 usuario@IP_DA_VPS, e depois abra http://127.0.0.1:3777 no navegador da sua maquina.' };
}

function configured() { return !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET); }
function redirectUri() {
  return process.env.YOUTUBE_REDIRECT_URI || `http://127.0.0.1:${process.env.PORT || 3777}/api/youtube/oauth/callback`;
}

/* ---------------- state imprevisivel, expirado e de uso unico ---------------- */
function readStates() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { return {}; }
}
function writeStates(s) {
  fs.mkdirSync(store.DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s), { mode: 0o600 });
}
function newState(channelId) {
  const all = readStates();
  const now = Date.now();
  for (const [k, v] of Object.entries(all)) if (now - v.created > STATE_TTL_MS) delete all[k];
  const state = crypto.randomBytes(32).toString('base64url');
  all[state] = { channelId, created: now };
  writeStates(all);
  return state;
}
/** Consome o state: valida existencia e validade, e o apaga (uso unico). */
function consumeState(state) {
  if (!state || typeof state !== 'string' || state.length < 32) return { ok: false, reason: 'state ausente ou curto demais' };
  const all = readStates();
  const rec = all[state];
  if (!rec) return { ok: false, reason: 'state desconhecido, ja usado ou expirado' };
  delete all[state];
  writeStates(all);
  if (Date.now() - rec.created > STATE_TTL_MS) return { ok: false, reason: 'state expirado' };
  return { ok: true, channelId: rec.channelId };
}

function authUrl(channelId) {
  if (!configured()) return null;
  const p = new URLSearchParams({
    client_id: process.env.YOUTUBE_CLIENT_ID, redirect_uri: redirectUri(),
    response_type: 'code', access_type: 'offline', prompt: 'consent',
    include_granted_scopes: 'true', scope: SCOPES.join(' '), state: newState(channelId)
  });
  return `${ENDPOINTS.auth}?${p.toString()}`;
}

/* ---------------- troca de codigo e refresh ---------------- */
async function exchangeCode(code) {
  const body = new URLSearchParams({
    code, client_id: process.env.YOUTUBE_CLIENT_ID, client_secret: process.env.YOUTUBE_CLIENT_SECRET,
    redirect_uri: redirectUri(), grant_type: 'authorization_code'
  }).toString();
  const res = await request(ENDPOINTS.token, { method: 'POST', body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } });
  if (res.status !== 200 || !res.json || !res.json.access_token) throw apiError('troca de codigo falhou', res);
  return res.json;
}
async function refresh(channelId) {
  const t = store.load(channelId);
  if (!t || t.__corrupt || !t.refresh_token) throw new Error('sem refresh_token guardado: e preciso autorizar de novo');
  const body = new URLSearchParams({
    refresh_token: t.refresh_token, client_id: process.env.YOUTUBE_CLIENT_ID,
    client_secret: process.env.YOUTUBE_CLIENT_SECRET, grant_type: 'refresh_token'
  }).toString();
  const res = await request(ENDPOINTS.token, { method: 'POST', body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } });
  if (res.status !== 200 || !res.json || !res.json.access_token) throw apiError('refresh do token falhou', res);
  const merged = { ...t, access_token: res.json.access_token,
    expires_at: Date.now() + (Number(res.json.expires_in || 3600) * 1000),
    scope: res.json.scope || t.scope, refreshed_at: new Date().toISOString() };
  if (res.json.refresh_token) merged.refresh_token = res.json.refresh_token;
  store.save(channelId, merged);
  log.info(`token renovado para ${channelId}`);
  return merged;
}
/** Token valido para uso, renovando se faltar menos de 60s. Nunca retorna para a web. */
async function accessToken(channelId) {
  const t = store.load(channelId);
  if (!t || t.__corrupt) throw new Error('nenhum token utilizavel guardado');
  if (!t.expires_at || t.expires_at - Date.now() < 60000) return (await refresh(channelId)).access_token;
  return t.access_token;
}

/* ---------------- verificacao REAL ---------------- */
/**
 * Confirma com o Google que o token vale e qual canal ele alcanca.
 * Sem esta chamada, nenhum estado AUTORIZADO e declarado.
 */
async function verify(channelId) {
  if (!configured()) return { ok: false, reason: 'credenciais do cliente ausentes' };
  if (!store.exists(channelId)) return { ok: false, reason: 'nenhum token guardado' };
  let token;
  try { token = await accessToken(channelId); }
  catch (e) { return { ok: false, reason: scrub(e.message) }; }
  const res = await request(`${ENDPOINTS.api}/youtube/v3/channels?part=snippet,contentDetails,status&mine=true`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403) return { ok: false, reason: `API recusou o token (HTTP ${res.status})`, http: res.status };
  if (res.status !== 200 || !res.json) return { ok: false, reason: scrub(`resposta inesperada (HTTP ${res.status})`), http: res.status };
  const item = (res.json.items || [])[0];
  if (!item) return { ok: false, reason: 'o token e valido mas nao alcanca nenhum canal do YouTube' };
  const t = store.load(channelId);
  const handle = (item.snippet && (item.snippet.customUrl || null)) || null;
  store.save(channelId, { ...t, channel_id_youtube: item.id,
    channel_title: (item.snippet && item.snippet.title) || null,
    channel_handle: handle, verified_at: new Date().toISOString() });
  return { ok: true, youtube_channel_id: item.id, title: (item.snippet && item.snippet.title) || null,
    handle, uploads_playlist: ((item.contentDetails || {}).relatedPlaylists || {}).uploads || null,
    verified_at: new Date().toISOString() };
}

async function handleCallback(query) {
  if (!configured()) return { ok: false, http: 503, reason: 'credenciais do cliente ausentes no .env' };
  if (query.error) return { ok: false, http: 400, reason: `o Google recusou: ${String(query.error).slice(0, 120)}` };
  const st = consumeState(query.state);
  if (!st.ok) return { ok: false, http: 400, reason: `state invalido: ${st.reason}` };
  if (!query.code) return { ok: false, http: 400, reason: 'callback sem code' };
  let tok;
  try { tok = await exchangeCode(query.code); }
  catch (e) { return { ok: false, http: 502, reason: scrub(e.message) }; }
  const granted = String(tok.scope || '').split(' ').filter(Boolean);
  const missing = SCOPES.filter((s) => !granted.includes(s));
  store.save(st.channelId, {
    access_token: tok.access_token, refresh_token: tok.refresh_token || null,
    scope: tok.scope || '', token_type: tok.token_type || 'Bearer',
    expires_at: Date.now() + (Number(tok.expires_in || 3600) * 1000),
    obtained_at: new Date().toISOString()
  });
  if (!tok.refresh_token) log.warn('o Google nao devolveu refresh_token: revogue o acesso e autorize de novo com prompt=consent');
  const v = await verify(st.channelId);
  if (!v.ok) { return { ok: false, http: 502, reason: `token obtido mas a verificacao falhou: ${v.reason}` }; }
  log.info(`canal autorizado: ${v.title || v.youtube_channel_id}`);
  return { ok: true, channelId: st.channelId, youtube_channel_id: v.youtube_channel_id, title: v.title,
    missing_scopes: missing, has_refresh_token: !!tok.refresh_token };
}

async function revoke(channelId) {
  const t = store.load(channelId);
  if (!t || t.__corrupt) { store.clear(channelId); return { ok: true, note: 'nao havia token utilizavel; estado local limpo' }; }
  const tokenToRevoke = t.refresh_token || t.access_token;
  const body = new URLSearchParams({ token: tokenToRevoke }).toString();
  let remote = { status: null };
  try {
    remote = await request(ENDPOINTS.revoke, { method: 'POST', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } });
  } catch (e) { return { ok: false, reason: `nao consegui falar com o endpoint de revogacao: ${scrub(e.message)}` }; }
  if (remote.status !== 200) return { ok: false, reason: `o Google recusou a revogacao (HTTP ${remote.status}); token local mantido`, http: remote.status };
  store.clear(channelId);
  log.info(`acesso revogado e token local apagado para ${channelId}`);
  return { ok: true, revoked_remotely: true };
}

/* ---------------- estado para o painel ---------------- */
let cache = { at: 0, value: null, channel: null };
async function state(channelId, { live = true } = {}) {
  const base = { scopes_requested: SCOPES, redirect_uri: redirectUri(),
    credential_type: CREDENTIAL_TYPE.google_console_type,
    default_privacy: process.env.DEFAULT_PRIVACY_STATUS || 'private' };
  if (!configured()) return { ...base, status: 'BLOQUEADO',
    reason: 'YOUTUBE_CLIENT_ID/YOUTUBE_CLIENT_SECRET ausentes no .env',
    next_step: `O proprietario cria um projeto no Google Cloud, habilita YouTube Data API v3, YouTube Analytics API e YouTube Reporting API, cria credencial OAuth do tipo ${CREDENTIAL_TYPE.google_console_type} com este redirect_uri cadastrado e coloca ID e segredo no .env deste projeto.`,
    credential_type: CREDENTIAL_TYPE,
    upload_possible: false, analytics_possible: false, token: { present: false } };
  const tok = store.describe(channelId);
  if (!tok.present || tok.usable === false) return { ...base, status: 'PENDENTE_AUTORIZACAO',
    reason: tok.usable === false ? tok.reason : 'credenciais presentes, consentimento do titular ainda nao concedido',
    authorize_path: '/api/youtube/oauth/start', upload_possible: false, analytics_possible: false, token: tok,
    note: 'O login acontece no navegador, com a conta do proprio titular. Este sistema nunca pede senha nem codigo por chat.' };
  if (!live) return { ...base, status: 'TOKEN_PRESENTE_NAO_VERIFICADO',
    reason: 'ha token guardado, mas sem checagem viva contra a API nada e declarado autorizado',
    upload_possible: false, analytics_possible: false, token: tok };
  if (cache.channel === channelId && Date.now() - cache.at < 60000 && cache.value) return cache.value;
  const v = await verify(channelId);
  const out = v.ok
    ? { ...base, status: 'AUTORIZADO', youtube_channel_id: v.youtube_channel_id, channel_title: v.title,
        channel_handle: v.handle || null,
        verified_at: v.verified_at, upload_possible: true, analytics_possible: true, token: store.describe(channelId) }
    : { ...base, status: 'PENDENTE_AUTORIZACAO', reason: `token guardado nao passou na verificacao: ${v.reason}`,
        authorize_path: '/api/youtube/oauth/start', upload_possible: false, analytics_possible: false, token: tok };
  cache = { at: Date.now(), value: out, channel: channelId };
  return out;
}
function invalidateCache() { cache = { at: 0, value: null, channel: null }; }
module.exports = { configured, authUrl, handleCallback, verify, refresh, accessToken, revoke, state,
  invalidateCache, consumeState, newState, validateRedirect, doctor,
  SCOPES, redirectUri, STATE_TTL_MS, CREDENTIAL_TYPE, EXPECTED_CALLBACK_PATH };
