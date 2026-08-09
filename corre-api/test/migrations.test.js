'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readdirSync, readFileSync, mkdtempSync, cpSync, appendFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { conectaDono, conectaApp, esperaErro } = require('./ajuda');

const RAIZ = path.join(__dirname, '..');
const MIGRAR = path.join(RAIZ, 'src', 'db', 'migrar.js');
const MIGRATIONS = path.join(RAIZ, 'migrations');

function rodaMigrar(env = {}) {
  return execFileSync('node', [MIGRAR], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('migrations', async (t) => {
  const dono = await conectaDono();
  t.after(() => dono.end());

  await t.test('todas as migrations do diretório estão registradas com o checksum do arquivo', async () => {
    const arquivos = readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort();
    const { rows } = await dono.query('SELECT versao, checksum FROM schema_migrations ORDER BY versao');

    assert.deepEqual(rows.map((r) => r.versao), arquivos);
    for (const linha of rows) {
      const conteudo = readFileSync(path.join(MIGRATIONS, linha.versao), 'utf8');
      const esperado = createHash('sha256').update(conteudo).digest('hex');
      assert.equal(linha.checksum, esperado, `checksum divergente em ${linha.versao}`);
    }
  });

  await t.test('rodar migrar de novo não aplica nada (idempotente)', () => {
    const saida = rodaMigrar();
    assert.match(saida, /migrations: 0 nova\(s\)/);
  });

  await t.test('migration aplicada com conteúdo alterado é recusada', () => {
    const copia = mkdtempSync(path.join(os.tmpdir(), 'corre-migrations-'));
    cpSync(MIGRATIONS, copia, { recursive: true });
    appendFileSync(path.join(copia, '0002_eventos.sql'), '\n-- sabotagem\n');

    assert.throws(
      () => rodaMigrar({ CORRE_MIGRATIONS_DIR: copia }),
      (erro) => {
        assert.equal(erro.status, 1);
        assert.match(String(erro.stderr), /checksum divergente/);
        return true;
      },
    );
  });

  await t.test('eventos tem exatamente as colunas esperadas', async () => {
    const { rows } = await dono.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'eventos'
      ORDER BY ordinal_position
    `);
    assert.deepEqual(rows, [
      { column_name: 'id', data_type: 'bigint', is_nullable: 'NO' },
      { column_name: 'tipo', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'agregado_tipo', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'agregado_id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'payload', data_type: 'jsonb', is_nullable: 'NO' },
      { column_name: 'autor_tipo', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'autor_id', data_type: 'uuid', is_nullable: 'YES' },
      { column_name: 'criado_em', data_type: 'timestamp with time zone', is_nullable: 'NO' },
    ]);
  });

  await t.test('domínio centavos existe e é inteiro de 64 bits (Lei 1)', async () => {
    const { rows } = await dono.query(`
      SELECT t.typname AS dominio, b.typname AS base
      FROM pg_type t JOIN pg_type b ON b.oid = t.typbasetype
      WHERE t.typname = 'centavos' AND t.typtype = 'd'
    `);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].base, 'int8');
  });

  await t.test('corre_app tem só SELECT e INSERT em eventos', async () => {
    const { rows } = await dono.query(`
      SELECT privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'eventos' AND grantee = 'corre_app'
      ORDER BY privilege_type
    `);
    assert.deepEqual(rows.map((r) => r.privilege_type), ['INSERT', 'SELECT']);
  });

  await t.test('os dois triggers de imutabilidade existem e estão ativos', async () => {
    const { rows } = await dono.query(`
      SELECT tgname, tgenabled
      FROM pg_trigger
      WHERE tgrelid = 'eventos'::regclass AND NOT tgisinternal
      ORDER BY tgname
    `);
    assert.deepEqual(rows, [
      { tgname: 'eventos_bloqueia_truncate', tgenabled: 'O' },
      { tgname: 'eventos_bloqueia_update_delete', tgenabled: 'O' },
    ]);
  });

  await t.test('corre_app não escreve em schema_migrations', async () => {
    const app = await conectaApp();
    try {
      const erro = await esperaErro(
        app,
        "INSERT INTO schema_migrations (versao, checksum) VALUES ('9999_falsa.sql', 'x')",
      );
      assert.equal(erro.code, '42501');
    } finally {
      await app.end();
    }
  });
});
