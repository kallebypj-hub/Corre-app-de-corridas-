'use strict';
/**
 * PROVA DE QUE A BATERIA NAO DESTROI DADO.
 *
 * Tira uma impressao digital de tudo que e estado de producao (registro de
 * experimentos, tokens, uploads, estado do pipeline, artefatos dos episodios),
 * roda TODAS as suites, e confere que nada mudou. Uma versao anterior da suite
 * do YouTube apagava var/uploads inteiro no fim — isso teria destruido o
 * historico de publicacao real.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WATCHED = [
  'var/evolution', 'var/tokens', 'var/uploads', 'var/channels', 'var/budget', 'var/scheduler',
  'content/channels/ch_practical_discipline', 'config'
];
const SUITES = ['test-gates.js', 'test-youtube.js', 'test-security.js', 'test-evolution.js',
  'test-integration.js', 'test-ato4-fixes.js', 'test-independence.js', 'test.js'];

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}
function snapshot() {
  const map = {};
  for (const w of WATCHED) for (const f of walk(path.join(ROOT, w))) {
    const rel = path.relative(ROOT, f);
    // o log do sistema e o estado do agendador mudam de propósito a cada passagem
    if (/^var\/logs\//.test(rel)) continue;
    try { map[rel] = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); } catch (_) { map[rel] = 'ILEGIVEL'; }
  }
  return map;
}
function diff(a, b) {
  const removed = Object.keys(a).filter((k) => !(k in b));
  const added = Object.keys(b).filter((k) => !(k in a));
  const changed = Object.keys(a).filter((k) => k in b && a[k] !== b[k]);
  return { removed, added, changed };
}

const before = snapshot();
console.log(`\nimpressao digital de ${Object.keys(before).length} arquivo(s) de producao tirada`);
console.log('rodando a bateria inteira...\n');
const results = [];
for (const s of SUITES) {
  const args = s === 'test-independence.js' ? ['ep_001', 'ep_002'] : (s === 'test.js' ? ['ep_001'] : []);
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'src', s), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const line = (out.match(/\d+ (aprovados|bloqueios comprovados|passos ok), \d+ falhas/) || ['?'])[0];
    results.push({ suite: s, ok: true, summary: line.replace(/\x1b\[[0-9;]*m/g, '') });
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '');
    const line = (out.match(/\d+ (aprovados|bloqueios comprovados|passos ok), \d+ falhas/) || ['falhou'])[0];
    results.push({ suite: s, ok: false, summary: line.replace(/\x1b\[[0-9;]*m/g, '') });
  }
}
for (const r of results) console.log(`  ${r.ok ? '\x1b[32mok\x1b[0m   ' : '\x1b[31mFALHA\x1b[0m'} ${r.suite.padEnd(24)} ${r.summary}`);

const after = snapshot();
const d = diff(before, after);
console.log(`\nimpressao digital depois: ${Object.keys(after).length} arquivo(s)`);
console.log(`  removidos: ${d.removed.length}  adicionados: ${d.added.length}  alterados: ${d.changed.length}`);
for (const k of d.removed.slice(0, 10)) console.log(`    \x1b[31m- ${k}\x1b[0m`);
for (const k of d.changed.slice(0, 10)) console.log(`    \x1b[33m~ ${k}\x1b[0m`);
for (const k of d.added.slice(0, 10)) console.log(`    \x1b[36m+ ${k}\x1b[0m`);

const suitesFailed = results.filter((r) => !r.ok).length;
const destroyed = d.removed.length + d.changed.length;
if (destroyed) { console.log(`\n\x1b[31mA BATERIA MEXEU EM ${destroyed} ARQUIVO(S) DE PRODUCAO\x1b[0m`); process.exit(1); }
console.log(`\n\x1b[32mNenhum arquivo de producao foi removido nem alterado pela bateria.\x1b[0m`);
if (suitesFailed) { console.log(`\x1b[31m${suitesFailed} suite(s) com falha\x1b[0m`); process.exit(1); }
console.log('\x1b[32mTodas as suites passaram.\x1b[0m');
