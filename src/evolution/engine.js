'use strict';
/**
 * EVOLUTION ENGINE — a fachada.
 *
 * Registra experimento antes de produzir, mede depois de publicar, avalia o
 * funil, passa pelo auditor metodologico e so entao propoe conhecimento.
 * Nada aqui publica, troca miniatura ou gasta dinheiro sozinho.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EvolutionStore } = require('./store');
const { MILESTONES, VERDICT, KNOWLEDGE_TIER, EVIDENCE } = require('./states');
const funnel = require('./funnel');
const knowledge = require('./knowledge');
const variables = require('./variables');
const auditor = require('./auditor');
const retention = require('./retention');
const thumbs = require('./thumbnail-analysis');

const ROOT = path.join(__dirname, '..', '..');
const EDITABLE = ['title', 'thumbnail', 'description', 'tags', 'chapters', 'seo_strategy'];

class EvolutionEngine {
  constructor(channelId) {
    this.channelId = channelId;
    this.store = new EvolutionStore(channelId);
  }
  epDir(epId) { return path.join(ROOT, 'content', 'channels', this.channelId, 'episodes', epId); }
  readJSON(epId, f) { const p = path.join(this.epDir(epId), f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; }

  /* ---------- 1. registrar o experimento ANTES de produzir ---------- */
  register(epId, { hypothesis, variable, applies_learning = [], audience, search_intent, author = 'editorial_director' }) {
    if (!hypothesis || String(hypothesis).trim().length < 20) throw new Error('experimento sem hipotese escrita');
    if (!variable) throw new Error('experimento sem variavel principal declarada');
    if (!variables.VARIABLES[variable]) throw new Error(`variavel desconhecida: ${variable}. Conhecidas: ${Object.keys(variables.VARIABLES).join(', ')}`);
    const id = `exp_${epId}`;
    if (this.store.experiment(id)) throw new Error(`experimento ${id} ja registrado; corrigir gera evento novo, nao sobrescreve`);
    const brief = this.readJSON(epId, 'brief.json');
    return this.store.append('experiment.registered', {
      experiment_id: id, episode_id: epId, channel_id: this.channelId,
      hypothesis, primary_variable: variable, applies_learning,
      topic: brief ? brief.working_title : null, thesis: brief ? brief.thesis : null,
      audience: audience || (brief && brief.audience) || null, search_intent: search_intent || null,
      registered_before_production: true
    }, { author });
  }

  /* ---------- 2. anotar o que foi realmente produzido ---------- */
  async recordProduction(epId, { author = 'compliance_auditor', gates = null } = {}) {
    const id = `exp_${epId}`;
    if (!this.store.experiment(id)) throw new Error(`nenhum experimento registrado para ${epId}: registre a hipotese antes de produzir`);
    const brief = this.readJSON(epId, 'brief.json');
    const script = this.readJSON(epId, 'script_en.json');
    const timeline = this.readJSON(epId, 'narration_timeline.json');
    const storyboard = this.readJSON(epId, 'storyboard.json');
    const metadata = this.readJSON(epId, 'metadata.json');
    // gates vem da rodada CORRENTE quando informado; ler o relatorio do disco
    // gravaria o numero da rodada anterior como se fosse desta producao.
    const quality = gates ? null : this.readJSON(epId, 'quality_report.json');
    const cfg = variables.readConfig({ brief, script, timeline, storyboard });
    const thumbAnalysis = [];
    for (const v of ['A', 'B']) {
      const f = path.join(this.epDir(epId), `thumbnail_${v}.png`);
      if (!fs.existsSync(f)) continue;
      const declared = (brief.thumbnails || []).find((t) => t.variant === v) || {};
      thumbAnalysis.push({ variant: v, ...(await thumbs.analyse(f, { declaredText: `${declared.title || ''} ${declared.proof || ''}`, emotionalIntent: declared.emotional_intent || null })) });
    }
    return this.store.append('experiment.produced', {
      experiment_id: id, episode_id: epId,
      variable_config: cfg, variable_fingerprint: variables.fingerprint(cfg),
      duration_s: timeline ? timeline.total_duration_s : null,
      scenes: script ? script.scenes.length : null,
      title: metadata ? metadata.title : null,
      gates: gates || (quality ? `${quality.passed}/${quality.total}` : null),
      thumbnails: thumbAnalysis,
      produced_at: new Date().toISOString()
    }, { author });
  }

  /* ---------- 3. publicacao ---------- */
  recordPublication(epId, { video_id, url, privacy, published_at, author = 'publishing_analytics' }) {
    const id = `exp_${epId}`;
    return this.store.append('experiment.published', {
      experiment_id: id, episode_id: epId, video_id, url, privacy,
      published_at: published_at || new Date().toISOString()
    }, { author });
  }

  /* ---------- 4. medidas reais, por marco ---------- */
  recordMeasurement(epId, { milestone, metrics, source, window, author = 'publishing_analytics' }) {
    if (!MILESTONES.find((m) => m.id === milestone)) throw new Error(`marco desconhecido: ${milestone}`);
    const id = `exp_${epId}`;
    const missing = [];
    const clean = {};
    for (const [k, v] of Object.entries(metrics || {})) {
      if (v === 'indisponivel' || v === null || v === undefined) { missing.push(k); clean[k] = null; }
      else clean[k] = v;
    }
    return this.store.append('measurement.recorded', {
      experiment_id: id, episode_id: epId, milestone, metrics: clean,
      missing_metrics: missing, source: source || 'youtube_analytics_api', window: window || null,
      note: missing.length ? `${missing.length} metrica(s) nao vieram da API e ficam como ausentes, nunca como zero` : null
    }, { author });
  }

  /* ---------- 5. funil + retencao ---------- */
  evaluateFunnel(epId, { baseline = {}, author = 'publishing_analytics' } = {}) {
    const x = this.store.experiment(`exp_${epId}`);
    if (!x) throw new Error(`experimento inexistente para ${epId}`);
    const last = x.measurements[x.measurements.length - 1];
    const metrics = last ? last.metrics : {};
    const ev = funnel.evaluate(metrics, { baseline });
    const sum = funnel.summary(ev);
    this.store.append('funnel.evaluated', { experiment_id: x.experiment_id, episode_id: epId,
      milestone: last ? last.milestone : null, stages: ev.stages, summary: sum, baseline }, { author });
    return { ...ev, summary: sum };
  }
  mapRetention(epId, curve, views, { author = 'publishing_analytics' } = {}) {
    const sb = this.readJSON(epId, 'storyboard.json');
    const tl = this.readJSON(epId, 'narration_timeline.json');
    if (!sb) throw new Error(`${epId} sem storyboard`);
    const map = retention.mapToScenes(curve, sb, tl, views);
    this.store.append('retention.mapped', { experiment_id: `exp_${epId}`, episode_id: epId,
      available: map.available, state: map.state || null, total_duration_s: map.total_duration_s,
      scenes: map.scenes, notable_drops: map.notable_drops || [], views: views == null ? null : views }, { author });
    return map;
  }

  /* ---------- 6. veredicto, sempre pelo auditor ---------- */
  issueVerdict(epId, { verdict, reason, blamedStage = null, blamedScene = null, compareWith = null, generalize = false, author = 'editorial_director' }) {
    const x = this.store.experiment(`exp_${epId}`);
    if (!x) throw new Error(`experimento inexistente para ${epId}`);
    let comparison = null;
    if (compareWith) {
      const other = this.store.experiment(`exp_${compareWith}`);
      if (other && other.production && x.production)
        comparison = variables.compare(x.production.variable_config, other.production.variable_config, { declaredVariable: x.primary_variable });
    }
    const audit = auditor.review({
      proposedVerdict: { verdict, reason, generalize }, hypothesis: x.hypothesis,
      funnelEval: x.current_funnel ? { stages: x.current_funnel.stages } : null,
      comparison, measurements: x.measurements, blamedStage, blamedScene,
      retentionMap: x.retention || null
    });
    this.store.append('audit.challenged', { experiment_id: x.experiment_id, episode_id: epId,
      proposed: { verdict, reason, blamedStage, blamedScene }, result: audit }, { author: 'methodology_auditor' });
    const finalVerdict = audit.approved ? verdict : audit.recommended_verdict;
    const ev = this.store.append('verdict.issued', {
      experiment_id: x.experiment_id, episode_id: epId,
      verdict: finalVerdict, proposed_verdict: verdict,
      reason: audit.approved ? reason : `${reason} [REESCRITO PELO AUDITOR: ${audit.objections.filter((o) => o.level === 'bloqueante').map((o) => o.code).join(', ')}]`,
      blamed_stage: audit.approved ? blamedStage : null, blamed_scene: audit.approved ? blamedScene : null,
      comparison, audit, conditions: this.conditionsOf(epId)
    }, { author });
    return { verdict: finalVerdict, audit, event: ev };
  }
  conditionsOf(epId) {
    const x = this.store.experiment(`exp_${epId}`);
    const cfg = x && x.production ? x.production.variable_config : {};
    const m = x && x.measurements.length ? x.measurements[x.measurements.length - 1].metrics : {};
    return { channel: this.channelId, niche: 'disciplina, habitos e filosofia pratica',
      video_length: cfg.target_minutes ? `${cfg.target_minutes[0]}-${cfg.target_minutes[1]}min` : null,
      duration_s: cfg.duration_s || null, traffic_source: m.top_traffic_source || 'indisponivel',
      sample_size: m.impressions == null ? null : m.impressions };
  }

  /* ---------- 7. conhecimento ---------- */
  proposeKnowledge({ statement, conditions, tier = KNOWLEDGE_TIER.PROMISING, supporting = [], contradicting = [], confounders = [], confidence = 'baixa', author = 'editorial_director' }) {
    const id = 'k_' + crypto.createHash('sha1').update(statement).digest('hex').slice(0, 10);
    return this.store.append('knowledge.proposed', { knowledge_id: id, statement, conditions, tier,
      supporting_experiments: supporting, contradicting_experiments: contradicting,
      confounders_noted: confounders, confidence }, { author });
  }
  changeTier(knowledgeId, { tier, reason, confidence, supporting = [], contradicting = [], author = 'editorial_director' }) {
    const current = knowledge.build(this.store).find((k) => k.knowledge_id === knowledgeId);
    if (!current) throw new Error(`conhecimento inexistente: ${knowledgeId}`);
    const audit = auditor.reviewTierChange({ proposal: { tier },
      supportingExperiments: supporting.map((s) => this.store.experiment(s)).filter(Boolean).map((x) => ({ conditions: this.conditionsOf(x.episode_id) })),
      comparisons: [] });
    if (!audit.approved) {
      this.store.append('audit.challenged', { knowledge_id: knowledgeId, proposed: { tier, reason }, result: audit }, { author: 'methodology_auditor' });
      return { applied: false, audit };
    }
    const type = tier === KNOWLEDGE_TIER.DISCARDED ? 'knowledge.demoted' : 'knowledge.promoted';
    const ev = this.store.append(type, { knowledge_id: knowledgeId, from_tier: current.tier, tier,
      reason, confidence, supporting_experiments: supporting, contradicting_experiments: contradicting }, { author });
    return { applied: true, audit, event: ev };
  }
  briefing(topicKeywords) { return knowledge.briefingFor(this.store, { topicKeywords }); }

  /* ---------- 8. registro de edicoes ---------- */
  async recordEdit(epId, { element, from, to, justification, hypothesis, files = [], author = 'presidente' }) {
    if (!EDITABLE.includes(element)) throw new Error(`elemento nao editavel/rastreado: ${element}. Conhecidos: ${EDITABLE.join(', ')}`);
    if (!justification || String(justification).trim().length < 15) throw new Error('edicao sem justificativa escrita');
    const x = this.store.experiment(`exp_${epId}`);
    const metricsAtEdit = x && x.measurements.length ? x.measurements[x.measurements.length - 1] : null;
    const analysis = [];
    for (const f of files) {
      const abs = path.isAbsolute(f) ? f : path.join(this.epDir(epId), f);
      if (fs.existsSync(abs) && /\.png$|\.jpe?g$/i.test(abs)) analysis.push(await thumbs.analyse(abs, { declaredText: typeof to === 'string' ? to : null }));
      else if (fs.existsSync(abs)) analysis.push({ file: abs, bytes: fs.statSync(abs).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex') });
    }
    return this.store.append('edit.recorded', {
      experiment_id: `exp_${epId}`, episode_id: epId, element,
      previous_version: from, new_version: to, justification, hypothesis: hypothesis || null,
      files: analysis,
      metrics_observed_at_edit: metricsAtEdit ? { milestone: metricsAtEdit.milestone, metrics: metricsAtEdit.metrics } : null,
      note: 'Este evento e o historico. Trocar de volta gera outro evento; nada aqui e sobrescrito.'
    }, { author });
  }

  /* ---------- 9. revisao de 48h: recomenda, nunca troca sozinha ---------- */
  review48h(epId, { now = Date.now() } = {}) {
    const x = this.store.experiment(`exp_${epId}`);
    if (!x) return { episode_id: epId, actionable: false, reason: 'nenhum experimento registrado' };
    if (!x.publication) return { episode_id: epId, actionable: false, reason: 'ainda nao publicado: nao ha o que revisar' };
    const since = now - new Date(x.publication.published_at).getTime();
    const hours = since / 3600000;
    const last = x.measurements[x.measurements.length - 1];
    const imp = last && typeof last.metrics.impressions === 'number' ? last.metrics.impressions : null;
    const recs = [];
    const blockers = [];
    if (hours < 48) blockers.push(`so passaram ${hours.toFixed(1)}h desde a publicacao; a janela de revisao e de 48h.`);
    if (imp === null) blockers.push('nao ha impressoes medidas: sem dado nao se decide nada.');
    else if (imp < 1000) blockers.push(`${imp} impressoes e pouco (piso de 1000): a variacao natural ainda domina.`);
    if (x.edits.filter((e) => e.element === 'thumbnail').length && hours < 168)
      blockers.push('ja houve troca de miniatura nesta semana: trocar de novo embaralha o teste nativo do YouTube.');
    if (!blockers.length) {
      const f = x.current_funnel;
      const click = f && f.stages && f.stages.click;
      if (click && click.state === 'OBSERVED_FAILURE')
        recs.push({ element: 'thumbnail/title', rationale: `CTR ${click.relative}% abaixo da referencia com ${click.reached} impressoes.`,
          requires_human: true, how: 'use o teste nativo de miniaturas do YouTube Studio; o sistema nao troca sozinho.' });
      if (click && click.state === 'OBSERVED_SUCCESS')
        recs.push({ element: 'nenhum', rationale: 'CTR acima da referencia: nao mexa no que esta funcionando.', requires_human: false });
    }
    const out = { episode_id: epId, hours_since_publication: +hours.toFixed(1),
      impressions: imp, actionable: blockers.length === 0,
      blockers, recommendations: recs,
      hard_rule: 'o prazo de 48h autoriza OLHAR, nunca trocar. Troca de miniatura so com impressoes suficientes, respeitando o teste nativo do YouTube e com decisao humana.' };
    this.store.append('review.performed', { experiment_id: x.experiment_id, episode_id: epId, ...out }, { author: 'publishing_analytics' });
    return out;
  }

  /* ---------- leitura ---------- */
  experiments() { return this.store.experiments(); }
  stats() { return this.store.stats(); }
  knowledge() { return knowledge.byTier(this.store); }
}
module.exports = { EvolutionEngine, EDITABLE };
