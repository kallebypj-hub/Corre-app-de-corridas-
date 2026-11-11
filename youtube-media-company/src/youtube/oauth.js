'use strict';
/**
 * YouTube Data v3 + Analytics.
 * Sem OAuth configurado, TUDO aqui responde BLOQUEADO — nunca simulado,
 * nunca com dado de exemplo se passando por real.
 */
const fs = require('fs');
const path = require('path');
const TOKEN_DIR = path.join(__dirname, '..', '..', 'var', 'tokens');
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly'
];
function configured() { return !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET); }
function tokenPath(channelId) { return path.join(TOKEN_DIR, `${channelId}.json`); }
function authorized(channelId) { return configured() && fs.existsSync(tokenPath(channelId)); }
function state(channelId) {
  if (!configured()) return { status: 'BLOQUEADO', reason: 'YOUTUBE_CLIENT_ID/SECRET ausentes no .env',
    next_step: 'O proprietario cria um projeto no Google Cloud, habilita YouTube Data API v3 e YouTube Analytics API, cria credencial OAuth de aplicativo web e coloca ID e segredo no .env deste projeto.',
    scopes_requested: SCOPES, upload_possible: false, analytics_possible: false };
  if (!authorized(channelId)) return { status: 'PENDENTE_AUTORIZACAO', reason: 'credenciais presentes, consentimento do titular ainda nao concedido',
    authorize_url: authUrl(channelId), scopes_requested: SCOPES, upload_possible: false, analytics_possible: false,
    note: 'O login acontece no navegador, com a conta do proprio titular. Este sistema nunca pede senha nem codigo por chat.' };
  return { status: 'AUTORIZADO', scopes_requested: SCOPES, upload_possible: true, analytics_possible: true,
    default_privacy: process.env.DEFAULT_PRIVACY_STATUS || 'private' };
}
function authUrl(channelId) {
  if (!configured()) return null;
  const redirect = process.env.YOUTUBE_REDIRECT_URI || `http://127.0.0.1:${process.env.PORT || 3777}/api/youtube/oauth/callback`;
  const p = new URLSearchParams({ client_id: process.env.YOUTUBE_CLIENT_ID, redirect_uri: redirect,
    response_type: 'code', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
    scope: SCOPES.join(' '), state: channelId });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}
/** Fila de publicacao: so aceita item com gates verdes E aprovacao especifica do episodio. */
function enqueue(store, epId, { privacy = 'private', publishAt = null, approvedBy }) {
  const ep = store.episode(epId);
  if (!ep) throw new Error('episodio inexistente');
  if (!ep.gates || !ep.gates.can_be_approved) throw new Error('gates nao aprovados: publicacao bloqueada');
  if (ep.approval.status !== 'approved') throw new Error('sem aprovacao do proprietario para este video');
  if (!ep.approval.scheduled_upload_authorized) throw new Error('a aprovacao nao autorizou envio programado deste video');
  if (privacy !== 'private' && privacy !== 'unlisted') throw new Error('o padrao operacional exige privado ou nao listado no primeiro envio');
  const rec = { epId, privacy, publishAt, approvedBy, queued_at: new Date().toISOString(),
    status: authorized(store.channelId) ? 'READY_TO_UPLOAD' : 'BLOCKED_NO_OAUTH', video_id: null, url: null };
  store.append('publication.recorded', rec);
  return rec;
}
function analytics(channelId) {
  if (!authorized(channelId)) return { status: 'BLOQUEADO',
    reason: 'sem OAuth autorizado e sem video publicado, nao existe metrica real a coletar',
    metrics: { impressions: 'indisponivel', ctr: 'indisponivel', average_view_duration: 'indisponivel',
      watch_time: 'indisponivel', audience_retention: 'indisponivel', subscribers: 'indisponivel', traffic_sources: 'indisponivel' },
    policy: 'Metrica inexistente aparece como indisponivel. Nunca como zero e nunca estimada.' };
  return { status: 'AUTORIZADO_SEM_PUBLICACAO', metrics: {}, note: 'coletar apos a primeira publicacao' };
}
module.exports = { configured, authorized, state, authUrl, enqueue, analytics, SCOPES, TOKEN_DIR };
