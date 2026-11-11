'use strict';
/**
 * YouTube REPORTING API — impressoes de miniatura e CTR.
 *
 * Por que este arquivo existe: a YouTube Analytics API (reports.query) NAO
 * entrega `impressions` nem `impressionsCtr`. Pedir essas metricas la devolve
 * erro, e a versao anterior deste projeto pedia — entao o CTR nunca viria.
 * Impressao e CTR vivem em relatorio em lote da Reporting API, tipo
 * `channel_reach_basic_a1` (dimensoes date, channel, video; metricas de
 * impressao de miniatura e CTR), disponivel desde 2026-01-15.
 *
 * O que isso implica, e esta escrito em cada resposta:
 *  - e baseado em JOB: nao existe consulta sob demanda. Cria-se o job e espera-se.
 *  - o PRIMEIRO relatorio pode levar ate 48h depois de criar o job.
 *  - relatorios expiram (~60 dias; ~30 para o backfill historico).
 *  - o dia fecha em horario do PACIFICO, nao UTC.
 *  - o mapeamento exato das colunas do CSV so se confirma com um arquivo real
 *    BAIXADO DO GOOGLE. Dado sintetico de teste NUNCA marca o mapeamento como
 *    verificado, por mais completo que seja.
 *
 * UNIDADE DO CTR — uma so, em todo o projeto:
 *   `video_thumbnail_impressions_ctr` vem do Google como FRACAO (cliques
 *   divididos por impressoes). 0.062 significa 6,2%.
 *   Aqui dentro o valor canonico e sempre a FRACAO de 0 a 1, no campo
 *   `impressions_ctr`. Quem precisa de porcentagem le `impressions_ctr_percent`,
 *   que e a mesma coisa vezes 100. Nenhuma outra escala circula.
 *   Protecao: fracao nao pode passar de 1. Se alguma linha vier acima de 1, a
 *   coluna esta em porcentagem — o parser converte e registra que converteu,
 *   em vez de aceitar um CTR de 620%.
 */
const fs = require('fs');
const path = require('path');
const { request, apiError, scrub } = require('./http');
const oauth = require('./oauth');
const { Logger } = require('../log');

const log = new Logger('youtube.reporting');
const BASE = process.env.GOOGLE_REPORTING_BASE || 'https://youtubereporting.googleapis.com';
const CACHE_DIR = process.env.YT_REPORT_CACHE_DIR || path.join(__dirname, '..', '..', 'var', 'reports-cache');

/** Tipos de relatorio que entregam alcance. O primeiro que existir e usado. */
const REACH_TYPES = ['channel_reach_basic_a1', 'channel_reach_combined_a1'];

const FACTS = {
  api: 'YouTube Reporting API v1 (relatorio em lote)',
  why_not_analytics: 'reports.query da Analytics API nao expoe impressions nem impressionsCtr',
  job_based: true,
  first_report_delay_hours_max: 48,
  report_retention_days: 60,
  backfill_retention_days: 30,
  day_boundary_timezone: 'America/Los_Angeles (Pacifico), nao UTC',
  available_since: '2026-01-15',
  official_metric_names: ['video_thumbnail_impressions', 'video_thumbnail_impressions_ctr'],
  ctr_unit: 'fracao de 0 a 1 (cliques / impressoes). 0.062 = 6,2%.',
  ctr_canonical_field: 'impressions_ctr (fracao); impressions_ctr_percent e o mesmo valor em porcentagem',
  ctr_definition: 'cliques divididos por impressoes de miniatura',
  requires_api_enabled: 'YouTube Reporting API habilitada no projeto do Google Cloud',
  scope: 'https://www.googleapis.com/auth/yt-analytics.readonly'
};

async function auth(channelId) { return { Authorization: `Bearer ${await oauth.accessToken(channelId)}` }; }

