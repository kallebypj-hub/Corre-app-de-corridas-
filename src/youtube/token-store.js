'use strict';
/**
 * Tokens em repouso, cifrados com AES-256-GCM.
 *
 * - chave: TOKEN_ENCRYPTION_KEY (64 hex) do .env; se ausente, gera uma e grava
 *   em var/tokens/.key com permissao 0600. A chave nunca aparece em log nem em API.
 * - arquivo de token: 0600, diretorio 0700.
 * - NADA aqui devolve token para a camada HTTP do painel. Quem precisa do token
 *   e o cliente da API, nao o navegador.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', '..', 'var', 'tokens');
const KEY_FILE = path.join(DIR, '.key');

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(DIR, 0o700); } catch (_) {}
}
function key() {
  const fromEnv = process.env.TOKEN_ENCRYPTION_KEY;
  if (fromEnv) {
    const b = Buffer.from(String(fromEnv).trim(), 'hex');
    if (b.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY precisa ter 64 caracteres hexadecimais (32 bytes)');
    return b;
  }
  ensureDir();
  if (fs.existsSync(KEY_FILE)) return Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
  const k = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, k.toString('hex'), { mode: 0o600 });
  try { fs.chmodSync(KEY_FILE, 0o600); } catch (_) {}
  return k;
}
function file(channelId) { return path.join(DIR, `${channelId}.enc`); }

function save(channelId, data) {
  ensureDir();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final()]);
  const payload = Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
  const p = file(channelId);
  fs.writeFileSync(p, payload, { mode: 0o600 });
  try { fs.chmodSync(p, 0o600); } catch (_) {}
  return p;
}
function load(channelId) {
  const p = file(channelId);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = Buffer.from(fs.readFileSync(p, 'utf8'), 'base64');
    const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), enc = raw.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString('utf8'));
  } catch (e) {
    // arquivo adulterado ou chave trocada: trata como ausencia de token, nunca como token valido
    return { __corrupt: true, reason: e.message };
  }
}
function clear(channelId) { const p = file(channelId); if (fs.existsSync(p)) fs.unlinkSync(p); return true; }
function exists(channelId) { return fs.existsSync(file(channelId)); }
/** Visao segura para o painel: diz o que existe, nunca o valor. */
function describe(channelId) {
  const t = load(channelId);
  if (!t) return { present: false };
  if (t.__corrupt) return { present: true, usable: false, reason: 'arquivo de token ilegivel (chave trocada ou adulterado)' };
  return { present: true, usable: true,
    has_refresh_token: !!t.refresh_token, scopes: t.scope ? String(t.scope).split(' ') : [],
    expires_at: t.expires_at || null, obtained_at: t.obtained_at || null,
    channel_title: t.channel_title || null, channel_id_youtube: t.channel_id_youtube || null,
    access_token: undefined, refresh_token: undefined };
}
function fileMode(channelId) {
  const p = file(channelId);
  if (!fs.existsSync(p)) return null;
  return '0' + (fs.statSync(p).mode & 0o777).toString(8);
}
module.exports = { save, load, clear, exists, describe, file, DIR, fileMode };
