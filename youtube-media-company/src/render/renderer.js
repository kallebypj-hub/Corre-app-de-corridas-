'use strict';
/**
 * Renderizador de cena: Playwright captura frames-chave (um por beat, em 2560x1440)
 * e o FFmpeg produz MOVIMENTO REAL de camera (zoompan continuo) com revelacao de
 * texto em batidas sincronizadas a narracao. Nada de still parado por 30 segundos.
 * Cada cena e um arquivo independente -> remontagem por cena sem refazer o resto.
 */
const fs = require('fs');
const path = require('path');
const { sceneHTML } = require('./compose');
const { ffmpeg, probe } = require('../media');
const { Logger } = require('../log');

const SRC_W = 2560, SRC_H = 1440;
const OUT_W = Number(process.env.RENDER_WIDTH || 1920);
const OUT_H = Number(process.env.RENDER_HEIGHT || 1080);
const FPS = Number(process.env.RENDER_FPS || 30);
const CRF = String(process.env.RENDER_CRF || 20);
const PRESET = process.env.RENDER_PRESET || 'medium';
const FADE = 0.4;

/** Planos de camera, alternados por cena para evitar repeticao de linguagem. */
const MOTION = [
  { name: 'push_in',      z: [1.00, 1.075], px: [0.5, 0.52], py: [0.5, 0.48] },
  { name: 'drift_right',  z: [1.055, 1.055], px: [0.36, 0.64], py: [0.5, 0.5] },
  { name: 'pull_out',     z: [1.08, 1.005], px: [0.52, 0.5], py: [0.47, 0.5] },
  { name: 'drift_up',     z: [1.05, 1.05], px: [0.5, 0.5], py: [0.66, 0.36] },
  { name: 'push_diag',    z: [1.005, 1.085], px: [0.42, 0.58], py: [0.58, 0.44] },
  { name: 'drift_left',   z: [1.06, 1.06], px: [0.64, 0.36], py: [0.5, 0.5] },
  { name: 'slow_push',    z: [1.02, 1.06], px: [0.5, 0.5], py: [0.52, 0.48] },
  { name: 'pull_diag',    z: [1.085, 1.01], px: [0.6, 0.46], py: [0.42, 0.54] },
  { name: 'drift_down',   z: [1.045, 1.045], px: [0.5, 0.5], py: [0.34, 0.64] },
  { name: 'final_push',   z: [1.0, 1.1], px: [0.5, 0.5], py: [0.5, 0.5] }
];
function motionFor(i) { return MOTION[i % MOTION.length]; }

class SceneRenderer {
  constructor() { this.log = new Logger('render'); this.browser = null; }
  async browserOpen() {
    if (this.browser) return this.browser;
    const { chromium } = require('playwright');
    this.browser = await chromium.launch({ args: ['--no-sandbox', '--font-render-hinting=none', '--disable-lcd-text'] });
    return this.browser;
  }
  async close() { if (this.browser) { await this.browser.close().catch(() => {}); this.browser = null; } }

  /** Um PNG por beat. Congela animacoes para o still sair totalmente renderizado. */
  async captureStills(scene, dir) {
    fs.mkdirSync(dir, { recursive: true });
    const browser = await this.browserOpen();
    const page = await browser.newPage({ viewport: { width: SRC_W, height: SRC_H }, deviceScaleFactor: 1 });
    const out = [];
    try {
      for (let i = 0; i < scene.beats.length; i++) {
        await page.setContent(sceneHTML(scene, i, { width: SRC_W, height: SRC_H }), { waitUntil: 'load' });
        await page.addStyleTag({ content: '*{transition:none !important;animation:none !important}' });
        await page.evaluate(() => document.fonts.ready);
        const p = path.join(dir, `${scene.id}_b${String(i).padStart(2, '0')}.png`);
        await page.screenshot({ path: p, type: 'png' });
        out.push(p);
      }
    } finally { await page.close().catch(() => {}); }
    return out;
  }

  /**
   * Converte um still num clipe com movimento de camera, seguindo o trecho
   * [p0,p1] da trajetoria global da cena (camera continua entre beats).
   */
  _zoompanExpr(m, p0, p1, frames) {
    const lerp = (a, b, t) => a + (b - a) * t;
    const z0 = lerp(m.z[0], m.z[1], p0), z1 = lerp(m.z[0], m.z[1], p1);
    const cx0 = lerp(m.px[0], m.px[1], p0), cx1 = lerp(m.px[0], m.px[1], p1);
    const cy0 = lerp(m.py[0], m.py[1], p0), cy1 = lerp(m.py[0], m.py[1], p1);
    const n = Math.max(1, frames - 1);
    const t = `(on/${n})`;
    const z = `(${z0.toFixed(5)}+(${(z1 - z0).toFixed(5)})*${t})`;
    const cx = `(${cx0.toFixed(5)}+(${(cx1 - cx0).toFixed(5)})*${t})`;
    const cy = `(${cy0.toFixed(5)}+(${(cy1 - cy0).toFixed(5)})*${t})`;
    // x,y = canto superior esquerdo do recorte, centrado em (cx,cy) e preso dentro do quadro
    const x = `max(0\\,min(iw-iw/zoom\\,iw*${cx}-(iw/zoom)/2))`;
    const y = `max(0\\,min(ih-ih/zoom\\,ih*${cy}-(ih/zoom)/2))`;
    return `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${OUT_W}x${OUT_H}:fps=${FPS}`;
  }

