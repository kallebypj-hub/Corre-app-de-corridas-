'use strict';
/**
 * Store duravel sem dependencia nativa.
 *  - events.jsonl : log append-only de tudo que aconteceu (auditoria, recuperacao)
 *  - state.json   : projecao atual (escrita atomica: tmp + rename)
 * Isolamento: um diretorio por canal; nenhum dado de outro projeto e lido.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Logger } = require('./log');

const ROOT = path.join(__dirname, '..');
const VAR = path.join(ROOT, 'var');

function sha256File(p) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}
function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

class Store {
  constructor(channelId) {
    this.log = new Logger('store');
    this.channelId = channelId;
    this.dir = path.join(VAR, 'channels', channelId);
    fs.mkdirSync(this.dir, { recursive: true });
    this.eventsPath = path.join(this.dir, 'events.jsonl');
    this.statePath = path.join(this.dir, 'state.json');
    this.state = this._load();
  }
  _load() {
    if (fs.existsSync(this.statePath)) {
      try { this._mtime = fs.statSync(this.statePath).mtimeMs; return JSON.parse(fs.readFileSync(this.statePath, 'utf8')); }
      catch (e) { this.log.warn(`state.json corrompido, reconstruindo do events.jsonl: ${e.message}`); }
    }
    return this._rebuild();
  }
  /**
   * Relê o estado se outro processo o mudou. Sem isto, um servidor de painel
   * de vida longa mostraria o retrato do momento em que subiu, enquanto a CLI
   * produz em paralelo — ou seja, mostraria estado falso.
   */
  refresh() {
    try {
      if (!fs.existsSync(this.statePath)) return this;
      const m = fs.statSync(this.statePath).mtimeMs;
      if (m !== this._mtime) { this.state = this._load(); }
    } catch (_) {}
    return this;
  }
  /** Recuperacao pos-reinicio: reconstroi a projecao a partir do log append-only. */
  _rebuild() {
    const st = { channelId: this.channelId, episodes: {}, missions: [], publications: [], analytics: [], memory: [], created: new Date().toISOString() };
    if (!fs.existsSync(this.eventsPath)) return st;
    for (const raw of fs.readFileSync(this.eventsPath, 'utf8').split('\n')) {
      if (!raw.trim()) continue;
      let ev; try { ev = JSON.parse(raw); } catch (_) { continue; }
      applyEvent(st, ev);
    }
    return st;
  }
  append(type, payload) {
    this.refresh();
    const ev = { seq: Date.now() + '-' + crypto.randomBytes(3).toString('hex'), ts: new Date().toISOString(), type, payload };
    fs.appendFileSync(this.eventsPath, JSON.stringify(ev) + '\n');
    applyEvent(this.state, ev);
    this.flush();
    return ev;
  }
  flush() {
    const tmp = this.statePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.statePath);
    try { this._mtime = fs.statSync(this.statePath).mtimeMs; } catch (_) {}
  }
  episode(id) { return this.state.episodes[id] || null; }
  episodes() { return Object.values(this.state.episodes).sort((a, b) => (a.created < b.created ? 1 : -1)); }

  ensureEpisode(id, init) {
    if (!this.state.episodes[id]) this.append('episode.created', { id, ...init });
    return this.episode(id);
  }
  /** Marca inicio de um estagio. */
  stageStart(epId, stageId, meta) {
    return this.append('stage.started', { epId, stageId, ...meta });
  }
  /** Conclui estagio registrando artefatos com checksum real do arquivo em disco. */
  stageDone(epId, stageId, { outputs = [], artifacts = [], cost = { usd: 0, provider: 'local' }, model = null, mode = 'real', agent = null, notes = null, durationMs = 0, autonomy = null, inputs = null }) {
    const withChecksum = artifacts.map((a) => {
      const abs = a.path;
      let size = null, checksum = null;
      try { size = fs.statSync(abs).size; checksum = sha256File(abs); } catch (_) {}
      return { ...a, size, checksum };
    });
    return this.append('stage.completed', { epId, stageId, outputs, artifacts: withChecksum, cost, model, mode, agent, notes, durationMs, autonomy, inputs });
  }
  stageFailed(epId, stageId, error, agent) {
    return this.append('stage.failed', { epId, stageId, error: String(error && error.message || error), agent });
  }
}

function applyEvent(st, ev) {
  const p = ev.payload || {};
  switch (ev.type) {
    case 'episode.created':
      st.episodes[p.id] = { id: p.id, title: p.title || null, channelId: st.channelId, created: ev.ts,
        stages: {}, approval: { status: 'pending', by: null, at: null, notes: null, scheduled_upload_authorized: false },
        gates: null, cost_usd: 0, mode_map: {}, meta: p.meta || {} };
      break;
    case 'episode.meta':
      if (st.episodes[p.epId]) Object.assign(st.episodes[p.epId], p.patch || {});
      break;
    case 'stage.started': {
      const ep = st.episodes[p.epId]; if (!ep) break;
      ep.stages[p.stageId] = { ...(ep.stages[p.stageId] || {}), id: p.stageId, status: 'running', startedAt: ev.ts, error: null, agent: p.agent || null, attempt: ((ep.stages[p.stageId] || {}).attempt || 0) + 1 };
      break;
    }
    case 'stage.completed': {
      const ep = st.episodes[p.epId]; if (!ep) break;
      ep.stages[p.stageId] = { ...(ep.stages[p.stageId] || {}), id: p.stageId, status: 'done', finishedAt: ev.ts,
        outputs: p.outputs, artifacts: p.artifacts, cost: p.cost, model: p.model, mode: p.mode, agent: p.agent, notes: p.notes, durationMs: p.durationMs, autonomy: p.autonomy || null, inputs: p.inputs || null, error: null };
      ep.cost_usd = Object.values(ep.stages).reduce((s, x) => s + (((x.cost || {}).usd) || 0), 0);
      ep.mode_map[p.stageId] = p.mode;
      break;
    }
    case 'stage.failed': {
      const ep = st.episodes[p.epId]; if (!ep) break;
      ep.stages[p.stageId] = { ...(ep.stages[p.stageId] || {}), id: p.stageId, status: 'failed', finishedAt: ev.ts, error: p.error, agent: p.agent };
      break;
    }
    case 'stage.invalidated': {
      const ep = st.episodes[p.epId]; if (!ep) break;
      for (const s of p.stageIds || []) if (ep.stages[s]) ep.stages[s] = { ...ep.stages[s], status: 'stale' };
      break;
    }
    case 'gates.evaluated': {
      const ep = st.episodes[p.epId]; if (!ep) break;
      ep.gates = p.gates;
      break;
    }
    case 'approval.decided': {
      const ep = st.episodes[p.epId]; if (!ep) break;
      ep.approval = { status: p.status, by: p.by, at: ev.ts, notes: p.notes || null,
        scheduled_upload_authorized: !!p.scheduled_upload_authorized,
        public_release_authorized: !!p.public_release_authorized };
      break;
    }
    case 'mission.created': st.missions.unshift({ ...p, at: ev.ts }); break;
    case 'mission.updated': {
      const m = st.missions.find((x) => x.id === p.id); if (m) Object.assign(m, p.patch);
      break;
    }
    case 'publication.recorded': st.publications.unshift({ ...p, at: ev.ts }); break;
    case 'analytics.recorded': st.analytics.unshift({ ...p, at: ev.ts }); break;
    case 'memory.recorded': st.memory.unshift({ ...p, at: ev.ts }); break;
    default: break;
  }
}
module.exports = { Store, sha256File, sha256, VAR, ROOT };
