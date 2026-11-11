'use strict';
/** Testes de seguranca do painel: travessia de caminho, chave, exposicao e segredos. */
require('./env');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3899;
const KEY = 'chave-de-teste-com-mais-de-trinta-e-dois-caracteres';
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log(`\x1b[32m  ok\x1b[0m   ${name}`); }
  catch (e) { fail++; console.log(`\x1b[31m  FALHA\x1b[0m ${name}\n        ${e.message}`); }
}
const get = (p, headers = {}) => new Promise((res, rej) => {
  const r = http.request({ hostname: '127.0.0.1', port: PORT, path: p, method: 'GET', headers }, (x) => {
    let b = ''; x.on('data', (c) => (b += c)); x.on('end', () => res({ status: x.statusCode, body: b, headers: x.headers }));
  }); r.on('error', rej); r.end();
});
const post = (p, body, headers = {}) => new Promise((res, rej) => {
  const d = JSON.stringify(body || {});
  const r = http.request({ hostname: '127.0.0.1', port: PORT, path: p, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d), ...headers } },
    (x) => { let b = ''; x.on('data', (c) => (b += c)); x.on('end', () => res({ status: x.statusCode, body: b })); });
  r.on('error', rej); r.write(d); r.end();
});

(async () => {
  const srv = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')],
    { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', API_KEY: KEY }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 2500));
  try {
    console.log('\n— chave de acesso —');
    await t('/health responde sem chave (liveness)', async () => {
      const r = await get('/health'); assert.strictEqual(r.status, 200);
    });
    await t('leitura sem chave e recusada quando API_KEY esta definida', async () => {
      const r = await get('/api/episodes'); assert.strictEqual(r.status, 401, `veio ${r.status}`);
    });
    await t('leitura com chave certa passa', async () => {
      const r = await get('/api/episodes', { 'x-api-key': KEY }); assert.strictEqual(r.status, 200);
    });
    await t('chave errada do mesmo tamanho e recusada', async () => {
      const r = await get('/api/episodes', { 'x-api-key': KEY.slice(0, -1) + 'X' });
      assert.strictEqual(r.status, 401);
    });
    await t('escrita sem chave e recusada', async () => {
      const r = await post('/api/ceo/chat', { message: 'status' }); assert.strictEqual(r.status, 401);
    });
    await t('arquivos do episodio exigem chave', async () => {
      const r = await get('/files/ep_001/metadata.json'); assert.strictEqual(r.status, 401);
    });

    console.log('\n— travessia de caminho —');
    const attacks = [
      '/files/ep_001/../../../../etc/passwd',
      '/files/ep_001/..%2f..%2f..%2f..%2fetc%2fpasswd',
      '/files/ep_001/%2e%2e%2f%2e%2e%2f.env',
      '/files/../../../etc/passwd',
      '/files/ep_001/work/asr_align.json',
      '/files/ep_001/stills/s01/x.png',
      '/../.env',
      '/..%2f.env',
      '/%2e%2e%2f%2e%2e%2fvar%2ftokens%2f.key'
    ];
    for (const a of attacks) {
      await t(`recusa: ${a}`, async () => {
        const r = await get(a, { 'x-api-key': KEY });
        assert.ok(r.status >= 400, `passou com HTTP ${r.status}`);
        assert.ok(!/root:x:|TOKEN_ENCRYPTION_KEY|YOUTUBE_CLIENT_SECRET/.test(r.body), 'vazou conteudo sensivel');
      });
    }
    await t('arquivo legitimo do episodio continua servindo', async () => {
      const r = await get('/files/ep_001/metadata.json', { 'x-api-key': KEY });
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.includes('"title"'));
    });

    console.log('\n— segredos —');
    await t('nenhuma rota devolve token, chave ou segredo', async () => {
      for (const p of ['/api/youtube/state?live=0', '/api/integrations', '/api/publications', '/api/readiness']) {
        const r = await get(p, { 'x-api-key': KEY });
        for (const bad of ['access_token', 'refresh_token', 'TOKEN_ENCRYPTION_KEY', KEY]) {
          if (bad === 'access_token' || bad === 'refresh_token') {
            assert.ok(!new RegExp(`"${bad}"\\s*:\\s*"[^"]+"`).test(r.body), `${p} devolveu ${bad} com valor`);
          } else assert.ok(!r.body.includes(bad), `${p} vazou ${bad}`);
        }
      }
    });
    await t('o log do sistema nao contem segredo', () => {
      const lf = path.join(ROOT, 'var', 'logs', 'company.log');
      if (!fs.existsSync(lf)) return;
      const txt = fs.readFileSync(lf, 'utf8');
      for (const bad of ['YOUTUBE_CLIENT_SECRET=', 'refresh_token":"', 'TOKEN_ENCRYPTION_KEY']) assert.ok(!txt.includes(bad), `log vazou ${bad}`);
    });
    await t('permissoes: .env 0600, chave de token 0600, pasta de tokens 0700', () => {
      const mode = (p) => '0' + (fs.statSync(p).mode & 0o777).toString(8);
      assert.strictEqual(mode(path.join(ROOT, '.env')), '0600');
      const td = path.join(ROOT, 'var', 'tokens');
      if (fs.existsSync(td)) {
        assert.strictEqual(mode(td), '0700');
        const k = path.join(td, '.key');
        if (fs.existsSync(k)) assert.strictEqual(mode(k), '0600');
      }
    });
    await t('var/ inteiro esta fora do Git', () => {
      const { execFileSync } = require('child_process');
      const out = execFileSync('git', ['-C', path.join(ROOT, '..'), 'check-ignore', '-v',
        'youtube-media-company/var/tokens/x.enc'], { encoding: 'utf8' });
      assert.ok(out.includes('var/'), 'var/ nao ignorado pelo git');
    });
  } finally { srv.kill(); }

  console.log('\n— recusa de exposicao insegura —');
  await t('servidor RECUSA subir fora de loopback sem API_KEY', async () => {
    const r = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')],
      { env: { ...process.env, PORT: '3898', HOST: '0.0.0.0', API_KEY: '' }, stdio: 'ignore' });
    const code = await new Promise((rs) => r.on('exit', rs));
    assert.strictEqual(code, 1, `esperava recusa, saiu com ${code}`);
  });
  await t('servidor RECUSA HTTP puro exposto mesmo com chave', async () => {
    const r = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')],
      { env: { ...process.env, PORT: '3898', HOST: '0.0.0.0', API_KEY: KEY, TLS_TERMINATED: '', ALLOW_REMOTE_HTTP: '' }, stdio: 'ignore' });
    const code = await new Promise((rs) => r.on('exit', rs));
    assert.strictEqual(code, 1, `esperava recusa, saiu com ${code}`);
  });

  console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} aprovados, ${fail} falhas\x1b[0m`);
  if (fail) process.exit(1);
})().catch((e) => { console.error('ERRO:', e.stack || e.message); process.exit(1); });
