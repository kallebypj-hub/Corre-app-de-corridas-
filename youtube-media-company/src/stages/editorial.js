'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const chCfg = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'channels', `${id}.json`), 'utf8'));
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
  return { mode: 'real', outputs: ['strategy.json'], artifacts: [art(f, 'json', 'derivado da config do canal')], cost: { usd: 0, provider: 'local' } };
}

/** 2. Doze pautas originais com tese, valor exclusivo, fontes, risco e dificuldade. */
async function ideation({ paths }) {
  const ideas = [
    { id: 'idea_01', title: 'Why Waiting for Motivation Keeps You Stuck',
      thesis: 'Esperar motivacao e o proprio mecanismo que transforma uma tarefa comum numa tarefa que exige estado excepcional.',
      hook: 'You already know what to do. That is the strange part.',
      unique_value: 'Nomeia o juro composto do adiamento (inflacao de tarefa) e corrige dois numeros que o nicho repete errado.',
      audience: 'adultos que ja tentaram rotina e falharam', sources_available: ['Sirois & Pychyl 2013', 'Dimidjian 2006', 'Gollwitzer & Sheeran 2006', 'Lally 2010', 'Hagger 2016'],
      similarity_risk: 'medio — titulo comum no nicho; a diferenca esta na correcao dos numeros e na admissao do limite',
      visual_difficulty: 'baixa — tipografia e grafico de barras', est_cost_usd: 0, shorts_potential: 'alto (3 trechos autossuficientes)' },
    { id: 'idea_02', title: 'The Cost of Starting Is the Only Number That Matters',
      thesis: 'Disciplina e um problema de custo de entrada, nao de forca; reduzir atrito vence aumentar vontade.',
      hook: 'Stop asking how much you want it. Ask what it costs to begin.',
      unique_value: 'Transforma "atrito" em unidade mensuravel: segundos ate a primeira acao irreversivel.',
      audience: 'quem tem rotina mas nao consegue iniciar', sources_available: ['Gollwitzer 1999', 'literatura de nudge/choice architecture'],
      similarity_risk: 'baixo', visual_difficulty: 'media — exige diagrama de custo', est_cost_usd: 0, shorts_potential: 'alto' },
    { id: 'idea_03', title: 'You Are Not Lazy, You Are Avoiding a Feeling',
      thesis: 'Procrastinacao e regulacao de humor, e tratar como preguica impede a unica intervencao que funciona.',
      hook: 'Laziness is the wrong diagnosis. That is why the cure never works.',
      unique_value: 'Separa diagnostico moral de diagnostico funcional e mostra o que muda na pratica.',
      audience: 'quem se culpa por procrastinar', sources_available: ['Sirois & Pychyl 2013', 'Pychyl & Sirois 2016'],
      similarity_risk: 'alto — tema muito coberto', visual_difficulty: 'baixa', est_cost_usd: 0, shorts_potential: 'alto' },
    { id: 'idea_04', title: 'The 66-Day Habit Myth, Corrected',
      thesis: 'O numero mais repetido do nicho descreve uma mediana de um subgrupo, e metade dos participantes nunca chegou la.',
      hook: 'The 66-day number is real. Everything people say about it is not.',
      unique_value: 'Episodio inteiro de correcao factual com a fonte aberta na tela.',
      audience: 'quem ja ouviu a regra dos 21/66 dias', sources_available: ['Lally 2010'],
      similarity_risk: 'baixo — poucos corrigem com o dado primario', visual_difficulty: 'media — exige grafico de dispersao', est_cost_usd: 0, shorts_potential: 'muito alto' },
    { id: 'idea_05', title: 'Willpower Is Not a Fuel Tank',
      thesis: 'A metafora do tanque sobreviveu a propria evidencia; planejar com ela leva a decisoes erradas sobre horario e ordem das tarefas.',
      hook: 'The willpower battery you plan your day around did not survive replication.',
      unique_value: 'Mostra a consequencia pratica da replicacao, nao so a fofoca academica.',
      audience: 'quem organiza o dia por "energia"', sources_available: ['Hagger 2016', 'Baumeister 1998 (contexto historico)'],
      similarity_risk: 'medio', visual_difficulty: 'media', est_cost_usd: 0, shorts_potential: 'alto' },
    { id: 'idea_06', title: 'Discipline Is Architecture, Not Character',
      thesis: 'O que parece traco de carater e, quase sempre, arranjo de ambiente que alguem construiu antes.',
      hook: 'The disciplined person you envy did not out-want you. They out-built you.',
      unique_value: 'Converte admiracao em engenharia reproduzivel.',
      audience: 'quem se compara com pessoas "disciplinadas"', sources_available: ['Duckworth et al. sobre situational self-control', 'Gollwitzer 1999'],
      similarity_risk: 'medio', visual_difficulty: 'baixa', est_cost_usd: 0, shorts_potential: 'medio' },
    { id: 'idea_07', title: 'The Day After Is the Real Test',
      thesis: 'Sistemas sao julgados pelo dia seguinte a falha, nao pela sequencia perfeita; a regra de recuperacao importa mais que a meta.',
      hook: 'Nobody breaks a streak on day one. They break it on the day after.',
      unique_value: 'Desloca o foco de consistencia para protocolo de retomada.',
      audience: 'quem abandona apos a primeira falha', sources_available: ['Lally 2010 (falhas isoladas nao impedem automaticidade)'],
      similarity_risk: 'baixo', visual_difficulty: 'media', est_cost_usd: 0, shorts_potential: 'alto' },
    { id: 'idea_08', title: 'Why Your Goals Are Too Interesting',
      thesis: 'Metas ambiciosas competem com a execucao porque consomem o mesmo recurso: atencao de decisao.',
      hook: 'Your goal is not too small. It is too interesting to execute.',
      unique_value: 'Tese contra-intuitiva e propria do canal.',
      audience: 'quem planeja muito e executa pouco', sources_available: ['Gollwitzer & Sheeran 2006 (meta vs plano)'],
      similarity_risk: 'baixo — angulo raro', visual_difficulty: 'media', est_cost_usd: 0, shorts_potential: 'medio' },
    { id: 'idea_09', title: 'Act First: What Depression Treatment Taught Productivity',
      thesis: 'A ordem acao-antes-do-humor foi testada onde o custo do erro e alto, e isso muda o peso da recomendacao.',
      hook: 'The strongest evidence for acting before you feel like it came from a depression trial.',
      unique_value: 'Traz evidencia clinica com a ressalva da reanalise, em vez de usar como slogan.',
      audience: 'ceticos de conteudo de produtividade', sources_available: ['Dimidjian 2006', 'Lorenzo-Luaces & Dobson 2019'],
      similarity_risk: 'baixo', visual_difficulty: 'baixa', est_cost_usd: 0, shorts_potential: 'medio',
      sensitivity: 'tema de saude mental — exige enquadramento cuidadoso e nao pode virar conselho clinico' },
    { id: 'idea_10', title: 'Aristotle Did Not Say What the Quote Says',
      thesis: 'A frase mais citada sobre habito na internet nao esta em Aristoteles; o que ele diz e mais util do que a versao falsificada.',
      hook: 'We are what we repeatedly do. Aristotle never wrote that sentence.',
      unique_value: 'Correcao de atribuicao com texto primario de dominio publico na tela.',
      audience: 'quem compartilha citacoes', sources_available: ['Nicomachean Ethics II (Ross)', 'Will Durant, The Story of Philosophy'],
      similarity_risk: 'baixo', visual_difficulty: 'baixa', est_cost_usd: 0, shorts_potential: 'muito alto',
      pending_research: 'confirmar na fonte primaria a atribuicao a Durant antes de produzir' },
    { id: 'idea_11', title: 'The Quiet Case Against Tracking Everything',
      thesis: 'Medir pode substituir a acao medida; o painel vira o trabalho.',
      hook: 'Your tracker is not measuring the habit. It has become the habit.',
      unique_value: 'Contraria o proprio nicho de produtividade.',
      audience: 'usuarios de apps de habito', sources_available: ['literatura sobre motivacao extrinseca/overjustification'],
      similarity_risk: 'baixo', visual_difficulty: 'media', est_cost_usd: 0, shorts_potential: 'medio',
      pending_research: 'precisa de fonte primaria solida antes de entrar no calendario' },
    { id: 'idea_12', title: 'Boredom Is the Skill',
      thesis: 'A competencia que sustenta rotina nao e entusiasmo, e tolerancia a repeticao sem recompensa nova.',
      hook: 'The skill is not focus. It is tolerating the part where nothing happens.',
      unique_value: 'Nomeia a habilidade real e da um treino para ela.',
      audience: 'quem troca de metodo toda semana', sources_available: ['literatura sobre habituacao e variable reward'],
      similarity_risk: 'baixo', visual_difficulty: 'baixa', est_cost_usd: 0, shorts_potential: 'alto',
      pending_research: 'fontes ainda genericas; nao produzir antes de dossie' }
  ];
  const demand_signals = [{
    signal: 'volume de busca e tamanho de audiencia para o nicho',
    status: 'INDISPONIVEL', method: 'exigiria YouTube Data API autenticada ou ferramenta de palavras-chave com conta',
    note: 'Nenhuma estimativa inventada. Enquanto nao houver OAuth e canal publicado, a selecao editorial e feita por qualidade de tese, conforme a regra do canal.',
    checked_at: '2026-11-11'
  }];
  const f1 = W(path.join(paths.base, 'ideas.json'), { generated_by: 'demand_researcher + editorial_director (modo piloto assistido)', count: ideas.length, ideas, demand_signals });
  return { mode: 'assisted', outputs: ['ideas.json'], artifacts: [art(f1, 'json', '12 pautas originais')],
    notes: 'Sinal de demanda marcado como INDISPONIVEL; nenhuma tendencia estimada.', cost: { usd: 0, provider: 'local' } };
}

