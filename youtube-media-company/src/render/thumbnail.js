'use strict';
/** Duas miniaturas 16:9 desenhadas por codigo. Sem foto de terceiro, sem promessa falsa. */
const path = require('path');
const fs = require('fs');
const { PALETTE } = require('./compose');

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function thumbHTML(variant, { title, kicker, proof }) {
  const W = 1280, H = 720, a = variant === 'A' ? PALETTE.accent : PALETTE.accent_2;
  const rings = [];
  if (variant === 'A') {
    for (let i = 0; i < 6; i++) rings.push(`<circle cx="${W * 0.84}" cy="${H * 0.5}" r="${H * (0.12 + i * 0.11)}" fill="none" stroke="${i === 2 ? a : PALETTE.line}" stroke-width="${i === 2 ? 4 : 1.6}" opacity="${i === 2 ? .9 : .45}"/>`);
  } else {
    const bars = 9, x0 = W * 0.6, span = W * 0.36, bw = span / (bars * 1.5);
    for (let i = 0; i < bars; i++) {
      const h = H * (0.06 + Math.pow(i / (bars - 1), 1.8) * 0.56);
      rings.push(`<rect x="${(x0 + i * bw * 1.5).toFixed(0)}" y="${(H * 0.84 - h).toFixed(0)}" width="${bw.toFixed(0)}" height="${h.toFixed(0)}" fill="${i >= bars - 2 ? a : PALETTE.line}" opacity="${i >= bars - 2 ? .95 : .5}"/>`);
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden}
  body{font-family:'Inter','DejaVu Sans',sans-serif;background:${PALETTE.bg_deep};color:${PALETTE.ink};-webkit-font-smoothing:antialiased}
  .s{position:relative;width:${W}px;height:${H}px;background:radial-gradient(130% 120% at ${variant === 'A' ? '82% 20%' : '18% 80%'}, ${PALETTE.bg_soft} 0%, ${PALETTE.bg_deep} 60%)}
  .vig{position:absolute;inset:0;background:radial-gradient(120% 100% at 50% 50%, rgba(0,0,0,0) 40%, rgba(0,0,0,.6) 100%)}
  .grain{position:absolute;inset:0;opacity:.06;background-image:radial-gradient(${PALETTE.ink} 1px,transparent 1.1px);background-size:4px 4px}
  .c{position:absolute;inset:0;padding:0 56px;display:flex;flex-direction:column;justify-content:center;max-width:${variant === 'A' ? 830 : 760}px}
  .k{display:flex;align-items:center;gap:12px;font-size:22px;letter-spacing:.2em;text-transform:uppercase;color:${PALETTE.ink_dim};font-weight:700;margin-bottom:22px}
  .k i{width:12px;height:12px;background:${a};border-radius:50%;display:block}
  h1{font-family:'Inter Display','Inter',sans-serif;font-weight:900;font-size:${variant === 'A' ? 96 : 84}px;line-height:.98;letter-spacing:-.035em;text-wrap:balance}
  h1 em{font-style:normal;color:${a}}
  .p{margin-top:26px;display:inline-flex;align-self:flex-start;background:${a};color:#0B0D10;font-weight:800;font-size:26px;padding:12px 20px;letter-spacing:-.01em}
  </style></head><body><div class="s">
  <svg width="${W}" height="${H}" style="position:absolute;inset:0">${rings.join('')}</svg>
  <div class="grain"></div><div class="vig"></div>
  <div class="c"><div class="k"><i></i>${esc(kicker)}</div><h1>${title}</h1><div class="p">${esc(proof)}</div></div>
  </div></body></html>`;
}

async function renderThumbnails(browser, outDir, variants) {
  fs.mkdirSync(outDir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const out = [];
  try {
    for (const v of variants) {
      await page.setContent(thumbHTML(v.variant, v), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const p = path.join(outDir, `thumbnail_${v.variant}.png`);
      await page.screenshot({ path: p, type: 'png' });
      out.push({ variant: v.variant, path: p, ...v });
    }
  } finally { await page.close().catch(() => {}); }
  return out;
}
module.exports = { renderThumbnails, thumbHTML };
