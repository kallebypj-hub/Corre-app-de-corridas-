'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readdirSync, readFileSync, mkdtempSync, cpSync, appendFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { randomUUID } = require('node:crypto');
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
      { column_name: 'seq', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'chave_idempotencia', data_type: 'text', is_nullable: 'YES' },
    ]);
  });

  await t.test('UNIQUE de sequência e de idempotência existem em eventos (Leis 4 e 5)', async () => {
    const { rows } = await dono.query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'eventos'::regclass AND contype = 'u'
      ORDER BY conname
    `);
    assert.deepEqual(
      rows.map((r) => r.conname),
      ['eventos_agregado_seq_unico', 'eventos_chave_idempotencia_unica'],
    );
  });

  await t.test('corridas tem exatamente as colunas esperadas', async () => {
    const { rows } = await dono.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'corridas'
      ORDER BY ordinal_position
    `);
    assert.deepEqual(rows, [
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'estado', data_type: 'smallint', is_nullable: 'NO' },
      { column_name: 'seq', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'vence_em', data_type: 'timestamp with time zone', is_nullable: 'YES' },
      { column_name: 'criado_em', data_type: 'timestamp with time zone', is_nullable: 'NO' },
      { column_name: 'atualizado_em', data_type: 'timestamp with time zone', is_nullable: 'NO' },
      { column_name: 'lojista_id', data_type: 'uuid', is_nullable: 'NO' },
    ]);
  });

  await t.test('travas de cadastro no banco: chave Pix igual ao CPF, CPF único, gênese única', async () => {
    const { rows } = await dono.query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'motoboys'::regclass AND conname IN ('motoboys_chave_pix_igual_cpf', 'motoboys_cpf_unico')
      ORDER BY conname
    `);
    assert.deepEqual(rows.map((r) => r.conname), ['motoboys_chave_pix_igual_cpf', 'motoboys_cpf_unico']);

    const { rows: indices } = await dono.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'operadores' AND indexname = 'operadores_genese_unica'
    `);
    assert.equal(indices.length, 1);
  });

  // As travas do banco precisam ser provadas pelo EFEITO, não pelo nome:
  // constraint neutralizada com o mesmo nome passaria num teste de nome.
  await t.test('EFEITO — corre_app não insere motoboy com chave Pix diferente do CPF (23514)', async () => {
    const app = await conectaApp();
    try {
      // Dois CPFs de dígitos válidos, para isolar o CHECK chave_pix=cpf.
      const erro = await esperaErro(
        app,
        `INSERT INTO motoboys (seq, nome, telefone, cpf, chave_pix, cnh_ref, crlv_ref, selfie_ref, aparelho_id, situacao)
         VALUES (1, 'x', '1', '52998224725', '11144477735', 'c', 'r', 's', 'ap', 'ativa')`,
      );
      assert.equal(erro.code, '23514');
    } finally {
      await app.end();
    }
  });

  await t.test('EFEITO — o banco recusa CPF de dígito inválido (23514)', async () => {
    const app = await conectaApp();
    try {
      // 11111111111 passa no regex ^[0-9]{11}$ mas é dígito repetido.
      const erro = await esperaErro(
        app,
        `INSERT INTO motoboys (seq, nome, telefone, cpf, chave_pix, cnh_ref, crlv_ref, selfie_ref, aparelho_id, situacao)
         VALUES (1, 'x', '1', '11111111111', '11111111111', 'c', 'r', 's', 'ap', 'ativa')`,
      );
      assert.equal(erro.code, '23514');
    } finally {
      await app.end();
    }
  });

  await t.test('EFEITO — corre_app não escolhe primeiro_saque no INSERT; nasce travado pelo DEFAULT', async () => {
    const app = await conectaApp();
    try {
      // corre_app não tem INSERT na coluna primeiro_saque (migration 0006).
      const erro = await esperaErro(
        app,
        `INSERT INTO motoboys (seq, nome, telefone, cpf, chave_pix, cnh_ref, crlv_ref, selfie_ref, aparelho_id, situacao, primeiro_saque)
         VALUES (1, 'x', '1', '52998224725', '52998224725', 'c', 'r', 's', 'ap', 'ativa', 'liberado')`,
      );
      assert.equal(erro.code, '42501');
    } finally {
      await app.end();
    }
  });

  await t.test('EFEITO — o banco recusa corrida para lojista sem cartão e para lojista bloqueado (CR002)', async () => {
    const app = await conectaApp();
    try {
      const { rows: [semCartao] } = await app.query(
        "INSERT INTO lojistas (seq, nome, telefone, situacao) VALUES (1, 'sem cartão', $1, 'ativa') RETURNING id",
        [`t-${randomUUID()}`],
      );
      const erroSemCartao = await esperaErro(
        app,
        'INSERT INTO corridas (estado, seq, vence_em, lojista_id) VALUES (1, 1, now(), $1)',
        [semCartao.id],
      );
      assert.equal(erroSemCartao.code, 'CR002');

      const { rows: [bloqueado] } = await app.query(
        "INSERT INTO lojistas (seq, nome, telefone, situacao) VALUES (1, 'bloqueado', $1, 'bloqueada') RETURNING id",
        [`t-${randomUUID()}`],
      );
      const erroBloqueado = await esperaErro(
        app,
        'INSERT INTO corridas (estado, seq, vence_em, lojista_id) VALUES (1, 1, now(), $1)',
        [bloqueado.id],
      );
      assert.equal(erroBloqueado.code, 'CR002');
    } finally {
      await app.end();
    }
  });

  await t.test('EFEITO — operador forjado por INSERT direto sem evento é recusado no commit (CR003)', async () => {
    const app = await conectaApp();
    try {
      await app.query('BEGIN');
      await app.query(
        "INSERT INTO operadores (seq, nome, papel, situacao, genese) VALUES (1, 'intruso', 'dono', 'ativa', false)",
      );
      // Sem o evento operador_cadastrado, o trigger deferido derruba o commit.
      const erro = await esperaErro(app, 'COMMIT');
      assert.equal(erro.code, 'CR003');
    } finally {
      try { await app.query('ROLLBACK'); } catch { /* já abortada */ }
      await app.end();
    }
  });

  await t.test('corridas: corre_app com SELECT na tabela; INSERT e UPDATE só nas colunas de projeção', async () => {
    const tabela = await dono.query(`
      SELECT privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'corridas' AND grantee = 'corre_app'
      ORDER BY privilege_type
    `);
    assert.deepEqual(tabela.rows.map((r) => r.privilege_type), ['SELECT']);

    const inserir = await dono.query(`
      SELECT column_name
      FROM information_schema.role_column_grants
      WHERE table_schema = 'public' AND table_name = 'corridas'
        AND grantee = 'corre_app' AND privilege_type = 'INSERT'
      ORDER BY column_name
    `);
    assert.deepEqual(inserir.rows.map((r) => r.column_name), ['estado', 'lojista_id', 'seq', 'vence_em']);

    const atualizar = await dono.query(`
      SELECT column_name
      FROM information_schema.role_column_grants
      WHERE table_schema = 'public' AND table_name = 'corridas'
        AND grantee = 'corre_app' AND privilege_type = 'UPDATE'
      ORDER BY column_name
    `);
    assert.deepEqual(
      atualizar.rows.map((r) => r.column_name),
      ['atualizado_em', 'estado', 'seq', 'vence_em'],
    );
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

  await t.test('corre_app: SELECT na tabela, INSERT só nas colunas de negócio', async () => {
    const tabela = await dono.query(`
      SELECT privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'eventos' AND grantee = 'corre_app'
      ORDER BY privilege_type
    `);
    assert.deepEqual(tabela.rows.map((r) => r.privilege_type), ['SELECT']);

    // INSERT por coluna: id e criado_em ficam de fora — sempre do banco.
    const colunas = await dono.query(`
      SELECT column_name
      FROM information_schema.role_column_grants
      WHERE table_schema = 'public' AND table_name = 'eventos'
        AND grantee = 'corre_app' AND privilege_type = 'INSERT'
      ORDER BY column_name
    `);
    assert.deepEqual(
      colunas.rows.map((r) => r.column_name),
      ['agregado_id', 'agregado_tipo', 'autor_id', 'autor_tipo', 'chave_idempotencia', 'payload', 'seq', 'tipo'],
    );
  });

  await t.test('os triggers de imutabilidade e do log sem buraco existem e estão ativos', async () => {
    const { rows } = await dono.query(`
      SELECT tgname, tgenabled
      FROM pg_trigger
      WHERE tgrelid = 'eventos'::regclass AND NOT tgisinternal
      ORDER BY tgname
    `);
    assert.deepEqual(rows, [
      { tgname: 'eventos_bloqueia_buraco', tgenabled: 'O' },
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
