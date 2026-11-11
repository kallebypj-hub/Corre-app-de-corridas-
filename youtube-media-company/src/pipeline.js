'use strict';
/**
 * Pipeline persistente, reiniciavel e rastreavel.
 * Cada estagio tem id, dependencias, agente responsavel, artefatos com checksum,
 * custo, modelo, modo (real | assistido | bloqueado) e tempo.
 * Falhou no meio: retoma do checkpoint. Refez um estagio: so o que depende dele vira 'stale'.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Store } = require('./store');
const { Logger } = require('./log');

const STAGES = [
  { id: 'strategy',        agent: 'editorial_director',   deps: [],                         title: 'Nicho e tese editorial' },
  { id: 'ideation',        agent: 'demand_researcher',    deps: ['strategy'],               title: 'Ideias com evidencia' },
  { id: 'selection',       agent: 'editorial_director',   deps: ['ideation'],               title: 'Selecao editorial' },
  { id: 'research',        agent: 'source_researcher',    deps: ['selection'],              title: 'Dossie de pesquisa' },
  { id: 'script',          agent: 'scriptwriter',         deps: ['research'],               title: 'Roteiro EN-US' },
  { id: 'factcheck',       agent: 'fact_checker',         deps: ['script', 'research'],     title: 'Auditoria de fatos' },
  { id: 'narrative_review',agent: 'narrative_editor',     deps: ['script'],                 title: 'Revisao de narrativa' },
  { id: 'storyboard',      agent: 'art_director',         deps: ['script'],                 title: 'Storyboard' },
  { id: 'media_rights',    agent: 'media_rights_curator', deps: ['storyboard'],             title: 'Licenciamento de midia' },
  { id: 'voice',           agent: 'voice_producer',       deps: ['script'],                 title: 'Narracao (TTS local)' },
  { id: 'align',           agent: 'voice_producer',       deps: ['voice'],                  title: 'Alinhamento por reconhecimento de fala' },
  { id: 'scenes',          agent: 'editor_renderer',      deps: ['storyboard', 'voice'],    title: 'Render de cenas 1080p' },
  { id: 'edit',            agent: 'editor_renderer',      deps: ['scenes', 'voice'],        title: 'Montagem final MP4' },
  { id: 'captions',        agent: 'voice_producer',       deps: ['align', 'edit'],          title: 'Legendas SRT' },
  { id: 'thumbnail',       agent: 'thumbnail_designer',   deps: ['storyboard'],             title: 'Miniaturas A/B' },
  { id: 'seo',             agent: 'discovery_seo',        deps: ['edit', 'voice'],          title: 'Titulo, descricao, capitulos' },
  { id: 'shorts',          agent: 'shorts_producer',      deps: ['edit', 'captions'],       title: 'Tres Shorts 9:16' },
  { id: 'provenance',      agent: 'media_rights_curator', deps: ['media_rights', 'shorts', 'thumbnail'], title: 'Manifesto de origem e direitos' },
  { id: 'qa',              agent: 'compliance_auditor',   deps: ['provenance', 'captions', 'seo', 'factcheck', 'narrative_review'], title: 'Auditoria tecnica e gates' }
];
const STAGE_IDS = STAGES.map((s) => s.id);
function stage(id) { return STAGES.find((s) => s.id === id); }
/** Todos os estagios que dependem (direta ou indiretamente) de um estagio. */
function downstreamOf(id) {
  const out = new Set(); let changed = true;
  out.add(id);
  while (changed) {
    changed = false;
    for (const s of STAGES) if (!out.has(s.id) && s.deps.some((d) => out.has(d))) { out.add(s.id); changed = true; }
  }
  out.delete(id);
  return [...out];
}

