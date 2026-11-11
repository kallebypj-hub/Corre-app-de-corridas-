'use strict';
const path = require('path');
const cfg = require('../episode-config');
const { declare } = require('../autonomy');
const { art, W } = require('./editorial');
const { EvolutionEngine } = require('../evolution/engine');
const { VARIABLES } = require('../evolution/variables');

/**
 * Estagio 4 — REGISTRO DO EXPERIMENTO, antes de qualquer producao.
 *
 * Nenhum episodio entra em producao sem declarar o que esta testando e qual
 * aprendizado anterior esta aplicando. Se o brief nao traz isso, o estagio
 * reprova. Se a pauta repete uma pratica ja descartada sem justificar, reprova.
 */
async function experiment({ channelId, epId, paths }) {
  const brief = cfg.loadBrief(channelId, epId);
  const e = brief.experiment;
  if (!e) throw new Error(`${epId}: brief sem bloco "experiment". Todo episodio declara hipotese e variavel antes de ser produzido.`);
  if (!e.hypothesis || String(e.hypothesis).trim().length < 20) throw new Error(`${epId}: hipotese ausente ou curta demais`);
  if (!e.primary_variable) throw new Error(`${epId}: variavel principal nao declarada`);
  if (!VARIABLES[e.primary_variable]) throw new Error(`${epId}: variavel "${e.primary_variable}" nao existe no laboratorio. Conhecidas: ${Object.keys(VARIABLES).join(', ')}`);

  const engine = new EvolutionEngine(channelId);
  const briefing = engine.briefing(e.topic_keywords || []);

  // Aprendizado anterior e obrigatorio a partir do SEGUNDO experimento — e o
  // proprio episodio nao conta como anterior a si mesmo. O primeiro episodio de
  // um canal e linha de base: exigir que ele cite aprendizado seria inventar.
  // "anterior" = registrado antes DESTE experimento no log imutavel.
  const mine = engine.store.experiment(`exp_${epId}`);
  const myTs = mine && mine.registered_at ? mine.registered_at : new Date().toISOString();
  const prior = engine.experiments().filter((x) => x.episode_id !== epId && x.registered_at && x.registered_at < myTs);
  if (prior.length > 0 && (!Array.isArray(e.applies_learning) || !e.applies_learning.length))
    throw new Error(`${epId}: ${prior.length} experimento(s) anteriores existem (${prior.map((x) => x.episode_id).join(', ')}) e este brief nao declara applies_learning. Linha de base so vale para o primeiro episodio do canal.`);
  if (prior.length === 0 && !e.baseline_role && (!Array.isArray(e.applies_learning) || !e.applies_learning.length))
    throw new Error(`${epId}: primeiro experimento do canal precisa declarar baseline_role explicando que serve de referencia.`);

  // nao repetir cegamente pratica descartada
  const discarded = briefing.do_not_repeat_blindly;
  const repeats = discarded.filter((d) => (e.hypothesis + ' ' + JSON.stringify(e)).toLowerCase().includes(String(d).slice(0, 25).toLowerCase()));
  if (repeats.length && !e.justification_for_retrying)
    throw new Error(`${epId}: a hipotese toca pratica ja descartada e o brief nao traz justification_for_retrying`);

  let registered;
  try {
    registered = engine.register(epId, { hypothesis: e.hypothesis, variable: e.primary_variable,
      applies_learning: e.applies_learning || [], audience: e.audience || brief.audience,
      search_intent: e.search_intent });
  } catch (err) {
    if (/ja registrado/.test(err.message)) registered = { note: 'experimento ja registrado; registro imutavel preservado' };
    else throw err;
  }

  const out = {
    episode_id: epId, experiment_id: `exp_${epId}`,
    hypothesis: e.hypothesis, primary_variable: e.primary_variable,
    variable_label: VARIABLES[e.primary_variable].label,
    held_constant: e.held_constant || [],
    applies_learning: e.applies_learning || [],
    search_intent: e.search_intent || null, audience: e.audience || brief.audience || null,
    knowledge_consulted: briefing,
    prior_experiments: prior.length,
    registered_before_production: true,
    note: 'Este registro e imutavel. Corrigir depois gera evento novo, nunca sobrescreve.',
    registered_event: registered.hash ? { seq: registered.seq, ts: registered.ts, hash: registered.hash.slice(0, 16) } : registered
  };
  const f = W(path.join(paths.base, 'experiment.json'), out);
  return { mode: 'real', autonomy: declare('experiment'), outputs: ['experiment.json'],
    artifacts: [art(f, 'json')],
    notes: `hipotese registrada sobre "${e.primary_variable}"; ${briefing.counts.apoiadas} praticas apoiadas e ${briefing.counts.descartadas} descartadas foram consultadas antes.`,
    cost: { usd: 0, provider: 'local' } };
}
module.exports = { experiment };
