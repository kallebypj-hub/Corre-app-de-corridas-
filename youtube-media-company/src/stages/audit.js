'use strict';
const fs = require('fs');
const path = require('path');
const { art, W, ROOT, chCfg } = require('./editorial');
const cfg = require('../episode-config');
const { declare } = require('../autonomy');

/**
 * Detector de marcadores factuais — generico e PRECISO.
 *
 * Ele nao julga a veracidade: aponta quais falas carregam afirmacao que exige
 * fonte. Precisa ser preciso dos dois lados: deixar passar uma estatistica e
 * perigoso; marcar toda frase retorica esvazia o sinal e a matriz vira burocracia.
 * Por isso marca quantidade COM UNIDADE, ano, estatistica, atribuicao a pessoa
 * ou instituicao perto de verbo de evidencia, e verbo de citacao direta.
 */
const NUM_WORDS = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve',
  'thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty','thirty','forty','fifty',
  'sixty','seventy','eighty','ninety','hundred','thousand','million','billion'];
const UNITS = ['day','days','week','weeks','month','months','year','years','minute','minutes','hour','hours',
  'people','person','adults','participants','patients','subjects','studies','study','trials','trial','labs',
  'percent','times','tests','reviews','papers','articles','men','women','students'];
const EVIDENCE_VERBS = /\b(published|wrote|writes|found|finds|argued|argues|reported|reports|showed|shows|tracked|followed|measured|reviewed|pulled together|concluded|team|et al)\b/i;
const QUOTE_VERBS = /\b(wrote that|said that|argued that|according to|in his words|in her words|as .{2,30} (put it|wrote|said))\b/i;
const STAT_RE = /\b(d\s*=|d of\b|p\s*[<>=]|effect size|odds ratio|confidence interval|median|mean of|average of|meta.?analys\w*|systematic review|replication|percent|%)/i;
const NUM_TOKEN = new RegExp(`^(?:\\d[\\d,.]*|${NUM_WORDS.join('|')})$`, 'i');
const UNIT_TOKEN = new RegExp(`^(?:${UNITS.join('|')})[.,;:]?$`, 'i');
const SENTENCE_STARTERS = new Set(['the','a','an','and','but','so','it','he','she','they','we','you','i',
  'this','that','there','here','what','why','how','when','which','who','not','no','yes','in','on','at','to','for',
  'from','with','of','if','then','now','every','each','all','his','her','their','its','our','your','my','nobody',
  'plot','have','those','only','among','same','start','stop','write','pick','read','sit','days','four','twenty',
  'because','about','after','before','sixty','let','do','does','did','can','could','should','would','will','just',
  'still','even','more','most','less','think','notice','stop','count','pick','sixty-six']);

