'use strict';
/** Painel vertical 1080x1920 do canal para Shorts: mesma identidade, desenhado por codigo. */
const { PALETTE } = require('./compose');
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function verticalFrameHTML({ index = 0, kicker = '', title = '', footer = '' }) {
  const W = 1080, H = 1920, a = index % 2 === 0 ? PALETTE.accent : PALETTE.accent_2;
  const g = [];
  for (let i = 0; i < 8; i++) g.push(`<circle cx="${W * 0.5}" cy="${H * 0.28}" r="${W * (0.2 + i * 0.14)}" fill="none" stroke="${i === 2 ? a : PALETTE.line}" stroke-width="${i === 2 ? 3 : 1.2}" opacity="${i === 2 ? .5 : .22}"/>`);
  for (let i = 0; i < 22; i++) g.push(`<line x1="0" y1="${(H * 0.70 + i * 26)}" x2="${W}" y2="${(H * 0.70 + i * 26)}" stroke="${PALETTE.line}" stroke-width="1" opacity="0.16"/>`);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden;background:${PALETTE.bg_deep}}
  body{font-family:'Inter','DejaVu Sans',sans-serif;color:${PALETTE.ink};-webkit-font-smoothing:antialiased}
  .s{position:relative;width:${W}px;height:${H}px;background:radial-gradient(120% 62% at 50% 20%, ${PALETTE.bg_soft} 0%, ${PALETTE.bg_deep} 68%)}
  .grain{position:absolute;inset:0;opacity:.06;background-image:radial-gradient(${PALETTE.ink} 1px,transparent 1.1px);background-size:4px 4px}
  .vig{position:absolute;inset:0;background:radial-gradient(95% 62% at 50% 40%, rgba(0,0,0,0) 46%, rgba(0,0,0,.6) 100%)}
  .top{position:absolute;top:96px;left:64px;right:64px;text-align:left}
  .k{display:flex;align-items:center;gap:14px;font-size:27px;letter-spacing:.2em;text-transform:uppercase;color:${PALETTE.ink_dim};font-weight:700;margin-bottom:26px}
  .k i{width:14px;height:14px;background:${a};border-radius:50%;display:block;flex:0 0 auto}
  h1{font-family:'Inter Display','Inter',sans-serif;font-weight:900;font-size:${title.length > 44 ? 72 : 88}px;line-height:1.0;letter-spacing:-.032em;text-wrap:balance}
  .foot{position:absolute;bottom:84px;left:64px;right:64px;font-size:26px;color:${PALETTE.line};letter-spacing:.24em;text-transform:uppercase;font-weight:700;text-align:center}
  </style></head><body><div class="s">
  <svg width="${W}" height="${H}" style="position:absolute;inset:0">${g.join('')}</svg>
  <div class="grain"></div><div class="vig"></div>
  <div class="top"><div class="k"><i></i>${esc(kicker)}</div><h1>${esc(title)}</h1></div>
  <div class="foot">${esc(footer)}</div>
  </div></body></html>`;
}
module.exports = { verticalFrameHTML };
