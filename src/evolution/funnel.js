'use strict';
/**
 * Funil de diagnostico.
 *
 * A REGRA QUE MANDA AQUI: nenhum agente atribui falha a uma etapa sem evidencia
 * de que o publico chegou ate ela. Isso nao e conselho — e uma funcao que recusa.
 * Se a retencao inicial derrubou 90% do publico, a cena 8 nao "falhou": ela nao
 * foi avaliada. Dizer o contrario seria inventar um fracasso.
 */
const { EVIDENCE, FUNNEL, stage } = require('./states');

const MISSING = (reason) => ({ state: 'DATA_UNAVAILABLE', ...EVIDENCE.DATA_UNAVAILABLE, value: null, reason });

/**
 * @param m metricas medidas de verdade; qualquer campo ausente ou 'indisponivel'
 *          vira DATA_UNAVAILABLE, nunca zero.
 * @param baseline referencia opcional (ex.: mediana do canal) por metrica
 */
function evaluate(m = {}, { baseline = {}, sampleOverrides = {} } = {}) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const raw = {
    impressions: num(m.impressions),
    impressionsCtr: num(m.impressionsCtr),
    views: num(m.views),
    retention_0_30s: num(m.retention_0_30s),
    retention_mid: num(m.retention_mid),
    retention_end: num(m.retention_end),
    shorts_referral_views: num(m.shorts_referral_views),
    estimatedRevenue: num(m.estimatedRevenue),
    estimatedMinutesWatched: num(m.estimatedMinutesWatched)
  };
  // quanto publico de fato alcancou cada etapa — e o que autoriza ou proibe culpar
  const reach = {
    exposure: raw.impressions,
    click: raw.impressions,
    early_retention: raw.views,
    mid_retention: raw.views !== null && raw.retention_0_30s !== null ? Math.round(raw.views * raw.retention_0_30s) : null,
    final_retention: raw.views !== null && raw.retention_mid !== null ? Math.round(raw.views * raw.retention_mid) : null,
    shorts_to_long: raw.shorts_referral_views,
    revenue: raw.estimatedMinutesWatched
  };

  const out = {};
  for (const f of FUNNEL) {
    const value = raw[f.metric] !== undefined ? raw[f.metric] : null;
    const reached = reach[f.id];
    const minSample = sampleOverrides[f.id] || f.min_sample;

    if (value === null) { out[f.id] = { ...MISSING('a metrica nao veio da API'), stage: f.id, label_stage: f.label, question: f.question, reached, min_sample: minSample }; continue; }
    if (reached === null) { out[f.id] = { ...MISSING('nao da para saber quanta gente chegou ate aqui'), stage: f.id, label_stage: f.label, question: f.question, value, reached, min_sample: minSample }; continue; }

    if (reached <= 0) {
      out[f.id] = { stage: f.id, label_stage: f.label, question: f.question, value, reached, min_sample: minSample,
        state: 'STAGE_NOT_REACHED', ...EVIDENCE.STAGE_NOT_REACHED,
        reason: `ninguem chegou a esta etapa (alcance medido: ${reached}). Culpar o que esta aqui seria invencao.` };
      continue;
    }
    if (reached < minSample) {
      out[f.id] = { stage: f.id, label_stage: f.label, question: f.question, value, reached, min_sample: minSample,
        state: 'INCONCLUSIVE_SAMPLE', ...EVIDENCE.INCONCLUSIVE_SAMPLE,
        reason: `${reached} de alcance contra o minimo de ${minSample} para distinguir do acaso.` };
      continue;
    }
    const ref = baseline[f.metric];
    if (ref === undefined || ref === null) {
      out[f.id] = { stage: f.id, label_stage: f.label, question: f.question, value, reached, min_sample: minSample,
        state: 'UNPROVEN_HYPOTHESIS', ...EVIDENCE.UNPROVEN_HYPOTHESIS,
        reason: 'ha amostra, mas nao ha referencia para comparar: primeiro video do canal nesta condicao.' };
      continue;
    }
    const delta = value - ref;
    const rel = ref !== 0 ? delta / Math.abs(ref) : null;
    const worse = rel !== null && rel <= -0.15;
    const better = rel !== null && rel >= 0.15;
    out[f.id] = { stage: f.id, label_stage: f.label, question: f.question, value, reached, min_sample: minSample,
      baseline: ref, delta: +delta.toFixed(6), relative: rel === null ? null : +(rel * 100).toFixed(1),
      state: worse ? 'OBSERVED_FAILURE' : (better ? 'OBSERVED_SUCCESS' : 'INCONCLUSIVE_SAMPLE'),
      ...(worse ? EVIDENCE.OBSERVED_FAILURE : (better ? EVIDENCE.OBSERVED_SUCCESS : EVIDENCE.INCONCLUSIVE_SAMPLE)),
      reason: rel === null ? 'referencia zerada' :
        (worse ? `${(rel * 100).toFixed(1)}% abaixo da referencia, com alcance suficiente.`
        : (better ? `${(rel * 100).toFixed(1)}% acima da referencia, com alcance suficiente.`
        : `variacao de ${(rel * 100).toFixed(1)}% nao separa do ruido.`)) };
  }
  // propaga: se a etapa anterior nao foi atravessada, a seguinte nao e avaliavel
  for (const f of FUNNEL) {
    if (!f.depends_on) continue;
    const up = out[f.depends_on];
    if (up && (up.state === 'STAGE_NOT_REACHED')) {
      out[f.id] = { ...out[f.id], state: 'STAGE_NOT_REACHED', ...EVIDENCE.STAGE_NOT_REACHED,
        reason: `a etapa anterior (${up.label_stage}) nao foi atravessada, entao esta nao foi avaliada.` };
    }
  }
  return { stages: out, evaluated_at: new Date().toISOString() };
}

