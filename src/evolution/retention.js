'use strict';
/**
 * Liga a curva de retencao do YouTube as CENAS e FALAS do video.
 *
 * O que o sistema faz: diz onde o publico saiu, quanto saiu, e qual cena/fala
 * estava no ar naquele ponto. O que o sistema NAO faz: dizer por que. Para cada
 * queda relevante ele emite HIPOTESES, marcadas como hipotese.
 */
const { EVIDENCE } = require('./states');

/**
 * @param curve [{ratio:0..1, audience:0..1}] vindo da API (elapsedVideoTimeRatio)
 * @param storyboard storyboard.json com duration_s por cena e beats
 * @param timeline narration_timeline.json com falas e tempos medidos
 * @param views visualizacoes no periodo, para converter fracao em gente
 */
function mapToScenes(curve, storyboard, timeline, views) {
  const total = Number(storyboard.total_duration_s) || (storyboard.scenes || []).reduce((a, s) => a + (s.duration_s || 0), 0);
  if (!total) throw new Error('storyboard sem duracao total');
  const haveCurve = Array.isArray(curve) && curve.length >= 5;
  const at = (t) => {
    if (!haveCurve) return null;
    const r = Math.max(0, Math.min(1, t / total));
    let best = curve[0];
    for (const p of curve) if (Math.abs(p.ratio - r) < Math.abs(best.ratio - r)) best = p;
    return best.audience;
  };
  const scenes = []; let t = 0;
  for (const sc of storyboard.scenes || []) {
    const start = t, end = t + (sc.duration_s || 0);
    const a0 = at(start), a1 = at(end);
    const phase = end <= 30 ? 'early' : (start >= total * 0.66 ? 'final' : 'mid');
    const lines = (timeline && timeline.lines || []).filter((l) => l.start >= start - 0.01 && l.start < end);
    scenes.push({
      scene: sc.id, role: sc.role || null, motif: sc.motif || null, phase,
      start_s: +start.toFixed(2), end_s: +end.toFixed(2), duration_s: +(end - start).toFixed(2),
      audience_at_start: a0, audience_at_end: a1,
      viewers_at_start: a0 === null || views == null ? null : Math.round(a0 * views),
      drop: a0 === null || a1 === null ? null : +(a0 - a1).toFixed(4),
      drop_rate_per_min: a0 === null || a1 === null || end === start ? null : +(((a0 - a1) / ((end - start) / 60))).toFixed(4),
      first_line: lines[0] ? lines[0].text : null,
      lines_in_scene: lines.length,
      on_screen: sc.on_screen ? (sc.on_screen.title || null) : null
    });
    t = end;
  }
  if (!haveCurve) {
    return { available: false, state: 'DATA_UNAVAILABLE', ...EVIDENCE.DATA_UNAVAILABLE,
      reason: 'nenhuma curva de retencao foi devolvida pela API para este video',
      total_duration_s: +total.toFixed(2), scenes };
  }
  // quedas relevantes: acima do dobro da mediana de queda por minuto
  const rates = scenes.map((s) => s.drop_rate_per_min).filter((x) => x !== null).sort((a, b) => a - b);
  const median = rates.length ? rates[Math.floor(rates.length / 2)] : 0;
  const threshold = Math.max(0.02, median * 2);
  const notable = scenes.filter((s) => s.drop_rate_per_min !== null && s.drop_rate_per_min >= threshold)
    .map((s) => ({ ...s, hypotheses: hypothesesFor(s, scenes) }));

  return { available: true, total_duration_s: +total.toFixed(2), views: views == null ? null : views,
    median_drop_per_min: +median.toFixed(4), notable_threshold: +threshold.toFixed(4),
    scenes, notable_drops: notable,
    disclaimer: 'Queda marcada e observacao, nao causa. As hipoteses abaixo sao hipoteses e precisam de experimento proprio para virar conclusao.' };
}

/** Hipoteses explicativas — rotuladas como hipotese, nunca como causa. */
function hypothesesFor(s, all) {
  const h = [];
  const idx = all.findIndex((x) => x.scene === s.scene);
  if (s.phase === 'early') h.push({ hypothesis: 'a abertura nao entregou o que a miniatura ou o titulo prometeram', testable_by: 'variar apenas o gancho mantendo o resto', confidence: 'nao testada' });
  if (s.lines_in_scene >= 8) h.push({ hypothesis: 'densidade de fala alta demais para o ponto do video', testable_by: 'reduzir falas desta cena mantendo o argumento', confidence: 'nao testada' });
  if (s.duration_s >= 70) h.push({ hypothesis: 'cena longa demais sem mudanca de ritmo', testable_by: 'quebrar em duas cenas com motivos visuais diferentes', confidence: 'nao testada' });
  if (/citation|evidence_gap|correction/.test(String(s.motif))) h.push({ hypothesis: 'bloco de evidencia denso perdeu quem veio pelo lado pratico', testable_by: 'mover a evidencia para depois do payoff', confidence: 'nao testada' });
  if (idx > 0 && all[idx - 1] && all[idx - 1].drop !== null && s.drop !== null && s.drop > all[idx - 1].drop * 2)
    h.push({ hypothesis: 'a transicao da cena anterior quebrou a continuidade', testable_by: 'reescrever a ponte entre as duas cenas', confidence: 'nao testada' });
  if (!h.length) h.push({ hypothesis: 'sem padrao evidente nesta cena; pode ser abandono natural de meio de video', testable_by: 'comparar com a mediana do canal quando houver mais episodios', confidence: 'nao testada' });
  return h;
}

/** Retencao agregada nos pontos que o funil usa. */
function summarise(curve, totalSeconds) {
  if (!Array.isArray(curve) || curve.length < 5) return { retention_0_30s: null, retention_mid: null, retention_end: null };
  const at = (r) => { let best = curve[0]; for (const p of curve) if (Math.abs(p.ratio - r) < Math.abs(best.ratio - r)) best = p; return best.audience; };
  return {
    retention_0_30s: totalSeconds ? at(Math.min(1, 30 / totalSeconds)) : at(0.07),
    retention_mid: at(0.5),
    retention_end: at(0.95)
  };
}
module.exports = { mapToScenes, summarise, hypothesesFor };
