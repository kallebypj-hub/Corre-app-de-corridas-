'use strict';
/**
 * Prova que dois episodios sao INDEPENDENTES.
 *
 * Nao basta "parecer diferente": aqui se mede sobreposicao de fala, de n-gramas,
 * de titulo, de metadados, de miniatura, de Shorts, de afirmacoes e de linguagem
 * visual. E fonte reaproveitada entre episodios so passa se o dossie DECLARAR
 * o reaproveitamento — reusar Lally 2010 e legitimo quando ele e o objeto do
 * episodio, desde que esteja escrito.
 */
require('./env');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const cfg = require('./episode-config');

const CH = process.env.CHANNEL_ID || 'ch_practical_discipline';
const A = process.argv[2] || 'ep_001';
const B = process.argv[3] || 'ep_002';
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log(`\x1b[32m  ok\x1b[0m   ${name}`); }
  catch (e) { fail++; console.log(`\x1b[31m  FALHA\x1b[0m ${name}\n        ${e.message}`); }
}
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
function ngrams(text, n) {
  const w = norm(text).split(' ').filter(Boolean);
  const out = new Set();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}
const jaccard = (x, y) => { const i = [...x].filter((v) => y.has(v)).length; const u = new Set([...x, ...y]).size; return u ? i / u : 0; };
const readEp = (ep) => {
  const base = cfg.episodeDir(CH, ep);
  const j = (f) => JSON.parse(fs.readFileSync(path.join(base, f), 'utf8'));
  return { base, brief: cfg.loadBrief(CH, ep), script: cfg.loadScript(CH, ep), sources: cfg.loadSources(CH, ep),
    claims: cfg.loadClaims(CH, ep), meta: fs.existsSync(path.join(base, 'metadata.json')) ? j('metadata.json') : null,
    sb: fs.existsSync(path.join(base, 'storyboard.json')) ? j('storyboard.json') : null };
};
const linesOf = (e) => { const out = []; for (const s of e.script.scenes) for (const b of s.beats) out.push(b.text.trim()); return out; };

