'use strict';
/**
 * Composicao visual por cena, desenhada por CODIGO.
 * Nenhuma foto de banco de imagem, nenhuma imagem generativa, nenhum ativo de terceiro.
 * Cada motivo gera geometria propria derivada do conteudo da cena (seed estavel),
 * para que duas cenas nunca fiquem iguais e o canal nao vire template.
 * Direitos: obra propria do canal. Tipografia: Inter / Inter Display (SIL OFL 1.1), instalada no sistema.
 */

function seedOf(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rngOf(seed) { let x = seed || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/** Resolve o estado de tela de um beat: o que esta revelado neste instante. */
function beatState(scene, beatIndex) {
  const st = { kicker: false, title: false, sub: false, cite: false, items: new Set(), beatText: null, hold: false };
  for (let i = 0; i <= beatIndex; i++) {
    const b = scene.beats[i]; if (!b) continue;
    const s = b.screen || 'hold';
    if (s === 'kicker') st.kicker = true;
    else if (s === 'title') { st.kicker = true; st.title = true; }
    else if (s === 'sub') { st.kicker = true; st.title = true; st.sub = true; }
    else if (s === 'cite') { st.kicker = true; st.title = true; st.cite = true; }
    else if (s.startsWith('item:')) { st.kicker = true; st.title = true; st.items.add(Number(s.split(':')[1])); }
    else if (s.startsWith('beat:')) { /* overlay momentaneo */ }
  }
  const cur = scene.beats[beatIndex] || {};
  const cs = cur.screen || 'hold';
  if (cs.startsWith('beat:')) st.beatText = cs.slice(5);
  if (cs === 'hold') st.hold = true;
  // garante que ao menos o titulo apareca depois do primeiro beat
  if (beatIndex > 0) st.kicker = st.kicker || !!(scene.on_screen || {}).kicker;
  return st;
}

const PALETTE = { bg_deep: '#0B0D10', bg_soft: '#141821', ink: '#F2F4F7', ink_dim: '#9AA4B2', accent: '#E8552F', accent_2: '#2F7FE8', line: '#2A313D' };

/** Geometria de fundo por motivo. Retorna SVG inline, deterministico pela seed da cena. */
function backdrop(motif, seed, accent, W, H) {
  const r = rngOf(seed);
  const a = accent, dim = PALETTE.line;
  const P = [];
  switch (motif) {
    case 'single_statement': {
      const cx = W * (0.74 + r() * 0.1), cy = H * (0.52 + r() * 0.1);
      for (let i = 0; i < 7; i++) {
        const rad = H * (0.16 + i * 0.105);
        const dash = 10 + Math.floor(r() * 26);
        P.push(`<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${rad.toFixed(0)}" fill="none" stroke="${i === 3 ? a : dim}" stroke-width="${i === 3 ? 3 : 1.5}" stroke-dasharray="${dash} ${dash * 2}" opacity="${i === 3 ? 0.85 : 0.5}"/>`);
      }
      break;
    }
    case 'rule_box': {
      for (let i = 0; i < 22; i++) {
        const y = (H / 22) * i + r() * 8;
        P.push(`<line x1="0" y1="${y.toFixed(0)}" x2="${W}" y2="${(y + (r() - 0.5) * 40).toFixed(0)}" stroke="${dim}" stroke-width="1" opacity="0.35"/>`);
      }
      P.push(`<rect x="${(W * 0.58).toFixed(0)}" y="${(H * 0.26).toFixed(0)}" width="${(W * 0.3).toFixed(0)}" height="${(H * 0.48).toFixed(0)}" fill="none" stroke="${a}" stroke-width="3" opacity="0.8"/>`);
      P.push(`<line x1="${(W * 0.58).toFixed(0)}" y1="${(H * 0.5).toFixed(0)}" x2="${(W * 0.88).toFixed(0)}" y2="${(H * 0.5).toFixed(0)}" stroke="${a}" stroke-width="2" opacity="0.5"/>`);
      break;
    }
    case 'evidence_list': {
      const n = 34;
      for (let i = 0; i < n; i++) {
        const x = W * 0.55 + (W * 0.42 / n) * i;
        const h = H * (0.08 + r() * 0.5);
        P.push(`<rect x="${x.toFixed(0)}" y="${((H - h) / 2).toFixed(0)}" width="3" height="${h.toFixed(0)}" fill="${i % 7 === 0 ? a : dim}" opacity="${i % 7 === 0 ? 0.7 : 0.33}"/>`);
      }
      break;
    }
    case 'citation': {
      const cx = W * 0.8, cy = H * 0.45;
      for (let i = 0; i < 5; i++) {
        const w = H * (0.2 + i * 0.13), hh = w * 0.62, rot = (r() * 24 - 12).toFixed(1);
        P.push(`<rect x="${(cx - w / 2).toFixed(0)}" y="${(cy - hh / 2).toFixed(0)}" width="${w.toFixed(0)}" height="${hh.toFixed(0)}" fill="none" stroke="${i === 1 ? a : dim}" stroke-width="${i === 1 ? 2.5 : 1.2}" opacity="${i === 1 ? 0.8 : 0.4}" transform="rotate(${rot} ${cx} ${cy})"/>`);
      }
      break;
    }
    case 'inflation_chart': {
      const bars = 11, x0 = W * 0.545, xEnd = W * 0.965, span = xEnd - x0;
      const bw = span / (bars + (bars - 1) * 0.46), gap = bw * 0.46, base = H * 0.82;
      for (let i = 0; i < bars; i++) {
        const h = H * (0.05 + Math.pow(i / (bars - 1), 1.75) * 0.6);
        const x = x0 + i * (bw + gap);
        P.push(`<rect x="${x.toFixed(0)}" y="${(base - h).toFixed(0)}" width="${bw.toFixed(0)}" height="${h.toFixed(0)}" fill="${i >= bars - 3 ? a : dim}" opacity="${i >= bars - 3 ? 0.85 : 0.45}"/>`);
      }
      P.push(`<line x1="${(x0 - gap).toFixed(0)}" y1="${base.toFixed(0)}" x2="${W}" y2="${base.toFixed(0)}" stroke="${PALETTE.ink_dim}" stroke-width="2" opacity="0.6"/>`);
      break;
    }
    case 'if_then': {
      const yc = H * 0.5, x1 = W * 0.56, x2 = W * 0.84;
      P.push(`<circle cx="${x1}" cy="${yc}" r="${(H * 0.14).toFixed(0)}" fill="none" stroke="${dim}" stroke-width="2" opacity="0.55"/>`);
      P.push(`<circle cx="${x2}" cy="${yc}" r="${(H * 0.14).toFixed(0)}" fill="none" stroke="${a}" stroke-width="3" opacity="0.85"/>`);
      P.push(`<line x1="${(x1 + H * 0.145).toFixed(0)}" y1="${yc}" x2="${(x2 - H * 0.15).toFixed(0)}" y2="${yc}" stroke="${a}" stroke-width="3" opacity="0.8"/>`);
      P.push(`<polygon points="${(x2 - H * 0.15).toFixed(0)},${yc} ${(x2 - H * 0.175).toFixed(0)},${(yc - 12)} ${(x2 - H * 0.175).toFixed(0)},${(yc + 12)}" fill="${a}"/>`);
      for (let i = 0; i < 16; i++) { const yy = H * 0.1 + (H * 0.8 / 16) * i; P.push(`<line x1="${(W * 0.52).toFixed(0)}" y1="${yy.toFixed(0)}" x2="${(W * 0.545).toFixed(0)}" y2="${yy.toFixed(0)}" stroke="${dim}" stroke-width="1.5" opacity="0.4"/>`); }
      break;
    }
    case 'correction': {
      const cx = W * 0.78, cy = H * 0.46;
      P.push(`<circle cx="${cx}" cy="${cy}" r="${(H * 0.3).toFixed(0)}" fill="none" stroke="${dim}" stroke-width="2" opacity="0.5"/>`);
      P.push(`<line x1="${(cx - H * 0.3).toFixed(0)}" y1="${(cy + H * 0.3).toFixed(0)}" x2="${(cx + H * 0.3).toFixed(0)}" y2="${(cy - H * 0.3).toFixed(0)}" stroke="${a}" stroke-width="4" opacity="0.9"/>`);
      for (let i = 0; i < 9; i++) { const rr = H * (0.06 + i * 0.03); P.push(`<circle cx="${cx}" cy="${cy}" r="${rr.toFixed(0)}" fill="none" stroke="${dim}" stroke-width="1" opacity="0.28"/>`); }
      break;
    }
    case 'quote_pair': {
      for (let i = 0; i < 2; i++) {
        const x = W * (0.56 + i * 0.2), y = H * (0.2 + i * 0.26);
        P.push(`<text x="${x.toFixed(0)}" y="${y.toFixed(0)}" font-family="Inter Display, Inter, sans-serif" font-size="${(H * 0.34).toFixed(0)}" font-weight="900" fill="${i === 0 ? a : dim}" opacity="${i === 0 ? 0.22 : 0.16}">&#8220;</text>`);
      }
      for (let i = 0; i < 26; i++) { const yy = (H / 26) * i; P.push(`<line x1="${(W * 0.54).toFixed(0)}" y1="${yy.toFixed(0)}" x2="${W}" y2="${yy.toFixed(0)}" stroke="${dim}" stroke-width="0.8" opacity="0.22"/>`); }
      break;
    }
    case 'closing_statement': default: {
      const cx = W * 0.5, cy = H * 0.5;
      for (let i = 0; i < 11; i++) {
        const rad = H * (0.1 + i * 0.09);
        P.push(`<circle cx="${cx}" cy="${cy}" r="${rad.toFixed(0)}" fill="none" stroke="${i % 4 === 0 ? a : dim}" stroke-width="${i % 4 === 0 ? 2 : 1}" opacity="${i % 4 === 0 ? 0.5 : 0.22}"/>`);
      }
      break;
    }
  }
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="position:absolute;inset:0">${P.join('')}</svg>`;
}

/** HTML completo de um frame-chave (beat) da cena, em 2560x1440 para render nitido. */
function sceneHTML(scene, beatIndex, opts = {}) {
  const W = opts.width || 2560, H = opts.height || 1440;
  const os = scene.on_screen || {};
  const st = beatState(scene, beatIndex);
  const seed = seedOf(scene.id + '|' + (scene.motif || ''));
  const accentKey = scene.accent || 'accent';
  const accent = PALETTE[accentKey] || PALETTE.accent;
  const centered = scene.motif === 'closing_statement' || scene.motif === 'single_statement';
  const items = Array.isArray(os.items) ? os.items : [];
  const chTitle = String(os.title || '').length;
  const titleSize = chTitle > 62 ? 0.058 : chTitle > 42 ? 0.072 : chTitle > 26 ? 0.092 : 0.112;

  const body = [];
  if (os.kicker && st.kicker) body.push(`<div class="kicker"><span class="dot"></span>${esc(os.kicker)}</div>`);
  if (os.title && st.title) body.push(`<h1 class="title">${esc(os.title)}</h1>`);
  if (os.sub && st.sub) body.push(`<p class="sub">${esc(os.sub)}</p>`);
  if (items.length) {
    const li = items.map((t, i) => st.items.has(i)
      ? `<li class="on"><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="t">${esc(t)}</span></li>`
      : `<li class="off"><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="t">${esc(t)}</span></li>`).join('');
    body.push(`<ul class="items">${li}</ul>`);
  }
  if (os.cite && st.cite) body.push(`<div class="cite">${esc(os.cite)}</div>`);

  const overlay = st.beatText
    ? `<div class="overlay"><div class="obox">${esc(st.beatText)}</div></div>` : '';

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden;background:${PALETTE.bg_deep}}
  body{font-family:'Inter','DejaVu Sans',sans-serif;color:${PALETTE.ink};-webkit-font-smoothing:antialiased}
  .stage{position:relative;width:${W}px;height:${H}px;
    background:radial-gradient(130% 110% at 78% 18%, ${PALETTE.bg_soft} 0%, ${PALETTE.bg_deep} 62%)}
  .grain{position:absolute;inset:0;opacity:.055;
    background-image:radial-gradient(${PALETTE.ink} 1px, transparent 1.1px);background-size:5px 5px}
  .vig{position:absolute;inset:0;background:radial-gradient(118% 100% at 50% 46%, rgba(0,0,0,0) 44%, rgba(0,0,0,.62) 100%)}
  .content{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;
    ${st.beatText ? `padding-bottom:${(H * 0.165).toFixed(0)}px;` : ''}
    ${centered ? `align-items:center;text-align:center;padding:0 ${(W * 0.11).toFixed(0)}px` : `align-items:flex-start;padding:0 ${(W * 0.055).toFixed(0)}px;max-width:${(W * 0.56).toFixed(0)}px`}}
  .kicker{display:flex;align-items:center;gap:${(H * 0.016).toFixed(0)}px;font-size:${(H * 0.0235).toFixed(0)}px;
    letter-spacing:.21em;text-transform:uppercase;color:${PALETTE.ink_dim};font-weight:600;margin-bottom:${(H * 0.034).toFixed(0)}px}
  .dot{width:${(H * 0.0135).toFixed(0)}px;height:${(H * 0.0135).toFixed(0)}px;background:${accent};border-radius:50%;flex:0 0 auto}
  .title{font-family:'Inter Display','Inter','DejaVu Sans',sans-serif;font-weight:800;
    font-size:${(H * titleSize).toFixed(0)}px;line-height:1.045;letter-spacing:-.022em;
    text-wrap:balance;max-width:${centered ? '100%' : '20ch'}}
  .sub{margin-top:${(H * 0.038).toFixed(0)}px;font-size:${(H * 0.0345).toFixed(0)}px;line-height:1.46;
    color:${PALETTE.ink_dim};font-weight:400;max-width:${centered ? (W * 0.6).toFixed(0) + 'px' : '34ch'}}
  .items{list-style:none;margin-top:${(H * 0.042).toFixed(0)}px;display:flex;flex-direction:column;gap:${(H * 0.026).toFixed(0)}px}
  .items li{display:flex;gap:${(H * 0.024).toFixed(0)}px;align-items:flex-start;font-size:${(H * 0.0315).toFixed(0)}px;line-height:1.42;max-width:40ch}
  .items .n{font-variant-numeric:tabular-nums;font-weight:700;font-size:${(H * 0.021).toFixed(0)}px;
    color:${accent};padding-top:${(H * 0.008).toFixed(0)}px;flex:0 0 auto;letter-spacing:.06em}
  .items li.off{opacity:.21}
  .items li.on{opacity:1}
  .items li.on .t{border-left:3px solid ${accent};padding-left:${(H * 0.018).toFixed(0)}px;margin-left:${(-H * 0.0).toFixed(0)}px}
  .items li.off .t{border-left:3px solid ${PALETTE.line};padding-left:${(H * 0.018).toFixed(0)}px}
  .cite{margin-top:${(H * 0.05).toFixed(0)}px;font-size:${(H * 0.0205).toFixed(0)}px;color:${PALETTE.ink_dim};
    border-top:1px solid ${PALETTE.line};padding-top:${(H * 0.018).toFixed(0)}px;letter-spacing:.03em;max-width:52ch}
  .overlay{position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:center;
    padding-bottom:${(H * 0.058).toFixed(0)}px}
  .obox{background:${accent};color:#0B0D10;font-family:'Inter Display','Inter',sans-serif;font-weight:800;
    font-size:${(H * 0.0405).toFixed(0)}px;letter-spacing:-.012em;padding:${(H * 0.019).toFixed(0)}px ${(H * 0.036).toFixed(0)}px;
    max-width:${(W * 0.74).toFixed(0)}px;text-align:center;line-height:1.2;box-shadow:0 ${(H*0.018).toFixed(0)}px ${(H*0.05).toFixed(0)}px rgba(0,0,0,.5)}
  .sid{position:absolute;right:${(W * 0.03).toFixed(0)}px;bottom:${(H * 0.045).toFixed(0)}px;
    font-size:${(H * 0.017).toFixed(0)}px;color:${PALETTE.line};letter-spacing:.3em;font-weight:600}
  </style></head><body><div class="stage">
    ${backdrop(scene.motif, seed, accent, W, H)}
    <div class="grain"></div><div class="vig"></div>
    <div class="content">${body.join('')}</div>
    ${overlay}
    <div class="sid">${esc(String(scene.id || '').toUpperCase())}</div>
  </div></body></html>`;
}

module.exports = { sceneHTML, beatState, PALETTE, seedOf };
