'use strict';
/**
 * Metricas REAIS da YouTube Analytics API.
 *
 * Regra: o que nao veio da API fica "indisponivel". Nunca zero, nunca estimado,
 * nunca dado de exemplo. E nada e coletado antes de existir publicacao real.
 */
const { request, apiError, ENDPOINTS, scrub } = require('./http');
const oauth = require('./oauth');

const ANALYTICS_BASE = process.env.GOOGLE_ANALYTICS_BASE || 'https://youtubeanalytics.googleapis.com';
const WANTED = ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage',
  'subscribersGained', 'subscribersLost', 'likes', 'comments', 'shares'];
// impressoes e CTR vivem em outro grupo de metricas e nem sempre sao liberadas por filtro de video
const IMPRESSION_METRICS = ['impressions', 'impressionsCtr'];

function unavailable(reason) {
  const m = {};
  for (const k of WANTED.concat(IMPRESSION_METRICS, ['audienceRetention', 'trafficSources'])) m[k] = 'indisponivel';
  return { status: 'BLOQUEADO', reason, metrics: m,
    policy: 'Metrica inexistente aparece como indisponivel. Nunca como zero e nunca estimada.' };
}

async function query(channelId, { videoId = null, startDate, endDate, metrics, dimensions = null }) {
  const token = await oauth.accessToken(channelId);
  const p = new URLSearchParams({ ids: 'channel==MINE', startDate, endDate, metrics: metrics.join(',') });
  if (dimensions) p.set('dimensions', dimensions);
  if (videoId) p.set('filters', `video==${videoId}`);
  const res = await request(`${ANALYTICS_BASE}/v2/reports?${p.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status !== 200 || !res.json) throw apiError('consulta de analytics falhou', res);
  return res.json;
}
function rowsToObject(payload) {
  const cols = (payload.columnHeaders || []).map((c) => c.name);
  const row = (payload.rows || [])[0] || [];
  const o = {};
  cols.forEach((c, i) => { o[c] = row[i] === undefined ? 'indisponivel' : row[i]; });
  return o;
}

/**
 * @param publications registros reais de publicacao (com video_id). Sem eles, nao ha o que coletar.
 */
async function collect(channelId, publications = [], { days = 28 } = {}) {
  const st = await oauth.state(channelId);
  if (st.status !== 'AUTORIZADO') return unavailable(`OAuth em estado ${st.status}: ${st.reason || 'sem autorizacao'}`);
  const published = publications.filter((p) => p.video_id);
  if (!published.length) return unavailable('nenhum video publicado por este sistema: nao existe metrica real a coletar');

  const end = new Date(); const start = new Date(Date.now() - days * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const perVideo = []; const errors = [];
  for (const pub of published) {
    const entry = { video_id: pub.video_id, episode: pub.epId || null, metrics: {}, notes: [] };
    try {
      const base = await query(channelId, { videoId: pub.video_id, startDate: fmt(start), endDate: fmt(end), metrics: WANTED });
      entry.metrics = rowsToObject(base);
    } catch (e) { errors.push(scrub(e.message)); entry.notes.push(`metricas principais indisponiveis: ${scrub(e.message)}`); for (const k of WANTED) entry.metrics[k] = 'indisponivel'; }
    try {
      const imp = await query(channelId, { videoId: pub.video_id, startDate: fmt(start), endDate: fmt(end), metrics: IMPRESSION_METRICS });
      Object.assign(entry.metrics, rowsToObject(imp));
    } catch (e) { for (const k of IMPRESSION_METRICS) entry.metrics[k] = 'indisponivel'; entry.notes.push('impressoes e CTR nao foram liberados para este filtro'); }
    perVideo.push(entry);
  }
  return { status: 'COLETADO', window_days: days, from: fmt(start), to: fmt(end),
    videos: perVideo, errors,
    hypotheses_separated: 'Este bloco traz apenas dado medido. Hipotese sobre causa (titulo, miniatura, horario) fica em memoria, separada, e nao vira politica sem aprovacao.',
    collected_at: new Date().toISOString() };
}
module.exports = { collect, query, unavailable, WANTED, IMPRESSION_METRICS, ANALYTICS_BASE };
