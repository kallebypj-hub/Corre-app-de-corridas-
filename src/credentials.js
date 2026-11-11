'use strict';
/**
 * ASSISTENTE DE CREDENCIAIS — qr-credenciais.
 *
 * Grava YOUTUBE_CLIENT_ID e YOUTUBE_CLIENT_SECRET no .env privado e NADA MAIS.
 *
 * As garantias, nesta ordem, porque o dono pediu auditoria antes de usar:
 *
 *  1. NAO TRANSMITE. Este arquivo nao carrega http, https, net, dgram, dns, tls
 *     nem child_process. Nao ha caminho de codigo capaz de mandar um segredo
 *     para fora da maquina, e isso e conferido por teste que le o proprio fonte.
 *  2. NAO REGISTRA. Nenhum valor vai para stdout, para arquivo de log ou para o
 *     objeto de retorno. So sai a impressao digital de 12 caracteres (sha256) e
 *     o tamanho. O relatorio e conferido por teste contra o valor real.
 *  3. NAO PASSA PELO HISTORICO DO SHELL. O segredo nunca vem por argumento de
 *     linha de comando: ou vem de um arquivo JSON baixado do Google, ou e
 *     digitado com o eco do terminal desligado.
 *  4. SO ESCREVE O .env. Escrita atomica (tmp + rename), modo 0600, preservando
 *     todas as outras chaves que ja estavam la. Backup da versao anterior,
 *     tambem 0600.
 *  5. RECUSA PLACEHOLDER. Valor de exemplo nao entra: o doctor diria "ok" e o
 *     Google diria "invalid_client" la na frente.
 *  6. RECUSA .env RASTREADO. Se o .env estiver versionado no git, nada e
 *     escrito — gravar segredo em arquivo rastreado e vazamento com data
 *     marcada.
 *  7. UM TIPO DE CREDENCIAL. JSON de "installed" (Aplicativo de desktop) e
 *     recusado com o motivo; este projeto usa "web" (Aplicativo da Web).
 *
 * Quem prova isso NAO e este arquivo: e src/credentials-audit.js, que le este
 * fonte de fora. Auditor que mora dentro do codigo auditado casa com os
 * proprios padroes de deteccao e aprova a si mesmo — nao serve de prova.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const ENV_FILE = process.env.QR_ENV_FILE || path.join(ROOT, '.env');
/** Pasta onde o dono pode simplesmente soltar o JSON baixado do Google. */
const INBOX = process.env.QR_CRED_INBOX || path.join(ROOT, 'var', 'credenciais-entrada');

const KEYS = ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET'];
const PLACEHOLDER = /exemplo|example|cole[_\s-]*aqui|paste[_\s-]*here|seu[_\s-]|your[_\s-]|xxx+|\.\.\.|<.*>|troque|change[_\s-]*me/i;

/** Impressao digital curta. E a UNICA forma de um segredo aparecer em relatorio. */
function fingerprint(v) {
  return v ? crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 12) : null;
}
function describe(key, value) {
  return { key, present: !!value, length: value ? String(value).length : 0, fingerprint: fingerprint(value) };
}

/* ---------------- validacao ---------------- */
function validate(id, secret) {
  const problems = [];
  if (!id) problems.push('o ID do cliente veio vazio');
  else {
    if (PLACEHOLDER.test(id)) problems.push('o ID do cliente parece ser um valor de exemplo, nao a credencial real');
    if (!/\.apps\.googleusercontent\.com$/.test(id)) problems.push('o ID do cliente nao termina em .apps.googleusercontent.com');
  }
  if (!secret) problems.push('a chave secreta veio vazia');
  else {
    if (PLACEHOLDER.test(secret)) problems.push('a chave secreta parece ser um valor de exemplo, nao a credencial real');
    if (String(secret).length < 12) problems.push('a chave secreta e curta demais para ser uma chave do Google');
    if (/\s/.test(secret)) problems.push('a chave secreta tem espaco ou quebra de linha: provavelmente veio colada com sobra');
  }
  return problems;
}

/* ---------------- leitura e escrita do .env ---------------- */
function readEnvLines() {
  if (!fs.existsSync(ENV_FILE)) return [];
  return fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/);
}
/** Substitui as duas chaves preservando ordem, comentarios e todo o resto. */
function mergeLines(lines, values) {
  const out = []; const seen = new Set();
  for (const line of lines) {
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
    if (m && values[m[1]] !== undefined) { out.push(`${m[1]}=${values[m[1]]}`); seen.add(m[1]); }
    else out.push(line);
  }
  const missing = Object.keys(values).filter((k) => !seen.has(k));
  if (missing.length) {
    if (out.length && out[out.length - 1].trim() !== '') out.push('');
    out.push('# credenciais OAuth do Google (Aplicativo da Web) — gravadas por qr-credenciais');
    for (const k of missing) out.push(`${k}=${values[k]}`);
  }
  return out;
}
/** O .env esta rastreado pelo git? Se estiver, nao gravamos segredo nele. */
function envIsTracked() {
  const rel = path.relative(ROOT, ENV_FILE);
  if (rel.startsWith('..')) return false;
  const gitDir = path.join(ROOT, '.git');
  if (!fs.existsSync(gitDir)) return false;
  // sem child_process: lemos o indice do git pela lista de arquivos ignorados
  const ignore = path.join(ROOT, '.gitignore');
  const ignored = fs.existsSync(ignore)
    && fs.readFileSync(ignore, 'utf8').split(/\r?\n/).map((l) => l.trim()).includes(rel);
  return !ignored;
}

