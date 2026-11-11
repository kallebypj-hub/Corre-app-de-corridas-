'use strict';
/**
 * Metricas REAIS da YouTube Analytics API, organizadas para o Evolution Engine.
 *
 * Regras: o que nao veio fica "indisponivel" — nunca zero, nunca estimado.
 * Nada e coletado antes de existir publicacao real. E a receita e declarada
 * estruturalmente indisponivel enquanto nao pedirmos o escopo monetario, que
 * exige decisao do dono.
 */
const { request, apiError, scrub } = require('./http');
const oauth = require('./oauth');
const { MILESTONES } = require('../evolution/states');

const ANALYTICS_BASE = process.env.GOOGLE_ANALYTICS_BASE || 'https://youtubeanalytics.googleapis.com';
const MONETARY_SCOPE = 'https://www.googleapis.com/auth/yt-analytics-monetary.readonly';

const CORE = ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage',
  'subscribersGained', 'subscribersLost', 'likes', 'comments', 'shares'];
/**
 * IMPORTANTE: impressions e impressionsCtr NAO existem em reports.query da
 * Analytics API. Pedi-las ali devolve erro e o CTR nunca chegaria. Elas vem da
 * Reporting API (relatorio em lote) ou de CSV exportado do Studio.
 */
const REACH = [];
const REACH_FROM_REPORTING = ['impressions', 'impressionsCtr'];
const ALL_KEYS = CORE.concat(REACH_FROM_REPORTING, ['retention_0_30s', 'retention_mid', 'retention_end',
  'top_traffic_source', 'shorts_referral_views', 'estimatedRevenue', 'cpm', 'playbackBasedCpm']);

function unavailableAll(reason, extra = {}) {
  const m = {};
  for (const k of ALL_KEYS) m[k] = 'indisponivel';
  return { status: 'BLOQUEADO', reason, metrics: m,
    policy: 'Metrica inexistente aparece como indisponivel. Nunca como zero e nunca estimada.', ...extra };
}
const fmt = (d) => new Date(d).toISOString().slice(0, 10);

