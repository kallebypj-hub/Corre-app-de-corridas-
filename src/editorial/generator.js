'use strict';
/**
 * GERACAO EDITORIAL CONFIGURAVEL.
 *
 * Hoje pesquisa, ideacao e roteiro sao ASSISTIDOS: o conteudo e escrito por
 * pessoa ou por uma sessao de agente, e o pipeline apenas valida e bloqueia.
 * Este modulo e o encaixe para isso mudar sem reescrever o pipeline — e ele
 * recusa declarar autonomia que nao existe.
 *
 * Provedores:
 *   manual      (padrao) — le os 4 arquivos do episodio. Zero custo, zero rede.
 *   local_llm   — endpoint compativel com OpenAI rodando NESTA maquina
 *                 (llama.cpp, ollama...). Zero custo externo. Desligado ate ter URL.
 *   external_api— provedor pago. Passa pelo teto de orcamento e hoje e recusado.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('../episode-config');
const budget = require('../budget');
const { Logger } = require('../log');

const log = new Logger('editorial');
const ROOT = path.join(__dirname, '..', '..');

const PROVIDERS = {
  manual: {
    label: 'manual/assistido',
    autonomy: 'assisted',
    external_cost: false,
    enabled: () => true,
    describe: () => 'o conteudo vem dos 4 arquivos do episodio, escritos por pessoa ou por uma sessao de agente. O pipeline valida e bloqueia; nao escreve.'
  },
  local_llm: {
    label: 'modelo local',
    autonomy: 'local_model',
    external_cost: false,
    enabled: () => !!process.env.LOCAL_LLM_URL,
    describe: () => process.env.LOCAL_LLM_URL
      ? `endpoint local em ${process.env.LOCAL_LLM_URL} (modelo ${process.env.LOCAL_LLM_MODEL || 'nao declarado'})`
      : 'nenhum endpoint local configurado (defina LOCAL_LLM_URL). Enquanto isso, desligado.'
  },
  external_api: {
    label: 'provedor externo pago',
    autonomy: 'requires_external_agent',
    external_cost: true,
    enabled: () => !!(process.env.EDITORIAL_API_KEY && process.env.EDITORIAL_API_URL),
    describe: () => 'provedor pago. Exige chave, URL e teto de orcamento maior que zero. Hoje o teto e US$ 0,00, entao toda chamada e recusada antes de sair.'
  }
};

function selected() { return process.env.EDITORIAL_PROVIDER || 'manual'; }
function status() {
  const sel = selected();
  return {
    selected: sel,
    valid: !!PROVIDERS[sel],
    providers: Object.entries(PROVIDERS).map(([k, p]) => ({
      id: k, label: p.label, autonomy: p.autonomy, external_cost: p.external_cost,
      enabled: p.enabled(), description: p.describe(), active: k === sel })),
    assisted_stages: ['ideation', 'research', 'script'],
    honest_statement: sel === 'manual'
      ? 'Hoje a empresa NAO gera pauta, pesquisa nem roteiro sozinha. Esses tres estagios sao assistidos e vao exigir o mesmo trabalho no proximo episodio.'
      : `Provedor "${sel}" selecionado. A autonomia declarada muda para "${PROVIDERS[sel] ? PROVIDERS[sel].autonomy : 'desconhecida'}" apenas se ele estiver de fato habilitado.`,
    how_to_enable_local: 'suba um servidor compativel com OpenAI nesta maquina e defina LOCAL_LLM_URL e LOCAL_LLM_MODEL. Custo externo continua zero.',
    how_to_enable_paid: 'exige, nesta ordem: (1) voce elevar o teto em config/budget.json, (2) EDITORIAL_API_KEY e EDITORIAL_API_URL no .env. Sem (1), a chamada e recusada mesmo com chave.'
  };
}

/**
 * Pede um artefato editorial. Em modo manual, apenas confirma que o arquivo existe.
 * Em modo LLM, chama o provedor — e, se for pago, passa pelo teto ANTES de sair.
 */
async function generate(kind, { channelId, epId, prompt = null, estimatedCostUsd = 0 } = {}) {
  const sel = selected();
  const p = PROVIDERS[sel];
  if (!p) throw new Error(`EDITORIAL_PROVIDER desconhecido: ${sel}. Conhecidos: ${Object.keys(PROVIDERS).join(', ')}`);
  if (!p.enabled()) return { generated: false, provider: sel, autonomy: p.autonomy,
    reason: `provedor "${sel}" nao esta habilitado: ${p.describe()}`, fallback: 'manual' };

  if (sel === 'manual') {
    const fileFor = { ideation: null, research: 'sources.json', script: 'script_en.json', claims: 'claims.json', brief: 'brief.json' }[kind];
    if (!fileFor) return { generated: false, provider: 'manual', autonomy: 'assisted',
      reason: `"${kind}" nao tem arquivo correspondente; em modo manual esse artefato e escrito a mao` };
    const f = path.join(cfg.episodeDir(channelId, epId), fileFor);
    return { generated: false, provider: 'manual', autonomy: 'assisted', file: fileFor,
      present: fs.existsSync(f),
      reason: fs.existsSync(f) ? `${fileFor} ja existe; o pipeline vai validar, nao gerar`
        : `${fileFor} nao existe. Em modo manual, escreva-o antes de produzir (docs/novo-episodio.md).` };
  }

  if (p.external_cost) {
    const auth = budget.authorize({ channelId, category: 'api_llm', amountUsd: estimatedCostUsd,
      experimentId: `exp_${epId}`, purpose: `gerar ${kind}` });
    if (!auth.allowed) return { generated: false, provider: sel, autonomy: p.autonomy,
      reason: `recusado pelo teto de orcamento: ${auth.reason}`, budget_blocked: true };
  }
  const url = sel === 'local_llm' ? process.env.LOCAL_LLM_URL : process.env.EDITORIAL_API_URL;
  const model = sel === 'local_llm' ? (process.env.LOCAL_LLM_MODEL || 'local') : (process.env.EDITORIAL_API_MODEL || 'default');
  const { request } = require('../youtube/http');
  const body = JSON.stringify({ model, messages: [{ role: 'user', content: String(prompt || '') }], temperature: 0.7 });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
  if (sel === 'external_api') headers.Authorization = `Bearer ${process.env.EDITORIAL_API_KEY}`;
  const res = await request(`${url.replace(/\/$/, '')}/chat/completions`, { method: 'POST', body, headers, timeout: 300000 });
  if (res.status !== 200 || !res.json) return { generated: false, provider: sel, autonomy: p.autonomy,
    reason: `provedor respondeu HTTP ${res.status}` };
  const text = ((res.json.choices || [])[0] || {}).message?.content || null;
  if (p.external_cost) budget.record(channelId, { category: 'api_llm', amountUsd: estimatedCostUsd,
    experimentId: `exp_${epId}`, purpose: `gerar ${kind}`, outcome: 'charged', provider: sel });
  log.info(`${kind} gerado por ${sel}`);
  return { generated: true, provider: sel, autonomy: p.autonomy, model, text,
    note: 'conteudo gerado por modelo ainda passa INTEIRO pela matriz de afirmacoes e pelos gates. Gerar nao e aprovar.' };
}
module.exports = { generate, status, PROVIDERS, selected };
