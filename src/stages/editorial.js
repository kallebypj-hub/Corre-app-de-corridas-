'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('../episode-config');
const { declare } = require('../autonomy');
const ROOT = cfg.ROOT;
const chCfg = (id) => cfg.loadChannel(id);
const art = (p, kind, note) => ({ path: p, kind, note: note || null });
const W = (p, data) => { fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data, null, 2), 'utf8'); return p; };

/** 1. Nicho e tese editorial — le a identidade do canal, nao inventa posicionamento. */
async function strategy({ channelId, paths }) {
  const c = chCfg(channelId);
  const out = {
    channel_id: c.id, language: c.language, niche: c.niche, thesis: c.editorial_thesis,
    audience: c.audience, voice: c.voice_of_channel, cadence: c.cadence,
    differentiation_test: 'Um episodio so passa se a tese dele nao puder ser trocada pela tese de outro episodio do canal.',
    name_status: c.registration
  };
  const f = W(path.join(paths.base, 'strategy.json'), out);
  return { mode: 'real', autonomy: declare('strategy'), outputs: ['strategy.json'],
    artifacts: [art(f, 'json', 'derivado da config do canal')], cost: { usd: 0, provider: 'local' } };
}

/** 2. Pautas: LIDAS do catalogo do canal. O pipeline nao as inventa e declara isso. */
async function ideation({ channelId, paths }) {
  const cat = cfg.loadIdeas(channelId);
  if (!Array.isArray(cat.ideas) || cat.ideas.length < 3)
    throw new Error('catalogo de pautas vazio ou pequeno demais; pesquisa de pauta e trabalho assistido');
  const missing = cat.ideas.filter((i) => !i.thesis || !i.hook || !i.unique_value);
  if (missing.length) throw new Error(`${missing.length} pauta(s) sem tese, gancho ou valor exclusivo`);
  const f = W(path.join(paths.base, 'ideas.json'), {
    source_file: `content/channels/${channelId}/ideas.json`,
    authored_by: cat.authored_by, autonomy_note: cat.autonomy_note,
    count: cat.ideas.length, ideas: cat.ideas, demand_signals: cat.demand_signals || []
  });
  return { mode: 'assisted', autonomy: declare('ideation'), outputs: ['ideas.json'],
    artifacts: [art(f, 'json', `${cat.ideas.length} pautas lidas do catalogo do canal`)],
    notes: `Catalogo com ${cat.ideas.length} pautas. O pipeline LE este arquivo; nao gera pauta sozinho.`,
    cost: { usd: 0, provider: 'local' } };
}

/** 3. Selecao: o brief do episodio aponta a pauta. Sem brief, nao ha producao. */
async function selection({ channelId, epId, paths }) {
  const brief = cfg.loadBrief(channelId, epId);
  const cat = cfg.loadIdeas(channelId);
  const chosen = cat.ideas.find((i) => i.id === brief.idea_id);
  if (!chosen) throw new Error(`brief de ${epId} aponta idea_id="${brief.idea_id}", que nao existe no catalogo do canal`);
  if (chosen.pending_research) throw new Error(`pauta ${chosen.id} esta marcada com pesquisa pendente: ${chosen.pending_research}`);
  const out = { episode_id: epId, chosen_id: chosen.id, title: brief.working_title, thesis: brief.thesis,
    idea_thesis: chosen.thesis,
    rationale: brief.selection_rationale || `Selecionada pelo brief do episodio. Tese: ${chosen.thesis}`,
    blocked_for_research: cat.ideas.filter((i) => i.pending_research).map((i) => ({ id: i.id, reason: i.pending_research })),
    decided_by: 'editorial_director', decided_at: new Date().toISOString() };
  const f = W(path.join(paths.base, 'selection.json'), out);
  return { mode: 'real', autonomy: declare('selection'), outputs: ['selection.json'],
    artifacts: [art(f, 'json')], notes: `pauta ${chosen.id} -> ${epId}`, cost: { usd: 0, provider: 'local' } };
}

