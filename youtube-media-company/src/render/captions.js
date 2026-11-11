'use strict';
/**
 * Legendas com tempo VERIFICAVEL.
 *  - cada fala tem duracao MEDIDA (amostras do wav sintetizado), nunca estimada;
 *  - dentro de uma fala longa, as quebras de cue sao realinhadas pelos timestamps
 *    de palavra do reconhecedor local; so cai em divisao proporcional se o
 *    alinhamento falhar, e isso fica registrado no relatorio.
 */
const fs = require('fs');
const MAX_CHARS = 42, MAX_LINES = 2;
const MAX_CUE = MAX_CHARS * MAX_LINES;

function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim(); }

function wrap(text) {
  const words = text.split(/\s+/); const lines = []; let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= MAX_CHARS) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
/** Divide uma fala em cues de no maximo 2 linhas, cortando em fronteira de palavra. */
function splitIntoCues(text) {
  const t = text.trim();
  if (t.length <= MAX_CUE) return [t];
  const words = t.split(/\s+/); const cues = []; let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= MAX_CUE) cur += ' ' + w;
    else { cues.push(cur); cur = w; }
  }
  if (cur) cues.push(cur);
  return cues;
}
function ts(sec) {
  const s = Math.max(0, sec); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60), ms = Math.round((s - Math.floor(s)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * @param timeline [{ lineId, text, start, end }]  tempos MEDIDOS por fala
 * @param asrWords [{ w, start, end }] palavras do reconhecedor (opcional)
 */
function buildCaptions(timeline, asrWords) {
  const cues = []; const stats = { total: 0, aligned_by_asr: 0, proportional: 0 };
  let wi = 0;
  const words = Array.isArray(asrWords) ? asrWords : [];
  for (const line of timeline) {
    const parts = splitIntoCues(line.text);
    const dur = line.end - line.start;
    // janela de palavras do ASR que cai dentro desta fala
    while (wi < words.length && words[wi].end < line.start - 0.25) wi++;
    const win = []; let j = wi;
    while (j < words.length && words[j].start < line.end + 0.25) { win.push(words[j]); j++; }
    let cursor = 0; let acc = 0;
    const totalChars = parts.reduce((s, p) => s + p.length, 0);
    for (let k = 0; k < parts.length; k++) {
      const p = parts[k];
      const nWords = norm(p).split(' ').filter(Boolean).length;
      let start = null, end = null, how = 'proportional';
      if (win.length && nWords > 0 && cursor < win.length) {
        const slice = win.slice(cursor, cursor + nWords);
        if (slice.length >= Math.max(1, Math.floor(nWords * 0.6))) {
          start = slice[0].start; end = slice[slice.length - 1].end; how = 'asr';
          cursor += slice.length;
        }
      }
      if (start === null) {
        start = line.start + (acc / totalChars) * dur;
        end = line.start + ((acc + p.length) / totalChars) * dur;
      }
      acc += p.length;
      // nunca ultrapassar a fronteira medida da fala
      start = Math.max(line.start, Math.min(start, line.end - 0.12));
      end = Math.max(start + 0.35, Math.min(end, line.end));
      if (k === 0) start = line.start;
      if (k === parts.length - 1) end = line.end;
      cues.push({ lineId: line.lineId, text: p, lines: wrap(p), start, end, how });
      stats.total++; stats[how === 'asr' ? 'aligned_by_asr' : 'proportional']++;
    }
    wi = j;
  }
  // garante monotonia e ausencia de sobreposicao
  for (let i = 1; i < cues.length; i++) {
    if (cues[i].start < cues[i - 1].end) cues[i].start = cues[i - 1].end + 0.001;
    if (cues[i].end <= cues[i].start) cues[i].end = cues[i].start + 0.4;
  }
  return { cues, stats };
}
function toSRT(cues) {
  return cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.lines.join('\n')}\n`).join('\n');
}
function writeSRT(file, cues) { fs.writeFileSync(file, toSRT(cues), 'utf8'); return file; }
function parseSRT(file) {
  const blocks = fs.readFileSync(file, 'utf8').trim().split(/\n\s*\n/);
  return blocks.map((b) => {
    const l = b.split('\n'); const m = (l[1] || '').match(/(\d+):(\d+):(\d+),(\d+)\s*-->\s*(\d+):(\d+):(\d+),(\d+)/);
    if (!m) return null;
    const t = (h, mi, s, ms) => +h * 3600 + +mi * 60 + +s + +ms / 1000;
    return { index: Number(l[0]), start: t(m[1], m[2], m[3], m[4]), end: t(m[5], m[6], m[7], m[8]), text: l.slice(2).join(' ') };
  }).filter(Boolean);
}
module.exports = { buildCaptions, toSRT, writeSRT, parseSRT, splitIntoCues, wrap, ts, norm, MAX_CHARS, MAX_LINES };
