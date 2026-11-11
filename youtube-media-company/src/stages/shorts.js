'use strict';
const fs = require('fs');
const path = require('path');
const { art, W, chCfg } = require('./editorial');
const { parseSRT, wrap, ts } = require('../render/captions');
const { cuesToASS } = require('../render/ass');
const { verticalFrameHTML } = require('../render/vertical');
const { ffmpeg, probe, regionBrightness } = require('../media');

/** Trechos escolhidos editorialmente: cada um abre e fecha sozinho. */
const SEGMENTS = [
  { id: 'short_01', scene: 's01', from: 0, to: 5, kicker: 'The trap', title: 'You already know what to do.',
    why_standalone: 'Abre nomeando o problema e fecha na frase que o espectador reconhece como propria. Nao depende de nada dito antes.' },
  { id: 'short_02', scene: 's05', from: 0, to: 6, kicker: 'Task inflation', title: 'Waiting is what makes it hard.',
    why_standalone: 'Argumento circular completo: premissa, mecanismo e conclusao dentro do proprio trecho.' },
  { id: 'short_03', scene: 's08', from: 1, to: 5, kicker: 'Corrected', title: 'The 66-day habit number is wrong.',
    why_standalone: 'Correcao factual autossuficiente, com o numero, a fonte e a ressalva no mesmo trecho.' }
];

/** Recorta as legendas para a janela do Short e devolve os cues ja relativos ao clipe. */
function shiftCues(cues, start, end) {
  const out = [];
  for (const c of cues) {
    if (c.end <= start + 0.02 || c.start >= end - 0.02) continue;
    const s = Math.max(0, c.start - start), e = Math.min(end - start, c.end - start);
    if (e - s < 0.2) continue;
    out.push({ start: s, end: e, text: c.text, lines: wrap(c.text) });
  }
  return out;
}

