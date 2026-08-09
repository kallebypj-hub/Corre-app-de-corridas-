#!/usr/bin/env node
// Apoio de teste: um PROCESSO disputando o cadastro do MESMO CPF —
// concorrência real entre processos; o UNIQUE do banco decide uma conta só.
// Uso: node apoio-de-teste/cadastrador-concorrente.js <cpf> <tentativas>
// Imprime JSON {criadas, recusadas} no stdout.
'use strict';

const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { cadastraMotoboy } = require('../src/dominio/contas');
const { ErroDeDominio, CODIGOS } = require('../src/dominio/erros');

async function main() {
  const cpf = process.argv[2];
  const tentativas = Number.parseInt(process.argv[3], 10);
  if (!cpf || !Number.isInteger(tentativas) || tentativas <= 0) {
    throw new Error('uso: cadastrador-concorrente.js <cpf> <tentativas>');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL_APP, max: 10 });
  const placar = { criadas: 0, recusadas: 0 };
  try {
    await Promise.all(
      Array.from({ length: tentativas }, async (vazio, i) => {
        try {
          const { repetida } = await cadastraMotoboy(pool, {
            nome: `Disputante ${i}`,
            telefone: `88 9${String(i).padStart(8, '0')}`,
            cpf,
            chavePix: cpf,
            cnhRef: 'docs/cnh.jpg',
            crlvRef: 'docs/crlv.jpg',
            selfieRef: 'docs/selfie.jpg',
            aparelhoId: `aparelho-${randomUUID()}`,
            chaveIdempotencia: randomUUID(),
          });
          if (repetida) throw new Error('replay inesperado: chaves são únicas por tentativa');
          placar.criadas += 1;
        } catch (erro) {
          if (erro instanceof ErroDeDominio && erro.codigo === CODIGOS.CPF_JA_CADASTRADO) {
            placar.recusadas += 1;
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
