'use strict';
/**
 * AUDITOR METODOLOGICO — o agente que diz nao.
 *
 * Funcao unica: impedir que correlacao vire certeza. Ele questiona relacao
 * causal, aponta fator de confusao, exige amostra e recusa veredicto que culpe
 * etapa onde o publico nunca chegou. Ele nao produz nada; ele barra.
 */
const { EVIDENCE, VERDICT } = require('./states');
const funnel = require('./funnel');
const variables = require('./variables');

const CAUSAL_WORDS = /\b(porque|por causa|causou|causa|devido a|gerou|fez com que|resultou em|prova que|comprova|demonstra que|caused|because of|proves)\b/i;

/**
 * Revisa um veredicto proposto. Devolve objecoes; se houver objecao bloqueante,
 * o veredicto nao pode ser emitido como esta.
 */
function review({ proposedVerdict, hypothesis, funnelEval, comparison, measurements = [], blamedStage = null, blamedScene = null, retentionMap = null }) {
  const objections = [];
  const add = (level, code, message, fix) => objections.push({ level, code, message, fix });

  // 1) linguagem causal em estudo observacional
  if (comparison && comparison.causal_claim_allowed === false && CAUSAL_WORDS.test(String(proposedVerdict.reason || ''))) {
    add('bloqueante', 'LINGUAGEM_CAUSAL',
      'o texto do veredicto afirma causa, mas a comparacao e observacional.',
      'reescreva como associacao: "veio junto com", "coincidiu com", em vez de "causou".');
  }
  // 2) culpa sem alcance
  if (blamedStage) {
    const g = funnel.canAttributeFailure(funnelEval, blamedStage);
    if (!g.allowed) add('bloqueante', 'CULPA_SEM_ALCANCE',
      `o veredicto culpa a etapa "${blamedStage}", mas ${g.reason}`,
      'aponte a primeira etapa com evidencia suficiente, ou declare o resultado como inconclusivo.');
  }
  if (blamedScene) {
    const g = funnel.canAttributeFailureToScene(funnelEval, retentionMap, blamedScene);
    if (!g.allowed) add('bloqueante', 'CULPA_DE_CENA_SEM_PUBLICO',
      `o veredicto culpa a cena "${blamedScene}", mas ${g.reason}`,
      'so e possivel discutir uma cena quando ha curva de retencao mostrando publico nela.');
  }
  // 3) fatores de confusao
  if (comparison && comparison.differing_count > 1) {
    add(comparison.differing_count > 3 ? 'bloqueante' : 'alerta', 'CONFUNDIDORES',
      `${comparison.differing_count} variaveis diferem entre os episodios comparados: ${comparison.differing.map((d) => d.variable).join(', ')}.`,
      'isole a variavel declarada, ou rebaixe o veredicto para inconclusivo citando os confundidores.');
  }
  // 4) amostra
  const latest = measurements[measurements.length - 1];
  if (!latest) {
    add('bloqueante', 'SEM_MEDIDA', 'nenhuma medida foi registrada para este experimento.',
      'colete ao menos um marco antes de emitir veredicto, ou use "aguardando dados".');
  } else {
    const imp = latest.metrics && latest.metrics.impressions;
    if (typeof imp === 'number' && imp < 500 && proposedVerdict.verdict !== VERDICT.AWAITING_DATA)
      add('bloqueante', 'AMOSTRA_INSUFICIENTE', `apenas ${imp} impressoes no marco ${latest.milestone}.`,
        'aguarde o proximo marco ou emita "inconclusivo por amostra insuficiente".');
    if (latest.milestone === 'h24' && proposedVerdict.verdict !== VERDICT.AWAITING_DATA && proposedVerdict.verdict !== VERDICT.INCONCLUSIVE)
      add('alerta', 'JANELA_CURTA', 'veredicto em 24 horas: a distribuicao do YouTube ainda esta se formando.',
        'confirme no marco de 7 ou 28 dias antes de promover isto a conhecimento.');
  }
  // 5) tamanho do efeito
  if (comparison && proposedVerdict.verdict === VERDICT.SUPPORTED && funnelEval) {
    const anyStrong = Object.values(funnelEval.stages || {}).some((s) => s.state === 'OBSERVED_SUCCESS');
    if (!anyStrong) add('bloqueante', 'SEM_EFEITO_OBSERVADO',
      'o veredicto diz "apoiado" mas nenhuma etapa do funil ficou acima da referencia com amostra suficiente.',
      'use "inconclusivo".');
  }
  // 6) generalizacao
  if (proposedVerdict.generalize === true)
    add('bloqueante', 'GENERALIZACAO_INDEVIDA',
      'o veredicto quer valer fora das condicoes testadas.',
      'toda conclusao fica presa ao canal, nicho, duracao e origem de trafego em que foi medida.');

  const blocking = objections.filter((o) => o.level === 'bloqueante');
  return {
    approved: blocking.length === 0,
    objections, blocking_count: blocking.length,
    recommended_verdict: blocking.length === 0 ? proposedVerdict.verdict
      : (measurements.length ? VERDICT.INCONCLUSIVE : VERDICT.AWAITING_DATA),
    reviewed_at: new Date().toISOString(),
    auditor: 'methodology_auditor'
  };
}

/** Revisa uma proposta de mudanca de camada no conhecimento. */
function reviewTierChange({ proposal, supportingExperiments = [], comparisons = [] }) {
  const objections = [];
  const distinctConditions = new Set(supportingExperiments.map((x) => JSON.stringify((x.conditions || {}))));
  if (supportingExperiments.length && distinctConditions.size === 1)
    objections.push({ level: 'alerta', code: 'CONDICAO_UNICA',
      message: 'todos os experimentos de apoio rodaram na mesma condicao.',
      fix: 'a conclusao fica valida so nessa condicao; registre isso no campo conditions.' });
  const uncontrolled = comparisons.filter((c) => c.comparability !== 'controlado_em_uma_variavel').length;
  if (uncontrolled && uncontrolled === comparisons.length)
    objections.push({ level: 'alerta', code: 'TUDO_OBSERVACIONAL',
      message: 'nenhuma das comparacoes isolou a variavel declarada.',
      fix: 'mantenha a confianca em "baixa" ate haver ao menos uma comparacao controlada.' });
  if (proposal && proposal.tier === 'pratica_sustentada_por_evidencia' && supportingExperiments.length < 3)
    objections.push({ level: 'bloqueante', code: 'POUCOS_EXPERIMENTOS',
      message: `promocao a pratica sustentada com apenas ${supportingExperiments.length} experimento(s).`,
      fix: 'minimo de 3 experimentos independentes apoiando e nenhum contraditando.' });
  const blocking = objections.filter((o) => o.level === 'bloqueante');
  return { approved: blocking.length === 0, objections, reviewed_at: new Date().toISOString(), auditor: 'methodology_auditor' };
}
module.exports = { review, reviewTierChange, CAUSAL_WORDS };
