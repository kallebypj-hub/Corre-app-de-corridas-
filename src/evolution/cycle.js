'use strict';
/**
 * CICLO DE APRENDIZAGEM — uma chamada faz o caminho inteiro.
 *
 * publicacao -> coleta (Analytics + Reporting) -> curva de retencao mapeada nas
 * cenas -> funil -> auditor metodologico -> veredicto -> conhecimento.
 *
 * Idempotente: um marco ja medido nao e medido de novo, e nenhum evento e
 * duplicado. Falha em qualquer ponto vira evento de falha, nao silencio.
 */
const { EvolutionEngine } = require('./engine');
const { MILESTONES, VERDICT, KNOWLEDGE_TIER } = require('./states');
const funnelMod = require('./funnel');
const knowledge = require('./knowledge');
const variables = require('./variables');
const { Logger } = require('../log');

const log = new Logger('evolution.cycle');

/** Referencia do canal: mediana das medidas dos OUTROS experimentos no mesmo marco. */
function baselineFor(engine, epId, milestone) {
  const others = engine.experiments().filter((x) => x.episode_id !== epId);
  const vals = {};
  for (const x of others) {
    const m = x.measurements.find((mm) => mm.milestone === milestone);
    if (!m) continue;
    for (const [k, v] of Object.entries(m.metrics || {})) {
      if (typeof v !== 'number') continue;
      (vals[k] = vals[k] || []).push(v);
    }
  }
  const out = {}; const n = {};
  for (const [k, arr] of Object.entries(vals)) {
    arr.sort((a, b) => a - b);
    out[k] = arr[Math.floor(arr.length / 2)];
    n[k] = arr.length;
  }
  return { baseline: out, sample_episodes: Object.keys(vals).length ? n : {},
    note: Object.keys(out).length ? `mediana de ${others.length} episodio(s) no marco ${milestone}`
      : 'nenhum outro episodio tem medida neste marco: sem referencia, o funil nao acusa falha' };
}

/** Veredicto proposto a partir do funil — proposta, nunca decisao final. */
function proposeVerdict(x, funnelEval, comparison) {
  const stages = funnelEval.stages || {};
  const sum = funnelMod.summary(funnelEval);
  const states = Object.values(stages).map((s) => s.state);
  if (states.every((s) => s === 'DATA_UNAVAILABLE'))
    return { verdict: VERDICT.AWAITING_DATA, reason: 'nenhuma metrica veio: nao ha o que concluir.' };
  const target = x.primary_variable === 'hook_style' ? 'early_retention'
    : (x.primary_variable === 'thumbnail_style' || x.primary_variable === 'title_shape' ? 'click' : null);
  if (target && stages[target]) {
    const s = stages[target];
    if (s.state === 'OBSERVED_SUCCESS')
      return { verdict: VERDICT.SUPPORTED, blamedStage: null,
        reason: `a etapa ligada a variavel testada (${s.label_stage}) ficou ${s.relative}% acima da referencia, com ${s.reached} de alcance. Associacao, nao causa.` };
    if (s.state === 'OBSERVED_FAILURE')
      return { verdict: VERDICT.CONTRADICTED, blamedStage: target,
        reason: `a etapa ligada a variavel testada (${s.label_stage}) ficou ${s.relative}% abaixo da referencia, com ${s.reached} de alcance. Associacao, nao causa.` };
    return { verdict: VERDICT.INCONCLUSIVE,
      reason: `a etapa ligada a variavel testada esta em "${s.state}": ${s.reason}` };
  }
  return { verdict: VERDICT.INCONCLUSIVE,
    reason: sum.blameable_stages.length
      ? `ha evidencia em ${sum.blameable_stages.join(', ')}, mas nenhuma delas e a etapa ligada a variavel testada.`
      : (sum.note || 'sem etapa com evidencia suficiente.') };
}

/**
 * Roda o ciclo para um episodio.
 * @param collector funcao (channelId, {videoId, publishedAt, durationSeconds}) -> coleta.
 *   Em producao e o modulo de analytics; no teste integrado e um injetor sintetico.
 */