async function query(channelId, { videoId = null, startDate, endDate, metrics, dimensions = null, sort = null, maxResults = null }) {
  const token = await oauth.accessToken(channelId);
  const p = new URLSearchParams({ ids: 'channel==MINE', startDate, endDate, metrics: metrics.join(',') });
  if (dimensions) p.set('dimensions', dimensions);
  if (sort) p.set('sort', sort);
  if (maxResults) p.set('maxResults', String(maxResults));
  if (videoId) p.set('filters', `video==${videoId}`);
  const res = await request(`${ANALYTICS_BASE}/v2/reports?${p.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status !== 200 || !res.json) throw apiError('consulta de analytics falhou', res);
  return res.json;
}
function rowsToObject(payload) {
  const cols = (payload.columnHeaders || []).map((c) => c.name);
  const row = (payload.rows || [])[0] || [];
  const o = {};
  cols.forEach((c, i) => { o[c] = row[i] === undefined || row[i] === null ? 'indisponivel' : row[i]; });
  return o;
}

/** Curva de retencao: [{ratio, audience}] ou null se a API nao devolveu. */
async function retentionCurve(channelId, videoId, startDate, endDate) {
  try {
    const r = await query(channelId, { videoId, startDate, endDate,
      metrics: ['audienceWatchRatio'], dimensions: 'elapsedVideoTimeRatio' });
    const rows = r.rows || [];
    if (rows.length < 5) return { curve: null, reason: `a API devolveu ${rows.length} ponto(s) de retencao: insuficiente` };
    return { curve: rows.map((x) => ({ ratio: Number(x[0]), audience: Number(x[1]) })).sort((a, b) => a.ratio - b.ratio) };
  } catch (e) { return { curve: null, reason: scrub(e.message) }; }
}
async function trafficSources(channelId, videoId, startDate, endDate) {
  try {
    const r = await query(channelId, { videoId, startDate, endDate,
      metrics: ['views', 'estimatedMinutesWatched'], dimensions: 'insightTrafficSourceType', sort: '-views' });
    const rows = r.rows || [];
    if (!rows.length) return { sources: null, reason: 'a API nao devolveu origem de trafego' };
    const total = rows.reduce((a, x) => a + Number(x[1] || 0), 0);
    return { sources: rows.map((x) => ({ source: x[0], views: Number(x[1]), minutes: Number(x[2]),
      share_pct: total ? +((Number(x[1]) / total) * 100).toFixed(1) : null })), top: rows[0][0] };
  } catch (e) { return { sources: null, reason: scrub(e.message) }; }
}

/** Marco mais proximo do tempo decorrido desde a publicacao, sem inventar. */
function milestoneFor(publishedAt, now = Date.now()) {
  const hours = (now - new Date(publishedAt).getTime()) / 3600000;
  let hit = null;
  for (const m of MILESTONES) if (hours >= m.hours) hit = m;
  return { hours: +hours.toFixed(2), milestone: hit, next: MILESTONES.find((m) => m.hours > hours) || null };
}

/**
 * Coleta completa de UM video num marco. Devolve o que veio e lista o que faltou.
 */
async function collectForVideo(channelId, { videoId, publishedAt, durationSeconds }) {
  const st = await oauth.state(channelId);
  if (st.status !== 'AUTORIZADO') return unavailableAll(`OAuth em estado ${st.status}: ${st.reason || 'sem autorizacao'}`);
  const ms = milestoneFor(publishedAt);
  if (!ms.milestone) return unavailableAll(
    `o video tem ${ms.hours}h de publicado; o primeiro marco e ${MILESTONES[0].label}`,
    { hours_since_publication: ms.hours, next_milestone: ms.next });

  const start = fmt(publishedAt), end = fmt(Date.now());
  const metrics = {}; const missing = []; const notes = [];
  try { Object.assign(metrics, rowsToObject(await query(channelId, { videoId, startDate: start, endDate: end, metrics: CORE }))); }
  catch (e) { for (const k of CORE) metrics[k] = 'indisponivel'; notes.push(`metricas principais: ${scrub(e.message)}`); }
  // --- alcance: Reporting API em lote, com queda para CSV do Studio ---
  const reporting = require('./reporting');
  let reach = null;
  try { reach = await reporting.fetchReach(channelId, { videoId, from: start, to: end }); }
  catch (e) { reach = { impressions: 'indisponivel', impressions_ctr: 'indisponivel', available: false, reason: scrub(e.message) }; }
  metrics.impressions = reach.impressions;
  metrics.impressionsCtr = reach.impressions_ctr !== undefined ? reach.impressions_ctr : 'indisponivel';
  const reachMeta = { source: reach.available ? 'youtube_reporting_api' : null, available: !!reach.available,
    reason: reach.reason || null, job_id: reach.job_id || null, report_id: reach.report_id || null,
    report_window: reach.report_window || null, column_mapping_verified: reach.column_mapping_verified ?? null,
    day_boundary_timezone: reporting.FACTS.day_boundary_timezone,
    delay_note: reach.delay_note || `relatorio em lote: o primeiro arquivo pode levar ate ${reporting.FACTS.first_report_delay_hours_max}h apos criar o job` };
  if (!reach.available) notes.push(`impressoes e CTR indisponiveis pela Reporting API: ${reach.reason}. Alternativa: exportar do YouTube Studio e importar com "node src/cli.js import-studio".`);

  const rc = await retentionCurve(channelId, videoId, start, end);
  let curve = rc.curve;
  if (!curve) { for (const k of ['retention_0_30s', 'retention_mid', 'retention_end']) metrics[k] = 'indisponivel'; notes.push(`curva de retencao: ${rc.reason}`); }
  else {
    const { summarise } = require('../evolution/retention');
    Object.assign(metrics, summarise(curve, durationSeconds));
  }
  const ts = await trafficSources(channelId, videoId, start, end);
  metrics.top_traffic_source = ts.top || 'indisponivel';
  if (!ts.sources) notes.push(`origem de trafego: ${ts.reason}`);
  const shortsRef = ts.sources ? (ts.sources.find((s) => /SHORTS/i.test(s.source)) || null) : null;
  metrics.shorts_referral_views = shortsRef ? shortsRef.views : 'indisponivel';

  // receita: escopo monetario nao foi pedido, entao e estruturalmente indisponivel
  const granted = (st.token && st.token.scopes) || [];
  const hasMonetary = granted.includes(MONETARY_SCOPE);
  for (const k of ['estimatedRevenue', 'cpm', 'playbackBasedCpm']) metrics[k] = 'indisponivel';
  if (!hasMonetary) notes.push('receita indisponivel por decisao de escopo: o escopo yt-analytics-monetary.readonly nao foi pedido na autorizacao. Pedir exige decisao do dono e canal monetizado.');

  for (const [k, v] of Object.entries(metrics)) if (v === 'indisponivel') missing.push(k);
  return { status: 'COLETADO', video_id: videoId, milestone: ms.milestone.id, milestone_label: ms.milestone.label,
    hours_since_publication: ms.hours, window: { from: start, to: end },
    metrics, missing_metrics: missing, notes,
    sources: { core: 'youtube_analytics_api/reports.query', reach: reachMeta,
      retention: curve ? 'youtube_analytics_api/elapsedVideoTimeRatio' : null,
      traffic: ts.sources ? 'youtube_analytics_api/insightTrafficSourceType' : null },
    retention_curve: curve, traffic_sources: ts.sources || null,
    monetary_scope_granted: hasMonetary,
    collected_at: new Date().toISOString() };
}

/** Compatibilidade: coleta para a lista de publicacoes do store. */
async function collect(channelId, publications = [], { days = 28 } = {}) {
  const st = await oauth.state(channelId);
  if (st.status !== 'AUTORIZADO') return unavailableAll(`OAuth em estado ${st.status}: ${st.reason || 'sem autorizacao'}`);
  const published = publications.filter((p) => p.video_id);
  if (!published.length) return unavailableAll('nenhum video publicado por este sistema: nao existe metrica real a coletar');
  const videos = [];
  for (const pub of published) {
    videos.push(await collectForVideo(channelId, { videoId: pub.video_id,
      publishedAt: pub.published_at || pub.queued_at || pub.at, durationSeconds: pub.duration_s || null }));
  }
  return { status: 'COLETADO', window_days: days, videos,
    hypotheses_separated: 'Este bloco traz apenas dado medido. Hipotese sobre causa fica no Evolution Engine, separada, e nao vira politica sem auditoria e aprovacao.',
    collected_at: new Date().toISOString() };
}
module.exports = { collect, collectForVideo, query, retentionCurve, trafficSources, milestoneFor,
  unavailable: unavailableAll, CORE, REACH, REACH_FROM_REPORTING, ALL_KEYS, MONETARY_SCOPE, ANALYTICS_BASE };