/** 4. Dossie: o pipeline VALIDA o que recebeu. Nao sai procurando fonte sozinho. */
async function research({ channelId, epId, paths }) {
  const sources = cfg.loadSources(channelId, epId);
  const unverified = sources.sources.filter((s) => !/verificad/i.test(String(s.verification || '')));
  if (unverified.length) throw new Error(`${unverified.length} fonte(s) sem marca de verificacao: ${unverified.map((s) => s.id).join(', ')}`);
  const noDate = sources.sources.filter((s) => !s.verified_at);
  if (noDate.length) throw new Error(`${noDate.length} fonte(s) sem data de verificacao`);

  const md = ['# Source dossier — ' + epId, '',
    `Compilado em ${sources.compiled_at || '(sem data)'} por ${sources.compiled_by || '(sem autor)'}.`,
    `Método: ${sources.verification_method || '(sem método declarado)'}`, '',
    '> Honestidade de autonomia: encontrar e ler fonte primária é trabalho de pessoa ou de agente com acesso à web. Este estágio apenas **valida** o dossiê recebido e **bloqueia** o episódio se algo não estiver rastreável.', '',
    '## Fontes usadas', ''];
  for (const s of sources.sources) {
    md.push(`### ${s.id}`, `- **Referência:** ${s.authors} (${s.year}). *${s.title}*. ${s.venue || ''}`.trim());
    if (s.doi) md.push(`- **DOI:** ${s.doi}`);
    if (s.url) md.push(`- **URL:** ${s.url}`);
    md.push(`- **Usada para:** ${s.used_for}`, `- **Status:** ${s.verification} (${s.verified_at})`);
    if (s.caveat_in_script) md.push(`- **Ressalva dita no vídeo:** ${s.caveat_in_script}`);
    if (s.rights) md.push(`- **Direitos:** ${s.rights}`);
    md.push('');
  }
  const withheld = sources.rejected_or_withheld || [];
  md.push('## Afirmações retidas ou reformuladas', '');
  for (const r of withheld) md.push(`- **${r.status}** — ${r.claim}`, `  - Motivo: ${r.reason}`, '');
  const f2 = W(path.join(paths.base, 'sources.md'), md.join('\n'));
  return { mode: 'assisted', autonomy: declare('research'),
    outputs: ['sources.md'], artifacts: [art(f2, 'markdown'), art(path.join(paths.base, 'sources.json'), 'json')],
    notes: `${sources.sources.length} fontes validadas, ${withheld.length} afirmacoes retidas.`,
    cost: { usd: 0, provider: 'local' } };
}

/** 5. Roteiro: o pipeline le o roteiro do episodio e o transforma em markdown. */
async function script({ channelId, epId, paths }) {
  const s = cfg.loadScript(channelId, epId);
  const brief = cfg.loadBrief(channelId, epId);
  const md = [`# ${brief.working_title}`, '', `**Thesis.** ${brief.thesis}`, '',
    `**Production mode.** \`${brief.production_mode}\``, '',
    `**Autoria.** ${brief.authorship.script_by}`, '',
    `> ${brief.authorship.honest_statement}`, '', '---', ''];
  let words = 0;
  for (const sc of s.scenes) {
    md.push(`## ${sc.id.toUpperCase()} · ${sc.role} · *${sc.motif}*`, '', `*Purpose (PT):* ${sc.purpose}`, '');
    for (const b of sc.beats) { md.push(b.text); words += b.text.trim().split(/\s+/).length; }
    md.push('');
  }
  md.push('---', '', `**Word count:** ${words}`);
  const f = W(path.join(paths.base, 'script_en.md'), md.join('\n'));
  return { mode: 'assisted', autonomy: declare('script'),
    model: brief.authorship.script_by,
    outputs: ['script_en.md'], artifacts: [art(f, 'markdown')],
    notes: `${s.scenes.length} cenas, ${words} palavras. ${brief.authorship.honest_statement}`,
    cost: { usd: 0, provider: 'none' } };
}
module.exports = { strategy, ideation, selection, research, script, chCfg, art, W, ROOT };
