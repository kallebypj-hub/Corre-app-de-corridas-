'use strict';
/**
 * Conhecimento acumulado da empresa, em tres camadas.
 *
 * Duas regras que o codigo faz valer:
 *  1) Toda afirmacao carrega as CONDICOES em que foi testada. Nao existe
 *     "tecnica X nao funciona" — existe "nao funcionou neste nicho, nesta
 *     duracao, com esta origem de trafego, nestes N experimentos".
 *  2) Nada e apagado. Rebaixar e revisar sao eventos novos que apontam para o
 *     anterior; o historico continua legivel com a data em que valia.
 */
const { KNOWLEDGE_TIER, VERDICT } = require('./states');

const TIER_ORDER = [KNOWLEDGE_TIER.PROMISING, KNOWLEDGE_TIER.SUPPORTED, KNOWLEDGE_TIER.DISCARDED];

/** Reconstroi a base atual a partir do log imutavel. */
function build(store) {
  const items = new Map();
  for (const e of store.reload().events) {
    const p = e.payload || {};
    if (!p.knowledge_id) continue;
    const id = p.knowledge_id;
    if (!items.has(id)) items.set(id, { knowledge_id: id, history: [] });
    const k = items.get(id);
    k.history.push({ seq: e.seq, ts: e.ts, type: e.type, author: e.author, from: p.from_tier || null, to: p.tier || null, reason: p.reason || null });
    switch (e.type) {
      case 'knowledge.proposed':
        Object.assign(k, { statement: p.statement, conditions: p.conditions, tier: p.tier || KNOWLEDGE_TIER.PROMISING,
          supporting_experiments: p.supporting_experiments || [], contradicting_experiments: p.contradicting_experiments || [],
          confounders_noted: p.confounders_noted || [], confidence: p.confidence || 'baixa',
          proposed_at: e.ts, proposed_by: e.author, superseded_by: null });
        break;
      case 'knowledge.promoted':
      case 'knowledge.demoted':
        k.tier = p.tier; k.confidence = p.confidence || k.confidence;
        k.supporting_experiments = p.supporting_experiments || k.supporting_experiments;
        k.contradicting_experiments = p.contradicting_experiments || k.contradicting_experiments;
        k.last_change_reason = p.reason || null; k.last_changed_at = e.ts;
        break;
      case 'knowledge.revised':
        k.superseded_by = p.supersedes_with || null;
        k.revision_note = p.reason || null; k.last_changed_at = e.ts;
        if (p.statement) k.statement = p.statement;
        if (p.conditions) k.conditions = p.conditions;
        if (p.tier) k.tier = p.tier;
        break;
      default: break;
    }
  }
  return [...items.values()];
}

function byTier(store) {
  const all = build(store);
  const out = {};
  for (const t of TIER_ORDER) out[t] = all.filter((k) => k.tier === t);
  return out;
}

/**
 * Como a afirmacao DEVE ser citada: sempre com as condicoes coladas.
 * Impede que "nao funcionou aqui" vire "nao funciona".
 */
function cite(k) {
  const c = k.conditions || {};
  const cond = [c.channel && `canal ${c.channel}`, c.niche && `nicho ${c.niche}`,
    c.video_length && `duracao ${c.video_length}`, c.traffic_source && `trafego ${c.traffic_source}`,
    c.sample_size && `n=${c.sample_size}`].filter(Boolean).join(', ');
  return `${k.statement} — valido apenas em: ${cond || 'condicoes nao registradas'}. ` +
    `Apoiado por ${(k.supporting_experiments || []).length} experimento(s), contraditado por ${(k.contradicting_experiments || []).length}. ` +
    `Confianca: ${k.confidence}.`;
}

/**
 * Proposta de promocao/rebaixamento a partir dos veredictos acumulados.
 * NAO aplica sozinho: devolve a proposta para o auditor metodologico e, depois, para o humano.
 */
function proposeTierChange(k, verdicts) {
  const sup = verdicts.filter((v) => v.verdict === VERDICT.SUPPORTED).length;
  const con = verdicts.filter((v) => v.verdict === VERDICT.CONTRADICTED).length;
  const inc = verdicts.filter((v) => v.verdict === VERDICT.INCONCLUSIVE).length;
  if (sup >= 3 && con === 0) return { tier: KNOWLEDGE_TIER.SUPPORTED, confidence: 'media',
    reason: `${sup} experimentos independentes apoiaram e nenhum contraditou. Ainda e observacional: nao e prova de causa.` };
  if (con >= 2 && sup === 0) return { tier: KNOWLEDGE_TIER.DISCARDED, confidence: 'media',
    reason: `${con} experimentos contraditaram. Descartada SOMENTE nas condicoes testadas; fora delas continua nao testada.` };
  if (inc >= 3 && sup === 0 && con === 0) return { tier: KNOWLEDGE_TIER.DISCARDED, confidence: 'baixa',
    reason: `${inc} tentativas inconclusivas: o efeito, se existe, e pequeno demais para o volume atual.` };
  return null;
}

/** O que o diretor editorial precisa ler ANTES de aprovar uma pauta. */
function briefingFor(store, { topicKeywords = [] } = {}) {
  const tiers = byTier(store);
  const touches = (k) => !topicKeywords.length || topicKeywords.some((w) =>
    (k.statement + ' ' + JSON.stringify(k.conditions || {})).toLowerCase().includes(String(w).toLowerCase()));
  return {
    must_apply: tiers[KNOWLEDGE_TIER.SUPPORTED].filter(touches).map(cite),
    worth_testing: tiers[KNOWLEDGE_TIER.PROMISING].filter(touches).map(cite),
    do_not_repeat_blindly: tiers[KNOWLEDGE_TIER.DISCARDED].filter(touches).map(cite),
    counts: { apoiadas: tiers[KNOWLEDGE_TIER.SUPPORTED].length,
      promissoras: tiers[KNOWLEDGE_TIER.PROMISING].length,
      descartadas: tiers[KNOWLEDGE_TIER.DISCARDED].length },
    note: 'Descartada quer dizer "nao funcionou nas condicoes testadas". Fora delas, continua sem teste — e pode ser retomada com justificativa.'
  };
}
module.exports = { build, byTier, cite, proposeTierChange, briefingFor, TIER_ORDER };
