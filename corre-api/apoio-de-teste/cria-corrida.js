#!/usr/bin/env node
// Apoio de teste: cria uma corrida e a leva até o estado pedido, depois
// MORRE — simulando o processo que reinicia no meio (regra 2 da Etapa 1).
// Uso: node apoio-de-teste/cria-corrida.js <aguardando_pagamento|procurando_motoboy>
// Honra CORRE_PRAZO_*_MS do ambiente. Imprime o id da corrida no stdout.
'use strict';

const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { criaCorrida, transiciona } = require('../src/dominio/corridas');

async function main() {
  const alvo = process.argv[2];
  if (!['aguardando_pagamento', 'procurando_motoboy'].includes(alvo)) {
    throw new Error(`alvo inválido: ${alvo}`);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_APP });
  try {
    const { corrida } = await criaCorrida(pool, {
      autorTipo: 'lojista',
      autorId: randomUUID(),
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
