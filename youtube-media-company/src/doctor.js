'use strict';
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const execFileAsync = promisify(execFile);
async function v(cmd, args) { try { const { stdout, stderr } = await execFileAsync(cmd, args); return String(stdout || stderr).split('\n')[0]; } catch (_) { return null; } }
async function checkEnv() {
  const { TTS_PYTHON } = require('./tts/local-tts');
  return {
    host: { platform: os.platform(), release: os.release(), cpus: os.cpus().length, cpu: (os.cpus()[0] || {}).model,
      mem_gb: +(os.totalmem() / 1073741824).toFixed(1), free_mem_gb: +(os.freemem() / 1073741824).toFixed(1) },
    node: process.version,
    ffmpeg: await v('ffmpeg', ['-version']), ffprobe: await v('ffprobe', ['-version']),
    playwright: (() => { try { require('playwright'); return 'disponivel'; } catch (e) { return 'AUSENTE: ' + e.message; } })(),
    tts_python: fs.existsSync(TTS_PYTHON) ? TTS_PYTHON : 'AUSENTE',
    kokoro: await v(TTS_PYTHON, ['-c', 'import kokoro;print("kokoro",kokoro.__version__)']),
    faster_whisper: await v(TTS_PYTHON, ['-c', 'import faster_whisper;print("faster-whisper ok")']),
    external_spend_limit_usd: Number(process.env.EXTERNAL_SPEND_LIMIT_USD || 0),
    youtube_oauth: (process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET) ? 'configurado' : 'NAO CONFIGURADO (publicacao e analytics BLOQUEADOS)'
  };
}
module.exports = { checkEnv };
