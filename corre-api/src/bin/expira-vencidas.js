#!/usr/bin/env node
// Varredor de prazos: aplica expirou (1→8) e cascata_esgotada (2→9) nas
// corridas cujo vence_em passou. Vencer é consulta ao banco — este processo
// pode morrer e renascer à vontade que nenhum prazo se perde (regra 2).
'use strict';

const { Pool } = require('pg');
const { expiraVencidas } = require('../dominio/corridas');

async function main() {
  if (!process.env.DATABASE_URL_APP) {
    throw new Error('DATABASE_URL_APP não definido');
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_APP });
  try {
    const aplicadas = await pool.query('SELECT 1').then(() => expiraVencidas(pool));
    console.log(`vencidas aplicadas: ${aplicadas}`);
  } finally {
    await pool.end();
  }
}

main().catch((erro) => {
  console.error(`varredura falhou: ${erro.message}`);
  process.exit(1);
});