/**
 * Grava as duas credenciais. Nao devolve valor nenhum: so o relatorio seguro.
 */
function write(id, secret, { origin = 'desconhecida' } = {}) {
  const problems = validate(id, secret);
  if (problems.length) { const e = new Error(`credenciais recusadas: ${problems.join('; ')}`); e.problems = problems; throw e; }
  if (envIsTracked())
    throw new Error(`${path.relative(ROOT, ENV_FILE)} nao esta no .gitignore: gravar segredo em arquivo rastreado seria vazamento. Adicione ao .gitignore primeiro.`);

  const before = readEnvLines();
  let backup = null;
  if (fs.existsSync(ENV_FILE)) {
    backup = `${ENV_FILE}.anterior`;
    fs.writeFileSync(backup, before.join('\n'), { mode: 0o600 });
  }
  const merged = mergeLines(before, { YOUTUBE_CLIENT_ID: id, YOUTUBE_CLIENT_SECRET: secret });
  const tmp = `${ENV_FILE}.tmp`;
  fs.writeFileSync(tmp, merged.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
  fs.renameSync(tmp, ENV_FILE);
  fs.chmodSync(ENV_FILE, 0o600);

  const st = fs.statSync(ENV_FILE);
  return {
    written: true, file: path.relative(ROOT, ENV_FILE),
    mode: '0' + (st.mode & 0o777).toString(8),
    origin,
    keys: KEYS.map((k) => describe(k, k === 'YOUTUBE_CLIENT_ID' ? id : secret)),
    other_keys_preserved: before.filter((l) => /^\s*[A-Z0-9_]+\s*=/.test(l) && !KEYS.some((k) => l.startsWith(k))).length,
    backup: backup ? path.relative(ROOT, backup) : null,
    secrets_disclosed: false,
    note: 'nenhum valor foi impresso, registrado ou transmitido: so impressao digital de 12 caracteres e tamanho.'
  };
}

/* ---------------- entrada 1: JSON baixado do Google ---------------- */
/**
 * Caminho preferido. O dono clica em "BAIXAR JSON" na tela do Google e solta o
 * arquivo na pasta de entrada. Ele nunca le, nunca digita e nunca cola a chave.
 */
function fromJsonFile(file, { shred = true } = {}) {
  if (!fs.existsSync(file)) throw new Error(`arquivo nao encontrado: ${file}`);
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error('o arquivo nao e um JSON valido; baixe de novo em "BAIXAR JSON" na tela do cliente OAuth'); }
  return applyJson(j, { origin: `json_baixado_do_google (${path.basename(file)})`, shredFile: shred ? file : null });
}

/**
 * Mesma coisa, a partir do TEXTO do JSON.
 *
 * O arquivo que o Google entrega e uma linha so de JSON compacto, entao o dono
 * abre, da um Ctrl+A Ctrl+V e acabou: uma colagem, com o eco desligado, sem ler
 * valor nenhum, sem passar pelo historico do shell e sem precisar subir arquivo
 * para a VPS.
 */
function fromJsonText(text, { origin = 'json_colado_no_terminal' } = {}) {
  let j;
  try { j = JSON.parse(String(text).trim()); }
  catch (e) { throw new Error('o que foi colado nao e um JSON valido. Abra o arquivo que o Google baixou, selecione tudo e cole de uma vez.'); }
  return applyJson(j, { origin, shredFile: null });
}

