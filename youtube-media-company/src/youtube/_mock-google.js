'use strict';
/**
 * ESPELHO DO GOOGLE — SOMENTE PARA TESTE.
 *
 * Isto NAO e uma integracao e nao prova que o YouTube aceitou nada. Serve para
 * exercitar o NOSSO cliente: troca de codigo, refresh, 401, sessao retomavel,
 * 308, interrupcao no meio, revogacao e consulta de video. O aperto de mao real
 * com o Google so acontece quando o dono autorizar com as credenciais dele.
 */
const http = require('http');
const { URL } = require('url');

function start({ port = 0, behavior = {} } = {}) {
  const st = {
    codes: new Map(), access: new Map(), refresh: new Map(), sessions: new Map(), videos: new Map(),
    revoked: new Set(), calls: [], seq: 0,
    forceInterruptAt: behavior.forceInterruptAt || null,   // byte a partir do qual corta a conexao uma vez
    expireSessionOnce: behavior.expireSessionOnce || false,
    interrupted: false, expired: false,
    clientId: behavior.clientId || 'CLIENT_ID_TESTE',
    clientSecret: behavior.clientSecret || 'CLIENT_SECRET_TESTE'
  };
  const json = (res, code, obj, headers = {}) => {
    const b = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b), ...headers });
    res.end(b);
  };
  const readBody = (req) => new Promise((r) => { const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => r(Buffer.concat(c))); });

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    st.calls.push({ method: req.method, path: u.pathname });
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');

    if (u.pathname === '/token' && req.method === 'POST') {
      const p = new URLSearchParams((await readBody(req)).toString());
      if (p.get('client_id') !== st.clientId || p.get('client_secret') !== st.clientSecret)
        return json(res, 401, { error: 'invalid_client', error_description: 'credenciais do cliente invalidas' });
      if (p.get('grant_type') === 'authorization_code') {
        const code = p.get('code');
        if (!st.codes.has(code)) return json(res, 400, { error: 'invalid_grant', error_description: 'codigo invalido ou ja usado' });
        st.codes.delete(code);
        const at = 'AT_' + (++st.seq), rt = 'RT_' + st.seq;
        st.access.set(at, { exp: Date.now() + 3600000 }); st.refresh.set(rt, true);
        return json(res, 200, { access_token: at, refresh_token: rt, expires_in: 3600, token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly' });
      }
      if (p.get('grant_type') === 'refresh_token') {
        const rt = p.get('refresh_token');
        if (!st.refresh.has(rt) || st.revoked.has(rt)) return json(res, 400, { error: 'invalid_grant', error_description: 'refresh token revogado' });
        const at = 'AT_' + (++st.seq);
        st.access.set(at, { exp: Date.now() + 3600000 });
        return json(res, 200, { access_token: at, expires_in: 3600, token_type: 'Bearer' });
      }
      return json(res, 400, { error: 'unsupported_grant_type' });
    }
    if (u.pathname === '/revoke' && req.method === 'POST') {
      const p = new URLSearchParams((await readBody(req)).toString());
      const t = p.get('token');
      if (!t) return json(res, 400, { error: 'invalid_token' });
      st.revoked.add(t); st.access.delete(t); st.refresh.delete(t);
      return json(res, 200, {});
    }
    if (u.pathname === '/youtube/v3/channels') {
      const a = st.access.get(bearer);
      if (!a || a.exp < Date.now()) return json(res, 401, { error: { code: 401, message: 'Invalid Credentials' } });
      return json(res, 200, { items: [{ id: 'UC_TESTE_123', snippet: { title: 'Canal de Teste' },
        contentDetails: { relatedPlaylists: { uploads: 'UU_TESTE_123' } }, status: {} }] });
    }
    if (u.pathname === '/youtube/v3/videos' && req.method === 'GET') {
      const a = st.access.get(bearer);
      if (!a) return json(res, 401, { error: { code: 401, message: 'Invalid Credentials' } });
      const id = u.searchParams.get('id');
      const v = st.videos.get(id);
      return json(res, 200, { items: v ? [{ id, status: { privacyStatus: v.privacy, uploadStatus: 'uploaded' },
        snippet: { title: v.title, publishedAt: v.at }, processingDetails: { processingStatus: 'succeeded' } }] : [] });
    }
    if (u.pathname === '/upload/youtube/v3/videos' && req.method === 'POST') {
      const a = st.access.get(bearer);
      if (!a || a.exp < Date.now()) return json(res, 401, { error: { code: 401, message: 'Invalid Credentials' } });
      const meta = JSON.parse((await readBody(req)).toString());
      const total = Number(req.headers['x-upload-content-length'] || 0);
      const sid = 'sess_' + (++st.seq);
      st.sessions.set(sid, { total, received: 0, meta, dead: false });
      return json(res, 200, {}, { Location: `http://127.0.0.1:${server.address().port}/upload/session/${sid}` });
    }
    const m = u.pathname.match(/^\/upload\/session\/(\w+)$/);
    if (m && req.method === 'PUT') {
      const s = st.sessions.get(m[1]);
      if (!s || s.dead) return json(res, 404, { error: { code: 404, message: 'sessao expirada' } });
      const cr = String(req.headers['content-range'] || '');
      if (/^bytes \*\//.test(cr)) { // consulta de progresso
        if (s.received >= s.total && s.videoId) return json(res, 200, { id: s.videoId, status: { privacyStatus: 'private' } });
        res.writeHead(308, { Range: `bytes=0-${Math.max(0, s.received - 1)}` }); return res.end();
      }
      const body = await readBody(req);
      const mm = cr.match(/bytes (\d+)-(\d+)\/(\d+)/);
      if (!mm) return json(res, 400, { error: { code: 400, message: 'Content-Range ausente' } });
      const start = Number(mm[1]);
      if (start !== s.received) { res.writeHead(308, { Range: `bytes=0-${Math.max(0, s.received - 1)}` }); return res.end(); }
      // interrupcao forcada uma unica vez, para exercitar a retomada
      if (st.forceInterruptAt !== null && !st.interrupted && start + body.length > st.forceInterruptAt) {
        st.interrupted = true;
        const partial = Math.max(0, st.forceInterruptAt - start);
        s.received = start + partial;
        return req.socket.destroy();
      }
      if (st.expireSessionOnce && !st.expired && start > 0) { st.expired = true; s.dead = true; return json(res, 404, { error: { code: 404, message: 'sessao expirada' } }); }
      s.received = start + body.length;
      if (s.received >= s.total) {
        const vid = 'VID_' + (++st.seq);
        s.videoId = vid;
        st.videos.set(vid, { privacy: s.meta.status.privacyStatus, title: s.meta.snippet.title, at: new Date().toISOString() });
        return json(res, 200, { id: vid, snippet: s.meta.snippet, status: { privacyStatus: s.meta.status.privacyStatus, uploadStatus: 'uploaded' } });
      }
      res.writeHead(308, { Range: `bytes=0-${s.received - 1}` }); return res.end();
    }
    if (u.pathname === '/v2/reports') {
      const a = st.access.get(bearer);
      if (!a) return json(res, 401, { error: { code: 401, message: 'Invalid Credentials' } });
      return json(res, 200, { columnHeaders: [{ name: 'views' }, { name: 'estimatedMinutesWatched' }], rows: [[0, 0]] });
    }
    json(res, 404, { error: { code: 404, message: 'rota de espelho desconhecida: ' + u.pathname } });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      resolve({ server, port: p, state: st,
        issueCode: (c) => st.codes.set(c, true),
        expireAccessTokens: () => { for (const v of st.access.values()) v.exp = Date.now() - 1000; },
        base: {
          GOOGLE_TOKEN_BASE: `http://127.0.0.1:${p}/token`,
          GOOGLE_REVOKE_BASE: `http://127.0.0.1:${p}/revoke`,
          GOOGLE_API_BASE: `http://127.0.0.1:${p}`,
          GOOGLE_UPLOAD_BASE: `http://127.0.0.1:${p}/upload`,
          GOOGLE_ANALYTICS_BASE: `http://127.0.0.1:${p}`
        },
        close: () => new Promise((r) => server.close(r)) });
    });
  });
}
module.exports = { start };
