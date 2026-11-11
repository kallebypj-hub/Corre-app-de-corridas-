'use strict';
/**
 * Declaracao honesta de autonomia por estagio.
 *
 * O sistema NAO finge que se vira sozinho. Cada estagio declara de quem depende
 * para existir. Isso aparece no relatorio, no painel e no quality_report, para
 * que ninguem confunda "o pipeline roda sozinho" com "a empresa pensa sozinha".
 */
const LEVELS = {
  automated: {
    label: 'automatico',
    meaning: 'codigo deterministico desta maquina, sem pessoa nem modelo externo no caminho. Roda de novo igual.'
  },
  local_model: {
    label: 'modelo local',
    meaning: 'usa um modelo que roda nesta maquina (TTS, reconhecimento de fala). Sem rede, sem fatura, mas com variacao propria de modelo.'
  },
  assisted: {
    label: 'assistido',
    meaning: 'o conteudo foi escrito por trabalho intelectual nesta sessao do Claude Code, nao gerado pelo pipeline. Um proximo episodio exige o mesmo trabalho de novo, por uma pessoa ou por um agente.'
  },
  requires_external_agent: {
    label: 'depende de agente externo',
    meaning: 'so roda sozinho com uma LLM configurada e autorizacao de gasto. Hoje esta desligado: o pipeline NAO gera isto por conta propria.'
  },
  requires_human: {
    label: 'depende de pessoa',
    meaning: 'exige decisao do proprietario. Nenhum automatismo substitui.'
  }
};

/** O que cada estagio REALMENTE e hoje, e o que seria preciso para virar automatico. */
const STAGE_AUTONOMY = {
  strategy:         { level: 'automated',               gap: null },
  ideation:         { level: 'assisted',                gap: 'Gerar pauta com evidencia sozinho exigiria LLM configurada + fonte de sinal de busca autenticada. Hoje a lista vem de config/ e foi escrita nesta sessao.' },
  selection:        { level: 'automated',               gap: 'A escolha segue a regra do brief do episodio; a formulacao do criterio foi humana/assistida.' },
  research:         { level: 'assisted',                gap: 'Encontrar e ler fontes primarias exige agente com acesso a web ou pessoa. O pipeline apenas VALIDA o dossie que recebe.' },
  script:           { level: 'assisted',                gap: 'Roteiro original exige LLM configurada ou pessoa. O pipeline le o roteiro do episodio e o transforma em markdown.' },
  factcheck:        { level: 'automated',               gap: 'A VERIFICACAO da afirmacao contra a fonte e assistida e fica registrada na matriz; o pipeline cobra que toda afirmacao detectada tenha entrada verificada e bloqueia quando nao tem.' },
  narrative_review: { level: 'automated',               gap: 'Checagens mecanicas. Julgamento editorial fino continua humano e sai listado como pendencia.' },
  storyboard:       { level: 'automated',               gap: null },
  media_rights:     { level: 'automated',               gap: null },
  voice:            { level: 'local_model',             gap: null },
  align:            { level: 'local_model',             gap: null },
  scenes:           { level: 'automated',               gap: null },
  edit:             { level: 'automated',               gap: null },
  captions:         { level: 'automated',               gap: null },
  thumbnail:        { level: 'automated',               gap: 'Os textos das miniaturas vem do brief do episodio, escritos de forma assistida.' },
  seo:              { level: 'automated',               gap: 'Titulo, descricao e tags vem do brief; capitulos sao calculados do audio medido.' },
  shorts:           { level: 'automated',               gap: 'A ESCOLHA dos trechos vem do brief (decisao editorial assistida); o corte, o 9:16 e a legenda sao automaticos.' },
  provenance:       { level: 'automated',               gap: null },
  qa:               { level: 'automated',               gap: null }
};

function declare(stageId) {
  const a = STAGE_AUTONOMY[stageId];
  if (!a) return { level: 'automated', label: LEVELS.automated.label, meaning: LEVELS.automated.meaning, gap: null };
  return { level: a.level, label: LEVELS[a.level].label, meaning: LEVELS[a.level].meaning, gap: a.gap };
}
/** Resumo para o relatorio: quais estagios NAO sao autonomos hoje. */
function notAutonomous() {
  return Object.entries(STAGE_AUTONOMY)
    .filter(([, a]) => a.level === 'assisted' || a.level === 'requires_external_agent' || a.level === 'requires_human')
    .map(([id, a]) => ({ stage: id, level: a.level, label: LEVELS[a.level].label, gap: a.gap }));
}
module.exports = { LEVELS, STAGE_AUTONOMY, declare, notAutonomous };
