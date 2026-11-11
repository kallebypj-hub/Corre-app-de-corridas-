'use strict';
/**
 * Vocabulario de evidencia do Evolution Engine.
 *
 * A regra que organiza tudo: NINGUEM atribui falha a uma etapa sem prova de que
 * o publico chegou ate ela. Por isso "nao avaliado" e "sem dado" sao estados de
 * primeira classe, nao sinonimos de ruim.
 */
const EVIDENCE = {
  OBSERVED_FAILURE: {
    label: 'falha observada',
    meaning: 'ha medida suficiente mostrando que esta etapa teve desempenho pior que a referencia.',
    allows_blame: true
  },
  OBSERVED_SUCCESS: {
    label: 'desempenho observado acima da referencia',
    meaning: 'ha medida suficiente mostrando desempenho melhor que a referencia.',
    allows_blame: false
  },
  UNPROVEN_HYPOTHESIS: {
    label: 'hipotese de falha, ainda sem prova',
    meaning: 'alguem suspeita desta etapa, mas a medida nao sustenta a acusacao.',
    allows_blame: false
  },
  INCONCLUSIVE_SAMPLE: {
    label: 'inconclusivo por amostra insuficiente',
    meaning: 'ha dado, mas pouco demais para distinguir do acaso.',
    allows_blame: false
  },
  STAGE_NOT_REACHED: {
    label: 'etapa nao avaliada: o publico nao chegou ate aqui',
    meaning: 'o funil se perdeu antes. Culpar esta etapa seria inventar.',
    allows_blame: false
  },
  DATA_UNAVAILABLE: {
    label: 'sem dado',
    meaning: 'a API, a distribuicao ou o limite de medicao nao entregaram este numero.',
    allows_blame: false
  }
};

/** Etapas do funil, na ordem em que o publico as atravessa. */
const FUNNEL = [
  { id: 'exposure',        label: 'exposicao',            metric: 'impressions',
    depends_on: null,            min_sample: 500,  question: 'o YouTube mostrou o video para alguem?' },
  { id: 'click',           label: 'clique',               metric: 'impressionsCtr',
    depends_on: 'exposure',      min_sample: 500,  question: 'quem viu a miniatura clicou?' },
  { id: 'early_retention', label: 'retencao inicial',     metric: 'retention_0_30s',
    depends_on: 'click',         min_sample: 50,   question: 'quem clicou passou dos primeiros 30 segundos?' },
  { id: 'mid_retention',   label: 'retencao intermediaria', metric: 'retention_mid',
    depends_on: 'early_retention', min_sample: 50, question: 'quem passou do inicio chegou ao meio?' },
  { id: 'final_retention', label: 'retencao final',       metric: 'retention_end',
    depends_on: 'mid_retention', min_sample: 50,   question: 'quem chegou ao meio terminou?' },
  { id: 'shorts_to_long',  label: 'conversao de Short para longo', metric: 'shorts_referral_views',
    depends_on: null,            min_sample: 30,   question: 'o Short levou gente para o episodio completo?' },
  { id: 'revenue',         label: 'receita',              metric: 'estimatedRevenue',
    depends_on: 'final_retention', min_sample: 1000, question: 'o tempo assistido virou dinheiro?' }
];
const FUNNEL_IDS = FUNNEL.map((f) => f.id);
function stage(id) { return FUNNEL.find((f) => f.id === id) || null; }

/** Marcos de coleta. O sistema registra o que faltou, nao preenche. */
const MILESTONES = [
  { id: 'h24', hours: 24,  label: '24 horas' },
  { id: 'h72', hours: 72,  label: '72 horas' },
  { id: 'd7',  hours: 168, label: '7 dias' },
  { id: 'd28', hours: 672, label: '28 dias' }
];

const VERDICT = {
  SUPPORTED: 'apoiado',
  CONTRADICTED: 'contraditado',
  INCONCLUSIVE: 'inconclusivo',
  AWAITING_DATA: 'aguardando dados'
};

const KNOWLEDGE_TIER = {
  PROMISING: 'hipotese_promissora',
  SUPPORTED: 'pratica_sustentada_por_evidencia',
  DISCARDED: 'descartada_ou_inconclusiva'
};

module.exports = { EVIDENCE, FUNNEL, FUNNEL_IDS, stage, MILESTONES, VERDICT, KNOWLEDGE_TIER };
