#!/usr/bin/env node
// Aplica as migrations SQL pendentes, em ordem, cada uma na própria transação.
// Migration aplicada nunca muda: divergência de checksum derruba o processo.
'use strict';

const { createHash } = require('node:crypto');
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

// Chave fixa do advisory lock: uma migração por vez, mesmo com dois deploys simultâneos.
const LOCK_MIGRACAO = 872_340_119;

async function migrar() {
  const dir = process.env.CORRE_MIGRATIONS_DIR
    || path.join(__dirname, '..', '..', 'migrations');

  const arquivos = readdirSync(dir).filter((nome) => nome.endsWith('.sql')).sort();
  if (arquivos.length === 0) {
    throw new Error(`nenhuma migration encontrada em ${dir}`);
  }
  for (const nome of arquivos) {
    if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(nome)) {
      throw new Error(`nome de migration inválido: ${nome} (esperado NNNN_nome_em_minusculas.sql)`);
    }
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL não definido');
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_MIGRACAO]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        versao      TEXT PRIMARY KEY,
        checksum    TEXT NOT NULL,
        aplicado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query('SELECT versao, checksum FROM schema_migrations');
    const aplicadas = new Map(rows.map((linha) => [linha.versao, linha.checksum]));

    let novas = 0;
    for (const arquivo of arquivos) {
      const sql = readFileSync(path.join(dir, arquivo), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const registrado = aplicadas.get(arquivo);

      if (registrado !== undefined) {
        if (registrado !== checksum) {
          throw new Error(
            `migration ${arquivo} já aplicada com outro conteúdo (checksum divergente). `
            + 'Migration aplicada não se edita: crie uma nova.',
          );
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (versao, checksum) VALUES ($1, $2)',
          [arquivo, checksum],
        );
        await client.query('COMMIT');
      } catch (erro) {
        try {
          await client.query('ROLLBACK');
        } catch (erroRollback) {
          console.error(`rollback de ${arquivo} falhou: ${erroRollback.message}`);
        }
        throw erro;
      }
      novas += 1;
      console.log(`aplicada: ${arquivo}`);
    }

    console.log(`migrations: ${novas} nova(s), ${arquivos.length - novas} já aplicada(s)`);
  } finally {
    await client.end();
  }
}

migrar().catch((erro) => {
  console.error(`migração falhou: ${erro.message}`);
  process.exit(1);
});