/** 3. Selecao editorial pela qualidade da tese. */
async function selection({ paths }) {
  const ideas = JSON.parse(fs.readFileSync(path.join(paths.base, 'ideas.json'), 'utf8'));
  const chosen = ideas.ideas.find((i) => i.id === 'idea_01');
  const out = { chosen_id: chosen.id, title: chosen.title, thesis: chosen.thesis,
    rationale: 'Escolhido pela tese, nao por palavra-chave: e a unica das 12 que sustenta um argumento circular verificavel (esperar e o que cria a necessidade de esperar) e que ja tem cinco fontes primarias confirmadas. Risco de semelhanca no titulo e compensado por duas correcoes factuais que quase ninguem no nicho faz.',
    rejected_now: ideas.ideas.filter((i) => i.pending_research).map((i) => ({ id: i.id, reason: i.pending_research })),
    decided_by: 'editorial_director', decided_at: new Date().toISOString() };
  const f = W(path.join(paths.base, 'selection.json'), out);
  return { mode: 'assisted', outputs: ['selection.json'], artifacts: [art(f, 'json')], cost: { usd: 0, provider: 'local' } };
}

/** 4. Dossie: copia as fontes verificadas do canal para o episodio e gera o markdown. */
async function research({ channelId, paths }) {
  const src = path.join(ROOT, 'content', 'channels', channelId, 'sources.json');
  const sources = JSON.parse(fs.readFileSync(src, 'utf8'));
  const f1 = W(path.join(paths.base, 'sources.json'), sources);
  const md = ['# Source dossier — ep_001', '', `Compilado em ${sources.compiled_at} por ${sources.compiled_by}.`,
    `Método: ${sources.verification_method}`, '', '## Fontes usadas', ''];
  for (const s of sources.sources) {
    md.push(`### ${s.id}`, `- **Referência:** ${s.authors} (${s.year}). *${s.title}*. ${s.venue || ''}`.trim());
    if (s.doi) md.push(`- **DOI:** ${s.doi}`);
    if (s.url) md.push(`- **URL:** ${s.url}`);
    md.push(`- **Usada para:** ${s.used_for}`, `- **Status:** ${s.verification} (${s.verified_at})`);
    if (s.caveat_in_script) md.push(`- **Ressalva dita no vídeo:** ${s.caveat_in_script}`);
    if (s.rights) md.push(`- **Direitos:** ${s.rights}`);
    md.push('');
  }
  md.push('## Afirmações retidas ou reformuladas', '');
  for (const r of sources.rejected_or_withheld) md.push(`- **${r.status}** — ${r.claim}`, `  - Motivo: ${r.reason}`, '');
  const f2 = W(path.join(paths.base, 'sources.md'), md.join('\n'));
  return { mode: 'real', outputs: ['sources.json', 'sources.md'],
    artifacts: [art(f1, 'json'), art(f2, 'markdown')],
    notes: `${sources.sources.length} fontes verificadas, ${sources.rejected_or_withheld.length} afirmacoes retidas.`,
    cost: { usd: 0, provider: 'local' } };
}