async function listReportTypes(channelId) {
  const res = await request(`${BASE}/v1/reportTypes`, { headers: await auth(channelId) });
  if (res.status !== 200 || !res.json) throw apiError('listagem de tipos de relatorio falhou', res);
  return (res.json.reportTypes || []).map((r) => ({ id: r.id, name: r.name, deprecateTime: r.deprecateTime || null }));
}
async function listJobs(channelId) {
  const res = await request(`${BASE}/v1/jobs`, { headers: await auth(channelId) });
  if (res.status !== 200 || !res.json) throw apiError('listagem de jobs falhou', res);
  return res.json.jobs || [];
}
async function createJob(channelId, reportTypeId) {
  const body = JSON.stringify({ reportTypeId, name: `ymc-${reportTypeId}` });
  const res = await request(`${BASE}/v1/jobs`, { method: 'POST', body,
    headers: { ...(await auth(channelId)), 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } });
  if (res.status !== 200 && res.status !== 201) throw apiError(`criacao do job ${reportTypeId} falhou`, res);
  return res.json;
}
/**
 * Garante o job de alcance. IDEMPOTENTE: se ja existe, reusa.
 * Devolve tambem quando o primeiro relatorio deve aparecer.
 */
async function ensureReachJob(channelId) {
  const st = await oauth.state(channelId);
  if (st.status !== 'AUTORIZADO') return { ok: false, status: st.status, reason: st.reason || 'sem autorizacao', facts: FACTS };
  let types = [];
  try { types = await listReportTypes(channelId); }
  catch (e) { return { ok: false, reason: `nao consegui listar tipos de relatorio: ${scrub(e.message)}`, hint: 'a YouTube Reporting API precisa estar habilitada no projeto do Google Cloud', facts: FACTS }; }
  const available = REACH_TYPES.filter((t) => types.find((x) => x.id === t));
  if (!available.length) return { ok: false, reason: `nenhum tipo de alcance disponivel nesta conta. Procurados: ${REACH_TYPES.join(', ')}`,
    report_types_seen: types.length, facts: FACTS };
  const jobs = await listJobs(channelId);
  const existing = jobs.find((j) => available.includes(j.reportTypeId));
  if (existing) return { ok: true, job: existing, created_now: false,
    report_type: existing.reportTypeId, created_at: existing.createTime, facts: FACTS };
  const job = await createJob(channelId, available[0]);
  log.info(`job de alcance criado: ${job.id} (${available[0]})`);
  return { ok: true, job, created_now: true, report_type: available[0], created_at: job.createTime,
    first_report_expected_after: new Date(Date.now() + FACTS.first_report_delay_hours_max * 3600000).toISOString(),
    note: `relatorio em lote: o primeiro arquivo pode levar ate ${FACTS.first_report_delay_hours_max}h para existir.`, facts: FACTS };
}
async function listReports(channelId, jobId, { createdAfter = null } = {}) {
  const q = createdAfter ? `?createdAfter=${encodeURIComponent(createdAfter)}` : '';
  const res = await request(`${BASE}/v1/jobs/${encodeURIComponent(jobId)}/reports${q}`, { headers: await auth(channelId) });
  if (res.status !== 200 || !res.json) throw apiError('listagem de relatorios falhou', res);
  return res.json.reports || [];
}
async function downloadReport(channelId, downloadUrl) {
  const url = downloadUrl.includes('alt=media') ? downloadUrl : `${downloadUrl}${downloadUrl.includes('?') ? '&' : '?'}alt=media`;
  const res = await request(url, { headers: await auth(channelId), timeout: 180000 });
  if (res.status !== 200) throw apiError('download do relatorio falhou', res);
  return res.text;
}

/* ---------------- CSV ---------------- */
function parseCSV(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return { header: [], rows: [] };
  const split = (l) => { const out = []; let cur = '', q = false;
    for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; }
    out.push(cur); return out.map((x) => x.trim()); };
  const header = split(lines[0]).map((h) => h.toLowerCase());
  return { header, rows: lines.slice(1).map((l) => { const c = split(l); const o = {}; header.forEach((h, i) => { o[h] = c[i]; }); return o; }) };
}
/**
 * Acha a coluna pelo nome. O PRIMEIRO de cada lista e o nome oficial do
 * relatorio; os seguintes sao variacoes toleradas, para o caso de o arquivo vir
 * com outro cabecalho. A ordem importa: nome oficial ganha.
 */