class Pipeline {
  constructor({ channelId, store, impls }) {
    this.log = new Logger('pipeline');
    this.channelId = channelId;
    this.store = store || new Store(channelId);
    this.impls = impls;
    this.running = new Map();
  }
  /**
   * Impressao digital das ENTRADAS editoriais do episodio.
   * Se o brief, o roteiro, o dossie ou a matriz mudarem no disco, os estagios ja
   * concluidos passam a contar como desatualizados — mesmo que ninguem tenha
   * mandado refazer nada. Sem isto, editar o roteiro deixaria auditoria velha
   * passando por valida.
   */
  inputsFingerprint(epId) {
    const base = path.join(__dirname, '..', 'content', 'channels', this.channelId, 'episodes', epId);
    const h = crypto.createHash('sha256');
    for (const f of ['brief.json', 'script_en.json', 'sources.json', 'claims.json']) {
      const p2 = path.join(base, f);
      h.update(f);
      h.update(fs.existsSync(p2) ? fs.readFileSync(p2) : Buffer.from('AUSENTE'));
    }
    h.update('render:' + Pipeline.renderCodeHash());
    return h.digest('hex');
  }
  /**
   * Hash do codigo que DESENHA. Mudar a arte de um motivo tem de invalidar o
   * video, nao so a assinatura interna da cena — senao o pipeline pula o estagio
   * inteiro antes de chegar la, e o arquivo final guarda frame velho.
   */
  static renderCodeHash() {
    if (Pipeline._rch) return Pipeline._rch;
    const dir = path.join(__dirname, 'render');
    const h = crypto.createHash('sha256');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) {
      h.update(f); h.update(fs.readFileSync(path.join(dir, f)));
    }
    Pipeline._rch = h.digest('hex');
    return Pipeline._rch;
  }
  paths(epId) {
    const base = path.join(__dirname, '..', 'content', 'channels', this.channelId, 'episodes', epId);
    const p = { base, work: path.join(base, 'work'), scenes: path.join(base, 'scenes'), shorts: path.join(base, 'shorts'),
      audio: path.join(base, 'work', 'audio'), stills: path.join(base, 'work', 'stills') };
    for (const d of Object.values(p)) fs.mkdirSync(d, { recursive: true });
    return p;
  }
  status(epId) {
    const ep = this.store.episode(epId);
    const fp = this.inputsFingerprint(epId);
    return STAGES.map((s) => {
      const st0 = (ep && ep.stages[s.id]) || {};
      const inputsChanged = st0.status === 'done' && st0.inputs && st0.inputs !== fp;
      const st = inputsChanged ? { ...st0, status: 'stale', stale_reason: 'as entradas editoriais do episodio mudaram no disco' } : st0;
      const depsOk = s.deps.every((d) => ep && ep.stages[d] && ep.stages[d].status === 'done');
      return { ...s, status: st.status || 'pending', mode: st.mode || null, autonomy: st.autonomy || null,
        stale_reason: st.stale_reason || null, error: st.error || null,
        durationMs: st.durationMs || null, artifacts: st.artifacts || [], attempt: st.attempt || 0,
        finishedAt: st.finishedAt || null, cost: st.cost || null, runnable: depsOk || s.deps.length === 0 };
    });
  }
  /** Executa um estagio isolado. Marca os dependentes como 'stale'. */
  async runStage(epId, id, ctx = {}) {
    const s = stage(id); if (!s) throw new Error(`estagio desconhecido: ${id}`);
    const impl = this.impls[id]; if (!impl) throw new Error(`estagio sem implementacao: ${id}`);
    const ep = this.store.episode(epId); if (!ep) throw new Error(`episodio inexistente: ${epId}`);
    for (const d of s.deps) {
      const ds = ep.stages[d];
      if (!ds || ds.status !== 'done') throw new Error(`dependencia nao concluida: ${id} precisa de ${d} (${ds ? ds.status : 'pending'})`);
    }
    const t0 = Date.now();
    this.store.stageStart(epId, id, { agent: s.agent, inputs: this.inputsFingerprint(epId) });
    this.log.info(`[${epId}] ${id} -> ${s.title} (agente: ${s.agent})`);
    try {
      const res = await impl({ epId, channelId: this.channelId, store: this.store, paths: this.paths(epId), pipeline: this, log: this.log, ...ctx });
      const ms = Date.now() - t0;
      this.store.stageDone(epId, id, { agent: s.agent, durationMs: ms, inputs: this.inputsFingerprint(epId), ...res });
      const down = downstreamOf(id).filter((d) => (this.store.episode(epId).stages[d] || {}).status === 'done');
      if (down.length) this.store.append('stage.invalidated', { epId, stageIds: down, cause: id });
      this.log.info(`[${epId}] ${id} OK em ${(ms / 1000).toFixed(1)}s (modo: ${res.mode})${down.length ? ` | invalidou: ${down.join(', ')}` : ''}`);
      return res;
    } catch (e) {
      this.store.stageFailed(epId, id, e, s.agent);
      this.log.error(`[${epId}] ${id} FALHOU: ${e.message}`);
      throw e;
    }
  }
  /** Roda a cadeia inteira a partir do checkpoint: pula o que ja esta 'done'. */
  async run(epId, { from = null, only = null, force = false } = {}) {
    const ran = [];
    let started = !from;
    for (const s of STAGES) {
      if (only && !only.includes(s.id)) continue;
      if (from && s.id === from) started = true;
      if (!started) continue;
      const rec = this.store.episode(epId).stages[s.id] || {};
      const inputsChanged = rec.status === 'done' && rec.inputs && rec.inputs !== this.inputsFingerprint(epId);
      if (!force && rec.status === 'done' && !inputsChanged) { this.log.info(`[${epId}] ${s.id} ja concluido — pulando (checkpoint)`); continue; }
      if (inputsChanged) this.log.warn(`[${epId}] ${s.id} refazendo: as entradas editoriais mudaram no disco`);
      await this.runStage(epId, s.id);
      ran.push(s.id);
    }
    return ran;
  }
}
module.exports = { Pipeline, STAGES, STAGE_IDS, stage, downstreamOf };
