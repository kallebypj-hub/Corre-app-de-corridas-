'use strict';

// Ponto de entrada da aplicação. Sem HTTP de negócio nesta etapa: só o
// esqueleto que prova a trava de boot — a verificação da credencial roda
// ANTES do listen; credencial errada derruba o processo sem servir nada.

const express = require('express');
const { Pool } = require('pg');

const { exigePapelDeAplicacao } = require('./db/boot');

async function main() {
  if (!process.env.DATABASE_URL_APP) {
    throw new Error('DATABASE_URL_APP não definido');
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_APP });

  const conexao = await pool.connect();
  try {
    await exigePapelDeAplicacao(conexao);
  } finally {
    conexao.release();
  }

  const app = express();
  app.get('/saude', (requisicao, resposta) => {
    resposta.json({ ok: true });
  });

  const porta = process.env.PORTA === undefined ? 0 : Number(process.env.PORTA);
  const servidor = app.listen(porta, () => {
    console.log(`escutando :${servidor.address().port}`);
  });

  process.on('SIGTERM', () => {
    servidor.close(() => {
      pool.end().then(() => process.exit(0)).catch((erro) => {
        console.error(`encerramento falhou: ${erro.message}`);
        process.exit(1);
      });
    });
  });
}

main().catch((erro) => {
  console.error(`boot recusado ou falhou: ${erro.message}`);
  process.exit(1);
});
