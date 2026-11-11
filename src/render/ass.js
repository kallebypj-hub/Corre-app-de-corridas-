'use strict';
/**
 * SRT -> ASS com PlayRes explicito.
 *
 * Por que nao usar o filtro `subtitles` direto no SRT: a conversao interna do
 * FFmpeg define PlayResX/PlayResY pequenos, e o libass escala Fontsize e MarginV
 * por esse fator. Num quadro 1080x1920 isso joga a legenda para fora da tela —
 * foi exatamente o que aconteceu na primeira versao dos Shorts: o arquivo saiu
 * sem legenda nenhuma e ninguem percebeu porque o gate so olhava resolucao.
 * Escrevendo o ASS com PlayRes 1080x1920, a posicao e o corpo sao em pixels reais.
 */
function ts(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60), cs = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(Math.min(99, cs)).padStart(2, '0')}`;
}
function esc(t) { return String(t).replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\N'); }

/**
 * @param cues [{start,end,lines[]}] em segundos, ja relativos ao clipe
 * @param opts {width,height,fontSize,marginV,marginLR,font,primary,outline,back}
 */
function cuesToASS(cues, opts = {}) {
  const W = opts.width || 1080, H = opts.height || 1920;
  const font = opts.font || 'Inter';
  const size = opts.fontSize || 54;
  const marginV = opts.marginV || 430;
  const marginLR = opts.marginLR || 80;
  // ASS usa &HAABBGGRR
  const primary = opts.primary || '&H00F4F2F7';
  const outline = opts.outline || '&H00100D0B';
  const back = opts.back || '&H6B100D0B';
  const head = [
    '[Script Info]', 'ScriptType: v4.00+', 'WrapStyle: 0', 'ScaledBorderAndShadow: yes',
    `PlayResX: ${W}`, `PlayResY: ${H}`, '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Cap,${font},${size},${primary},${primary},${outline},${back},-1,0,0,0,100,100,0,0,3,6,0,2,${marginLR},${marginLR},${marginV},1`, '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ];
  const body = cues.map((c) => `Dialogue: 0,${ts(c.start)},${ts(c.end)},Cap,,0,0,0,,${esc((c.lines || [c.text]).join('\n'))}`);
  return head.concat(body).join('\n') + '\n';
}
module.exports = { cuesToASS, ts };
