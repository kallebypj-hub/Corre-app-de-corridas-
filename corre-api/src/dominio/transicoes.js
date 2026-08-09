'use strict';

const E = require('./estados');
const config = require('../config');

// A ÚNICA fonte das transições legais (regra 1 da Etapa 1): estado atual →
// transição permitida → estado seguinte, num lugar só. Nunca if espalhado.
//
// 13 arestas legais + a criação (∅→1):
//   ∅→1 criada · 1→2 pagamento_confirmado · 1→8 expirou · 1→10 cancelada
//   2→3 motoboy_aceitou · 2→9 cascata_esgotada · 2→10 cancelada
//   3→4 coleta_confirmada · 3→10 cancelada
//   4→7 pin_validado · 4→5 entrega_falhou · 4→10 cancelada
//   5→11 devolucao_concluida · 5→10 cancelada
//
// Decisão do dono (2026-08-09): o estado 6 (em disputa) não tem transições
// nesta etapa — abertura e resolução são da etapa do painel (Etapa 10), por
// migration própria. Cancelamento pela operação vale para 3, 4 e 5
// ("do estado 3 em diante", seção 5), sempre com motivo registrado.
//
// prazoDoDestinoMs: prazo do estado que a transição ABRE (regra 2: o
// vencimento é gravado com o evento; vencer é consulta ao banco).
// porPrazo: transição que o varredor aplica quando vence_em passa.

const QUALQUER_PARTE = ['lojista', 'cliente', 'painel'];
const SO_OPERACAO = ['painel'];

const TRANSICOES = {
  criada: {
    de: [null],
    para: E.AGUARDANDO_PAGAMENTO,
    autorizados: { [String(null)]: ['lojista'] },
    prazoDoDestinoMs: config.prazoPagamentoMs,
  },
  pagamento_confirmado: {
    de: [E.AGUARDANDO_PAGAMENTO],
    para: E.PROCURANDO_MOTOBOY,
    autorizados: { [E.AGUARDANDO_PAGAMENTO]: ['sistema'] },
    prazoDoDestinoMs: config.prazoCascataMs,
  },
  expirou: {
    de: [E.AGUARDANDO_PAGAMENTO],
    para: E.EXPIRADA,
    autorizados: { [E.AGUARDANDO_PAGAMENTO]: ['sistema'] },
    porPrazo: true,
  },
  motoboy_aceitou: {
    de: [E.PROCURANDO_MOTOBOY],
    para: E.A_CAMINHO_DA_LOJA,
    autorizados: { [E.PROCURANDO_MOTOBOY]: ['motoboy'] },
  },
  cascata_esgotada: {
    de: [E.PROCURANDO_MOTOBOY],
    para: E.SEM_MOTOBOY,
    autorizados: { [E.PROCURANDO_MOTOBOY]: ['sistema'] },
    porPrazo: true,
  },
  coleta_confirmada: {
    de: [E.A_CAMINHO_DA_LOJA],
    para: E.COM_A_MERCADORIA,
    autorizados: { [E.A_CAMINHO_DA_LOJA]: ['motoboy', 'lojista'] },
  },
  entrega_falhou: {
    de: [E.COM_A_MERCADORIA],
    para: E.EM_RETORNO,
    autorizados: { [E.COM_A_MERCADORIA]: ['motoboy'] },
  },
  pin_validado: {
    de: [E.COM_A_MERCADORIA],
    para: E.ENTREGUE,
    autorizados: { [E.COM_A_MERCADORIA]: ['motoboy'] },
  },
  devolucao_concluida: {
    de: [E.EM_RETORNO],
    para: E.DEVOLVIDA,
    autorizados: { [E.EM_RETORNO]: ['motoboy', 'lojista'] },
  },
  cancelada: {
    de: [
      E.AGUARDANDO_PAGAMENTO,
      E.PROCURANDO_MOTOBOY,
      E.A_CAMINHO_DA_LOJA,
      E.COM_A_MERCADORIA,
      E.EM_RETORNO,
    ],
    para: E.CANCELADA,
    // Livre até o estado 2 (seção 5); do 3 em diante, só a operação.
    autorizados: {
      [E.AGUARDANDO_PAGAMENTO]: QUALQUER_PARTE,
      [E.PROCURANDO_MOTOBOY]: QUALQUER_PARTE,
      [E.A_CAMINHO_DA_LOJA]: SO_OPERACAO,
      [E.COM_A_MERCADORIA]: SO_OPERACAO,
      [E.EM_RETORNO]: SO_OPERACAO,
    },
    exigeMotivoNasOrigens: [E.A_CAMINHO_DA_LOJA, E.COM_A_MERCADORIA, E.EM_RETORNO],
  },
};

module.exports = { TRANSICOES };
