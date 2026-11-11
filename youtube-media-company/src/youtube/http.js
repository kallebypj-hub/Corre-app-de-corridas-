'use strict';
/**
 * Cliente HTTPS minimo para as APIs do Google. Sem framework.
 * Regra dura: NENHUM cabecalho de autorizacao e registrado em log, nem em erro.
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');

const REDACT = new Set(['authorization', 'x-goog-api-key', 'cookie', 'set-cookie']);
function safeHeaders(h) {
  const o = {};
  for (const [k, v] of Object.entries(h || {})) o[k] = REDACT.has(k.toLowerCase()) ? '[REDACTED]' : v;
  return o;
}
/** Remove segredos de qualquer texto antes de virar mensagem de erro ou log. */
function scrub(text) {
  return String(text == null ? '' : text)
    .replace(/("?(?:access_token|refresh_token|id_token|client_secret|code)"?\s*[:=]\s*")[^"]+(")/gi, '$1[REDACTED]$2')
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:access_token|refresh_token|code|client_secret)=)[^&\s]+/gi, '$1[REDACTED]');
}

function request(url, { method = 'GET', headers = {}, body = null, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request({
      protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search, method, headers
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, text, json, buffer: buf });
      });
    });
    req.on('error', (e) => reject(new Error(scrub(e.message))));
    req.setTimeout(timeout, () => { req.destroy(new Error(`timeout apos ${timeout}ms em ${u.hostname}${u.pathname}`)); });
    if (body) req.write(body);
    req.end();
  });
}
/** Erro de API do Google sem vazar segredo. */
function apiError(prefix, res) {
  const detail = (res.json && res.json.error && (res.json.error.message || res.json.error))
    || (res.text || '').slice(0, 400);
  return new Error(`${prefix} [HTTP ${res.status}] ${scrub(typeof detail === 'string' ? detail : JSON.stringify(detail))}`);
}
const ENDPOINTS = {
  auth: process.env.GOOGLE_AUTH_BASE || 'https://accounts.google.com/o/oauth2/v2/auth',
  token: process.env.GOOGLE_TOKEN_BASE || 'https://oauth2.googleapis.com/token',
  revoke: process.env.GOOGLE_REVOKE_BASE || 'https://oauth2.googleapis.com/revoke',
  tokeninfo: process.env.GOOGLE_TOKENINFO_BASE || 'https://oauth2.googleapis.com/tokeninfo',
  api: process.env.GOOGLE_API_BASE || 'https://www.googleapis.com',
  upload: process.env.GOOGLE_UPLOAD_BASE || 'https://www.googleapis.com/upload'
};
module.exports = { request, apiError, safeHeaders, scrub, ENDPOINTS };
