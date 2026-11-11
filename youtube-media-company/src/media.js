'use strict';
/** Sonda de midia real: ffprobe + ffmpeg. Nenhuma metrica estimada. */
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const execFileAsync = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

async function ffmpeg(args, { timeout = 1000 * 60 * 30 } = {}) {
  return execFileAsync(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 64 * 1024 * 1024, timeout });
}
async function ffprobeJson(file) {
  const { stdout } = await execFileAsync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(stdout);
}
async function probe(file) {
  if (!fs.existsSync(file)) throw new Error(`arquivo inexistente: ${file}`);
  const j = await ffprobeJson(file);
  const v = (j.streams || []).find((s) => s.codec_type === 'video') || null;
  const a = (j.streams || []).find((s) => s.codec_type === 'audio') || null;
  const dur = Number(j.format && j.format.duration) || (v && Number(v.duration)) || (a && Number(a.duration)) || 0;
  return {
    file, size: Number(j.format && j.format.size) || fs.statSync(file).size,
    duration: dur, format: (j.format && j.format.format_name) || null,
    video: v ? { codec: v.codec_name, profile: v.profile || null, width: v.width, height: v.height,
      fps: ratio(v.r_frame_rate), pix_fmt: v.pix_fmt, nb_frames: v.nb_frames ? Number(v.nb_frames) : null } : null,
    audio: a ? { codec: a.codec_name, sample_rate: Number(a.sample_rate) || null, channels: a.channels,
      bit_rate: a.bit_rate ? Number(a.bit_rate) : null } : null
  };
}
function ratio(r) { if (!r) return null; const [n, d] = String(r).split('/').map(Number); return d ? +(n / d).toFixed(3) : n; }

/** Decodifica o arquivo inteiro para o nada. Prova que os frames/amostras existem de verdade. */
async function fullDecodeCheck(file) {
  const t0 = Date.now();
  try {
    const { stderr } = await execFileAsync(FFMPEG, ['-hide_banner', '-v', 'error', '-xerror', '-i', file, '-f', 'null', '-'], { maxBuffer: 32 * 1024 * 1024, timeout: 1000 * 60 * 20 });
    return { ok: true, ms: Date.now() - t0, stderr: String(stderr || '').trim().slice(0, 2000) };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, stderr: String(e.stderr || e.message).slice(0, 2000) };
  }
}
/** Mede volume real (detecta faixa muda ou com clipping). */
async function audioStats(file) {
  try {
    const { stderr } = await execFileAsync(FFMPEG, ['-hide_banner', '-i', file, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'], { maxBuffer: 16 * 1024 * 1024, timeout: 1000 * 60 * 15 });
    const s = String(stderr || '');
    const g = (re) => { const m = s.match(re); return m ? Number(m[1]) : null; };
    return { mean_volume_db: g(/mean_volume:\s*(-?[\d.]+) dB/), max_volume_db: g(/max_volume:\s*(-?[\d.]+) dB/) };
  } catch (e) {
    const s = String(e.stderr || '');
    const g = (re) => { const m = s.match(re); return m ? Number(m[1]) : null; };
    const r = { mean_volume_db: g(/mean_volume:\s*(-?[\d.]+) dB/), max_volume_db: g(/max_volume:\s*(-?[\d.]+) dB/) };
    if (r.mean_volume_db === null) throw e;
    return r;
  }
}
/** Conta frames nao-negros: pega amostras do video e rejeita render vazio/placeholder. */
async function blackFrameRatio(file, duration) {
  try {
    const { stderr } = await execFileAsync(FFMPEG, ['-hide_banner', '-i', file, '-vf', 'blackdetect=d=0.5:pix_th=0.10', '-an', '-f', 'null', '-'], { maxBuffer: 16 * 1024 * 1024, timeout: 1000 * 60 * 20 });
    const s = String(stderr || '');
    let black = 0;
    for (const m of s.matchAll(/black_duration:(\d+(?:\.\d+)?)/g)) black += Number(m[1]);
    return { black_seconds: +black.toFixed(2), black_ratio: duration ? +(black / duration).toFixed(4) : null };
  } catch (_) { return { black_seconds: null, black_ratio: null }; }
}
/**
 * Brilho medio (0..1) de uma regiao do quadro num instante. Serve para PROVAR
 * que algo foi desenhado ali — por exemplo, que a legenda foi mesmo queimada.
 * Le os bytes do quadro em escala de cinza; nao depende de nenhuma outra ferramenta.
 */
async function regionBrightness(file, timeSec, { x, y, w, h }) {
  const { execFile } = require('child_process');
  return new Promise((resolve, reject) => {
    const p = execFile(FFMPEG, ['-hide_banner', '-v', 'error', '-ss', String(timeSec), '-i', file,
      '-frames:v', '1', '-vf', `crop=${w}:${h}:${x}:${y},format=gray`, '-f', 'rawvideo', '-'],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(err);
        const b = stdout;
        if (!b || !b.length) return reject(new Error('sem bytes de quadro'));
        let sum = 0, max = 0, bright = 0;
        for (let i = 0; i < b.length; i++) { sum += b[i]; if (b[i] > max) max = b[i]; if (b[i] > 191) bright++; }
        // brightFrac = fracao de pixels quase brancos. Texto produz um patamar
        // claro; linha de fundo tenue, nao. E o sinal mais confiavel para provar
        // que ha tipografia desenhada numa faixa.
        resolve({ mean: +(sum / b.length / 255).toFixed(5), max: +(max / 255).toFixed(4),
          brightFrac: +(bright / b.length).toFixed(5), pixels: b.length });
      });
    p.on('error', reject);
  });
}
module.exports = { ffmpeg, ffprobeJson, probe, fullDecodeCheck, audioStats, blackFrameRatio, regionBrightness, FFMPEG, FFPROBE };
