#!/usr/bin/env node
// Apoio de teste: cria uma corrida e a leva até o estado pedido, depois
// MORRE — simulando o processo que reinicia no meio (regra 2 da Etapa 1).
// Uso: node apoio-de-teste/cria-corrida.js <aguardando_pagamento|procurando_motoboy>
// Honra CORRE_PRAZO_*_MS do ambiente. Imprime o id da corrida no stdout.
'use strict';

const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { emTransacao } = require('../src/dominio/nucleo');
const { criaCorrida, transiciona } = require('../src/dominio/corridas');
const { cadastraLojista, registraCartao } = require('../src/dominio/contas');

// Etapa 4: processo de apoio também opera dentro de uma cidade. Sobral tem id
// fixo (migration 0010), então não é preciso consultar para descobri-la — e
// consultar para descobrir a cidade seria, ela mesma, consulta sem cidade.
const SOBRAL = '00000001-2312-4908-8000-000000000001';
function daCidade(cru, cidadeId = process.env.CORRE_CIDADE_ID || SOBRAL) {
  return {
    cidadeId,
    query: (t, p) => emTransacao(cru, (c) => c.query(t, p), { cidadeId }),
    connect: () => cru.connect(),
    end: () => cru.end(),
  };
}


async function main() {
  const alvo = process.argv[2];
  if (!['aguardando_pagamento', 'procurando_motoboy'].includes(alvo)) {
    throw new Error(`alvo inválido: ${alvo}`);
  }
  const pool = daCidade(new Pool({ connectionString: process.env.DATABASE_URL_APP }));
  try {
    // Corrida exige lojista real com cartão (Etapa 2).
    const { conta: lojista } = await cadastraLojista(pool, {
      nome: 'Loja do Apoio',
      telefone: `88 7${randomUUID().slice(0, 12)}`,
    });
    await registraCartao(pool, { lojistaId: lojista.id, cartaoRef: 'cartao-apoio' });

    const { corrida } = await criaCorrida(pool, {
      autorTipo: 'lojista',
      autorId: lojista.id,
      payload: { origem: 'apoio_cria_corrida' },
    });
    if (alvo === 'procurando_motoboy') {
      await transiciona(pool, {
        corridaId: corrida.id,
        tipo: 'pagamento_confirmado',
        autorTipo: 'sistema',
        autorId: null,
      });
    }
    console.log(corrida.id);
  } finally {
    await pool.end();
  }
}

main().catch((erro) => {
  console.error(erro.message);
  process.exit(1);
});
