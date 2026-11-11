'use strict';
/**
 * Laboratorio de variaveis.
 *
 * Descreve o que pode variar entre episodios e calcula a assinatura de cada
 * producao, para que o sistema consiga achar episodios COMPARAVEIS — e, mais
 * importante, apontar quando dois episodios diferem em coisas demais para que a
 * comparacao signifique alguma coisa.
 */
const crypto = require('crypto');

const VARIABLES = {
  hook_style:        { label: 'estilo de abertura', values: ['cold_statement', 'number_trio', 'question', 'story', 'contradiction'] },
  narration_voice:   { label: 'voz da narracao', values: ['am_michael', 'am_adam', 'af_heart', 'bm_george'] },
  narration_speed:   { label: 'velocidade da narracao', values: [0.9, 0.95, 1.0, 1.05, 1.1] },
  pause_beat:        { label: 'pausa entre falas (s)', values: [0.28, 0.38, 0.48] },
  pause_scene:       { label: 'pausa entre cenas (s)', values: [0.8, 1.1, 1.4] },
  music:             { label: 'trilha', values: ['none'] },
  target_minutes:    { label: 'duracao alvo', values: [[4, 6], [6, 9], [9, 14]] },
  scene_count:       { label: 'numero de cenas', values: 'inteiro' },
  motif_set:         { label: 'conjunto de motivos visuais', values: 'lista' },
  camera_motion:     { label: 'movimento de camera', values: 'lista' },
  title_shape:       { label: 'formato do titulo', values: ['question', 'claim', 'correction', 'how_to', 'contrarian'] },
  thumbnail_style:   { label: 'estilo da miniatura', values: ['typographic', 'numeric', 'chart', 'contrast_word'] },
  evidence_position: { label: 'onde a evidencia entra', values: ['early', 'middle', 'late'] },
  payoff_position:   { label: 'onde o payoff entra', values: ['middle', 'late'] }
};

/** Le a configuracao real do episodio e devolve os valores das variaveis. */
function readConfig({ brief, script, timeline, storyboard }) {
  const scenes = (script && script.scenes) || [];
  const motifs = [...new Set(scenes.map((s) => s.motif))].sort();
  const cameras = storyboard ? [...new Set((storyboard.scenes || []).map((s) => s.camera))].sort() : [];
  const exp = (brief && brief.experiment) || {};
  return {
    hook_style: exp.hook_style || (scenes[0] ? scenes[0].motif : null),
    narration_voice: (timeline && timeline.voice) || process.env.TTS_VOICE || null,
    narration_speed: exp.narration_speed || 1.0,
    pause_beat: (timeline && timeline.pauses && timeline.pauses.beat) || null,
    pause_scene: (timeline && timeline.pauses && timeline.pauses.scene) || null,
    music: 'none',
    target_minutes: (brief && brief.target_minutes) || null,
    scene_count: scenes.length,
    motif_set: motifs,
    camera_motion: cameras,
    title_shape: exp.title_shape || null,
    thumbnail_style: exp.thumbnail_style || null,
    evidence_position: exp.evidence_position || null,
    payoff_position: exp.payoff_position || null,
    duration_s: timeline ? timeline.total_duration_s : null
  };
}
function fingerprint(cfg) {
  return crypto.createHash('sha256').update(JSON.stringify(cfg, Object.keys(cfg).sort())).digest('hex').slice(0, 16);
}

/**
 * Compara dois episodios e diz se a comparacao vale alguma coisa.
 * Mais de UMA variavel diferente = experimento observacional, nao controlado.
 */
function compare(a, b, { declaredVariable = null } = {}) {
  const diffs = [];
  for (const k of Object.keys(VARIABLES)) {
    const va = JSON.stringify(a[k]), vb = JSON.stringify(b[k]);
    if (va !== vb) diffs.push({ variable: k, label: VARIABLES[k].label, a: a[k], b: b[k] });
  }
  const controlled = diffs.length === 1 && declaredVariable && diffs[0].variable === declaredVariable;
  return {
    differing: diffs, differing_count: diffs.length,
    declared_variable: declaredVariable,
    comparability: controlled ? 'controlado_em_uma_variavel'
      : (diffs.length <= 3 ? 'observacional_com_poucos_confundidores' : 'observacional_com_muitos_confundidores'),
    causal_claim_allowed: false,
    note: controlled
      ? 'Uma unica variavel declarada difere. Ainda assim o assunto e o publico mudam entre episodios originais: trate como forte indicio, nao como prova.'
      : `${diffs.length} variaveis diferem (${diffs.map((d) => d.variable).join(', ') || 'nenhuma'}). Qualquer diferenca de resultado tem mais de uma explicacao possivel.`
  };
}
module.exports = { VARIABLES, readConfig, fingerprint, compare };
