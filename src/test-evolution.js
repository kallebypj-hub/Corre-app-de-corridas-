'use strict';
/**
 * Testes do Evolution Engine.
 * O que precisa ser provado nao e que ele guarda dado: e que ele RECUSA
 * conclusao sem evidencia, preserva historico e nunca transforma ausencia em zero.
 */
require('./env');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const os = require('os');
// tudo que esta suite escreve vai para um sandbox; var/ de producao nao e tocado
process.env.BUDGET_LEDGER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ymc-evo-budget-'));
const { EvolutionStore } = require('./evolution/store');
const { EvolutionEngine } = require('./evolution/engine');
const funnel = require('./evolution/funnel');
const knowledge = require('./evolution/knowledge');
const variables = require('./evolution/variables');
const auditor = require('./evolution/auditor');
const retention = require('./evolution/retention');
const thumbs = require('./evolution/thumbnail-analysis');
const budget = require('./budget');
const { VERDICT, KNOWLEDGE_TIER, EVIDENCE } = require('./evolution/states');

const LAB = 'ch_evo_test';
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log(`\x1b[32m  ok\x1b[0m   ${name}`); }
  catch (e) { fail++; console.log(`\x1b[31m  FALHA\x1b[0m ${name}\n        ${e.message}`); }
}
const cleanup = () => {
  fs.rmSync(path.join(ROOT, 'var', 'evolution', LAB), { recursive: true, force: true });
  fs.rmSync(process.env.BUDGET_LEDGER_DIR, { recursive: true, force: true });
};

