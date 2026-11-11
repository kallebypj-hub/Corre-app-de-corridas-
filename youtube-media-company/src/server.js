'use strict';
require('./env');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { Store } = require('./store');
const { Pipeline, STAGES, downstreamOf } = require('./pipeline');
const impls = require('./stages');
const { Logger } = require('./log');
const ceo = require('./ceo');
const yt = require('./youtube/oauth');
const { checkEnv } = require('./doctor');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3777);
const HOST = process.env.HOST || '127.0.0.1';
const API_KEY = process.env.API_KEY || '';
const CHANNEL = process.env.CHANNEL_ID || 'ch_practical_discipline';
const log = new Logger('server');

const store = new Store(CHANNEL);
const pipeline = new Pipeline({ channelId: CHANNEL, store, impls });
const jobs = new Map();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.png': 'image/png',
  '.srt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml' };

function json(res, code, data) { const b = JSON.stringify(data, null, 2); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(b), 'Cache-Control': 'no-store' }); res.end(b); }
function readBody(req) { return new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (_) { resolve({}); } }); }); }

/** Protecao: fora de 127.0.0.1, toda escrita exige x-api-key. Token nunca aparece em log/resposta. */
function guard(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const local = HOST === '127.0.0.1' || HOST === 'localhost';
  if (local && !API_KEY) return true;
  if (API_KEY && req.headers['x-api-key'] === API_KEY) return true;
  json(res, 401, { error: 'nao autorizado', hint: 'defina API_KEY no .env e envie no cabecalho x-api-key' });
  return false;
}

function serveFile(req, res, abs) {
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return json(res, 404, { error: 'nao encontrado' });
  const stat = fs.statSync(abs);
  const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    let start = m[1] ? Number(m[1]) : 0;
    let end = m[2] ? Number(m[2]) : stat.size - 1;
    if (start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
    end = Math.min(end, stat.size - 1);
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes' });
    return fs.createReadStream(abs, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(abs).pipe(res);
}

function episodeDir(epId) { return path.join(ROOT, 'content', 'channels', CHANNEL, 'episodes', epId); }
function listArtifacts(epId) {
  const base = episodeDir(epId);
  if (!fs.existsSync(base)) return [];
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'work' || e.name === 'stills') continue;
      const abs = path.join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else out.push({ rel: r, bytes: fs.statSync(abs).size, url: `/files/${epId}/${r}` });
    }
  };
  walk(base, '');
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

const labStores = new Map();
/** Canal de laboratorio para testes negativos: isolado, nunca toca o canal de producao. */
function storeFor(req) {
  const c = req.headers['x-channel'];
  if (!c || c === CHANNEL) return store.refresh();
  if (!/^ch_lab_[a-z0-9_]+$/.test(String(c))) return store.refresh();
  if (!labStores.has(c)) labStores.set(c, new Store(c));
  return labStores.get(c).refresh();
}

