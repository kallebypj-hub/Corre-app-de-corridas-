'use strict';
/**
 * Importacao de CSV exportado a mao do YouTube Studio.
 *
 * Existe porque a Reporting API e em lote e pode levar ate 48h para o primeiro
 * arquivo. Enquanto isso o dono pode exportar do Studio e colocar aqui. O dado
 * importado fica marcado com origem, periodo e quem importou — nunca se mistura
 * com dado de API como se fosse a mesma coisa.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseCSV } = require('./reporting');

const INBOX = process.env.STUDIO_IMPORT_DIR || path.join(__dirname, '..', '..', 'var', 'studio-import');

/** O Studio exporta cabecalhos em linguagem natural, que mudam por idioma. */
const FIELD_ALIASES = {
  impressions: ['impressions', 'impressoes', 'impressões', 'thumbnail impressions', 'impressoes de miniatura'],
  impressions_ctr: ['impressions click-through rate (%)', 'impressions click-through rate', 'ctr de impressoes (%)',
    'taxa de cliques das impressoes (%)', 'taxa de cliques de impressões (%)', 'impressions ctr'],
  views: ['views', 'visualizacoes', 'visualizações'],
  average_view_duration: ['average view duration', 'duracao media da visualizacao', 'duração média da visualização'],
  watch_time_hours: ['watch time (hours)', 'tempo de exibicao (horas)', 'tempo de exibição (horas)'],
  video_id: ['content', 'video', 'video id', 'conteudo', 'conteúdo'],
  date: ['date', 'data', 'day', 'dia']
};
function resolve(header) {
  const map = {}; const missing = [];
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const hit = header.find((h) => aliases.includes(h.toLowerCase().trim()));
    if (hit) map[field] = hit; else missing.push(field);
  }
  return { map, missing };
}
function pct(v) { const n = Number(String(v).replace('%', '').replace(',', '.')); return Number.isFinite(n) ? n / 100 : null; }
function num(v) { const n = Number(String(v).replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; }

/**
 * @param file CSV exportado do Studio
 * @param videoId opcional; se o CSV for de um video so, pode vir null
 */
function importFile(file, { videoId = null, importedBy = 'presidente', note = null } = {}) {
  if (!fs.existsSync(file)) throw new Error(`arquivo nao encontrado: ${file}`);
  const raw = fs.readFileSync(file, 'utf8');
  const { header, rows } = parseCSV(raw);
  const { map, missing } = resolve(header);
  if (!map.impressions && !map.views)
    throw new Error(`o CSV nao parece ser uma exportacao do Studio: nenhuma coluna de impressoes nem de visualizacoes reconhecida. Cabecalho: ${header.join(', ')}`);
  const sel = videoId && map.video_id ? rows.filter((r) => String(r[map.video_id]).includes(videoId)) : rows;
  if (!sel.length) throw new Error(videoId ? `nenhuma linha para o video ${videoId}` : 'CSV sem linhas');

  const imp = map.impressions ? sel.reduce((a, r) => a + (num(r[map.impressions]) || 0), 0) : null;
  const clicks = map.impressions && map.impressions_ctr
    ? sel.reduce((a, r) => a + (pct(r[map.impressions_ctr]) || 0) * (num(r[map.impressions]) || 0), 0) : null;
  const dates = map.date ? sel.map((r) => r[map.date]).filter(Boolean).sort() : [];

  return {
    source: 'youtube_studio_csv_manual',
    file: path.basename(file), sha256: crypto.createHash('sha256').update(raw).digest('hex'),
    imported_by: importedBy, imported_at: new Date().toISOString(), note,
    video_id: videoId, rows_used: sel.length,
    period: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    resolved_columns: map, unresolved_fields: missing,
    metrics: {
      impressions: imp === null ? 'indisponivel' : imp,
      impressions_ctr: imp && clicks !== null ? +(clicks / imp).toFixed(6) : 'indisponivel',
      impressions_ctr_percent: imp && clicks !== null ? +((clicks / imp) * 100).toFixed(2) : 'indisponivel',
      views: map.views ? sel.reduce((a, r) => a + (num(r[map.views]) || 0), 0) : 'indisponivel'
    },
    // mesma unidade canonica do resto do projeto
    ctr_unit: 'fracao de 0 a 1 (cliques / impressoes). 0.062 = 6,2%. A coluna do Studio vem em porcentagem e foi dividida por 100.',
    ctr_canonical_field: 'impressions_ctr (fracao); impressions_ctr_percent e o mesmo valor em porcentagem',
    csv_origin: 'manual_csv',
    column_mapping_verified: false,
    verification_note: 'planilha exportada a mao nunca confirma o mapeamento das colunas do relatorio da API: sao arquivos diferentes, com cabecalhos diferentes.',
    caveats: [
      'dado exportado a mao: o periodo e o recorte sao os que o dono escolheu no Studio, nao os do sistema',
      'o Studio fecha o dia em horario do Pacifico, igual a Reporting API',
      'este dado NAO e tratado como se tivesse vindo da API: a origem fica gravada no evento'
    ]
  };
}
/** Varre a caixa de entrada e devolve o que da para importar. */
function scanInbox() {
  fs.mkdirSync(INBOX, { recursive: true });
  return fs.readdirSync(INBOX).filter((f) => /\.csv$/i.test(f)).map((f) => path.join(INBOX, f));
}
module.exports = { importFile, scanInbox, resolve, FIELD_ALIASES, INBOX };
