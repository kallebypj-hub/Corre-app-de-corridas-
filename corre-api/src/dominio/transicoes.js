'use strict';

const E = require('./estados');
const config = require('../config');

// A ÚNICA fonte das transições legais (seção 4): estado atual → transição
// permitida → estado seguinte, num lugar só. Nunca `if` de legalidade
// espalhado pelo código.
//
// 14 arestas legais além da criação (∅→1):
//   1→2 motoboy_aceitou   · 1→9 cascata_esgotada   · 1→10 cancelada
//   2→3 coleta_confirmada · 2→10 cancelada
//   3→4 chegada_declarada · 3→6 retorno_sem_contato · 3→10 cancelada
//   4→5 pagamento_confirmado · 4→6 espera_vencida  · 4→10 cancelada
//   5→8 entrega_confirmada
//   6→11 devolucao_concluida · 6→10 cancelada
//
// A INVARIANTE DA ETAPA: 5→8 é a ÚNICA aresta que entra em 8 (Entregue), e
// 4→5 é a única que entra em 5 (Pago). Logo não existe caminho até Entregue
// que não passe por Pago. A garantia forte não é esta tabela — é o
// `pago_em` derivado por trigger mais o CHECK da migration 0012, porque uma
// linha errada AQUI se apaga em silêncio e uma constraint não.
//
// O estado 7 (Em disputa) fica SEM ARESTA NENHUMA, nem de entrada, até a
// Etapa 11 (painel). Buraco declarado na seção 5.
//
// prazoDoDestinoMs: prazo do estado que a transição ABRE (o vencimento é
// gravado com o evento; vencer é consulta ao banco).
// porPrazo: transição que o varredor aplica quando `vence_em` passa.

const QUALQUER_PARTE = ['lojista', 'cliente', 'painel'];
const SO_OPERACAO = ['painel'];

// Os dois casos de "cliente não pagou na porta", declarados pelo motoboy. A
// seção 12 trata isso como declaração de PARTE INTERESSADA, não como fato
// observado — o sistema não enxerga presença. Por isso o valor é exigido e
// fechado numa lista: declaração vaga não vira reputação de ninguém.
const CASOS_DE_ESPERA_VENCIDA = ['cliente_ausente', 'presente_e_nao_pagou'];

const TRANSICOES = {
  criada: {
    de: [null],
    para: E.PROCURANDO_MOTOBOY,
    autorizados: { [String(null)]: ['lojista'] },
    // A corrida NASCE procurando motoboy: a cascata começa a correr na
    // criação, porque não há mais pagamento antes dela (seção 6).
    prazoDoDestinoMs: config.prazoCascataMs,
  },

  // 1 → 2. O gatilho (oferta um a um, 30s cada) é da Etapa 6; a aresta é
  // desta.
  motoboy_aceitou: {
    de: [E.PROCURANDO_MOTOBOY],
    para: E.A_CAMINHO_DA_LOJA,
    autorizados: { [E.PROCURANDO_MOTOBOY]: ['motoboy'] },
  },
  // 1 → 9. Cascata de 5 minutos sem aceite. NENHUM movimento de dinheiro:
  // ninguém pagou nada, não há o que estornar.
  cascata_esgotada: {
    de: [E.PROCURANDO_MOTOBOY],
    para: E.SEM_MOTOBOY,
    autorizados: { [E.PROCURANDO_MOTOBOY]: ['sistema'] },
    porPrazo: true,
  },

  // 2 → 3.
  coleta_confirmada: {
    de: [E.A_CAMINHO_DA_LOJA],
    para: E.COM_A_MERCADORIA,
    autorizados: { [E.A_CAMINHO_DA_LOJA]: ['motoboy', 'lojista'] },
  },

  // 3 → 4. O motoboy declara que chegou; é aqui que o QR nasce (Etapa 7).
  // Abre a espera na porta de 5 minutos, que é o mesmo relógio da validade
  // da cobrança — não é número novo (seção 4).
  chegada_declarada: {
    de: [E.COM_A_MERCADORIA],
    para: E.NA_PORTA_COBRANDO,
    autorizados: { [E.COM_A_MERCADORIA]: ['motoboy'] },
    prazoDoDestinoMs: config.prazoEsperaNaPortaMs,
  },
  // 3 → 6. Endereço não localizado ou cliente inalcançável ANTES da chegada:
  // é o caminho de quem nem chegou a mostrar o QR. Exige motivo registrado,
  // como o cancelamento pela operação.
  retorno_sem_contato: {
    de: [E.COM_A_MERCADORIA],
    para: E.EM_RETORNO,
    autorizados: { [E.COM_A_MERCADORIA]: ['motoboy'] },
    exigeMotivoNasOrigens: [E.COM_A_MERCADORIA],
  },

  // 4 → 5. Confirmação do gateway. Único autor: o sistema — pagamento não é
  // declaração de parte, é fato do banco (Lei 6).
  pagamento_confirmado: {
    de: [E.NA_PORTA_COBRANDO],
    para: E.PAGO,
    autorizados: { [E.NA_PORTA_COBRANDO]: ['sistema'] },
  },
  // 4 → 6. Venceu a espera sem pagamento. O motoboy declara QUAL dos dois
  // casos foi, e a declaração é de parte interessada (seção 12).
  espera_vencida: {
    de: [E.NA_PORTA_COBRANDO],
    para: E.EM_RETORNO,
    autorizados: { [E.NA_PORTA_COBRANDO]: ['motoboy'] },
    exigeCasoDeclarado: CASOS_DE_ESPERA_VENCIDA,
  },

  // 5 → 8. ÚNICA saída do Pago. Depois de pago, o que der errado é disputa
  // (seção 11), resolvida por evento compensatório do painel — não por
  // transição.
  entrega_confirmada: {
    de: [E.PAGO],
    para: E.ENTREGUE,
    autorizados: { [E.PAGO]: ['motoboy'] },
  },

  // 6 → 11.
  devolucao_concluida: {
    de: [E.EM_RETORNO],
    para: E.DEVOLVIDA,
    autorizados: { [E.EM_RETORNO]: ['motoboy', 'lojista'] },
  },

  // Cancelamento (seção 5): livre e sem custo no estado 1 — ninguém saiu do
  // lugar. Dos estados 2, 3, 4 e 6, só a operação, sempre com motivo.
  // DEPOIS DO 5 NÃO SE CANCELA: o dinheiro já foi dividido em três contas
  // que não são nossas.
  cancelada: {
    de: [
      E.PROCURANDO_MOTOBOY,
      E.A_CAMINHO_DA_LOJA,
      E.COM_A_MERCADORIA,
      E.NA_PORTA_COBRANDO,
      E.EM_RETORNO,
    ],
    para: E.CANCELADA,
    autorizados: {
      [E.PROCURANDO_MOTOBOY]: QUALQUER_PARTE,
      [E.A_CAMINHO_DA_LOJA]: SO_OPERACAO,
      [E.COM_A_MERCADORIA]: SO_OPERACAO,
      [E.NA_PORTA_COBRANDO]: SO_OPERACAO,
      [E.EM_RETORNO]: SO_OPERACAO,
    },
    exigeMotivoNasOrigens: [
      E.A_CAMINHO_DA_LOJA,
      E.COM_A_MERCADORIA,
      E.NA_PORTA_COBRANDO,
      E.EM_RETORNO,
    ],
  },
};

module.exports = { TRANSICOES, CASOS_DE_ESPERA_VENCIDA };
