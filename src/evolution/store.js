'use strict';
/**
 * Registro IMUTAVEL de experimentos.
 *
 * Um unico arquivo append-only por canal. Nada e editado, nada e apagado.
 * Mudar de ideia gera um evento NOVO que aponta para o anterior — o conhecimento
 * velho continua legivel, com a data em que valia. As projecoes (experimentos,
 * conhecimento, edicoes) sao reconstruidas do log, nunca a fonte da verdade.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const DIR = process.env.EVOLUTION_DIR || path.join(ROOT, 'var', 'evolution');

const EVENT_TYPES = new Set([
  'experiment.registered', 'experiment.produced', 'experiment.published',
  'measurement.recorded', 'retention.mapped', 'funnel.evaluated', 'verdict.issued',
  'knowledge.proposed', 'knowledge.promoted', 'knowledge.demoted', 'knowledge.revised',
  'edit.recorded', 'audit.challenged', 'review.performed'
]);

class EvolutionStore {
  constructor(channelId) {
    this.channelId = channelId;
    this.dir = path.join(DIR, channelId);
    fs.mkdirSync(this.dir, { recursive: true });
    this.logPath = path.join(this.dir, 'experiments.jsonl');
    this._mtime = 0;
    this.events = [];
    this.reload();
  }
  reload() {
    if (!fs.existsSync(this.logPath)) { this.events = []; return this; }
    const m = fs.statSync(this.logPath).mtimeMs;
    if (m === this._mtime && this.events.length) return this;
    this._mtime = m;
    this.events = fs.readFileSync(this.logPath, 'utf8').split('\n')
      .filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
      .filter(Boolean);
    return this;
  }
  /** Append puro. O hash encadeado torna reescrita silenciosa detectavel. */
  append(type, payload, { author = 'sistema' } = {}) {
    if (!EVENT_TYPES.has(type)) throw new Error(`tipo de evento desconhecido: ${type}`);
    this.reload();
    const prev = this.events.length ? this.events[this.events.length - 1].hash : 'GENESIS';
    const body = { seq: this.events.length + 1, ts: new Date().toISOString(), type, author, payload, prev };
    body.hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    fs.appendFileSync(this.logPath, JSON.stringify(body) + '\n');
    this.events.push(body);
    this._mtime = fs.existsSync(this.logPath) ? fs.statSync(this.logPath).mtimeMs : 0;
    return body;
  }
  /** Confere a corrente de hashes: prova que nenhum evento foi reescrito ou removido. */
  verifyChain() {
    let prev = 'GENESIS';
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i];
      const { hash, ...body } = e;
      const expected = crypto.createHash('sha256').update(JSON.stringify({ ...body, prev })).digest('hex');
      if (e.prev !== prev) return { ok: false, at: i + 1, reason: 'elo anterior nao bate (evento removido ou inserido)' };
      if (expected !== hash) return { ok: false, at: i + 1, reason: 'conteudo do evento foi alterado depois de gravado' };
      prev = hash;
    }
    return { ok: true, events: this.events.length, head: prev };
  }
  by(type) { this.reload(); return this.events.filter((e) => e.type === type); }
  forEpisode(epId) { this.reload(); return this.events.filter((e) => (e.payload || {}).episode_id === epId); }

  /** Projecao: um registro por experimento, montado na ordem dos eventos. */
  experiments() {
    this.reload();
    const map = new Map();
    for (const e of this.events) {
      const p = e.payload || {};
      const id = p.experiment_id;
      if (!id) continue;
      if (!map.has(id)) map.set(id, { experiment_id: id, events: [], measurements: [], funnels: [], verdicts: [], edits: [], challenges: [] });
      const x = map.get(id);
      x.events.push({ seq: e.seq, ts: e.ts, type: e.type, author: e.author });
      switch (e.type) {
        case 'experiment.registered': Object.assign(x, p, { registered_at: e.ts }); break;
        case 'experiment.produced': x.production = p; break;
        // as etapas de publicacao se ACUMULAM: a data do envio privado nao se
        // perde quando a publicacao publica e registrada depois.
        case 'experiment.published': {
          const prev = x.publication || {};
          x.publication = { ...prev, ...p,
            uploaded_privately_at: p.uploaded_privately_at || prev.uploaded_privately_at || null,
            published_publicly_at: p.published_publicly_at || prev.published_publicly_at || null };
          (x.publication_steps = x.publication_steps || []).push({ kind: p.kind || 'desconhecida', ts: e.ts, privacy: p.privacy || null });
          break;
        }
        case 'measurement.recorded': x.measurements.push({ ...p, ts: e.ts }); break;
        case 'retention.mapped': x.retention = { ...p, ts: e.ts }; break;
        case 'funnel.evaluated': x.funnels.push({ ...p, ts: e.ts }); break;
        case 'verdict.issued': x.verdicts.push({ ...p, ts: e.ts, author: e.author }); break;
        case 'edit.recorded': x.edits.push({ ...p, ts: e.ts, author: e.author }); break;
        case 'audit.challenged': x.challenges.push({ ...p, ts: e.ts, author: e.author }); break;
        default: break;
      }
    }
    // o veredicto que vale e o ultimo emitido; os anteriores continuam visiveis
    for (const x of map.values()) {
      x.current_verdict = x.verdicts.length ? x.verdicts[x.verdicts.length - 1] : { verdict: 'aguardando dados', reason: 'nenhum veredicto emitido ainda' };
      x.current_funnel = x.funnels.length ? x.funnels[x.funnels.length - 1] : null;
      x.superseded_verdicts = x.verdicts.slice(0, -1);
      // Remedicao nao duplica marco: a ULTIMA medida de cada marco e a que vale,
      // e as anteriores (provisorias) continuam no registro, visiveis.
      const byMs = {};
      for (const m of x.measurements) byMs[m.milestone] = m;
      x.measurement_by_milestone = byMs;
      x.current_measurements = Object.values(byMs);
      x.open_milestones = Object.values(byMs).filter((m) => m.completeness === 'provisoria').map((m) => m.milestone);
      x.final_milestones = Object.values(byMs).filter((m) => m.completeness !== 'provisoria').map((m) => m.milestone);
    }
    return [...map.values()].sort((a, b) => String(a.experiment_id).localeCompare(String(b.experiment_id)));
  }
  experiment(id) { return this.experiments().find((x) => x.experiment_id === id) || null; }
  stats() {
    this.reload();
    const byType = {};
    for (const e of this.events) byType[e.type] = (byType[e.type] || 0) + 1;
    return { channel: this.channelId, events: this.events.length, by_type: byType,
      first: this.events[0] ? this.events[0].ts : null,
      last: this.events[this.events.length - 1] ? this.events[this.events.length - 1].ts : null,
      chain: this.verifyChain() };
  }
}
module.exports = { EvolutionStore, EVENT_TYPES, DIR };
