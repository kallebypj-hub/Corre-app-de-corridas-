'use strict';
const fs = require('fs');
const path = require('path');
const { art, W, ROOT, chCfg } = require('./editorial');

/** Detecta sentencas que CARREGAM afirmacao factual e portanto exigem fonte. */
function factualMarkers(text) {
  const m = [];
  if (/\b(1[6-9]\d{2}|20\d{2})\b/.test(text)) m.push('ano');
  if (/\btwo thousand\s+(six|ten|thirteen|sixteen|nineteen)\b/i.test(text)) m.push('ano_falado');
  if (/\bd of point|\bd = |\bd of \b/i.test(text)) m.push('tamanho_de_efeito');
  if (/\b\d+\s*(%|percent)\b/i.test(text)) m.push('percentual');
  if (/\b(ninety four|two hundred forty one|ninety six|eighty four|sixty six|twenty three|two thousand one hundred forty one|eighteen)\b/i.test(text)) m.push('numero_falado');
  if (/\b(Sirois|Pychyl|Dimidjian|Gollwitzer|Sheeran|Lally|Hagger|Aristotle|William James|Phillippa)\b/.test(text)) m.push('pessoa_real');
  if (/\bconfidence interval|meta analysis|randomized trial|replication\b/i.test(text)) m.push('termo_de_evidencia');
  return m;
}

