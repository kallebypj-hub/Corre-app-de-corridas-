'use strict';

// Os 11 estados da corrida (seção 4 da especificação).
// Vivos: 1–7. Finais: 8–11.
//
// ESTA TABELA SUBSTITUI A DA ETAPA 1. Com o pagamento na porta do cliente,
// "Aguardando pagamento" e "Expirada" deixaram de existir: a corrida nasce
// procurando motoboy, e a cobrança só nasce quando o motoboy chega na porta.

const ESTADOS = {
  PROCURANDO_MOTOBOY: 1,
  A_CAMINHO_DA_LOJA: 2,
  COM_A_MERCADORIA: 3,
  NA_PORTA_COBRANDO: 4,
  PAGO: 5,
  EM_RETORNO: 6,
  EM_DISPUTA: 7,
  ENTREGUE: 8,
  SEM_MOTOBOY: 9,
  CANCELADA: 10,
  DEVOLVIDA: 11,
};

const NOMES = {
  1: 'procurando_motoboy',
  2: 'a_caminho_da_loja',
  3: 'com_a_mercadoria',
  4: 'na_porta_cobrando',
  5: 'pago',
  6: 'em_retorno',
  7: 'em_disputa',
  8: 'entregue',
  9: 'sem_motoboy',
  10: 'cancelada',
  11: 'devolvida',
};

const VIVOS = [1, 2, 3, 4, 5, 6, 7];
const FINAIS = [8, 9, 10, 11];

module.exports = { ...ESTADOS, NOMES, VIVOS, FINAIS };