/** Quantidade com unidade: "ninety six people", "84 days", "23 percent". */
function hasQuantity(text) {
  const toks = String(text).split(/\s+/);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i].replace(/^[^\w]+|[^\w%]+$/g, '');
    if (!NUM_TOKEN.test(t)) continue;
    for (let j = i + 1; j <= Math.min(toks.length - 1, i + 4); j++) {
      const u = toks[j].replace(/^[^\w%]+|[^\w%]+$/g, '');
      if (UNIT_TOKEN.test(u) || u === '%') return true;
      if (!NUM_TOKEN.test(u) && !/^(and|of|to|a|the)$/i.test(u)) break;
    }
  }
  return false;
}
/** Nome proprio plausivel de pessoa ou instituicao, ignorando inicio de frase. */
function properNouns(text) {
  const out = [];
  for (const sent of String(text).split(/(?<=[.!?])\s+/)) {
    const toks = sent.trim().split(/\s+/);
    toks.forEach((tok, i) => {
      let clean = tok.replace(/^[^A-Za-z]+|[^A-Za-z']+$/g, '');
      // contracao nao e nome proprio: "Here's", "It's", "Lally's" -> base
      const base = clean.replace(/'(s|re|ll|ve|d|m|t)$/i, '');
      if (!base || base.length < 3) return;
      if (!/^[A-Z][a-z]{2,}$/.test(base) && !/^[A-Z]{2,}$/.test(base)) return;
      if (SENTENCE_STARTERS.has(base.toLowerCase())) return;
      out.push(base);
    });
  }
  return [...new Set(out)];
}
function factualMarkers(text) {
  const t = String(text);
  const m = [];
  if (/\b(1[0-9]{3}|20[0-9]{2})\b/.test(t)) m.push('ano');
  if (/\b(nineteen|twenty)\s+(hundred|sixty|seventy|eighty|ninety|ten|twelve|sixteen|twenty|thirty|forty|fifty|two|four|six|eight|one|three|five|seven|nine|eleven|thirteen|fourteen|fifteen|seventeen|eighteen)\b/i.test(t)
      || /\btwo thousand\b/i.test(t)) m.push('ano_falado');
  if (hasQuantity(t)) m.push('quantidade_com_unidade');
  if (STAT_RE.test(t)) m.push('estatistica');
  if (QUOTE_VERBS.test(t)) m.push('citacao_direta');
  const pn = properNouns(t);
  if (pn.length && EVIDENCE_VERBS.test(t)) m.push('atribuicao:' + pn.join('+'));
  else if (pn.length && (m.includes('ano') || m.includes('ano_falado') || m.includes('estatistica'))) m.push('nome_em_contexto_factual:' + pn.join('+'));
  return [...new Set(m)];
}
/**
 * 6. Auditoria de fatos — MATRIZ, nao regex.
 *
 * O detector de marcadores continua existindo, mas so como GATILHO: ele aponta
 * quais falas carregam afirmacao factual. A autoridade e claims.json, onde cada
 * afirmacao tem fonte, evidencia, contra o que foi conferida, quem conferiu e quando.
 * Fala com marcador e sem entrada na matriz BLOQUEIA. Entrada sem evidencia BLOQUEIA.
 * Entrada apontando para fonte fora do dossie BLOQUEIA. Entrada orfa (que nao existe
 * mais no roteiro) BLOQUEIA, para a matriz nao envelhecer em silencio.
 */
function normClaim(t) { return String(t).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }

async function factcheck({ channelId, epId, paths }) {
  const script = cfg.loadScript(channelId, epId);
  const sources = cfg.loadSources(channelId, epId);
  const matrix = cfg.loadClaims(channelId, epId);
  const knownSources = new Set(sources.sources.map((x) => x.id));
  const assertions = Array.isArray(matrix.assertions) ? matrix.assertions : [];

  const byText = new Map();
  for (const a of assertions) byText.set(normClaim(a.claim), a);
  /**
   * Isencoes: quantidade usada como ILUSTRACAO, nao como dado ("uma caminhada de
   * trinta minutos"). Nao se afrouxa o detector por causa delas: escreve-se a
   * isencao, com justificativa, autor e data. Silencio nao e auditavel; isencao e.
   */
  const exemptions = Array.isArray(matrix.exemptions) ? matrix.exemptions : [];
  const byExempt = new Map();
  for (const e of exemptions) byExempt.set(normClaim(e.claim), e);

  const lines = [];
  for (const sc of script.scenes) for (const b of sc.beats) lines.push({ scene: sc.id, text: b.text.trim() });

  const scriptTexts = new Set(lines.map((l) => normClaim(l.text)));
  const rows = []; const problems = []; const usedAssertions = new Set(); const usedExemptions = new Set();
  for (const l of lines) {
    const markers = factualMarkers(l.text);
    const a = byText.get(normClaim(l.text));
    const ex = byExempt.get(normClaim(l.text));
    if (markers.length && !a && ex) {
      if (!ex.justification || !ex.verified_by || !ex.verified_at) {
        problems.push({ kind: 'ISENCAO_INCOMPLETA', scene: l.scene, claim: String(ex.claim).slice(0, 80) });
      }
      usedExemptions.add(normClaim(l.text));
      rows.push({ scene: l.scene, text: l.text, markers, assertion: null, type: 'isencao_ilustrativa',
        sources: [], evidence: ex.justification, checked_against: 'nao se aplica — uso ilustrativo',
        verified_by: ex.verified_by, verified_at: ex.verified_at, status: 'ISENTA' });
      continue;
    }
    // Varre toda fala: a que tem marcador EXIGE entrada; a que nao tem, mas
    // possui entrada, entra como cobertura voluntaria (ressalva, limitacao).
    if (!markers.length && !a) continue;
    if (!markers.length && a) {
      usedAssertions.add(a.id);
      rows.push({ scene: l.scene, text: l.text, markers: ['cobertura_voluntaria'], assertion: a.id, type: a.type || null,
        sources: a.sources || [], evidence: a.evidence, checked_against: a.checked_against || null,
        verified_by: a.verified_by || null, verified_at: a.verified_at || null, status: 'verificada' });
      continue;
    }
    if (!a) {
      problems.push({ kind: 'SEM_ENTRADA_NA_MATRIZ', scene: l.scene, text: l.text });
      rows.push({ scene: l.scene, text: l.text, markers, assertion: null, sources: [], status: 'SEM_FONTE' });
      continue;
    }
    usedAssertions.add(a.id);
    const issues = [];
    if (!a.evidence || String(a.evidence).trim().length < 20) issues.push('sem evidencia descrita');
    if (!a.verified_by) issues.push('sem verificador');
    if (!a.verified_at) issues.push('sem data de verificacao');
    if (a.status !== 'verified') issues.push(`status=${a.status || 'ausente'}`);
    const srcs = Array.isArray(a.sources) ? a.sources : [];
    if (!srcs.length) issues.push('sem fonte');
    const unknown = srcs.filter((x) => !knownSources.has(x));
    if (unknown.length) issues.push(`fonte fora do dossie: ${unknown.join(', ')}`);
    if (a.caveat_required_in_script && a.caveat_present !== true) issues.push('ressalva exigida nao marcada como presente');
    if (issues.length) problems.push({ kind: 'ENTRADA_INCOMPLETA', scene: l.scene, assertion: a.id, issues });
    rows.push({ scene: l.scene, text: l.text, markers, assertion: a.id, type: a.type || null,
      sources: srcs, evidence: a.evidence, checked_against: a.checked_against || null,
      verified_by: a.verified_by || null, verified_at: a.verified_at || null,
      status: issues.length ? 'INCOMPLETA' : 'verificada' });
  }
  // entradas orfas: a matriz nao pode descrever fala que o roteiro nao tem mais
  for (const e of exemptions) if (!scriptTexts.has(normClaim(e.claim)))
    problems.push({ kind: 'ISENCAO_ORFA', claim: String(e.claim).slice(0, 80), why: 'o texto desta isencao nao existe no roteiro atual' });
  const orphans = assertions.filter((a) => !scriptTexts.has(normClaim(a.claim)));
  for (const o of orphans) problems.push({ kind: 'ENTRADA_ORFA', assertion: o.id,
    claim: String(o.claim).slice(0, 90), why: 'o texto desta afirmacao nao existe em nenhuma fala do roteiro atual' });

  // ressalvas exigidas pelo dossie precisam estar na matriz
  for (const s of sources.sources) {
    if (String(s.caveat_in_script || '').toUpperCase().startsWith('SIM')) {
      const has = assertions.some((a) => (a.sources || []).includes(s.id) && a.caveat_present === true);
      if (!has) problems.push({ kind: 'RESSALVA_DO_DOSSIE_AUSENTE', source: s.id, required: s.caveat_in_script });
    }
  }

  const summary = {
    lines_scanned: lines.length,
    factual_lines_detected: rows.filter((r) => !r.markers.includes('cobertura_voluntaria')).length,
    voluntary_coverage_lines: rows.filter((r) => r.markers.includes('cobertura_voluntaria')).length,
    verified: rows.filter((r) => r.status === 'verificada').length,
    exempt_illustrative: rows.filter((r) => r.status === 'ISENTA').length,
    blocked: problems.length,
    assertions_in_matrix: assertions.length,
    orphan_assertions: orphans.length,
    sources_in_dossier: sources.sources.length,
    withheld_from_script: (sources.rejected_or_withheld || []).length,
    verdict: problems.length === 0 ? 'APROVADO' : 'BLOQUEIA_APROVACAO'
  };

  const md = [`# Claims review — ${epId}`, '', `**Veredicto:** ${summary.verdict}`, '',
    `Falas varridas: **${summary.lines_scanned}** · com marcador factual: **${summary.factual_lines_detected}** · verificadas: **${summary.verified}** · bloqueando: **${summary.blocked}**`, '',
    `Matriz: **${summary.assertions_in_matrix}** afirmações, **${summary.orphan_assertions}** órfãs, **${summary.exempt_illustrative}** isenções ilustrativas declaradas. Dossiê: **${summary.sources_in_dossier}** fontes.`, '',
    `Verificador declarado: ${matrix.verifier || '(ausente)'}`, '',
    '> O detector de marcadores é apenas o gatilho. A autoridade é a matriz `claims.json`: cada afirmação diz contra o quê foi conferida, por quem e quando. Fala com marcador e sem entrada bloqueia; entrada sem evidência bloqueia; entrada órfã bloqueia.', '',
    '## Afirmação a afirmação', '', '| Cena | Afirmação | Tipo | Fonte | Conferida contra | Por / quando | Status |', '|---|---|---|---|---|---|---|'];
  for (const r of rows) md.push(`| ${r.scene} | ${String(r.text).replace(/\|/g, '/').slice(0, 120)} | ${r.type || '—'} | ${r.sources.join(', ') || '—'} | ${String(r.checked_against || '—').replace(/\|/g, '/').slice(0, 70)} | ${r.verified_by || '—'} / ${r.verified_at || '—'} | ${r.status} |`);
  if (problems.length) {
    md.push('', '## Bloqueios', '');
    for (const p of problems) md.push(`- **${p.kind}** — ${JSON.stringify(p).replace(/\|/g, '/')}`);
  }
  md.push('', '## Retiradas antes de entrar na narração', '');
  for (const r of (sources.rejected_or_withheld || [])) md.push(`- **${r.status}** — ${r.claim}`, `  - ${r.reason}`, '');
  const f1 = W(path.join(paths.base, 'claims_review.md'), md.join('\n'));
  const f2 = W(path.join(paths.base, 'claims_review.json'), { summary, rows, problems, matrix_verifier: matrix.verifier || null, withheld: sources.rejected_or_withheld || [] });
  if (problems.length) throw new Error(`auditoria de fatos reprovou: ${problems.map((p) => p.kind).join(', ')}`);
  return { mode: 'real', autonomy: declare('factcheck'), outputs: ['claims_review.md', 'claims_review.json'],
    artifacts: [art(f1, 'markdown'), art(f2, 'json')],
    notes: `${summary.factual_lines_detected} falas factuais: ${summary.verified} verificadas na matriz e ${summary.exempt_illustrative} isentas por uso ilustrativo declarado; 0 orfas.`,
    cost: { usd: 0, provider: 'local' } };
}

/** 7. Revisao de narrativa: checagens automaticas + pendencias para revisao humana. */
async function narrative_review({ channelId, epId, paths }) {
  const s = cfg.loadScript(channelId, epId);
  const matrix = cfg.loadClaims(channelId, epId);
  const c = chCfg(channelId);
  const lines = []; for (const sc of s.scenes) for (const b of sc.beats) lines.push({ scene: sc.id, text: b.text.trim() });
  const words = lines.reduce((a, l) => a + l.text.split(/\s+/).length, 0);
  const lens = lines.map((l) => l.text.split(/\s+/).length);
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);

  const forbidden = (c.voice_of_channel.forbidden || []).filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(lines.map((l) => l.text).join(' ')));
  const hookWords = s.scenes[0].beats[0].text.split(/\s+/).length;
  // Intercambiabilidade: o vocabulario distintivo DO PROPRIO episodio e derivado
  // do roteiro (termos de conteudo mais frequentes, fora da lista de palavras vazias),
  // somado a nomes proprios e numeros. Uma fala e "intercambiavel" quando nao carrega
  // nenhum deles. O risco real nao e uma fala solta, e um TRECHO inteiro sem nada
  // especifico — por isso o teste olha janelas consecutivas, nao falas isoladas.
  const STOP = new Set(('a an the and or but so if then than that this these those it its it s is are was were be been being am do does did done doing have has had having will would can could should may might must of in on at to for from with without about into over after before while when where why how what who you your yours we our us they them their he she his her i me my not no yes just only still even more most less least very really much many any some all each both other another same own as by up down out off again once here there now too also well way thing things get got go goes going come comes came make makes made take takes took put puts need needs want wants know knows knew think thinks thought say says said tell tells told feel feels felt look looks looked part point case kind sort lot bit time times day days week weeks year years').split(' '));
  const tokens = lines.flatMap((l) => l.text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/)).filter((w) => w.length > 2 && !STOP.has(w));
  const freq = {}; for (const w of tokens) freq[w] = (freq[w] || 0) + 1;
  const vocab = new Set(Object.entries(freq).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([w]) => w));
  const hasProper = (t) => /(?!^)\b[A-Z][a-z]{2,}/.test(t.replace(/^[^.]*?\. ?/g, (m) => m));
  const hasNumber = (t) => /\b\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|twenty|thirty|sixty|ninety|hundred|thousand|million)\b/i.test(t);
  const isSpecific = (t) => hasProper(t) || hasNumber(t) ||
    t.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).some((w) => vocab.has(w));
  const specificFlags = lines.map((l) => isSpecific(l.text));
  const density = specificFlags.filter(Boolean).length / lines.length;
  let worstRun = 0, run = 0;
  for (const f of specificFlags) { if (f) run = 0; else { run++; worstRun = Math.max(worstRun, run); } }
  const generic = lines.filter((l, i) => !specificFlags[i]);
  // repeticao: bigramas de abertura repetidos
  const openers = lines.map((l) => l.text.split(/\s+/).slice(0, 3).join(' ').toLowerCase());
  const dupOpeners = openers.filter((o, i) => openers.indexOf(o) !== i);

  const checks = [
    { id: 'hook_short', pass: hookWords <= 8, detail: `gancho com ${hookWords} palavras (limite 8, resolvido em ~3s de leitura)` },
    { id: 'sem_termo_proibido', pass: forbidden.length === 0, detail: forbidden.length ? `encontrados: ${forbidden.join(', ')}` : 'nenhum termo da lista proibida do canal' },
    { id: 'variacao_de_frase', pass: sd >= 4, detail: `media ${mean.toFixed(1)} palavras, desvio ${sd.toFixed(1)} (minimo 4 para evitar cadencia monotona)` },
    { id: 'densidade_de_vocabulario_proprio', pass: density >= 0.55, detail: `${(density * 100).toFixed(0)}% das falas carregam termo distintivo do proprio episodio, nome proprio ou numero (minimo 55%)` },
    { id: 'sem_trecho_intercambiavel', pass: worstRun <= 5, detail: `maior sequencia de falas consecutivas sem nada especifico: ${worstRun} (limite 5). Um trecho longo sem vocabulario proprio e o que torna um roteiro trocavel por outro.` },
    { id: 'sem_abertura_repetida', pass: dupOpeners.length <= 3, detail: `${dupOpeners.length} aberturas de frase repetidas (limite 3)` },
    { id: 'duracao_alvo', pass: words >= 850 && words <= 1500, detail: `${words} palavras (faixa 850-1500 para 6-9 min)` },
    // Admitir o limite deixou de ser uma lista de frases do primeiro episodio:
    // agora sai da matriz de afirmacoes, que e por episodio e auditavel.
    { id: 'tem_limite_admitido',
      pass: (matrix.assertions || []).some((a) => /limitation|limite|caveat|ressalva/i.test(String(a.type || '')) || a.caveat_present === true),
      detail: `${(matrix.assertions || []).filter((a) => /limitation/i.test(String(a.type || '')) || a.caveat_present === true).length} afirmacao(oes) marcada(s) como limitacao ou com ressalva exigida presente no roteiro` },
    // Convite pertinente: a ultima cena precisa pedir algo que so faz sentido
    // para quem assistiu — isto e, usar vocabulario proprio do episodio.
    { id: 'convite_pertinente',
      pass: (() => {
        const last = s.scenes[s.scenes.length - 1].beats.map((b) => b.text).join(' ');
        if (!/comment|reply|post|write|share|tally/i.test(last)) return false;
        const own = last.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter((w) => vocab.has(w));
        return own.length >= 2;
      })(),
      detail: 'a cena final faz um pedido concreto usando vocabulario proprio do episodio, em vez de um convite generico' }
  ];
  const failed = checks.filter((x) => !x.pass);
  const out = { verdict: failed.length === 0 ? 'APROVADO' : 'REPROVADO', checks,
    stats: { lines: lines.length, words, mean_words_per_line: +mean.toFixed(2), sd_words: +sd.toFixed(2),
      episode_vocabulary: [...vocab].slice(0, 25), specific_density: +density.toFixed(3), worst_generic_run: worstRun,
      generic_lines: generic.map((g) => g.text) },
    method_note: 'A primeira versao deste teste comparava com uma lista fixa de palavras-chave e reprovava falas altamente especificas (ex.: a citacao de Sirois e Pychyl) so porque o termo nao estava na lista. Foi trocada por vocabulario derivado do proprio roteiro mais nomes proprios e numeros, medindo densidade e a pior sequencia sem nada especifico.',
    human_review_pending: [
      'Ouvir a narração inteira uma vez com fone: o tom calmo se mantém na cena 8?',
      'Confirmar que a cena 6 (saúde mental) não soa como conselho clínico.',
      'Decidir se o título definitivo é o provisório ou um dos alternativos do metadata.'
    ], reviewed_by: 'narrative_editor', reviewed_at: new Date().toISOString() };
  const f = W(path.join(paths.base, 'narrative_review.json'), out);
  if (failed.length) throw new Error(`revisao de narrativa reprovou: ${failed.map((x) => x.id).join(', ')}`);
  return { mode: 'real', autonomy: declare('narrative_review'), outputs: ['narrative_review.json'], artifacts: [art(f, 'json')],
    notes: `${checks.length} checagens, todas aprovadas; ${out.human_review_pending.length} pendencias humanas.`,
    cost: { usd: 0, provider: 'local' } };
}
module.exports = { factcheck, narrative_review, factualMarkers, normClaim };
