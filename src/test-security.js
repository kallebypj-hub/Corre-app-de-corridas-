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
      // o projeto agora ocupa a raiz do repositorio
      const out = execFileSync('git', ['-C', ROOT, 'check-ignore', '-v', 'var/tokens/x.enc'], { encoding: 'utf8' });
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


  // ---------- assistente de credenciais ----------
  {
    const os = require('os');
    const auditor = require('./credentials-audit');
    const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ymc-cred-'));
    const ID = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';
    const SECRET = 'GOCSPX-chave-secreta-de-teste-abc123';
    const REDIRECT = 'http://127.0.0.1:3777/api/youtube/oauth/callback';
    const fresh = (name) => {
      const envFile = path.join(SANDBOX, `${name}.env`);
      const inbox = path.join(SANDBOX, `${name}-inbox`);
      fs.mkdirSync(inbox, { recursive: true });
      process.env.QR_ENV_FILE = envFile;
      process.env.QR_CRED_INBOX = inbox;
      for (const k of Object.keys(require.cache)) if (/src[\/\\]credentials\.js$/.test(k)) delete require.cache[k];
      return { cred: require('./credentials'), envFile, inbox };
    };

    await t('o auditor aprova o assistente de credenciais de verdade', () => {
      const a = auditor.audit();
      assert.strictEqual(a.ok, true, a.checks.filter((c) => !c.ok).map((c) => c.check).join('; '));
      assert.strictEqual(a.transmits_to.length, 0, 'o auditor admitiu destino de transmissao');
      assert.deepStrictEqual(a.requires.filter((r) => auditor.FORBIDDEN_MODULES.includes(r)), []);
    });

    await t('o auditor PEGA uma violacao plantada (prova que ele funciona)', () => {
      const copia = path.join(SANDBOX, 'credentials-violado.js');
      const src = fs.readFileSync(path.join(__dirname, 'credentials.js'), 'utf8');
      fs.writeFileSync(copia, src.replace("const os = require('os');", "const os = require('os');\nconst https = require('https');"));
      const a = auditor.audit({ target: copia });
      assert.strictEqual(a.ok, false, 'o auditor aprovou um arquivo que carrega https');
      const c = a.checks.find((x) => /transmitir/.test(x.check));
      assert.strictEqual(c.ok, false);
      assert.ok(/https/.test(c.detail));
    });

    await t('o auditor pega impressao em log plantada', () => {
      const copia = path.join(SANDBOX, 'credentials-logado.js');
      const src = fs.readFileSync(path.join(__dirname, 'credentials.js'), 'utf8');
      fs.writeFileSync(copia, src.replace('function describe(key, value) {', 'function describe(key, value) {\n  console.log(value);'));
      const a = auditor.audit({ target: copia });
      assert.strictEqual(a.ok, false, 'o auditor aprovou um arquivo que imprime o valor');
    });

    await t('gravar deixa o .env em 0600 e preserva as outras chaves', () => {
      const { cred, envFile } = fresh('a');
      fs.writeFileSync(envFile, 'PORT=3777\nAPI_KEY=nao-pode-sumir\nDEFAULT_PRIVACY_STATUS=private\n', { mode: 0o600 });
      const r = cred.write(ID, SECRET, { origin: 'teste' });
      assert.strictEqual(r.mode, '0600', `permissao ${r.mode}`);
      const txt = fs.readFileSync(envFile, 'utf8');
      assert.ok(txt.includes('API_KEY=nao-pode-sumir'), 'perdeu uma chave que ja existia');
      assert.ok(txt.includes('PORT=3777'));
      assert.ok(txt.includes(`YOUTUBE_CLIENT_ID=${ID}`));
      assert.strictEqual(r.other_keys_preserved, 3);
    });

    await t('o relatorio NAO carrega o segredo nem o ID inteiro', () => {
      const { cred } = fresh('b');
      const r = cred.write(ID, SECRET, { origin: 'teste' });
      const txt = JSON.stringify(r);
      assert.ok(!txt.includes(SECRET), 'VAZOU A CHAVE SECRETA NO RELATORIO');
      assert.ok(!txt.includes(ID), 'vazou o ID inteiro no relatorio');
      assert.strictEqual(r.secrets_disclosed, false);
      assert.strictEqual(r.keys[1].fingerprint.length, 12);
    });

    await t('o estado tambem nao revela valor', () => {
      const { cred, envFile } = fresh('c');
      cred.write(ID, SECRET, { origin: 'teste' });
      const old = { id: process.env.YOUTUBE_CLIENT_ID, s: process.env.YOUTUBE_CLIENT_SECRET };
      process.env.YOUTUBE_CLIENT_ID = ID; process.env.YOUTUBE_CLIENT_SECRET = SECRET;
      const txt = JSON.stringify(cred.status());
      if (old.id === undefined) delete process.env.YOUTUBE_CLIENT_ID; else process.env.YOUTUBE_CLIENT_ID = old.id;
      if (old.s === undefined) delete process.env.YOUTUBE_CLIENT_SECRET; else process.env.YOUTUBE_CLIENT_SECRET = old.s;
      assert.ok(!txt.includes(SECRET), 'VAZOU A CHAVE NO ESTADO');
      assert.ok(!txt.includes(ID), 'vazou o ID no estado');
      assert.ok(envFile);
    });

    await t('valor de exemplo e recusado', () => {
      const { cred } = fresh('d');
      assert.throws(() => cred.write('cole_aqui.apps.googleusercontent.com', SECRET), /exemplo/i);
      assert.throws(() => cred.write(ID, 'SEU_SEGREDO_AQUI'), /exemplo/i);
    });

    await t('ID fora do formato do Google e recusado', () => {
      const { cred } = fresh('e');
      assert.throws(() => cred.write('abc123', SECRET), /apps\.googleusercontent\.com/);
    });

    await t('chave com espaco colado e recusada', () => {
      const { cred } = fresh('f');
      assert.throws(() => cred.write(ID, 'GOCSPX-com espaco no meio'), /espaco/i);
    });

    await t('JSON do Google e importado e o arquivo de entrada e destruido', () => {
      const { cred, inbox } = fresh('g');
      const f = path.join(inbox, 'client_secret_123.json');
      fs.writeFileSync(f, JSON.stringify({ web: { client_id: ID, client_secret: SECRET,
        redirect_uris: [REDIRECT], auth_uri: 'https://accounts.google.com/o/oauth2/auth' } }));
      const r = cred.fromJsonFile(f);
      assert.strictEqual(r.written, true);
      assert.strictEqual(r.redirect_registered, true);
      assert.strictEqual(r.input_file_shredded, true);
      assert.strictEqual(fs.existsSync(f), false, 'o JSON com a chave continua na pasta');
      assert.ok(!JSON.stringify(r).includes(SECRET));
    });

    await t('JSON de Aplicativo de desktop e recusado, com o motivo', () => {
      const { cred, inbox } = fresh('h');
      const f = path.join(inbox, 'desktop.json');
      fs.writeFileSync(f, JSON.stringify({ installed: { client_id: ID, client_secret: SECRET } }));
      assert.throws(() => cred.fromJsonFile(f), /Aplicativo da Web/);
      assert.strictEqual(fs.existsSync(f), true, 'apagou um arquivo que nem usou');
    });

    await t('JSON sem a chave explica que o Google nao mostra de novo', () => {
      const { cred, inbox } = fresh('i');
      const f = path.join(inbox, 'sem-chave.json');
      fs.writeFileSync(f, JSON.stringify({ web: { client_id: ID, redirect_uris: [REDIRECT] } }));
      assert.throws(() => cred.fromJsonFile(f), /Reset Secret/i);
    });

    await t('redirect que nao esta cadastrado vira alerta, nao silencio', () => {
      const { cred, inbox } = fresh('j');
      const f = path.join(inbox, 'outro-redirect.json');
      fs.writeFileSync(f, JSON.stringify({ web: { client_id: ID, client_secret: SECRET,
        redirect_uris: ['http://localhost:8080/outro'] } }));
      const r = cred.fromJsonFile(f);
      assert.strictEqual(r.redirect_registered, false);
      assert.ok(/redirect_uri_mismatch/.test(r.redirect_note));
    });

    await t('JSON colado de uma vez tambem funciona, e nao cria arquivo', () => {
      const { cred, inbox } = fresh('l');
      const texto = JSON.stringify({ web: { client_id: ID, client_secret: SECRET, redirect_uris: [REDIRECT] } });
      const r = cred.fromJsonText(texto);
      assert.strictEqual(r.written, true);
      assert.strictEqual(r.redirect_registered, true);
      assert.strictEqual(r.origin, 'json_colado_no_terminal');
      assert.ok(!JSON.stringify(r).includes(SECRET), 'VAZOU A CHAVE');
      assert.strictEqual(fs.readdirSync(inbox).length, 0, 'o caminho colado nao deve criar arquivo nenhum');
    });

    await t('texto colado que nao e JSON da erro claro', () => {
      const { cred } = fresh('m');
      assert.throws(() => cred.fromJsonText('isso nao e json'), /selecione tudo e cole/i);
    });

    await t('JSON colado de desktop tambem e recusado', () => {
      const { cred } = fresh('n');
      assert.throws(() => cred.fromJsonText(JSON.stringify({ installed: { client_id: ID, client_secret: SECRET } })), /Aplicativo da Web/);
    });

    await t('a pasta de entrada e encontrada sozinha', () => {
      const { cred, inbox } = fresh('k');
      fs.writeFileSync(path.join(inbox, 'qualquer.json'), JSON.stringify({ web: { client_id: ID, client_secret: SECRET } }));
      fs.writeFileSync(path.join(inbox, 'nao-e-credencial.json'), JSON.stringify({ outra: 'coisa' }));
      const achados = cred.scanInbox();
      assert.strictEqual(achados.length, 1, `achou ${achados.length}`);
      assert.ok(achados[0].endsWith('qualquer.json'));
    });

    delete process.env.QR_ENV_FILE; delete process.env.QR_CRED_INBOX;
    for (const k of Object.keys(require.cache)) if (/src[\/\\]credentials\.js$/.test(k)) delete require.cache[k];
    fs.rmSync(SANDBOX, { recursive: true, force: true });
  }

  console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} aprovados, ${fail} falhas\x1b[0m`);
  if (fail) process.exit(1);
})().catch((e) => { console.error('ERRO:', e.stack || e.message); process.exit(1); });
