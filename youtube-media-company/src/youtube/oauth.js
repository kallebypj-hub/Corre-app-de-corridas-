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
  store.save(channelId, { ...t, channel_id_youtube: item.id,
    channel_title: (item.snippet && item.snippet.title) || null, verified_at: new Date().toISOString() });
  return { ok: true, youtube_channel_id: item.id, title: (item.snippet && item.snippet.title) || null,
    uploads_playlist: ((item.contentDetails || {}).relatedPlaylists || {}).uploads || null,
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
    default_privacy: process.env.DEFAULT_PRIVACY_STATUS || 'private' };
  if (!configured()) return { ...base, status: 'BLOQUEADO',
    reason: 'YOUTUBE_CLIENT_ID/YOUTUBE_CLIENT_SECRET ausentes no .env',
    next_step: 'O proprietario cria um projeto no Google Cloud, habilita YouTube Data API v3 e YouTube Analytics API, cria credencial OAuth de aplicativo web com este redirect_uri e coloca ID e segredo no .env deste projeto.',
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
        verified_at: v.verified_at, upload_possible: true, analytics_possible: true, token: store.describe(channelId) }
    : { ...base, status: 'PENDENTE_AUTORIZACAO', reason: `token guardado nao passou na verificacao: ${v.reason}`,
        authorize_path: '/api/youtube/oauth/start', upload_possible: false, analytics_possible: false, token: tok };
  cache = { at: Date.now(), value: out, channel: channelId };
  return out;
}
function invalidateCache() { cache = { at: 0, value: null, channel: null }; }
module.exports = { configured, authUrl, handleCallback, verify, refresh, accessToken, revoke, state,
  invalidateCache, consumeState, newState, SCOPES, redirectUri, STATE_TTL_MS };
