#!/usr/bin/env node
// Varredor de prazos: aplica expirou (1→8) e cascata_esgotada (2→9) nas
// corridas cujo vence_em passou. Vencer é consulta ao banco — este processo
// pode morrer e renascer à vontade que nenhum prazo se perde (regra 2).
//
// Etapa 4: ele é OPERAÇÃO, não requisição — não tem sessão de onde tirar a
// cidade. Então varre CIDADE POR CIDADE, dentro do contexto de cada uma.
// Não existe atalho de "ver tudo": a política do banco vale para ele igual,
// e é isso que garante que o varredor nunca vire a porta dos fundos do
// isolamento.
'use strict';

const { Pool } = require('pg');
const { expiraVencidas } = require('../dominio/corridas');
const { listaCidades, poolDaCidade } = require('../dominio/cidades');

async function main() {
  if (!process.env.DATABASE_URL_APP) {
    throw new Error('DATABASE_URL_APP não definido');
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_APP });
  try {
    const cidades = await listaCidades(pool);
    let total = 0;
    for (const cidade of cidades) {
      const aplicadas = await expiraVencidas(poolDaCidade(pool, cidade.id));
      total += aplicadas;
      if (aplicadas > 0) console.log(`${cidade.nome}/${cidade.uf}: ${aplicadas}`);
    }
    console.log(`vencidas aplicadas: ${total}`);
  } finally {
    await pool.end();
  }
}

main().catch((erro) => {
  console.error(`varredura falhou: ${erro.message}`);
  process.exit(1);
});
