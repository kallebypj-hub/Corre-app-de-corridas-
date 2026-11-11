'use strict';
const fs = require('fs');
const path = require('path');
const { art, W, chCfg } = require('./editorial');
const cfg = require('../episode-config');
const { declare } = require('../autonomy');
const { parseSRT, wrap, ts } = require('../render/captions');
const { cuesToASS } = require('../render/ass');
const { verticalFrameHTML } = require('../render/vertical');
const { ffmpeg, probe, regionBrightness } = require('../media');

/**
 * Os trechos vem do BRIEF do episodio (decisao editorial, assistida).
 * O corte, o 9:16, a legenda queimada e a verificacao sao automaticos.
 */
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
async function shorts({ paths, channelId, epId, log }) {
  const brief = cfg.loadBrief(channelId, epId);
  const SEGMENTS = brief.shorts;
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
      // Amostra a cue mais LONGA: e onde a legenda cobre mais pixels, entao o
      // sinal e mais forte. Medir uma cue curta demais fazia o teste raspar no
      // limiar e reprovar legenda que estava la.
      const probeCue = segCues.reduce((a2, c2) => (c2.text.length > a2.text.length ? c2 : a2), segCues[0]);
      const tCue = (probeCue.start + probeCue.end) / 2;
      const inCue = await regionBrightness(out, tCue, band);
      const bgBand = await regionBrightness(bg, 0, band);
      const delta = inCue.brightFrac - bgBand.brightFrac;
      // piso logo acima do ruido: o fundo nesta faixa mede 0,00% de pixels claros
      const burned = delta > 0.0015;
      if (!burned) throw new Error(`${seg.id}: legenda NAO foi queimada (faixa em ${tCue.toFixed(1)}s, cue "${probeCue.text.slice(0, 40)}": ${(inCue.brightFrac * 100).toFixed(3)}% de pixels claros contra ${(bgBand.brightFrac * 100).toFixed(3)}% no fundo)`);
      const meta = { short_id: seg.id, derived_from: `${epId} / video_long_1080p.mp4`,
        source_window_s: { start: +start.toFixed(2), end: +end.toFixed(2) }, duration_s: +p.duration.toFixed(2),
        resolution: `${p.video.width}x${p.video.height}`,
        title: seg.title, kicker: seg.kicker,
        youtube_title: `${seg.title} #shorts`,
        parent_title: brief.metadata.title,
        description: [seg.why_standalone, '',
          `From the full essay: ${brief.metadata.title}.`,
          ...(brief.metadata.closing_notes || [])].join('\n'),
        tags: ['shorts'].concat((brief.metadata.tags || []).slice(0, 4)),
        standalone_rationale: seg.why_standalone,
        caption_cues_in_window: segCues.length,
        captions_burned: burned,
        captions_burned_evidence: { checked_at_s: +tCue.toFixed(2), band,
          probe_cue: probeCue.text, probe_cue_chars: probeCue.text.length,
          delta_pct: +(delta * 100).toFixed(3), threshold_pct: 0.15,
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
  return { mode: 'real', autonomy: declare('shorts'), outputs: made.map((m) => `shorts/${m.short_id}.mp4`), artifacts,
    notes: `${made.length} Shorts 1080x1920, janelas sem sobreposicao, legenda queimada.`, cost: { usd: 0, provider: 'local' } };
}
module.exports = { shorts };
