#!/usr/bin/env node
// Apoio de teste: um PROCESSO competidor disputando o aceite da mesma
// corrida (concorrência real entre processos, como manda a lei de teste).
// Uso: node apoio-de-teste/competidor-aceite.js <corridaId> <tentativas>
// Imprime JSON {vencedoras, conflitos, ilegais} no stdout.
'use strict';

const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { emTransacao } = require('../src/dominio/nucleo');
const { transiciona } = require('../src/dominio/corridas');
const { ErroDeDominio, CODIGOS } = require('../src/dominio/erros');

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
  const corridaId = process.argv[2];
  const tentativas = Number.parseInt(process.argv[3], 10);
  if (!corridaId || !Number.isInteger(tentativas) || tentativas <= 0) {
    throw new Error('uso: competidor-aceite.js <corridaId> <tentativas>');
  }

  const pool = daCidade(new Pool({
    connectionString: process.env.DATABASE_URL_APP,
    max: 10,
  }));
  const placar = { vencedoras: 0, conflitos: 0, ilegais: 0 };
  try {
    // Todas as tentativas disparam juntas: é a corrida contra o relógio
    // entre aparelhos que a Lei 4 manda o banco arbitrar.
    await Promise.all(
      Array.from({ length: tentativas }, async () => {
        try {
          const { repetida } = await transiciona(pool, {
            corridaId,
            tipo: 'motoboy_aceitou',
            autorTipo: 'motoboy',
            autorId: randomUUID(),
            chaveIdempotencia: randomUUID(),
          });
          if (repetida) throw new Error('replay inesperado: chaves são únicas por tentativa');
          placar.vencedoras += 1;
        } catch (erro) {
          if (erro instanceof ErroDeDominio && erro.codigo === CODIGOS.CONFLITO_DE_CONCORRENCIA) {
            placar.conflitos += 1;
          } else if (erro instanceof ErroDeDominio && erro.codigo === CODIGOS.TRANSICAO_ILEGAL) {
            // Leu o estado já pós-aceite: perdeu a corrida do mesmo jeito.
            placar.ilegais += 1;
          } else {
            throw erro;
          }
        }
      }),
    );
    console.log(JSON.stringify(placar));
  } finally {
    await pool.end();
  }
}

main().catch((erro) => {
  console.error(erro.message);
  process.exit(1);
});