/**
 * Porteiro: pode-se culpar esta etapa?
 * Devolve {allowed:false, reason} sempre que a evidencia nao autoriza.
 */
function canAttributeFailure(funnel, stageId) {
  const f = stage(stageId);
  if (!f) return { allowed: false, reason: `etapa desconhecida: ${stageId}` };
  const s = (funnel && funnel.stages && funnel.stages[stageId]) || null;
  if (!s) return { allowed: false, reason: 'esta etapa nunca foi avaliada neste experimento' };
  if (!EVIDENCE[s.state] || !EVIDENCE[s.state].allows_blame)
    return { allowed: false, state: s.state, reason: `${EVIDENCE[s.state] ? EVIDENCE[s.state].label : s.state}: ${s.reason}` };
  return { allowed: true, state: s.state, evidence: s.reason, reached: s.reached, baseline: s.baseline, value: s.value };
}

/**
 * Culpar uma CENA exige mais: alem da etapa estar culpavel, e preciso que a
 * curva de retencao mostre que o publico chegou naquele ponto do video.
 */
function canAttributeFailureToScene(funnel, retentionMap, sceneId) {
  const sc = (retentionMap && retentionMap.scenes || []).find((x) => x.scene === sceneId);
  if (!sc) return { allowed: false, reason: `a cena ${sceneId} nao esta no mapa de retencao deste video` };
  if (sc.audience_at_start === null || sc.audience_at_start === undefined)
    return { allowed: false, state: 'DATA_UNAVAILABLE', reason: 'nao ha curva de retencao medida para este video' };
  if (sc.audience_at_start <= 0.02)
    return { allowed: false, state: 'STAGE_NOT_REACHED',
      reason: `so ${(sc.audience_at_start * 100).toFixed(1)}% do publico chegou ao inicio de ${sceneId}; a cena nao foi avaliada.` };
  if ((sc.viewers_at_start || 0) < 50)
    return { allowed: false, state: 'INCONCLUSIVE_SAMPLE',
      reason: `apenas ${sc.viewers_at_start} espectadores chegaram a ${sceneId}: amostra insuficiente.` };
  const which = sc.phase === 'early' ? 'early_retention' : (sc.phase === 'mid' ? 'mid_retention' : 'final_retention');
  const gate = canAttributeFailure(funnel, which);
  if (!gate.allowed) return { allowed: false, state: gate.state, reason: `a etapa ${which} nao autoriza culpa: ${gate.reason}` };
  return { allowed: true, scene: sceneId, audience_at_start: sc.audience_at_start, viewers_at_start: sc.viewers_at_start,
    drop_in_scene: sc.drop, evidence: `${(sc.audience_at_start * 100).toFixed(1)}% do publico chegou ao inicio da cena e ${(sc.drop * 100).toFixed(1)}% saiu dentro dela.` };
}

function summary(funnel) {
  const s = funnel && funnel.stages || {};
  const counts = {};
  for (const k of Object.keys(s)) counts[s[k].state] = (counts[s[k].state] || 0) + 1;
  const blameable = Object.keys(s).filter((k) => EVIDENCE[s[k].state] && EVIDENCE[s[k].state].allows_blame);
  return { counts, blameable_stages: blameable,
    first_measurable_loss: blameable[0] || null,
    note: blameable.length ? null : 'nenhuma etapa tem evidencia suficiente para ser apontada como falha.' };
}
module.exports = { evaluate, canAttributeFailure, canAttributeFailureToScene, summary };