/** 5. Roteiro: le o JSON autoral e produz o markdown legivel. Modo PILOTO ASSISTIDO. */
async function script({ paths }) {
  const s = JSON.parse(fs.readFileSync(path.join(paths.base, 'script_en.json'), 'utf8'));
  const md = [`# ${s.working_title}`, '', `**Thesis.** ${s.thesis}`, '',
    `**Production mode.** \`${s.production_mode}\` — ${s.authorship_note}`, '', '---', ''];
  let words = 0;
  for (const sc of s.scenes) {
    md.push(`## ${sc.id.toUpperCase()} · ${sc.role} · *${sc.motif}*`, '', `*Purpose (PT):* ${sc.purpose}`, '');
    for (const b of sc.beats) { md.push(b.text); words += b.text.trim().split(/\s+/).length; }
    md.push('');
  }
  md.push('---', '', `**Word count:** ${words}`);
  const f = W(path.join(paths.base, 'script_en.md'), md.join('\n'));
  return { mode: 'assisted', model: 'Claude Code (sessao 2026-11-11) — piloto assistido, sem chamada de API externa',
    outputs: ['script_en.md'], artifacts: [art(f, 'markdown')],
    notes: `${s.scenes.length} cenas, ${words} palavras.`, cost: { usd: 0, provider: 'none' } };
}
module.exports = { strategy, ideation, selection, research, script, chCfg, art, W, ROOT };