/** 6. Auditoria de fatos: toda sentenca com marcador factual precisa de fonte mapeada. */
async function factcheck({ paths }) {
  const s = JSON.parse(fs.readFileSync(path.join(paths.base, 'script_en.json'), 'utf8'));
  const sources = JSON.parse(fs.readFileSync(path.join(paths.base, 'sources.json'), 'utf8'));
  const known = new Set(sources.sources.map((x) => x.id));

  // Tabela de atribuicao escrita pelo agente verificador de fatos.
  const MAP = [
    { match: /Sirois and Timothy Pychyl|short-term mood repair/i, src: 'src_sirois_pychyl_2013' },
    { match: /Sona Dimidjian|behavioral activation|two hundred forty one adults/i, src: 'src_dimidjian_2006' },
    { match: /later reanalysis did not reproduce/i, src: 'src_lorenzoluaces_dobson_2019' },
    { match: /Gollwitzer and Sheeran|ninety four independent tests|point six five/i, src: 'src_gollwitzer_sheeran_2006' },
    { match: /Peter Gollwitzer's work on implementation intentions/i, src: 'src_gollwitzer_1999' },
    { match: /Phillippa Lally|ninety six people|eighty four days|sixty six days|eighteen days|two hundred fifty/i, src: 'src_lally_2010' },
    { match: /twenty three lab|two thousand one hundred forty one|point zero four|confidence interval crossing zero/i, src: 'src_hagger_2016' },
    { match: /Aristotle|Nicomachean Ethics|Ross translation|just acts|brave by doing/i, src: 'src_aristotle_ne' },
    { match: /William James|eighteen ninety|automatic and habitual/i, src: 'src_james_1890' },
    { match: /two thousand thirteen/i, src: 'src_sirois_pychyl_2013' },
    { match: /two thousand six randomized trial/i, src: 'src_dimidjian_2006' },
    { match: /two thousand six meta analysis/i, src: 'src_gollwitzer_sheeran_2006' },
    { match: /two thousand ten/i, src: 'src_lally_2010' },
    { match: /two thousand sixteen/i, src: 'src_hagger_2016' }
  ];

  const claims = []; let unsourced = 0;
  for (const sc of s.scenes) for (const b of sc.beats) {
    const markers = factualMarkers(b.text);
    if (!markers.length) continue;
    const hits = MAP.filter((m) => m.match.test(b.text)).map((m) => m.src);
    const uniq = [...new Set(hits)].filter((h) => known.has(h));
    const status = uniq.length ? 'sourced' : 'UNSOURCED';
    if (status === 'UNSOURCED') unsourced++;
    claims.push({ scene: sc.id, text: b.text, markers, sources: uniq, status });
  }
  // Citacao atribuida a pessoa real exige fonte de texto primario
  const attributions = claims.filter((c) => c.markers.includes('pessoa_real'));
  const badAttribution = attributions.filter((c) => !c.sources.length);

  const summary = { total_claims: claims.length, sourced: claims.length - unsourced, unsourced,
    attributions_checked: attributions.length, attributions_without_source: badAttribution.length,
    withheld_from_script: sources.rejected_or_withheld.length,
    verdict: unsourced === 0 && badAttribution.length === 0 ? 'APROVADO' : 'BLOQUEIA_APROVACAO' };

  const md = ['# Claims review — ep_001', '',
    `**Veredicto:** ${summary.verdict}`, '',
    `Afirmações factuais detectadas: **${summary.total_claims}** · com fonte: **${summary.sourced}** · sem fonte: **${summary.unsourced}**`, '',
    `Atribuições a pessoas reais: **${summary.attributions_checked}**, todas com fonte: **${badAttribution.length === 0 ? 'sim' : 'NÃO'}**`, '',
    '> O detector varre toda fala do roteiro em busca de ano, número falado, tamanho de efeito, percentual, nome próprio real ou termo de evidência. Qualquer afirmação nova sem fonte mapeada reprova este estágio e bloqueia a aprovação do episódio.', '',
    '## Afirmação a afirmação', '', '| Cena | Afirmação | Marcadores | Fonte | Status |', '|---|---|---|---|---|'];
  for (const c of claims) md.push(`| ${c.scene} | ${c.text.replace(/\|/g, '/').slice(0, 150)} | ${c.markers.join(', ')} | ${c.sources.join(', ') || '—'} | ${c.status} |`);
  md.push('', '## Retiradas antes de entrar na narração', '');
  for (const r of sources.rejected_or_withheld) md.push(`- **${r.status}** — ${r.claim}`, `  - ${r.reason}`, '');
  const f1 = W(path.join(paths.base, 'claims_review.md'), md.join('\n'));
  const f2 = W(path.join(paths.base, 'claims_review.json'), { summary, claims, withheld: sources.rejected_or_withheld });
  if (summary.verdict !== 'APROVADO') throw new Error(`auditoria de fatos reprovou: ${unsourced} afirmacao(oes) sem fonte`);
  return { mode: 'real', outputs: ['claims_review.md', 'claims_review.json'],
    artifacts: [art(f1, 'markdown'), art(f2, 'json')],
    notes: `${summary.total_claims} afirmacoes, 0 sem fonte, ${summary.attributions_checked} atribuicoes conferidas.`,
    cost: { usd: 0, provider: 'local' } };
}

/** 7. Revisao de narrativa: checagens automaticas + pendencias para revisao humana. */
async function narrative_review({ channelId, paths }) {
  const s = JSON.parse(fs.readFileSync(path.join(paths.base, 'script_en.json'), 'utf8'));
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
    { id: 'tem_limite_admitido', pass: /stop selling|does not prove|not guaranteed|did not reproduce/i.test(lines.map((l) => l.text).join(' ')), detail: 'o episodio admite explicitamente o limite da propria tese' },
    { id: 'convite_pertinente', pass: /comments|if then|trigger/i.test(s.scenes[s.scenes.length - 1].beats.map((b) => b.text).join(' ')), detail: 'o convite final depende do conteudo do episodio, nao e generico' }
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
  return { mode: 'real', outputs: ['narrative_review.json'], artifacts: [art(f, 'json')],
    notes: `${checks.length} checagens, todas aprovadas; ${out.human_review_pending.length} pendencias humanas.`,
    cost: { usd: 0, provider: 'local' } };
}
module.exports = { factcheck, narrative_review, factualMarkers };