const OFFICIAL_COLUMNS = {
  date: 'date',
  video: 'video_id',
  impressions: 'video_thumbnail_impressions',
  ctr: 'video_thumbnail_impressions_ctr'
};
const COLUMN_CANDIDATES = {
  date: ['date', 'day'],
  video: ['video_id', 'video', 'resource_id'],
  impressions: ['video_thumbnail_impressions', 'thumbnail_impressions', 'impressions', 'card_impressions'],
  ctr: ['video_thumbnail_impressions_ctr', 'thumbnail_impressions_ctr', 'impressions_ctr', 'impressions_click_through_rate', 'ctr']
};
function mapColumns(header) {
  const map = {}; const unresolved = []; const aliases = [];
  for (const [k, cands] of Object.entries(COLUMN_CANDIDATES)) {
    const hit = cands.find((c) => header.includes(c));
    if (!hit) { unresolved.push({ field: k, tried: cands }); continue; }
    map[k] = hit;
    if (hit !== OFFICIAL_COLUMNS[k]) aliases.push({ field: k, found: hit, official: OFFICIAL_COLUMNS[k] });
  }
  return { map, unresolved, aliases,
    official_names_used: ['impressions', 'ctr'].every((k) => map[k] === OFFICIAL_COLUMNS[k]) };
}

/**
 * Descobre a escala da coluna de CTR a partir dos proprios numeros.
 * Fracao nao passa de 1: valor acima de 1 denuncia porcentagem.
 */
function detectCtrScale(values) {
  const nums = values.map(Number).filter((v) => Number.isFinite(v) && v > 0);
  if (!nums.length) return { scale: 'fracao', factor: 1, confidence: 'sem dado', reason: 'nenhum valor positivo de CTR no periodo' };
  const max = Math.max(...nums);
  if (max > 1) return { scale: 'porcentagem', factor: 1 / 100, confidence: 'alta',
    reason: `valor maximo ${max} passa de 1, e fracao nao passa de 1: a coluna esta em porcentagem e foi dividida por 100` };
  return { scale: 'fracao', factor: 1, confidence: 'alta',
    reason: `todos os valores ficam entre 0 e 1, como a documentacao do relatorio descreve (${FACTS.ctr_unit})` };
}
/**
 * Le o relatorio de alcance e extrai impressao e CTR do video pedido.
 * Nunca inventa: se a coluna nao existir, devolve indisponivel com o motivo.
 */
/** Origens possiveis de um CSV. Apenas uma confirma o mapeamento de colunas. */
const ORIGINS = {
  google_download: 'arquivo baixado da Reporting API do Google',
  sintetico: 'dado sintetico de teste',
  manual_csv: 'planilha exportada a mao do YouTube Studio',
  desconhecida: 'origem nao declarada'
};

function extractReach(csvText, { videoId = null, from = null, to = null, origin = 'desconhecida' } = {}) {
  const { header, rows } = parseCSV(csvText);
  const { map, unresolved, aliases, official_names_used } = mapColumns(header);
  const fromGoogle = origin === 'google_download';
  const resolved = unresolved.length === 0;
  const verified = fromGoogle && resolved && official_names_used;
  const base = { source: 'youtube_reporting_api', report_header: header,
    csv_origin: origin, csv_origin_label: ORIGINS[origin] || ORIGINS.desconhecida,
    column_mapping: map, unresolved_columns: unresolved, column_aliases_used: aliases,
    official_names_used,
    column_mapping_verified: verified,
    verification_note: verified
      ? 'mapeamento confirmado: arquivo vindo do Google, com os nomes oficiais das colunas.'
      : (!fromGoogle
        ? `mapeamento NAO confirmado: o CSV veio de "${ORIGINS[origin] || origin}". Somente arquivo baixado do Google confirma o mapeamento — dado sintetico nunca confirma, por completo que seja.`
        : (!resolved ? 'mapeamento NAO confirmado: ha coluna que nao foi reconhecida.'
          : 'mapeamento NAO confirmado: o arquivo veio do Google mas com nomes de coluna alternativos, nao os oficiais.')),
    ctr_unit: FACTS.ctr_unit,
    day_boundary_timezone: FACTS.day_boundary_timezone, rows_in_report: rows.length };
  if (!map.impressions || !map.ctr)
    return { ...base, impressions: 'indisponivel', impressions_ctr: 'indisponivel', impressions_ctr_percent: 'indisponivel',
      reason: `o relatorio nao traz coluna de ${!map.impressions ? 'impressoes' : 'CTR'} com nome reconhecido` };
  const sel = rows.filter((r) => {
    if (videoId && map.video && r[map.video] !== videoId) return false;
    if (from && map.date && r[map.date] < String(from).replace(/-/g, '')) return false;
    if (to && map.date && r[map.date] > String(to).replace(/-/g, '')) return false;
    return true;
  });
  if (!sel.length) return { ...base, impressions: 'indisponivel', impressions_ctr: 'indisponivel', impressions_ctr_percent: 'indisponivel',
    reason: videoId ? `o relatorio nao tem linha para o video ${videoId} no periodo` : 'nenhuma linha no periodo' };
  const scale = detectCtrScale(sel.map((r) => r[map.ctr]));
  const imp = sel.reduce((a, r) => a + (Number(r[map.impressions]) || 0), 0);
  // cliques reconstituidos linha por linha: ctr (em fracao) x impressoes daquele dia
  const clicks = sel.reduce((a, r) => a + (Number(r[map.ctr]) || 0) * scale.factor * (Number(r[map.impressions]) || 0), 0);
  const ratio = imp ? +(clicks / imp).toFixed(6) : null;
  return { ...base, impressions: imp,
    impressions_ctr: ratio === null ? 'indisponivel' : ratio,
    impressions_ctr_percent: ratio === null ? 'indisponivel' : +(ratio * 100).toFixed(2),
    estimated_clicks: +clicks.toFixed(1),
    ctr_scale_in_file: scale.scale, ctr_scale_confidence: scale.confidence, ctr_scale_reason: scale.reason,
    days_covered: map.date ? [...new Set(sel.map((r) => r[map.date]))].length : null,
    aggregation: 'impressoes somadas; CTR agregado = cliques/impressoes, com os cliques reconstituidos de cada linha diaria (dia ponderado pelas proprias impressoes)' };
}