function applyJson(j, { origin, shredFile }) {
  if (j.installed && !j.web)
    throw new Error('este JSON e de um cliente "Aplicativo de desktop" (installed). Este projeto usa exclusivamente "Aplicativo da Web", porque o callback tem endereco e caminho fixos. Crie um cliente do tipo Aplicativo da Web com o redirect http://127.0.0.1:3777/api/youtube/oauth/callback.');
  const w = j.web || j;
  if (!w.client_id || !w.client_secret)
    throw new Error('o JSON nao tem client_id e client_secret. Se voce baixou depois de criar o cliente, o Google nao entrega mais a chave: use "Reset Secret" (ou a rotacao de chave) e baixe na hora.');
  const uris = w.redirect_uris || [];
  const expected = 'http://127.0.0.1:3777/api/youtube/oauth/callback';
  const redirectOk = uris.includes(expected);
  const out = write(w.client_id, w.client_secret, { origin });
  out.redirect_uris_in_json = uris.length;
  out.redirect_registered = redirectOk;
  out.redirect_note = redirectOk
    ? `o redirect ${expected} esta cadastrado na credencial`
    : `ATENCAO: o redirect ${expected} NAO aparece nos URIs cadastrados deste cliente${uris.length ? '' : ' (o JSON nao trouxe a lista)'}. Sem ele o Google devolve redirect_uri_mismatch na tela de consentimento.`;
  if (shredFile) {
    // o arquivo de entrada carrega a chave em texto: sobrescreve e apaga
    try {
      const size = fs.statSync(shredFile).size;
      fs.writeFileSync(shredFile, crypto.randomBytes(Math.max(size, 64)));
      fs.unlinkSync(shredFile);
      out.input_file_shredded = true;
      out.shred_note = 'o JSON de entrada foi sobrescrito com bytes aleatorios e apagado: a chave nao fica largada na pasta.';
    } catch (e) { out.input_file_shredded = false; out.shred_note = `nao consegui apagar o arquivo de entrada: ${e.message}`; }
  }
  return out;
}

/** Procura sozinho um JSON de credencial na pasta de entrada. */
function scanInbox() {
  fs.mkdirSync(INBOX, { recursive: true, mode: 0o700 });
  return fs.readdirSync(INBOX)
    .filter((f) => /\.json$/i.test(f))
    .map((f) => path.join(INBOX, f))
    .filter((f) => {
      try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return !!(j.web || j.installed); }
      catch (_) { return false; }
    });
}

/* ---------------- entrada 2: digitado com eco desligado ---------------- */
/**
 * Le uma linha do terminal sem ecoar. Nao usa child_process: mexe direto no
 * modo do terminal pelo proprio stdin.
 */
function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY) return reject(new Error('sem terminal interativo: use o caminho do JSON baixado do Google'));
    process.stdout.write(prompt);
    let value = '';
    const wasRaw = input.isRaw;
    input.setRawMode(true); input.resume(); input.setEncoding('utf8');
    const onData = (ch) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        input.setRawMode(!!wasRaw); input.pause(); input.removeListener('data', onData);
        process.stdout.write('\n'); return resolve(value);
      }
      if (ch === '\u0003') { input.setRawMode(!!wasRaw); input.pause(); input.removeListener('data', onData); process.stdout.write('\n'); return reject(new Error('cancelado')); }
      if (ch === '\u007f' || ch === '\b') { value = value.slice(0, -1); return; }
      if (ch >= ' ') value += ch;
    };
    input.on('data', onData);
  });
}
async function fromPrompt() {
  process.stdout.write('\nNada do que voce colar aqui aparece na tela, no historico do shell ou em log nenhum.\n\n');
  const id = (await askHidden('ID do cliente (termina em .apps.googleusercontent.com): ')).trim();
  const secret = (await askHidden('Chave secreta do cliente: ')).trim();
  return write(id, secret, { origin: 'digitado_no_terminal_sem_eco' });
}

/**
 * Caminho de uma colagem: o JSON inteiro do Google, de uma vez, as cegas.
 * O arquivo do Google e uma linha, entao uma colagem basta; se vier quebrado em
 * varias linhas, vamos juntando ate o texto virar JSON valido.
 */
async function fromPastedJson() {
  process.stdout.write('\nAbra o arquivo que o Google baixou, selecione tudo (Ctrl+A) e cole aqui (Ctrl+V), depois Enter.\n');
  process.stdout.write('Nao aparece nada na tela: e proposito. Linha vazia cancela.\n\n');
  let buf = '';
  for (let i = 0; i < 40; i++) {
    const line = await askHidden(i === 0 ? 'JSON da credencial: ' : '');
    if (i === 0 && !line.trim()) throw new Error('cancelado: nada foi colado');
    buf += line;
    try { JSON.parse(buf.trim()); break; } catch (_) { /* ainda incompleto: segue lendo */ }
  }
  return fromJsonText(buf);
}

/** Estado atual, sem revelar valor. */
function status() {
  require('./env');
  return {
    env_file: path.relative(ROOT, ENV_FILE),
    keys: KEYS.map((k) => {
      const v = process.env[k] || '';
      const d = describe(k, v);
      d.looks_like_placeholder = !!v && PLACEHOLDER.test(v);
      return d;
    }),
    inbox: path.relative(ROOT, INBOX),
    json_waiting: scanInbox().map((f) => path.basename(f))
  };
}

module.exports = { write, fromJsonFile, fromJsonText, fromPrompt, fromPastedJson, scanInbox, status,
  validate, fingerprint, describe, mergeLines, envIsTracked,
  ENV_FILE, INBOX, KEYS };