(async () => {
  cleanup();

  console.log('\n— registro imutavel —');
  await t('a corrente de hashes detecta evento alterado', () => {
    const s = new EvolutionStore(LAB);
    s.append('experiment.registered', { experiment_id: 'x1', hypothesis: 'h' });
    s.append('measurement.recorded', { experiment_id: 'x1', milestone: 'h24' });
    assert.ok(s.verifyChain().ok);
    const lines = fs.readFileSync(s.logPath, 'utf8').trim().split('\n');
    const ev = JSON.parse(lines[0]); ev.payload.hypothesis = 'mentira';
    lines[0] = JSON.stringify(ev); fs.writeFileSync(s.logPath, lines.join('\n') + '\n');
    const v = new EvolutionStore(LAB).verifyChain();
    assert.strictEqual(v.ok, false);
    assert.ok(/alterado/.test(v.reason), v.reason);
    cleanup();
  });
  await t('a corrente detecta evento removido', () => {
    const s = new EvolutionStore(LAB);
    for (let i = 0; i < 3; i++) s.append('experiment.registered', { experiment_id: 'x' + i });
    const lines = fs.readFileSync(s.logPath, 'utf8').trim().split('\n');
    fs.writeFileSync(s.logPath, [lines[0], lines[2]].join('\n') + '\n');
    assert.strictEqual(new EvolutionStore(LAB).verifyChain().ok, false);
    cleanup();
  });
  await t('veredicto anterior nao some quando outro e emitido', () => {
    const s = new EvolutionStore(LAB);
    s.append('experiment.registered', { experiment_id: 'x1', hypothesis: 'h' });
    s.append('verdict.issued', { experiment_id: 'x1', verdict: VERDICT.INCONCLUSIVE, reason: 'r1' });
    s.append('verdict.issued', { experiment_id: 'x1', verdict: VERDICT.SUPPORTED, reason: 'r2' });
    const x = s.experiment('x1');
    assert.strictEqual(x.current_verdict.verdict, VERDICT.SUPPORTED);
    assert.strictEqual(x.superseded_verdicts.length, 1, 'o veredicto antigo tem de continuar legivel');
    assert.strictEqual(x.superseded_verdicts[0].verdict, VERDICT.INCONCLUSIVE);
    cleanup();
  });

  console.log('\n— a regra central: sem alcance, sem culpa —');
  const collapsed = funnel.evaluate(
    { impressions: 12000, impressionsCtr: 0.031, views: 380, retention_0_30s: 0.11, retention_mid: 0, retention_end: 0 },
    { baseline: { impressions: 10000, impressionsCtr: 0.045, retention_0_30s: 0.55, retention_mid: 0.3, retention_end: 0.18 } });
  await t('culpar etapa que o publico nao alcancou e RECUSADO', () => {
    const g = funnel.canAttributeFailure(collapsed, 'final_retention');
    assert.strictEqual(g.allowed, false);
    assert.strictEqual(g.state, 'STAGE_NOT_REACHED');
  });
  await t('culpar etapa com evidencia suficiente e PERMITIDO', () => {
    const g = funnel.canAttributeFailure(collapsed, 'click');
    assert.strictEqual(g.allowed, true);
    assert.strictEqual(g.state, 'OBSERVED_FAILURE');
    assert.ok(g.reached >= 500);
  });
  await t('sem metrica nenhuma, nada e culpavel e nada vira zero', () => {
    const f = funnel.evaluate({});
    for (const s of Object.values(f.stages)) {
      assert.strictEqual(s.state, 'DATA_UNAVAILABLE');
      assert.notStrictEqual(s.value, 0, 'ausencia virou zero');
    }
    assert.strictEqual(funnel.summary(f).blameable_stages.length, 0);
  });
  await t('culpar CENA sem curva de retencao e recusado', () => {
    const sb = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/channels/ch_practical_discipline/episodes/ep_001/storyboard.json'), 'utf8'));
    const map = retention.mapToScenes(null, sb, null, null);
    const g = funnel.canAttributeFailureToScene(collapsed, map, 's08');
    assert.strictEqual(g.allowed, false);
    assert.ok(/DATA_UNAVAILABLE|retencao/.test(g.state + g.reason));
  });
  await t('curva com despenhadeiro e detectada como queda notavel', () => {
    const sb = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/channels/ch_practical_discipline/episodes/ep_001/storyboard.json'), 'utf8'));
    const curve = [];
    for (let i = 0; i <= 50; i++) { const x = i / 50; curve.push({ ratio: x, audience: x < 0.3 ? 0.9 - x * 0.1 : (x < 0.36 ? 0.87 - (x - 0.3) * 8 : 0.39 - (x - 0.36) * 0.2) }); }
    const map = retention.mapToScenes(curve, sb, null, 5000);
    assert.ok(map.available);
    assert.ok(map.notable_drops.length >= 1, 'nao achou a queda');
    assert.ok(map.notable_drops[0].hypotheses.length >= 1, 'queda sem hipotese');
    assert.ok(map.notable_drops.every((d) => d.hypotheses.every((x) => x.confidence === 'nao testada')), 'hipotese apresentada como certeza');
  });

  console.log('\n— auditor metodologico —');
  await t('linguagem causal em estudo observacional e bloqueada', () => {
    const r = auditor.review({ proposedVerdict: { verdict: VERDICT.CONTRADICTED, reason: 'a abertura causou o abandono' },
      funnelEval: collapsed, comparison: { causal_claim_allowed: false, differing_count: 1, differing: [{ variable: 'hook_style' }] },
      measurements: [{ milestone: 'd7', metrics: { impressions: 9000 } }] });
    assert.strictEqual(r.approved, false);
    assert.ok(r.objections.some((o) => o.code === 'LINGUAGEM_CAUSAL'));
  });
  await t('amostra pequena bloqueia veredicto que nao seja "aguardando dados"', () => {
    const r = auditor.review({ proposedVerdict: { verdict: VERDICT.SUPPORTED, reason: 'foi melhor' },
      funnelEval: collapsed, comparison: null, measurements: [{ milestone: 'h24', metrics: { impressions: 120 } }] });
    assert.ok(r.objections.some((o) => o.code === 'AMOSTRA_INSUFICIENTE'));
    assert.strictEqual(r.approved, false);
  });
  await t('generalizar fora das condicoes testadas e bloqueado', () => {
    const r = auditor.review({ proposedVerdict: { verdict: VERDICT.SUPPORTED, reason: 'funcionou', generalize: true },
      funnelEval: collapsed, comparison: null, measurements: [{ milestone: 'd28', metrics: { impressions: 50000 } }] });
    assert.ok(r.objections.some((o) => o.code === 'GENERALIZACAO_INDEVIDA'));
  });
  await t('promover a pratica sustentada com menos de 3 experimentos e bloqueado', () => {
    const r = auditor.reviewTierChange({ proposal: { tier: KNOWLEDGE_TIER.SUPPORTED }, supportingExperiments: [{ conditions: {} }, { conditions: {} }] });
    assert.strictEqual(r.approved, false);
    assert.ok(r.objections.some((o) => o.code === 'POUCOS_EXPERIMENTOS'));
  });

  console.log('\n— conhecimento sempre preso as condicoes —');
  await t('citar conhecimento inclui obrigatoriamente as condicoes', () => {
    const c = knowledge.cite({ statement: 'X funciona', conditions: { channel: 'ch', niche: 'n', sample_size: 100 },
      supporting_experiments: ['a'], contradicting_experiments: [], confidence: 'baixa' });
    assert.ok(/valido apenas em/.test(c));
    assert.ok(/ch/.test(c) && /n/.test(c));
  });
  await t('descartar e sempre condicional, nunca definitivo', () => {
    const p = knowledge.proposeTierChange({}, [{ verdict: VERDICT.CONTRADICTED }, { verdict: VERDICT.CONTRADICTED }]);
    assert.strictEqual(p.tier, KNOWLEDGE_TIER.DISCARDED);
    assert.ok(/SOMENTE nas condicoes testadas/i.test(p.reason), p.reason);
  });

  console.log('\n— motor ponta a ponta —');
  const engine = new EvolutionEngine(LAB);
  await t('experimento exige hipotese e variavel conhecida', () => {
    assert.throws(() => engine.register('ep_x', { hypothesis: 'curta', variable: 'hook_style' }), /hipotese/i);
    assert.throws(() => engine.register('ep_x', { hypothesis: 'uma hipotese suficientemente longa para passar', variable: 'inexistente' }), /nao existe|desconhecida/i);
  });
  await t('registro duplicado e recusado: corrigir gera evento novo', () => {
    engine.register('ep_x', { hypothesis: 'uma hipotese suficientemente longa para passar no teste', variable: 'hook_style' });
    assert.throws(() => engine.register('ep_x', { hypothesis: 'outra hipotese suficientemente longa aqui', variable: 'hook_style' }), /ja registrado/i);
  });
  await t('metrica ausente e gravada como ausente, nunca como zero', () => {
    engine.recordMeasurement('ep_x', { milestone: 'h24', metrics: { impressions: 1200, impressionsCtr: 0.04, estimatedRevenue: 'indisponivel', retention_mid: null } });
    const x = engine.store.experiment('exp_ep_x');
    const m = x.measurements[0];
    assert.strictEqual(m.metrics.estimatedRevenue, null);
    assert.ok(m.missing_metrics.includes('estimatedRevenue'));
    assert.ok(m.missing_metrics.includes('retention_mid'));
    assert.notStrictEqual(m.metrics.estimatedRevenue, 0);
  });
  await t('veredicto que viola o auditor e reescrito e os dois ficam registrados', () => {
    engine.store.append('funnel.evaluated', { experiment_id: 'exp_ep_x', episode_id: 'ep_x', stages: collapsed.stages, summary: funnel.summary(collapsed) });
    const r = engine.issueVerdict('ep_x', { verdict: VERDICT.CONTRADICTED, reason: 'a cena final causou o abandono', blamedStage: 'final_retention' });
    assert.notStrictEqual(r.verdict, VERDICT.CONTRADICTED, 'o auditor deixou passar');
    const x = engine.store.experiment('exp_ep_x');
    const v = x.current_verdict;
    assert.strictEqual(v.proposed_verdict, VERDICT.CONTRADICTED);
    assert.ok(/REESCRITO PELO AUDITOR/.test(v.reason));
    assert.strictEqual(v.blamed_stage, null, 'a culpa sem alcance nao pode sobreviver no registro');
    assert.ok(x.challenges.length >= 1, 'a objecao do auditor precisa ficar registrada');
  });
  await t('edicao exige justificativa e guarda versao anterior', async () => {
    await assert.rejects(() => engine.recordEdit('ep_x', { element: 'title', from: 'a', to: 'b', justification: 'curta' }), /justificativa/i);
    await engine.recordEdit('ep_x', { element: 'title', from: 'Titulo velho', to: 'Titulo novo',
      justification: 'CTR abaixo da referencia com impressoes suficientes', hypothesis: 'titulo em pergunta atrai mais' });
    const x = engine.store.experiment('exp_ep_x');
    assert.strictEqual(x.edits.length, 1);
    assert.strictEqual(x.edits[0].previous_version, 'Titulo velho');
    assert.ok(x.edits[0].metrics_observed_at_edit, 'a edicao precisa guardar a metrica do momento');
  });
  await t('revisao de 48h nao troca nada sozinha e explica o que trava', () => {
    engine.store.append('experiment.published', { experiment_id: 'exp_ep_x', episode_id: 'ep_x', video_id: 'VID', privacy: 'private', published_at: new Date(Date.now() - 10 * 3600000).toISOString() });
    const r = engine.review48h('ep_x');
    assert.strictEqual(r.actionable, false);
    assert.ok(r.blockers.some((b) => /48h|horas/.test(b)));
    assert.ok(/nunca trocar|autoriza OLHAR/i.test(r.hard_rule));
    assert.strictEqual(r.recommendations.length, 0);
  });
  await t('revisao com impressoes insuficientes continua travada mesmo depois de 48h', () => {
    const e2 = new EvolutionEngine(LAB);
    e2.store.append('experiment.registered', { experiment_id: 'exp_ep_y', episode_id: 'ep_y', hypothesis: 'h', primary_variable: 'hook_style', registered_before_production: true });
    e2.store.append('experiment.published', { experiment_id: 'exp_ep_y', episode_id: 'ep_y', video_id: 'V2', privacy: 'private', published_at: new Date(Date.now() - 100 * 3600000).toISOString() });
    e2.store.append('measurement.recorded', { experiment_id: 'exp_ep_y', episode_id: 'ep_y', milestone: 'd7', metrics: { impressions: 300 } });
    const r = e2.review48h('ep_y');
    assert.strictEqual(r.actionable, false);
    assert.ok(r.blockers.some((b) => /impress/.test(b)));
  });

  console.log('\n— comparabilidade —');
  await t('comparacao nunca autoriza afirmar causa', () => {
    const a = variables.readConfig({ brief: { experiment: { hook_style: 'a' } }, script: { scenes: [{ motif: 'm1' }] }, timeline: null, storyboard: null });
    const b = variables.readConfig({ brief: { experiment: { hook_style: 'b' } }, script: { scenes: [{ motif: 'm2' }] }, timeline: null, storyboard: null });
    const c = variables.compare(a, b, { declaredVariable: 'hook_style' });
    assert.strictEqual(c.causal_claim_allowed, false);
    assert.ok(c.differing_count >= 1);
  });

  console.log('\n— orcamento —');
  await t('teto rigido recusa a chamada paga e registra a recusa', () => {
    const before = budget.summary('ch_practical_discipline').denied_attempts;
    const r = budget.authorize({ channelId: 'ch_practical_discipline', category: 'api_llm', amountUsd: 1.0, purpose: 'teste' });
    assert.strictEqual(r.allowed, false);
    assert.ok(/teto/.test(r.reason));
    assert.strictEqual(budget.summary('ch_practical_discipline').denied_attempts, before + 1);
  });
  await t('categoria desconhecida e recusada', () => {
    assert.strictEqual(budget.authorize({ channelId: 'ch_practical_discipline', category: 'inventada', amountUsd: 1 }).allowed, false);
  });

  console.log('\n— miniatura medida, nao declarada —');
  await t('analise de miniatura sai do pixel e separa medida de declaracao', async () => {
    const f = path.join(ROOT, 'content/channels/ch_practical_discipline/episodes/ep_002/thumbnail_B.png');
    const a = await thumbs.analyse(f, { declaredText: 'Only 23% ever got there', emotionalIntent: 'surpresa' });
    assert.ok(a.measured.dominant_colors.length >= 3);
    assert.ok(a.measured.contrast_ratio_p5_p95 > 1);
    assert.ok(a.measured.text_mass_box_pct, 'nao achou a massa de texto');
    assert.strictEqual(a.declared.emotional_intent, 'surpresa');
    assert.ok(/DECLARACAO/.test(a.declared.note), 'a separacao medida x declaracao precisa estar escrita');
    assert.strictEqual(a.sha256.length, 64);
  });

  console.log('\n— episodios reais —');
  await t('os dois episodios tem experimento registrado antes da producao', () => {
    const e = new EvolutionEngine('ch_practical_discipline');
    for (const ep of ['ep_001', 'ep_002']) {
      const x = e.store.experiment(`exp_${ep}`);
      assert.ok(x, `${ep} sem experimento`);
      assert.strictEqual(x.registered_before_production, true);
      assert.ok(String(x.hypothesis).length > 20);
      assert.ok(variables.VARIABLES[x.primary_variable], 'variavel fora do laboratorio');
    }
  });
  await t('o segundo episodio cita aprendizado do primeiro, e o primeiro nao finge ter aprendido de ninguem', () => {
    const e = new EvolutionEngine('ch_practical_discipline');
    const a = e.store.experiment('exp_ep_001'), b = e.store.experiment('exp_ep_002');
    assert.strictEqual((a.applies_learning || []).length, 0, 'a linha de base nao pode citar aprendizado inexistente');
    assert.ok((b.applies_learning || []).length >= 1);
    assert.ok(b.applies_learning.some((x) => /NAO DE AUDIENCIA|producao/i.test(x)),
      'o ep_002 precisa deixar claro que o aprendizado e de producao, nao de audiencia');
  });
  await t('o registro real esta integro', () => {
    const st = new EvolutionEngine('ch_practical_discipline').stats();
    assert.ok(st.chain.ok, st.chain.reason);
    assert.ok(st.events >= 4);
  });

  cleanup();
  console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} aprovados, ${fail} falhas\x1b[0m`);
  if (fail) process.exit(1);
})().catch((e) => { console.error('ERRO NA SUITE:', e.stack || e.message); process.exit(1); });
