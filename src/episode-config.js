'use strict';
/**
 * Configuracao editorial POR EPISODIO.
 *
 * Nada de conteudo de episodio dentro do codigo. Para produzir um episodio novo
 * basta criar a pasta dele com brief.json, script_en.json, sources.json e
 * claims.json. O pipeline nao muda.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function channelDir(channelId) { return path.join(ROOT, 'content', 'channels', channelId); }
function episodeDir(channelId, epId) { return path.join(channelDir(channelId), 'episodes', epId); }
function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function exists(p) { return fs.existsSync(p); }

const REQUIRED_BRIEF = ['episode_id', 'working_title', 'thesis', 'production_mode', 'metadata', 'shorts', 'thumbnails'];

function loadBrief(channelId, epId) {
  const p = path.join(episodeDir(channelId, epId), 'brief.json');
  if (!exists(p)) throw new Error(`brief do episodio ausente: ${p}. Crie-o a partir de docs/episodio-2.md antes de produzir.`);
  const b = readJSON(p);
  const missing = REQUIRED_BRIEF.filter((k) => b[k] === undefined || b[k] === null);
  if (missing.length) throw new Error(`brief.json de ${epId} incompleto: falta ${missing.join(', ')}`);
  if (b.episode_id !== epId) throw new Error(`brief.json diz episode_id="${b.episode_id}" mas a pasta e ${epId}`);
  if (!Array.isArray(b.shorts) || b.shorts.length < 1) throw new Error(`${epId}: brief.shorts precisa listar ao menos um trecho`);
  if (!Array.isArray(b.thumbnails) || b.thumbnails.length !== 2) throw new Error(`${epId}: brief.thumbnails precisa ter exatamente 2 variantes`);
  return b;
}
function loadScript(channelId, epId) {
  const p = path.join(episodeDir(channelId, epId), 'script_en.json');
  if (!exists(p)) throw new Error(`roteiro ausente: ${p}`);
  const s = readJSON(p);
  if (!Array.isArray(s.scenes) || !s.scenes.length) throw new Error(`${epId}: roteiro sem cenas`);
  for (const sc of s.scenes) {
    if (!sc.id || !sc.motif || !Array.isArray(sc.beats) || !sc.beats.length)
      throw new Error(`${epId}: cena invalida (${sc.id || '?'}) — precisa de id, motif e beats`);
  }
  return s;
}
function loadSources(channelId, epId) {
  const p = path.join(episodeDir(channelId, epId), 'sources.json');
  if (!exists(p)) throw new Error(`dossie de fontes ausente: ${p}. Pesquisa e trabalho assistido: o pipeline valida, nao inventa.`);
  const s = readJSON(p);
  if (!Array.isArray(s.sources) || !s.sources.length) throw new Error(`${epId}: sources.json sem fontes`);
  for (const x of s.sources) {
    if (!x.id || !x.authors || !x.title) throw new Error(`${epId}: fonte incompleta (${x.id || '?'})`);
    if (!x.doi && !x.url) throw new Error(`${epId}: fonte ${x.id} sem DOI nem URL — nao e rastreavel`);
  }
  return s;
}
function loadClaims(channelId, epId) {
  const p = path.join(episodeDir(channelId, epId), 'claims.json');
  if (!exists(p)) throw new Error(`matriz de afirmacoes ausente: ${p}. Toda afirmacao factual precisa de entrada com evidencia e verificador.`);
  return readJSON(p);
}
function loadIdeas(channelId) {
  const p = path.join(channelDir(channelId), 'ideas.json');
  if (!exists(p)) throw new Error(`catalogo de pautas ausente: ${p}`);
  return readJSON(p);
}
function loadChannel(channelId) {
  const p = path.join(ROOT, 'config', 'channels', `${channelId}.json`);
  if (!exists(p)) throw new Error(`canal nao configurado: ${p}`);
  return readJSON(p);
}
/** Lista episodios que tem pasta com brief, independentemente do store. */
function listEpisodeDirs(channelId) {
  const d = path.join(channelDir(channelId), 'episodes');
  if (!exists(d)) return [];
  return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && /^ep_/.test(e.name))
    .map((e) => e.name).sort();
}
module.exports = { loadBrief, loadScript, loadSources, loadClaims, loadIdeas, loadChannel,
  episodeDir, channelDir, listEpisodeDirs, readJSON, exists, ROOT };
