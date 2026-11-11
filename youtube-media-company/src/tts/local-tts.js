'use strict';
/**
 * Narracao local. Zero custo externo, zero chave de API.
 * Politica: se o TTS local falhar, a producao PARA. Nao existe caminho "simulado"
 * e nenhum provedor pago e acionado sem autorizacao do proprietario.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { Logger } = require('../log');

const PY = process.env.TTS_PYTHON || '/opt/ymc-tts/bin/python';
const WORKER = path.join(__dirname, 'kokoro_worker.py');

class LocalTTS {
  constructor({ voice = process.env.TTS_VOICE || 'am_michael', speed = 1.0 } = {}) {
    this.log = new Logger('tts');
    this.voice = voice; this.speed = speed;
    this.proc = null; this.ready = null; this.info = null;
    this.queue = new Map(); this.buf = ''; this.seq = 0;
  }
  available() { return fs.existsSync(PY) && fs.existsSync(WORKER); }
  start() {
    if (this.ready) return this.ready;
    if (!this.available()) return Promise.reject(new Error(`TTS local indisponivel: ${PY} ou worker ausente`));
    this.ready = new Promise((resolve, reject) => {
      const t0 = Date.now();
      this.proc = spawn(PY, ['-I', WORKER], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stderr = '';
      this.proc.stderr.on('data', (d) => { stderr += d.toString(); if (stderr.length > 20000) stderr = stderr.slice(-8000); });
      this.proc.on('exit', (code) => {
        const err = new Error(`worker TTS encerrou (code=${code}) ${stderr.slice(-800)}`);
        for (const [, p] of this.queue) p.reject(err);
        this.queue.clear(); this.proc = null; this.ready = null;
      });
      this.proc.stdout.on('data', (d) => {
        this.buf += d.toString();
        let i;
        while ((i = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
          if (!line) continue;
          let m; try { m = JSON.parse(line); } catch (_) { continue; }
          if (m.ready !== undefined) {
            if (m.ready) { this.info = { ...m, bootMs: Date.now() - t0 }; this.log.info(`TTS local pronto em ${((Date.now() - t0) / 1000).toFixed(1)}s`, { engine: m.engine, license: m.license }); resolve(this.info); }
            else reject(new Error(`TTS local falhou ao iniciar: ${m.error}`));
            continue;
          }
          const p = this.queue.get(m.id);
          if (!p) continue;
          this.queue.delete(m.id);
          m.ok ? p.resolve(m) : p.reject(new Error(`TTS falhou: ${m.error}`));
        }
      });
      setTimeout(() => { if (!this.info) reject(new Error(`TTS local nao respondeu em 300s. stderr: ${stderr.slice(-600)}`)); }, 300000);
    });
    return this.ready;
  }
  /** Sintetiza UMA fala e devolve a duracao REAL medida em amostras. */
  async say(text, outPath, opts = {}) {
    await this.start();
    const id = 'j' + (++this.seq);
    const job = { id, text, out: outPath, voice: opts.voice || this.voice, speed: opts.speed || this.speed };
    return new Promise((resolve, reject) => {
      this.queue.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify(job) + '\n');
      setTimeout(() => { if (this.queue.has(id)) { this.queue.delete(id); reject(new Error(`timeout sintetizando: ${text.slice(0, 60)}`)); } }, 180000);
    });
  }
  stop() { try { this.proc && this.proc.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n'); } catch (_) {} try { this.proc && this.proc.kill(); } catch (_) {} this.proc = null; this.ready = null; }
}
module.exports = { LocalTTS, TTS_PYTHON: PY };
