'use strict';
const fs = require('fs');
const path = require('path');
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = LEVELS[process.env.LOG_LEVEL || 'info'] || 20;
const LOG_DIR = path.join(__dirname, '..', 'var', 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const FILE = path.join(LOG_DIR, 'company.log');
const C = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', reset: '\x1b[0m' };

function emit(level, scope, msg, extra) {
  if (LEVELS[level] < MIN) return;
  const ts = new Date().toISOString();
  const line = { ts, level, scope, msg, ...(extra ? { extra } : {}) };
  try { fs.appendFileSync(FILE, JSON.stringify(line) + '\n'); } catch (_) {}
  const head = `${C[level]}${level.toUpperCase().padEnd(5)}${C.reset} ${C.debug}${ts.slice(11, 19)}${C.reset} [${scope}]`;
  process.stdout.write(`${head} ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}\n`);
}
class Logger {
  constructor(scope) { this.scope = scope; }
  debug(m, e) { emit('debug', this.scope, m, e); }
  info(m, e) { emit('info', this.scope, m, e); }
  warn(m, e) { emit('warn', this.scope, m, e); }
  error(m, e) { emit('error', this.scope, m, e); }
}
module.exports = { Logger, LOG_FILE: FILE };
