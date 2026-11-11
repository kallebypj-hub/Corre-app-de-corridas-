'use strict';
/**
 * PONTE PARA O PAPERCLIP — contrato, nao simulacao.
 *
 * O Paperclip nao foi adotado no piloto (causa registrada em docs/decisao-arquitetural.md:
 * exige Node >= 24.11.0 e esta maquina roda 22.23.4; o build do monorepo nao fechou na
 * janela de teste e o servidor nao sobe). Para nao travar o audiovisual, o piloto entrega
 * o motor com painel proprio MAIS este adaptador: quando o Paperclip subir, ele fala com a
 * empresa por HTTP, sem reescrever nada.
 *
 * REGRA DE OURO: UM controlador por trabalho. O Paperclip entra como CAMADA DE
 * ADMINISTRACAO (metas, departamentos, aprovacao, orcamento). Quem executa producao
 * continua sendo ESTE pipeline. O adaptador nao cria fila propria nem agenda nada:
 * ele traduz e delega. Nunca haverá dois schedulers disputando a mesma publicação.
 */
const http = require('http');

const CONTRACT = {
  version: '1.0',
  owner_of_execution: 'youtube-media-company/src/pipeline.js',
  owner_of_administration: 'paperclip (quando conectado)',
  single_scheduler_rule: 'O Paperclip pode PEDIR producao e LER estado. Ele nao agenda upload nem dispara render por conta propria. A fila de publicacao tem um dono so: este servico.',
  auth: 'cabecalho x-api-key, mesma chave do .env deste projeto. Sem chave, apenas leitura em 127.0.0.1.',
  endpoints: [
    { method: 'GET',  path: '/health',                              purpose: 'liveness' },
    { method: 'GET',  path: '/api/readiness',                       purpose: 'capacidades reais da maquina (ffmpeg, playwright, tts)' },
    { method: 'GET',  path: '/api/company',                         purpose: 'organograma das 16 funcoes, com orcamento e permissoes' },
    { method: 'GET',  path: '/api/episodes',                        purpose: 'lista de episodios com custo, gates e aprovacao' },
    { method: 'GET',  path: '/api/episodes/:id',                    purpose: 'estado completo: estagios, artefatos com checksum, relatorios' },
    { method: 'POST', path: '/api/episodes/:id/run',                purpose: 'pedir producao (retoma do checkpoint). Corpo: {from?}' },
    { method: 'POST', path: '/api/episodes/:id/stage/:stage/run',   purpose: 'refazer um estagio; responde o que isso invalida' },
    { method: 'GET',  path: '/api/episodes/:id/job',                purpose: 'estado do trabalho em andamento' },
    { method: 'POST', path: '/api/episodes/:id/approval',           purpose: 'registrar decisao HUMANA. Recusa se os gates nao passarem.' },
    { method: 'GET',  path: '/api/youtube/state',                   purpose: 'estado do OAuth: BLOQUEADO | PENDENTE_AUTORIZACAO | AUTORIZADO' },
    { method: 'POST', path: '/api/youtube/queue',                   purpose: 'enfileirar envio. Exige gates verdes + aprovacao especifica do video.' },
    { method: 'GET',  path: '/api/analytics',                       purpose: 'metricas reais; sem OAuth responde BLOQUEADO, nunca zero' },
    { method: 'GET',  path: '/api/integrations',                    purpose: 'provedores, limite e gasto real' }
  ],
  events_out: {
    transport: 'polling de /api/episodes/:id/job e /api/episodes/:id (sem websocket no piloto)',
    note: 'O store e um log append-only em var/channels/<canal>/events.jsonl. Um conector futuro pode ler o arquivo em vez de fazer polling.'
  },
  refusals: {
    publish_without_approval: '412 — gates nao aprovados ou aprovacao ausente',
    publish_public_first: '412 — o primeiro envio e privado ou nao listado, sempre',
    spend: 'nenhum endpoint gasta dinheiro; o limite externo e US$ 0,00'
  }
};

class PaperclipBridge {
  constructor({ baseUrl = `http://127.0.0.1:${process.env.PORT || 3777}`, apiKey = process.env.API_KEY || '' } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); this.apiKey = apiKey;
  }
  _req(method, p, body) {
    return new Promise((resolve, reject) => {
      const u = new URL(this.baseUrl + p);
      const data = body ? JSON.stringify(body) : null;
      const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
        headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}) } },
        (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(b) }); } catch (_) { resolve({ status: res.statusCode, body: b }); } }); });
      req.on('error', reject); if (data) req.write(data); req.end();
    });
  }
  health() { return this._req('GET', '/health'); }
  /** Meta do Paperclip -> missao aqui. Nao agenda: so pede producao. */
  async requestEpisode(epId, { from = null } = {}) { return this._req('POST', `/api/episodes/${epId}/run`, { from }); }
  async episodeState(epId) { return this._req('GET', `/api/episodes/${epId}`); }
  async jobState(epId) { return this._req('GET', `/api/episodes/${epId}/job`); }
  /** O Paperclip NAO aprova no lugar do humano: so repassa uma decisao ja tomada. */
  async relayHumanApproval(epId, decision) { return this._req('POST', `/api/episodes/${epId}/approval`, decision); }
  async youtubeState() { return this._req('GET', '/api/youtube/state'); }
  contract() { return CONTRACT; }
}
module.exports = { PaperclipBridge, CONTRACT };