async function runFor(channelId, epId, { collector, now = Date.now(), force = false, author = 'evolution_officer' } = {}) {
  const engine = new EvolutionEngine(channelId);
  const x = engine.store.experiment(`exp_${epId}`);
  const steps = [];
  const step = (name, status, detail) => { steps.push({ step: name, status, detail }); return { name, status, detail }; };

  if (!x) return { episode_id: epId, ran: false, steps: [step('experimento', 'ausente', 'nenhum experimento registrado')] };
  if (!x.publication) return { episode_id: epId, ran: false,
    steps: [step('publicacao', 'ausente', 'episodio nao publicado: sem audiencia, nao ha ciclo a rodar')] };

  const pub = x.publication;
  const hours = (now - new Date(pub.published_at).getTime()) / 3600000;
  let due = null;
  for (const m of MILESTONES) if (hours >= m.hours) due = m;
  if (!due) return { episode_id: epId, ran: false,
    steps: [step('marco', 'ainda nao', `${hours.toFixed(1)}h desde a publicacao; o primeiro marco e ${MILESTONES[0].label}`)] };

  // --- idempotencia ---
  const already = x.measurements.find((m) => m.milestone === due.id);
  if (already && !force) return { episode_id: epId, ran: false, milestone: due.id,
    steps: [step('idempotencia', 'ja medido', `o marco ${due.id} ja foi registrado em ${already.ts}; nada foi duplicado`)] };

  // --- 1. coleta ---
  let collected;
  try {
    collected = await collector(channelId, { videoId: pub.video_id, publishedAt: pub.published_at,
      durationSeconds: x.production ? x.production.duration_s : null, milestone: due.id });
    step('coleta', collected.status === 'COLETADO' ? 'ok' : 'bloqueada', collected.reason || `${Object.keys(collected.metrics || {}).length} metricas`);
  } catch (e) {
    engine.store.append('measurement.recorded', { experiment_id: x.experiment_id, episode_id: epId, milestone: due.id,
      metrics: {}, missing_metrics: ['todas'], source: 'falha', note: `coleta falhou: ${e.message}` }, { author });
    return { episode_id: epId, ran: true, milestone: due.id, failed: true,
      steps: [step('coleta', 'falhou', e.message)] };
  }
  if (collected.status !== 'COLETADO') {
    engine.store.append('measurement.recorded', { experiment_id: x.experiment_id, episode_id: epId, milestone: due.id,
      metrics: {}, missing_metrics: ['todas'], source: collected.status, note: collected.reason }, { author });
    return { episode_id: epId, ran: true, milestone: due.id, blocked: true, steps };
  }

  // --- 2. medicao ---
  engine.recordMeasurement(epId, { milestone: due.id, metrics: collected.metrics,
    source: collected.source || (collected.sources ? JSON.stringify(collected.sources) : 'youtube_api'),
    window: collected.window, author });
  step('medicao', 'registrada', `${Object.keys(collected.metrics).length} metricas, ${(collected.missing_metrics || []).length} ausentes`);

  // --- 3. retencao mapeada nas cenas ---
  let retMap = null;
  try {
    retMap = engine.mapRetention(epId, collected.retention_curve || null,
      typeof collected.metrics.views === 'number' ? collected.metrics.views : null, { author });
    step('retencao', retMap.available ? 'mapeada' : 'indisponivel',
      retMap.available ? `${retMap.notable_drops.length} queda(s) notavel(is) em ${retMap.scenes.length} cenas` : retMap.reason);
  } catch (e) { step('retencao', 'falhou', e.message); }

  // --- 4. funil ---
  const bl = baselineFor(engine, epId, due.id);
  const fe = engine.evaluateFunnel(epId, { baseline: bl.baseline, author });
  step('funil', 'avaliado', `${fe.summary.blameable_stages.length ? 'etapas com evidencia: ' + fe.summary.blameable_stages.join(', ') : fe.summary.note} (${bl.note})`);

  // --- 5. comparacao com o episodio alvo, se houver ---
  const brief = engine.readJSON(epId, 'brief.json');
  const target = brief && brief.experiment ? brief.experiment.comparison_target : null;

  // --- 6. veredicto sob auditoria ---
  const proposal = proposeVerdict(x, fe, null);
  const issued = engine.issueVerdict(epId, { verdict: proposal.verdict, reason: proposal.reason,
    blamedStage: proposal.blamedStage || null, compareWith: target, author });
  step('auditoria', issued.audit.approved ? 'aprovada' : `${issued.audit.objections.filter((o) => o.level === 'bloqueante').length} bloqueio(s)`,
    issued.audit.objections.map((o) => o.code).join(', ') || 'sem objecao');
  step('veredicto', issued.verdict, proposal.verdict !== issued.verdict ? `proposto "${proposal.verdict}", reescrito pelo auditor` : 'emitido como proposto');

  // --- 7. conhecimento ---
  let know = null;
  const fresh = engine.store.experiment(`exp_${epId}`);
  if (issued.verdict === VERDICT.SUPPORTED || issued.verdict === VERDICT.CONTRADICTED) {
    const statement = `Abertura do tipo "${(brief && brief.experiment && brief.experiment.variable_value) || x.primary_variable}" ` +
      `${issued.verdict === VERDICT.SUPPORTED ? 'veio junto com' : 'veio junto com queda em'} ` +
      `${x.primary_variable === 'hook_style' ? 'retencao inicial' : 'clique'} neste canal.`;
    const existing = knowledge.build(engine.store).find((k) => k.statement === statement);
    if (!existing) {
      const ev = engine.proposeKnowledge({ statement,
        conditions: engine.conditionsOf(epId),
        tier: KNOWLEDGE_TIER.PROMISING,
        supporting: issued.verdict === VERDICT.SUPPORTED ? [x.experiment_id] : [],
        contradicting: issued.verdict === VERDICT.CONTRADICTED ? [x.experiment_id] : [],
        confounders: (brief && brief.experiment && brief.experiment.known_confounders) || [],
        confidence: 'baixa', author });
      know = { knowledge_id: ev.payload.knowledge_id, tier: KNOWLEDGE_TIER.PROMISING, created: true };
      step('conhecimento', 'proposto', `"${statement}" entrou como hipotese promissora, presa as condicoes medidas`);
    } else { know = { knowledge_id: existing.knowledge_id, created: false }; step('conhecimento', 'ja existia', existing.knowledge_id); }
  } else {
    step('conhecimento', 'nao promovido', `veredicto "${issued.verdict}" nao sustenta afirmacao nova`);
  }

  // --- 8. revisao de 48h quando cabe ---
  let review = null;
  if (hours >= 48) { review = engine.review48h(epId, { now }); step('revisao_48h', review.actionable ? 'liberada' : 'travada',
    review.actionable ? `${review.recommendations.length} recomendacao(oes) para decisao humana` : review.blockers.join(' | ')); }

  log.info(`[${epId}] ciclo no marco ${due.id}: veredicto ${issued.verdict}`);
  return { episode_id: epId, ran: true, milestone: due.id, hours_since_publication: +hours.toFixed(2),
    verdict: issued.verdict, audit_approved: issued.audit.approved, knowledge: know, review, baseline: bl, steps };
}
module.exports = { runFor, baselineFor, proposeVerdict };
