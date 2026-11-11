'use strict';
/**
 * Analise MEDIDA de uma miniatura. Nada aqui e declarado: tudo sai do pixel.
 * Cores dominantes, contraste, area de texto, posicao dos elementos e hash do
 * arquivo. A intencao emocional continua sendo declaracao humana — e fica
 * marcada como declaracao, nao como medida.
 */
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

function lum(r, g, b) { return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }
function hex(r, g, b) { return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''); }

/** Le o PNG reduzido como RGB cru; sem dependencia de biblioteca de imagem. */
async function rawRGB(file, w = 160, h = 90) {
  const { stdout } = await execFileAsync(FFMPEG,
    ['-hide_banner', '-v', 'error', '-i', file, '-vf', `scale=${w}:${h}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
  return { buf: stdout, w, h };
}

async function analyse(file, { declaredText = null, emotionalIntent = null } = {}) {
  if (!fs.existsSync(file)) throw new Error(`miniatura inexistente: ${file}`);
  const { buf, w, h } = await rawRGB(file);
  const n = w * h;
  // cores dominantes por quantizacao grosseira (4 bits por canal)
  const bins = new Map();
  let sumL = 0; let bright = 0; let dark = 0;
  const lums = [];
  const colMass = new Array(w).fill(0), rowMass = new Array(h).fill(0);
  for (let i = 0; i < n; i++) {
    const r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const cur = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    cur.n++; cur.r += r; cur.g += g; cur.b += b; bins.set(key, cur);
    const L = lum(r, g, b); sumL += L; lums.push(L);
    if (L > 0.72) { bright++; const x = i % w, y = (i / w) | 0; colMass[x]++; rowMass[y]++; }
    if (L < 0.12) dark++;
  }
  const dominant = [...bins.values()].sort((a, b2) => b2.n - a.n).slice(0, 5)
    .map((c) => ({ hex: hex(Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n)),
      share_pct: +((c.n / n) * 100).toFixed(2), luminance: +lum(c.r / c.n, c.g / c.n, c.b / c.n).toFixed(3) }));
  lums.sort((a, b2) => a - b2);
  const p05 = lums[Math.floor(n * 0.05)], p95 = lums[Math.floor(n * 0.95)];
  // razao de contraste WCAG entre o claro e o escuro predominantes
  const ratio = (p95 + 0.05) / (p05 + 0.05);
  // caixa delimitadora da massa clara = onde esta o texto
  const colIdx = colMass.map((v, i) => [v, i]).filter(([v]) => v > 0).map(([, i]) => i);
  const rowIdx = rowMass.map((v, i) => [v, i]).filter(([v]) => v > 0).map(([, i]) => i);
  const box = colIdx.length ? {
    x_pct: +((Math.min(...colIdx) / w) * 100).toFixed(1), x2_pct: +((Math.max(...colIdx) / w) * 100).toFixed(1),
    y_pct: +((Math.min(...rowIdx) / h) * 100).toFixed(1), y2_pct: +((Math.max(...rowIdx) / h) * 100).toFixed(1)
  } : null;
  const side = box ? (box.x2_pct < 55 ? 'esquerda' : (box.x_pct > 45 ? 'direita' : 'centro')) : null;
  const stat = fs.statSync(file);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const chars = declaredText ? String(declaredText).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().length : null;
  return {
    file, bytes: stat.size, sha256: sha,
    measured: {
      dominant_colors: dominant,
      mean_luminance: +(sumL / n).toFixed(4),
      contrast_ratio_p5_p95: +ratio.toFixed(2),
      bright_pixels_pct: +((bright / n) * 100).toFixed(2),
      dark_pixels_pct: +((dark / n) * 100).toFixed(2),
      text_mass_box_pct: box, text_side: side,
      sample: `${w}x${h} rgb24`
    },
    declared: {
      text: declaredText ? String(declaredText).replace(/<[^>]+>/g, '') : null,
      text_chars: chars,
      emotional_intent: emotionalIntent,
      note: 'texto e intencao sao DECLARACAO de quem desenhou; cores, contraste e posicao acima sao MEDIDA do arquivo.'
    },
    legibility_flags: [
      ratio < 4.5 ? 'contraste abaixo de 4.5:1 entre extremos — risco de perder leitura em tela pequena' : null,
      chars !== null && chars > 48 ? `texto com ${chars} caracteres — acima de 48 costuma sumir no celular` : null,
      bright / n < 0.01 ? 'quase nenhuma massa clara: pode estar escuro demais para miniatura' : null
    ].filter(Boolean),
    analysed_at: new Date().toISOString()
  };
}
module.exports = { analyse, rawRGB };
