'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');

const {
  conectaDono,
  conectaApp,
  esperaErro,
  eventoSintetico,
  insereEvento,
} = require('./ajuda');

// Erros do PostgreSQL usados nas asserções:
//   42501 insufficient_privilege — camada de privilégio (papel corre_app)
//   P0001 raise_exception        — camada de trigger (vale até para o dono)
//   23514 check_violation        — constraints de conteúdo

test('eventos append-only', async (t) => {
  const app = await conectaApp();
  const dono = await conectaDono();
  t.after(async () => {
    await app.end();
    await dono.end();
  });

  await t.test('corre_app insere e lê eventos', async () => {
    const id = await insereEvento(app, eventoSintetico());
    const { rows } = await app.query('SELECT tipo, autor_tipo FROM eventos WHERE id = $1', [id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tipo, 'corrida_criada');
  });

  await t.test('UPDATE como corre_app falha por permissão (42501)', async () => {
    const id = await insereEvento(app, eventoSintetico());
    const erro = await esperaErro(app, "UPDATE eventos SET tipo = 'adulterado' WHERE id = $1", [id]);
    assert.equal(erro.code, '42501');
  });

  await t.test('DELETE como corre_app falha por permissão (42501)', async () => {
    const id = await insereEvento(app, eventoSintetico());
    const erro = await esperaErro(app, 'DELETE FROM eventos WHERE id = $1', [id]);
    assert.equal(erro.code, '42501');
  });

  await t.test('TRUNCATE como corre_app falha por permissão (42501)', async () => {
    const erro = await esperaErro(app, 'TRUNCATE eventos');
    assert.equal(erro.code, '42501');
  });

  await t.test('UPDATE até como dono da tabela falha pelo trigger', async () => {
    const id = await insereEvento(app, eventoSintetico());
    const erro = await esperaErro(dono, "UPDATE eventos SET tipo = 'adulterado' WHERE id = $1", [id]);
    assert.equal(erro.code, 'P0001');
    assert.match(erro.message, /append-only/);
  });

  await t.test('DELETE até como dono da tabela falha pelo trigger', async () => {
    const id = await insereEvento(app, eventoSintetico());
    const erro = await esperaErro(dono, 'DELETE FROM eventos WHERE id = $1', [id]);
    assert.equal(erro.code, 'P0001');
    assert.match(erro.message, /append-only/);
  });

  await t.test('TRUNCATE até como dono da tabela falha pelo trigger', async () => {
    const erro = await esperaErro(dono, 'TRUNCATE eventos');
    assert.equal(erro.code, 'P0001');
    assert.match(erro.message, /append-only/);
  });

  await t.test('corre_app não desliga os triggers de imutabilidade', async () => {
    const erro = await esperaErro(app, 'ALTER TABLE eventos DISABLE TRIGGER eventos_bloqueia_update_delete');
    assert.equal(erro.code, '42501');
    // 42501 sai para qualquer ALTER TABLE de não-dono, até com trigger
    // inexistente — então confira também que os alvos seguem lá, ativos.
    const { rows } = await dono.query(`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'eventos'::regclass AND NOT tgisinternal AND tgenabled = 'O'
      ORDER BY tgname
    `);
    assert.deepEqual(
      rows.map((r) => r.tgname),
      ['eventos_bloqueia_buraco', 'eventos_bloqueia_truncate', 'eventos_bloqueia_update_delete'],
    );
  });

  await t.test('corre_app não escolhe o id nem com OVERRIDING SYSTEM VALUE (42501)', async () => {
    const erro = await esperaErro(
      app,
      `INSERT INTO eventos (id, tipo, agregado_tipo, agregado_id, autor_tipo)
       OVERRIDING SYSTEM VALUE VALUES (999999, 'forjado', 'corrida', $1, 'sistema')`,
      [randomUUID()],
    );
    assert.equal(erro.code, '42501');
  });

  await t.test('corre_app não forja criado_em (42501)', async () => {
    const erro = await esperaErro(
      app,
      `INSERT INTO eventos (tipo, agregado_tipo, agregado_id, autor_tipo, criado_em)
       VALUES ('forjado', 'corrida', $1, 'sistema', '2000-01-01T00:00:00Z')`,
      [randomUUID()],
    );
    assert.equal(erro.code, '42501');
  });

  await t.test('corre_app não abre buraco no log: seq fora da próxima posição é recusado (CR001)', async () => {
    const agregado = randomUUID();
    await insereEvento(app, eventoSintetico({ agregado_id: agregado, seq: 1 }));

    const erro = await esperaErro(
      app,
      `INSERT INTO eventos (tipo, agregado_tipo, agregado_id, seq, autor_tipo)
       VALUES ('pulo', 'corrida', $1, 5, 'sistema')`,
      [agregado],
    );
    assert.equal(erro.code, 'CR001');
    assert.match(erro.message, /log sem buraco/);

    // A posição certa continua aceita — o trigger só recusa o pulo.
    const id = await insereEvento(app, eventoSintetico({ agregado_id: agregado, seq: 2 }));
    assert.ok(id);
  });

  await t.test('evento de painel sem autor identificado é recusado (23514)', async () => {
    const erro = await esperaErro(
      app,
      `INSERT INTO eventos (tipo, agregado_tipo, agregado_id, seq, autor_tipo, autor_id)
       VALUES ('estorno_forcado', 'corrida', $1, 1, 'painel', NULL)`,
      [randomUUID()],
    );
    assert.equal(erro.code, '23514');
  });

  await t.test('autor_tipo fora da lista é recusado (23514)', async () => {
    const erro = await esperaErro(
      app,
      `INSERT INTO eventos (tipo, agregado_tipo, agregado_id, seq, autor_tipo, autor_id)
       VALUES ('x', 'corrida', $1, 1, 'hacker', $2)`,
      [randomUUID(), randomUUID()],
    );
    assert.equal(erro.code, '23514');
  });

  await t.test('volume: 5.000 eventos sintéticos inseridos e íntegros', async () => {
    // Marcador único por execução: a bateria roda arquivos em paralelo e
    // pode rerodar sem reset — a contagem é relativa a ESTA rodada, não ao
    // total global (senão o verde depende de banco recém-nascido).
    const marcador = randomUUID();
    await app.query(`
      INSERT INTO eventos (tipo, agregado_tipo, agregado_id, seq, payload, autor_tipo)
      SELECT 'corrida_sintetica', 'corrida', gen_random_uuid(), 1,
             jsonb_build_object('n', g, 'frete_centavos', 1000, 'marcador', $1::text), 'sistema'
      FROM generate_series(1, 5000) g
    `, [marcador]);

    // id é IDENTITY (nunca duplica por construção); a integridade que importa
    // é nenhum payload perdido nem duplicado nesta rodada.
    const { rows } = await app.query(`
      SELECT count(*) AS n, count(DISTINCT (payload->>'n')) AS distintos
      FROM eventos WHERE tipo = 'corrida_sintetica' AND payload->>'marcador' = $1
    `, [marcador]);
    assert.equal(rows[0].n, '5000');
    assert.equal(rows[0].distintos, '5000');
  });

  await t.test('concorrência: 10 conexões x 200 inserts, nada se perde nem duplica', async () => {
    const marcador = randomUUID();
    const conexoes = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const c = new Client({ connectionString: process.env.DATABASE_URL_APP });
        await c.connect();
        return c;
      }),
    );
    try {
      await Promise.all(
        conexoes.map(async (c, i) => {
          for (let j = 0; j < 200; j += 1) {
            await insereEvento(c, eventoSintetico({
              tipo: 'evento_concorrente',
              payload: { conexao: i, sequencia: j, marcador },
            }));
          }
        }),
      );
    } finally {
      await Promise.all(conexoes.map((c) => c.end()));
    }

    const { rows } = await app.query(`
      SELECT count(*) AS n,
             count(DISTINCT ((payload->>'conexao') || ':' || (payload->>'sequencia'))) AS distintos
      FROM eventos WHERE tipo = 'evento_concorrente' AND payload->>'marcador' = $1
    `, [marcador]);
    assert.equal(rows[0].n, '2000');
    assert.equal(rows[0].distintos, '2000');
  });
});