async function api(req, res, u) {
  const store = storeFor(req); // o pipeline pode rodar noutro processo; o painel nunca mostra retrato velho
  const p = u.pathname;
  if (p === '/health') return json(res, 200, { ok: true, service: 'youtube-media-company', version: require('../package.json').version, channel: CHANNEL, uptime_s: Math.round(process.uptime()) });
  if (p === '/api/readiness') { const d = await checkEnv(); return json(res, 200, { ready: !!d.ffmpeg && d.playwright === 'disponivel' && d.tts_python !== 'AUSENTE', ...d }); }
  if (p === '/api/company') return json(res, 200, JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'company.json'), 'utf8')));
  if (p === '/api/channel') return json(res, 200, JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'channels', `${CHANNEL}.json`), 'utf8')));
  if (p === '/api/episodes') return json(res, 200, { episodes: store.episodes().map((e) => ({ id: e.id, title: e.title, created: e.created, cost_usd: e.cost_usd, gates: e.gates && e.gates.verdict, approval: e.approval.status })) });

  let m;
  if ((m = p.match(/^\/api\/episodes\/(ep_\w+)$/))) {
    const ep = store.episode(m[1]); if (!ep) return json(res, 404, { error: 'episodio nao encontrado' });
    const base = episodeDir(m[1]);
    const read = (f) => { const x = path.join(base, f); return fs.existsSync(x) ? JSON.parse(fs.readFileSync(x, 'utf8')) : null; };
    const qaOk = ep.stages.qa && ep.stages.qa.status === 'done';
    return json(res, 200, { episode: ep, gates_stale: !!ep.gates && !qaOk, pipeline: pipeline.status(m[1]), artifacts: listArtifacts(m[1]),
      metadata: read('metadata.json'), quality: read('quality_report.json'), storyboard: read('storyboard.json'),
      provenance: read('provenance.json'), claims: read('claims_review.json'), shorts: read('shorts_manifest.json'),
      narrative: read('narrative_review.json'), intelligibility: read('intelligibility_report.json'), captions: read('captions_report.json'),
      ideas: read('ideas.json') });
  }
  if ((m = p.match(/^\/api\/episodes\/(ep_\w+)\/stage\/(\w+)\/run$/)) && req.method === 'POST') {
    if (!guard(req, res)) return;
    const [, epId, stageId] = m;
    if (jobs.get(epId)) return json(res, 409, { error: 'ja existe um trabalho em andamento para este episodio', job: jobs.get(epId) });
    const job = { epId, stageId, status: 'running', started: new Date().toISOString() };
    jobs.set(epId, job);
    pipeline.runStage(epId, stageId).then(() => { job.status = 'done'; }).catch((e) => { job.status = 'failed'; job.error = e.message; })
      .finally(() => { setTimeout(() => jobs.delete(epId), 2000); });
    return json(res, 202, { accepted: true, job, invalidates: downstreamOf(stageId) });
  }
  if ((m = p.match(/^\/api\/episodes\/(ep_\w+)\/run$/)) && req.method === 'POST') {
    if (!guard(req, res)) return;
    const body = await readBody(req);
    const epId = m[1];
    if (jobs.get(epId)) return json(res, 409, { error: 'trabalho em andamento', job: jobs.get(epId) });
    store.ensureEpisode(epId, { title: body.title || null });
    const job = { epId, stageId: 'full', status: 'running', started: new Date().toISOString() };
    jobs.set(epId, job);
    pipeline.run(epId, { from: body.from || null }).then((r) => { job.status = 'done'; job.ran = r; })
      .catch((e) => { job.status = 'failed'; job.error = e.message; }).finally(() => { setTimeout(() => jobs.delete(epId), 2000); });
    return json(res, 202, { accepted: true, job });
  }
  if ((m = p.match(/^\/api\/episodes\/(ep_\w+)\/job$/))) return json(res, 200, { job: jobs.get(m[1]) || null });

  if ((m = p.match(/^\/api\/episodes\/(ep_\w+)\/approval$/)) && req.method === 'POST') {
    if (!guard(req, res)) return;
    const body = await readBody(req); const epId = m[1];
    const ep = store.episode(epId); if (!ep) return json(res, 404, { error: 'episodio nao encontrado' });
    if (body.status === 'approved') {
      if (!ep.gates || !ep.gates.can_be_approved)
        return json(res, 412, { error: 'gates nao aprovados — aprovacao bloqueada', blocking: ep.gates ? ep.gates.blocking_failures : ['gates nao avaliados'] });
      if (!ep.stages.qa || ep.stages.qa.status !== 'done')
        return json(res, 412, { error: 'auditoria desatualizada — um estagio foi refeito depois dela; rode a auditoria de novo antes de aprovar',
          blocking: ['qa:' + ((ep.stages.qa || {}).status || 'pendente')] });
    }
    store.append('approval.decided', { epId, status: body.status, by: body.by || 'presidente',
      notes: body.notes || null, scheduled_upload_authorized: !!body.scheduled_upload_authorized });
    store.append('memory.recorded', { kind: 'decisao_de_aprovacao', epId, status: body.status, notes: body.notes || null });
    return json(res, 200, { ok: true, approval: store.episode(epId).approval });
  }
  if (p === '/api/youtube/state') return json(res, 200, yt.state(CHANNEL));
  if (p === '/api/youtube/queue' && req.method === 'POST') {
    if (!guard(req, res)) return;
    const body = await readBody(req);
    try { return json(res, 200, { ok: true, record: yt.enqueue(store, body.epId, { privacy: body.privacy || 'private', publishAt: body.publishAt || null, approvedBy: body.by || 'presidente' }) }); }
    catch (e) { return json(res, 412, { error: e.message }); }
  }
  if (p === '/api/publications') return json(res, 200, { publications: store.state.publications, youtube: yt.state(CHANNEL) });
  if (p === '/api/analytics') return json(res, 200, yt.analytics(CHANNEL));
  if (p === '/api/memory') return json(res, 200, { memory: store.state.memory, missions: store.state.missions });
  if (p === '/api/integrations') {
    const d = await checkEnv();
    return json(res, 200, {
      spend_limit_usd: Number(process.env.EXTERNAL_SPEND_LIMIT_USD || 0),
      spent_usd: store.episodes().reduce((a, e) => a + (e.cost_usd || 0), 0),
      providers: [
        { name: 'Kokoro-82M (local)', role: 'narracao', status: d.kokoro ? 'ATIVO' : 'AUSENTE', cost: 'US$ 0,00', license: 'Apache-2.0' },
        { name: 'faster-whisper (local)', role: 'alinhamento/inteligibilidade', status: d.faster_whisper ? 'ATIVO' : 'AUSENTE', cost: 'US$ 0,00', license: 'MIT' },
        { name: 'FFmpeg', role: 'render', status: d.ffmpeg ? 'ATIVO' : 'AUSENTE', cost: 'US$ 0,00' },
        { name: 'Chromium/Playwright', role: 'rasterizacao', status: d.playwright, cost: 'US$ 0,00' },
        { name: 'LLM externa (Gemini/OpenAI)', role: 'roteiro automatico', status: 'DESLIGADA', cost: 'US$ 0,00', note: 'piloto roda em modo assistido; ligar exige chave e autorizacao de gasto' },
        { name: 'Provedores de video/imagem pagos', role: 'geracao visual', status: 'DESLIGADA POR PADRAO', cost: 'US$ 0,00' },
        { name: 'YouTube Data/Analytics', role: 'publicacao e metricas', status: yt.state(CHANNEL).status, cost: 'US$ 0,00' }
      ]
    });
  }
  if (p === '/api/ceo/chat' && req.method === 'POST') {
    if (!guard(req, res)) return;
    const body = await readBody(req);
    const r = await ceo.handle(body.message, { store, pipeline, channelId: CHANNEL });
    store.append('memory.recorded', { kind: 'ceo_chat', input: String(body.message || '').slice(0, 500), reply: r.message.slice(0, 1000) });
    return json(res, 200, r);
  }
  if (p === '/api/calendar') {
    const f = path.join(ROOT, 'content', 'channels', CHANNEL, 'calendar_90d.json');
    return json(res, 200, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { error: 'calendario nao gerado' });
  }
  return json(res, 404, { error: 'rota nao encontrada', path: p });
}