/** 17. Tres Shorts 1080x1920 reeditados, com legenda queimada e metadata propria. */
async function shorts({ paths, channelId, log }) {
  const tl = JSON.parse(fs.readFileSync(path.join(paths.base, 'narration_timeline.json'), 'utf8'));
  const long = path.join(paths.base, 'video_long_1080p.mp4');
  const lp = await probe(long);
  const cues = parseSRT(path.join(paths.base, 'captions.srt'));
  const c = chCfg(channelId);
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--no-sandbox', '--font-render-hinting=none'] });

  const made = []; const artifacts = []; const windows = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    for (let i = 0; i < SEGMENTS.length; i++) {
      const seg = SEGMENTS[i];
      const lines = tl.lines.filter((l) => l.scene === seg.scene && l.beat >= seg.from && l.beat <= seg.to);
      if (!lines.length) throw new Error(`segmento ${seg.id} sem falas`);
      const start = Math.max(0, lines[0].start - 0.35);
      const end = Math.min(lp.duration, lines[lines.length - 1].end + 0.75);
      const dur = end - start;
      if (dur < 12) throw new Error(`${seg.id} curto demais: ${dur.toFixed(1)}s`);
      if (dur > 59.5) throw new Error(`${seg.id} acima do limite de Short: ${dur.toFixed(1)}s`);
      for (const w of windows) if (start < w.end && end > w.start) throw new Error(`${seg.id} sobrepoe ${w.id}`);
      windows.push({ id: seg.id, start, end });

      const bg = path.join(paths.work, `${seg.id}_bg.png`);
      await page.setContent(verticalFrameHTML({ index: i, kicker: seg.kicker, title: seg.title, footer: c.working_name }), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: bg, type: 'png' });

      const segCues = shiftCues(cues, start, end);
      if (!segCues.length) throw new Error(`${seg.id} sem legenda na janela`);
      const assPath = path.join(paths.work, `${seg.id}.ass`);
      fs.writeFileSync(assPath, cuesToASS(segCues, { width: 1080, height: 1920, fontSize: 54, marginV: 430 }), 'utf8');

      const out = path.join(paths.shorts, `${seg.id}.mp4`);
      const fc = [
        `[0:v]scale=1080:1920,setsar=1[bg]`,
        `[1:v]scale=1080:-2,setsar=1[fg]`,
        `[bg][fg]overlay=0:560:shortest=1[ov]`,
        `[ov]ass='${assPath.replace(/'/g, "\\'")}'[vout]`
      ].join(';');
      await ffmpeg(['-y', '-loop', '1', '-framerate', '30', '-i', bg,
        '-ss', start.toFixed(3), '-t', dur.toFixed(3), '-i', long,
        '-filter_complex', fc, '-map', '[vout]', '-map', '1:a:0',
        '-t', dur.toFixed(3), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', out]);

      const p = await probe(out);
      if (p.video.width !== 1080 || p.video.height !== 1920) throw new Error(`${seg.id} nao esta 1080x1920`);
      if (!p.audio) throw new Error(`${seg.id} sem audio`);

      // PROVA de que a legenda foi queimada: mede a faixa de legenda num instante
      // em que ha cue ativa e compara com o mesmo recorte do fundo sem video.
      // A primeira versao deste estagio AFIRMAVA captions_burned: true sem medir —
      // e saiu Short nenhum com legenda. Agora a afirmacao vem da medicao.
      const band = { x: 0, y: 1330, w: 1080, h: 380 };
      const mid = segCues[Math.floor(segCues.length / 2)];
      const tCue = (mid.start + mid.end) / 2;
      const inCue = await regionBrightness(out, tCue, band);
      const bgBand = await regionBrightness(bg, 0, band);
      const burned = (inCue.brightFrac - bgBand.brightFrac) > 0.004;
      if (!burned) throw new Error(`${seg.id}: legenda NAO foi queimada (faixa em ${tCue.toFixed(1)}s: ${(inCue.brightFrac * 100).toFixed(2)}% de pixels claros contra ${(bgBand.brightFrac * 100).toFixed(2)}% no fundo)`);
      const meta = { short_id: seg.id, derived_from: 'ep_001 / video_long_1080p.mp4',
        source_window_s: { start: +start.toFixed(2), end: +end.toFixed(2) }, duration_s: +p.duration.toFixed(2),
        resolution: `${p.video.width}x${p.video.height}`,
        title: seg.title, kicker: seg.kicker,
        youtube_title: `${seg.title} #shorts`,
        description: `${seg.why_standalone}\n\nFrom the full essay: Why Waiting for Motivation Keeps You Stuck.\nNarrated with a synthetic voice (Kokoro-82M). All visuals generated by code.`,
        tags: ['shorts', 'discipline', 'habits', 'procrastination'],
        standalone_rationale: seg.why_standalone,
        caption_cues_in_window: segCues.length,
        captions_burned: burned,
        captions_burned_evidence: { checked_at_s: +tCue.toFixed(2), band,
          frame_bright_pixels_pct: +(inCue.brightFrac * 100).toFixed(3),
          backdrop_bright_pixels_pct: +(bgBand.brightFrac * 100).toFixed(3),
          method: 'fracao de pixels quase brancos na faixa de legenda do quadro renderizado, contra a mesma faixa do fundo sem legenda. Texto cria patamar claro; a geometria tenue do fundo nao.' },
        privacy_status: process.env.DEFAULT_PRIVACY_STATUS || 'private', made_for_kids: false,
        approval_status: 'pending' };
      W(path.join(paths.shorts, `${seg.id}.metadata.json`), meta);
      log.info(`  ${seg.id}: ${p.duration.toFixed(1)}s, ${p.video.width}x${p.video.height}, janela ${start.toFixed(1)}-${end.toFixed(1)}s`);
      made.push(meta);
      artifacts.push(art(out, 'video', `${seg.id} ${p.duration.toFixed(1)}s`), art(path.join(paths.shorts, `${seg.id}.metadata.json`), 'json'));
    }
    await page.close().catch(() => {});
  } finally { await browser.close().catch(() => {}); }
  W(path.join(paths.base, 'shorts_manifest.json'), { count: made.length, shorts: made });
  artifacts.push(art(path.join(paths.base, 'shorts_manifest.json'), 'json'));
  return { mode: 'real', outputs: made.map((m) => `shorts/${m.short_id}.mp4`), artifacts,
    notes: `${made.length} Shorts 1080x1920, janelas sem sobreposicao, legenda queimada.`, cost: { usd: 0, provider: 'local' } };
}
module.exports = { shorts, SEGMENTS };