(() => {
  const a = readEp(A), b = readEp(B);
  console.log(`\n— independencia entre ${A} e ${B} —`);

  t('titulos de trabalho diferentes', () => {
    assert.notStrictEqual(norm(a.brief.working_title), norm(b.brief.working_title));
  });
  t('nenhum titulo alternativo coincide', () => {
    const sa = new Set([a.brief.metadata.title, ...(a.brief.metadata.title_alternatives || [])].map(norm));
    for (const x of [b.brief.metadata.title, ...(b.brief.metadata.title_alternatives || [])]) assert.ok(!sa.has(norm(x)), `titulo repetido: ${x}`);
  });
  t('teses diferentes', () => {
    assert.notStrictEqual(norm(a.brief.thesis), norm(b.brief.thesis));
    assert.ok(jaccard(ngrams(a.brief.thesis, 5), ngrams(b.brief.thesis, 5)) < 0.1, 'teses quase iguais');
  });
  t('nenhuma fala de narracao e identica entre os episodios', () => {
    const sa = new Set(linesOf(a).map(norm));
    const dup = linesOf(b).filter((l) => sa.has(norm(l)));
    assert.strictEqual(dup.length, 0, `${dup.length} fala(s) repetida(s): ${dup.slice(0, 2).join(' | ')}`);
  });
  t('sobreposicao de 6-gramas da narracao abaixo de 2%', () => {
    const ja = jaccard(ngrams(linesOf(a).join(' '), 6), ngrams(linesOf(b).join(' '), 6));
    assert.ok(ja < 0.02, `jaccard ${(ja * 100).toFixed(2)}%`);
    console.log(`         (sobreposicao medida: ${(ja * 100).toFixed(3)}%)`);
  });
  t('nenhuma afirmacao da matriz se repete entre os episodios', () => {
    const sa = new Set((a.claims.assertions || []).map((x) => norm(x.claim)));
    const dup = (b.claims.assertions || []).filter((x) => sa.has(norm(x.claim)));
    assert.strictEqual(dup.length, 0, `${dup.length} afirmacao(oes) repetida(s)`);
  });
  t('fonte compartilhada entre episodios vem DECLARADA como reaproveitamento', () => {
    const byDoi = new Map();
    for (const s of a.sources.sources) if (s.doi) byDoi.set(s.doi, s);
    const shared = (b.sources.sources || []).filter((s) => s.doi && byDoi.has(s.doi));
    for (const s of shared) assert.ok(s.reuse_note && s.reuse_note.length > 30,
      `fonte ${s.id} (${s.doi}) aparece nos dois episodios sem reuse_note explicando por que`);
    console.log(`         (${shared.length} fonte(s) compartilhada(s), todas declaradas)`);
  });
  t('a maioria das fontes do episodio novo e nova', () => {
    const doisA = new Set(a.sources.sources.filter((s) => s.doi).map((s) => s.doi));
    const nova = b.sources.sources.filter((s) => !s.doi || !doisA.has(s.doi)).length;
    assert.ok(nova / b.sources.sources.length >= 0.5,
      `so ${nova}/${b.sources.sources.length} fontes novas`);
    console.log(`         (${nova}/${b.sources.sources.length} fontes novas)`);
  });
  t('capitulos totalmente diferentes', () => {
    const sa = new Set(Object.values(a.brief.chapters || {}).map(norm));
    const dup = Object.values(b.brief.chapters || {}).filter((x) => sa.has(norm(x)));
    assert.strictEqual(dup.length, 0, `capitulo repetido: ${dup.join(', ')}`);
  });
  t('textos das miniaturas diferentes', () => {
    const strip = (x) => norm(String(x).replace(/<[^>]+>/g, ''));
    const sa = new Set(a.brief.thumbnails.map((x) => strip(x.title) + '|' + strip(x.proof)));
    for (const x of b.brief.thumbnails) assert.ok(!sa.has(strip(x.title) + '|' + strip(x.proof)), `miniatura repetida: ${x.title}`);
  });
  t('titulos dos Shorts diferentes', () => {
    const sa = new Set(a.brief.shorts.map((x) => norm(x.title)));
    for (const x of b.brief.shorts) assert.ok(!sa.has(norm(x.title)), `Short repetido: ${x.title}`);
  });
  t('tags coincidem em menos de 40%', () => {
    const sa = new Set((a.brief.metadata.tags || []).map(norm));
    const inter = (b.brief.metadata.tags || []).filter((x) => sa.has(norm(x))).length;
    const r = inter / (b.brief.metadata.tags || []).length;
    assert.ok(r < 0.4, `${(r * 100).toFixed(0)}% de tags iguais`);
    console.log(`         (${inter} tags em comum de ${(b.brief.metadata.tags || []).length})`);
  });
  t('descricoes publicadas nao se repetem', () => {
    if (!a.meta || !b.meta) return;
    const ja = jaccard(ngrams(a.meta.description, 6), ngrams(b.meta.description, 6));
    assert.ok(ja < 0.12, `descricoes com ${(ja * 100).toFixed(1)}% de sobreposicao`);
  });
  t('linguagem visual propria: a maioria dos motivos do episodio novo nao aparece no antigo', () => {
    const ma = new Set(a.script.scenes.map((s) => s.motif));
    const mb = b.script.scenes.map((s) => s.motif);
    const novos = mb.filter((m) => !ma.has(m)).length;
    assert.ok(novos >= Math.ceil(mb.length * 0.6), `so ${novos}/${mb.length} motivos novos`);
    console.log(`         (${novos}/${mb.length} motivos visuais novos)`);
  });
  t('arquivos de midia sao distintos', () => {
    const crypto = require('crypto');
    const h = (p) => fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : null;
    for (const f of ['video_long_1080p.mp4', 'narration.wav', 'captions.srt', 'thumbnail_A.png']) {
      const ha = h(path.join(a.base, f)), hb = h(path.join(b.base, f));
      if (ha && hb) assert.notStrictEqual(ha, hb, `${f} identico nos dois episodios`);
    }
  });

  console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} aprovados, ${fail} falhas\x1b[0m`);
  if (fail) process.exit(1);
})();