  /**
   * Monta a cena: beats com duracao propria, camera continua e crossfade entre beats.
   * sceneDuration e a duracao REAL do audio da cena (sincronia por construcao).
   */
  async renderScene({ scene, sceneIndex, stills, beatNatural, sceneDuration, outPath, workDir }) {
    const n = stills.length;
    const m = motionFor(sceneIndex);
    const rawFade = n > 1 ? Math.min(FADE, Math.min(...beatNatural) * 0.5) : 0;
    const fadeFrames = Math.round(rawFade * FPS);
    const fade = fadeFrames / FPS;

    // Agendamento em FRAMES INTEIROS: a soma dos frames dos beats e exatamente
    // a duracao do audio da cena, entao o encadeamento de crossfades nao acumula
    // erro de arredondamento e o video casa com o audio sem deriva.
    const totalFrames = Math.round(sceneDuration * FPS);
    const sumNat = beatNatural.reduce((a, b) => a + b, 0);
    const beatFrames = []; let allocated = 0;
    for (let i = 0; i < n; i++) {
      if (i === n - 1) beatFrames.push(Math.max(fadeFrames + 1, totalFrames - allocated));
      else { const f = Math.max(fadeFrames + 1, Math.round((beatNatural[i] / sumNat) * totalFrames)); beatFrames.push(f); allocated += f; }
    }
    // clipe i dura beatFrames[i] + fade (menos o ultimo), para que o encadeamento devolva totalFrames
    const clipFrames = beatFrames.map((f, i) => (i < n - 1 ? f + fadeFrames : f));
    const cumFrames = []; let acc = 0;
    for (const f of beatFrames) { cumFrames.push(acc); acc += f; }

    const clips = [];
    fs.mkdirSync(workDir, { recursive: true });
    for (let i = 0; i < n; i++) {
      const frames = clipFrames[i];
      const p0 = Math.min(1, cumFrames[i] / totalFrames);
      const p1 = Math.min(1, (cumFrames[i] + frames) / totalFrames);
      const clip = path.join(workDir, `${scene.id}_clip${String(i).padStart(2, '0')}.mp4`);
      await ffmpeg(['-y', '-loop', '1', '-framerate', String(FPS), '-t', ((frames + 2) / FPS).toFixed(4), '-i', stills[i],
        '-vf', `${this._zoompanExpr(m, p0, p1, frames)},format=yuv420p`,
        '-frames:v', String(frames), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16',
        '-pix_fmt', 'yuv420p', '-r', String(FPS), clip]);
      const cp = await probe(clip);
      if (cp.video.nb_frames && Number(cp.video.nb_frames) !== frames)
        throw new Error(`clipe ${scene.id}#${i}: ${cp.video.nb_frames} frames, esperado ${frames}`);
      clips.push(clip);
    }

    if (n === 1) {
      await ffmpeg(['-y', '-i', clips[0], '-c:v', 'libx264', '-preset', PRESET, '-crf', CRF, '-pix_fmt', 'yuv420p', '-r', String(FPS), outPath]);
    } else {
      const args = ['-y']; clips.forEach((c) => args.push('-i', c));
      const f = []; let prev = '[0:v]';
      for (let i = 1; i < n; i++) {
        const offset = (cumFrames[i] / FPS).toFixed(4);
        const out = `[v${i}]`;
        f.push(`${prev}[${i}:v]xfade=transition=fade:duration=${fade.toFixed(4)}:offset=${offset}${out}`);
        prev = out;
      }
      f.push(`${prev}format=yuv420p,fps=${FPS}[vout]`);
      args.push('-filter_complex', f.join(';'), '-map', '[vout]', '-frames:v', String(totalFrames),
        '-c:v', 'libx264', '-preset', PRESET, '-crf', CRF, '-pix_fmt', 'yuv420p', '-r', String(FPS), outPath);
      await ffmpeg(args);
    }
    for (const c of clips) { try { fs.unlinkSync(c); } catch (_) {} }
    const info = await probe(outPath);
    return { path: outPath, motion: m.name, beats: n, fade, frames: totalFrames, probe: info };
  }
}
module.exports = { SceneRenderer, OUT_W, OUT_H, FPS, CRF, PRESET, MOTION, motionFor, FADE };