const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  try {
    if (u.pathname.startsWith('/files/')) {
      const rel = decodeURIComponent(u.pathname.slice('/files/'.length));
      const parts = rel.split('/'); const epId = parts.shift();
      if (!/^ep_\w+$/.test(epId)) return json(res, 400, { error: 'episodio invalido' });
      const abs = path.join(episodeDir(epId), ...parts);
      if (!abs.startsWith(episodeDir(epId))) return json(res, 403, { error: 'caminho fora do episodio' });
      return serveFile(req, res, abs);
    }
    if (u.pathname.startsWith('/api/') || u.pathname === '/health') return await api(req, res, u);
    const rel = u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, '');
    const abs = path.join(ROOT, 'dashboard', rel);
    if (!abs.startsWith(path.join(ROOT, 'dashboard'))) return json(res, 403, { error: 'proibido' });
    return serveFile(req, res, abs);
  } catch (e) { log.error(e.stack || e.message); json(res, 500, { error: e.message }); }
});
server.listen(PORT, HOST, () => {
  log.info(`Painel da empresa em http://${HOST}:${PORT}`);
  if (HOST !== '127.0.0.1' && !API_KEY) log.warn('HOST publico sem API_KEY — defina API_KEY antes de expor o painel.');
});
module.exports = { server };