/** Caminho completo: job -> relatorio mais recente -> alcance do video. */
async function fetchReach(channelId, { videoId, from, to }) {
  const job = await ensureReachJob(channelId);
  if (!job.ok) return { impressions: 'indisponivel', impressions_ctr: 'indisponivel',
    source: 'youtube_reporting_api', available: false, reason: job.reason, status: job.status || null, facts: FACTS };
  let reports = [];
  try { reports = await listReports(channelId, job.job.id, { createdAfter: from ? new Date(from).toISOString() : null }); }
  catch (e) { return { impressions: 'indisponivel', impressions_ctr: 'indisponivel', source: 'youtube_reporting_api',
    available: false, reason: `nao consegui listar relatorios: ${scrub(e.message)}`, job_id: job.job.id, facts: FACTS }; }
  if (!reports.length) {
    const age = job.created_at ? (Date.now() - new Date(job.created_at).getTime()) / 3600000 : null;
    return { impressions: 'indisponivel', impressions_ctr: 'indisponivel', source: 'youtube_reporting_api', available: false,
      reason: age !== null && age < FACTS.first_report_delay_hours_max
        ? `o job tem ${age.toFixed(1)}h; o primeiro relatorio pode levar ate ${FACTS.first_report_delay_hours_max}h`
        : 'nenhum relatorio disponivel para o periodo',
      job_id: job.job.id, job_created_at: job.created_at, job_age_hours: age, facts: FACTS };
  }
  reports.sort((a, b) => String(b.endTime || '').localeCompare(String(a.endTime || '')));
  const latest = reports[0];
  let csv;
  try { csv = await downloadReport(channelId, latest.downloadUrl); }
  catch (e) { return { impressions: 'indisponivel', impressions_ctr: 'indisponivel', source: 'youtube_reporting_api',
    available: false, reason: `download falhou: ${scrub(e.message)}`, facts: FACTS }; }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cached = path.join(CACHE_DIR, `${channelId}__${latest.id}.csv`);
  try { fs.writeFileSync(cached, csv); } catch (_) {}
  const out = extractReach(csv, { videoId, from, to, origin: 'google_download' });
  return { ...out, available: out.impressions !== 'indisponivel', job_id: job.job.id, report_id: latest.id,
    report_window: { start: latest.startTime, end: latest.endTime }, cached_file: cached,
    delay_note: `relatorio em lote: a janela termina em ${latest.endTime} e nao cobre as ultimas horas`, facts: FACTS };
}
module.exports = { ensureReachJob, listJobs, listReports, downloadReport, listReportTypes,
  fetchReach, extractReach, parseCSV, mapColumns, detectCtrScale,
  REACH_TYPES, FACTS, CACHE_DIR, COLUMN_CANDIDATES, OFFICIAL_COLUMNS, ORIGINS };
