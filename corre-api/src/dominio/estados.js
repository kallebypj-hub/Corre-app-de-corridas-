'use strict';

// Os 11 estados da corrida (seção 4 da especificação).
// Vivos: 1–6. Finais: 7–11.

const ESTADOS = {
  AGUARDANDO_PAGAMENTO: 1,
  PROCURANDO_MOTOBOY: 2,
  A_CAMINHO_DA_LOJA: 3,
  COM_A_MERCADORIA: 4,
  EM_RETORNO: 5,
  EM_DISPUTA: 6,
  ENTREGUE: 7,
  EXPIRADA: 8,
  SEM_MOTOBOY: 9,
  CANCELADA: 10,
  DEVOLVIDA: 11,
};

const NOMES = {
  1: 'aguardando_pagamento',
  2: 'procurando_motoboy',
  3: 'a_caminho_da_loja',
  4: 'com_a_mercadoria',
  5: 'em_retorno',
  6: 'em_disputa',
  7: 'entregue',
  8: 'expirada',
  9: 'sem_motoboy',
  10: 'cancelada',
  11: 'devolvida',
};

const VIVOS = [1, 2, 3, 4, 5, 6];
const FINAIS = [7, 8, 9, 10, 11];

module.exports = { ...ESTADOS, NOMES, VIVOS, FINAIS };
