'use strict';

// Etapa 4 — multi-cidade e o cliente como ator.
//
// O que esta bateria tem que provar, e a ordem importa:
//   1. a política FECHA POR PADRÃO — sem cidade declarada, nenhuma linha;
//   2. cidade A não enxerga cidade B, em leitura e em escrita;
//   3. o banco impede a corrida de misturar cidades, por chave composta —
//      não é verificação de código, é impossível por construção;
//   4. A ARMADILHA DO POOL: a cidade morre no COMMIT e não sobra na conexão
//      devolvida; e sob carga, com requisições de cidades diferentes
//      intercaladas, nenhuma devolve dado da cidade errada;
//   5. o cliente é da plataforma, nasce sozinho e é reivindicado uma vez só,
//      inclusive sob concorrência (Lei 9).

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const { cadastraLojista, registraCartao } = require('../src/dominio/contas');
const { criaCorrida } = require('../src/dominio/corridas');
const { garanteCliente, reivindica, buscaClientePorTelefone } = require('../src/dominio/clientes');
const { poolDaCidade } = require('../src/dominio/cidades');
const { ErroDeDominio, CODIGOS } = require('../src/dominio/erros');
const { emTransacao } = require('../src/dominio/nucleo');
const { conectaDono, esperaErro } = require('./ajuda');
const {
  poolApp, poolCru, SOBRAL, emParalelo,
} = require('./ajuda-maquina');

const telefoneNovo = () => `88 9${String(process.pid % 1e4).padStart(4, '0')}-${randomUUID().slice(0, 8)}`;

// Uma segunda cidade, criada por ato de dono (o app só lê `cidades`), com a
// própria configuração de taxa — porque configuração de taxa é POR CIDADE.
async function criaSegundaCidade(dono) {
  const ibge = String(2300000 + (Math.floor(Number(process.hrtime.bigint() % 90000n)) + 10000));
  const { rows: [cidade] } = await dono.query(
    `INSERT INTO cidades (nome, uf, ibge, tempo_base_coleta_min)
     VALUES ($1, 'CE', $2, 12) RETURNING id`,
    [`Cidade ${ibge}`, ibge],
  );
  await dono.query(
    `INSERT INTO configuracoes_taxa
       (rotulo, gateway, comissao_bps, taxa_percentual_bps, taxa_fixa_centavos,
        portador_taxa_percentual, frete_minimo_centavos, mercadoria_maxima_centavos, exemplo, cidade_id)
     VALUES ($1, 'teste', 500, 119, 0, 'lojista', 500, 50000, true, $2)`,
    [`exemplo-${ibge}`, cidade.id],
  );
  return cidade.id;
}

// ------------------------------------------- 1. fecha por padrão

test('sem cidade declarada, a consulta CEGA — não vaza', async (t) => {
  const pool = poolApp();
  const cru = poolCru();
  t.after(async () => { await pool.end(); await cru.end(); });

  const { conta } = await cadastraLojista(pool, { nome: 'Loja Sobral', telefone: telefoneNovo() });

  // O mesmo SELECT, com e sem cidade declarada.
  const { rows: comCidade } = await pool.query('SELECT id FROM lojistas WHERE id = $1', [conta.id]);
  assert.equal(comCidade.length, 1);

  const { rows: semCidade } = await cru.query('SELECT id FROM lojistas WHERE id = $1', [conta.id]);
  assert.equal(semCidade.length, 0, 'sem cidade a política tem que devolver ZERO linhas, não todas');

  // E não é só o lojista. A lista NAO e escrita à mão: ela é DESCOBERTA no
  // catálogo, porque foi exatamente uma lista escrita à mão que deixou
  // `eventos` de fora na primeira versão desta etapa — e `eventos` é a fonte
  // da verdade da Lei 2. Tabela nova sem política reprova aqui sozinha.
  const { rows: tabelas } = await cru.query(`
    SELECT c.relname AS tabela, c.relrowsecurity AS tem_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `);
  // As que ficam fora do isolamento estão DECLARADAS, uma a uma, com motivo:
  //   cidades           catálogo, o app só lê
  //   clientes          o cliente é da plataforma (seção 20)
  //   operadores        a operação é da plataforma
  //   sessoes           é onde se DESCOBRE a cidade; com política, cegaria
  //   otp_envios        o limite de SMS é da plataforma, não da cidade
  //   schema_migrations infraestrutura
  const FORA = new Set(['cidades', 'clientes', 'operadores', 'sessoes', 'otp_envios', 'schema_migrations']);
  const semPolitica = tabelas.filter((t) => !t.tem_rls && !FORA.has(t.tabela)).map((t) => t.tabela);
  assert.deepEqual(semPolitica, [], `tabela por cidade sem política: ${semPolitica.join(', ')}`);

  for (const { tabela, tem_rls: temRls } of tabelas) {
    if (!temRls) continue;
    const { rows } = await cru.query(`SELECT count(*)::int AS n FROM ${tabela}`);
    assert.equal(rows[0].n, 0, `${tabela} devolveu linha sem cidade declarada`);
  }
});

test('o LOG de outra cidade não se lê nem se escreve — nem sem cidade nenhuma', async (t) => {
  const dono = await conectaDono();
  const poolA = poolApp();
  const cru = poolCru();
  t.after(async () => { await dono.end(); await poolA.end(); await cru.end(); });

  const cidadeB = await criaSegundaCidade(dono);
  const poolB = poolDaCidade(poolA.cru, cidadeB);
  const { conta: lojistaB } = await cadastraLojista(poolB, { nome: 'Sigilo B', telefone: telefoneNovo() });
  await registraCartao(poolB, { lojistaId: lojistaB.id, cartaoRef: 'cartao' });
  const { corrida: corridaB } = await criaCorrida(poolB, {
    autorTipo: 'lojista', autorId: lojistaB.id, payload: {}, chaveIdempotencia: randomUUID(),
  });

  // LEITURA: o log da corrida de B não aparece em A, nem sem cidade nenhuma.
  for (const [nome, pool] of [['cidade A', poolA], ['sem cidade', cru]]) {
    const { rows } = await pool.query('SELECT tipo FROM eventos WHERE agregado_id = $1', [corridaB.id]);
    assert.equal(rows.length, 0, `${nome} leu o log da corrida de outra cidade`);
  }

  // ESCRITA: anexar evento no log de B, estando em A, tem que ser recusado.
  // É o pior caso: a Lei 3 proíbe apagar, então um evento intruso destruiria
  // a corrida alheia para sempre.
  const erro = await emTransacao(poolA.cru, async (c) => {
    await c.query('SELECT set_config($1,$2,true)', ['corre.cidade_id', SOBRAL]);
    return c.query(
      `INSERT INTO eventos (tipo, agregado_tipo, agregado_id, seq, payload, autor_tipo, autor_id)
       VALUES ('cancelada', 'corrida', $1, 2, '{}', 'sistema', NULL)`,
      [corridaB.id],
    );
  }).then(() => null, (e) => e);
  // Recusa por RLS ou pelo trigger anti-buraco — que, sob a política, nem
  // enxerga o log alheio para contar a próxima posição. Os dois são recusa;
  // o que importa é o EFEITO, e o efeito está na asserção seguinte.
  assert.ok(erro, 'escrever no log de outra cidade tinha que falhar');

  // E a corrida de B continua intacta: a posição 2 do log dela está livre.
  const { rows: [{ n }] } = await poolB.query(
    'SELECT count(*)::int AS n FROM eventos WHERE agregado_id = $1', [corridaB.id],
  );
  assert.equal(Number(n), 1, 'o log da corrida alheia foi tocado');
});

test('a chave de idempotência é por cidade e não vaza id de agregado alheio', async (t) => {
  const dono = await conectaDono();
  const poolA = poolApp();
  t.after(async () => { await dono.end(); await poolA.end(); });

  const cidadeB = await criaSegundaCidade(dono);
  const poolB = poolDaCidade(poolA.cru, cidadeB);

  const chave = randomUUID();
  const emB = await cadastraLojista(poolB, { nome: 'B', telefone: telefoneNovo(), chaveIdempotencia: chave });
  // A MESMA chave, noutra cidade, é outra operação — não colide e não conta
  // nada sobre a de lá.
  const emA = await cadastraLojista(poolA, { nome: 'A', telefone: telefoneNovo(), chaveIdempotencia: chave });

  assert.notEqual(emA.conta.id, emB.conta.id);
  assert.equal(emA.repetida, false, 'chave de outra cidade não pode virar replay');
});

test('o pool de cidade recusa nascer sem cidade — falha cedo, não silenciosa', () => {
  assert.throws(() => poolDaCidade({}, null), (erro) => {
    assert.ok(erro instanceof ErroDeDominio);
    assert.equal(erro.codigo, CODIGOS.CIDADE_NAO_DECLARADA);
    return true;
  });
});

// ------------------------------------------- 2. A não enxerga B

test('cidade A não lê nem escreve na cidade B', async (t) => {
  const dono = await conectaDono();
  const poolA = poolApp();
  t.after(async () => { await dono.end(); await poolA.end(); });

  const cidadeB = await criaSegundaCidade(dono);
  const poolB = poolDaCidade(poolA.cru, cidadeB);

  const { conta: emA } = await cadastraLojista(poolA, { nome: 'Loja A', telefone: telefoneNovo() });
  const { conta: emB } = await cadastraLojista(poolB, { nome: 'Loja B', telefone: telefoneNovo() });

  // Leitura: cada uma só vê a sua.
  assert.equal((await poolA.query('SELECT id FROM lojistas WHERE id = $1', [emB.id])).rows.length, 0);
  assert.equal((await poolB.query('SELECT id FROM lojistas WHERE id = $1', [emA.id])).rows.length, 0);
  assert.equal((await poolA.query('SELECT id FROM lojistas WHERE id = $1', [emA.id])).rows.length, 1);

  // Escrita: o WITH CHECK é quem dá dente. Estando em A, gravar linha de B
  // é recusado pela POLÍTICA, não por verificação no código.
  const erro = await emTransacao(poolA.cru, async (c) => {
    await c.query('SELECT set_config($1,$2,true)', ['corre.cidade_id', SOBRAL]);
    return c.query(
      `INSERT INTO lojistas (seq, nome, telefone, situacao, cidade_id)
       VALUES (1, 'intrusa', $1, 'ativa', $2)`,
      [telefoneNovo(), cidadeB],
    );
  }).then(() => null, (e) => e);
  assert.ok(erro, 'inserir em outra cidade tinha que falhar');
  assert.match(String(erro.message), /row-level security/i);
});

// ------------------------------------------- 3. o banco impede misturar

test('corrida com lojista de outra cidade é impossível por construção', async (t) => {
  const dono = await conectaDono();
  const poolA = poolApp();
  t.after(async () => { await dono.end(); await poolA.end(); });

  const cidadeB = await criaSegundaCidade(dono);
  const poolB = poolDaCidade(poolA.cru, cidadeB);
  const { conta: lojistaB } = await cadastraLojista(poolB, { nome: 'Loja B', telefone: telefoneNovo() });
  await registraCartao(poolB, { lojistaId: lojistaB.id, cartaoRef: 'cartao' });

  // Tentativa direta, como dono (sem RLS): a CHAVE COMPOSTA recusa.
  const erro = await esperaErro(
    dono,
    `INSERT INTO corridas (estado, seq, lojista_id, cidade_id)
     VALUES (1, 1, $1, $2)`,
    [lojistaB.id, SOBRAL],
  );
  assert.equal(erro.code, '23503');
  assert.match(String(erro.constraint), /corridas_lojista_da_mesma_cidade/);
});

test('configuração de taxa é por cidade — cada uma tem a sua', async (t) => {
  const dono = await conectaDono();
  const poolA = poolApp();
  t.after(async () => { await dono.end(); await poolA.end(); });

  const cidadeB = await criaSegundaCidade(dono);
  const poolB = poolDaCidade(poolA.cru, cidadeB);

  const { rows: deA } = await poolA.query('SELECT cidade_id FROM configuracoes_taxa');
  const { rows: deB } = await poolB.query('SELECT cidade_id FROM configuracoes_taxa');
  assert.ok(deA.length > 0 && deB.length > 0);
  assert.ok(deA.every((r) => r.cidade_id === SOBRAL), 'A viu configuração de outra cidade');
  assert.ok(deB.every((r) => r.cidade_id === cidadeB), 'B viu configuração de outra cidade');
});

// --------------------------- 4. A ARMADILHA DO POOL

test('a cidade morre no COMMIT: a conexão devolvida ao pool não a carrega', async (t) => {
  const cru = poolCru(1); // pool de UMA conexão: a mesma volta sempre
  t.after(() => cru.end());

  await emTransacao(cru, async (c) => c.query('SELECT 1'), { cidadeId: SOBRAL });

  // Mesma conexão, transação nova, cidade NÃO declarada.
  const { rows } = await cru.query("SELECT current_setting('corre.cidade_id', true) AS cidade");
  assert.ok(
    rows[0].cidade === null || rows[0].cidade === '',
    `a conexão voltou ao pool carregando a cidade "${rows[0].cidade}" — é o vazamento entre cidades`,
  );
});

test('sob carga, com duas cidades intercaladas num pool pequeno, nenhuma consulta erra de cidade', async (t) => {
  const dono = await conectaDono();
  const cru = poolCru(2); // dois slots para MUITAS requisições: reuso garantido
  t.after(async () => { await dono.end(); await cru.end(); });

  const cidadeB = await criaSegundaCidade(dono);
  const poolA = poolDaCidade(cru, SOBRAL);
  const poolB = poolDaCidade(cru, cidadeB);

  const { conta: emA } = await cadastraLojista(poolA, { nome: 'Carga A', telefone: telefoneNovo() });
  const { conta: emB } = await cadastraLojista(poolB, { nome: 'Carga B', telefone: telefoneNovo() });

  const RODADAS = 2000;
  const pedidos = Array.from({ length: RODADAS }, (_, i) => (i % 2 === 0 ? 'A' : 'B'));

  const erros = [];
  await emParalelo(pedidos, 16, async (qual) => {
    const pool = qual === 'A' ? poolA : poolB;
    const meu = qual === 'A' ? emA.id : emB.id;
    const alheio = qual === 'A' ? emB.id : emA.id;

    const { rows: meus } = await pool.query('SELECT id FROM lojistas WHERE id = $1', [meu]);
    if (meus.length !== 1) erros.push(`${qual} não viu o próprio lojista`);

    const { rows: outros } = await pool.query('SELECT id FROM lojistas WHERE id = $1', [alheio]);
    if (outros.length !== 0) erros.push(`${qual} VIU o lojista da outra cidade`);
  });

  assert.deepEqual(erros.slice(0, 5), [], `${erros.length} vazamentos em ${RODADAS} requisições`);
});

// ------------------------------------------- 5. o cliente

test('o cliente nasce pelo telefone que o lojista digita, e não tem cidade', async (t) => {
  const pool = poolApp();
  t.after(() => pool.end());

  const telefone = telefoneNovo();
  const { cliente, criada } = await garanteCliente(pool.cru, { telefone });
  assert.equal(criada, true);
  assert.equal(cliente.telefone, telefone);
  assert.equal(cliente.reivindicado_em, null, 'nasce NÃO reivindicada');
  assert.equal(cliente.cidade_id, undefined, 'cliente não tem cidade — é da plataforma');

  // Segundo lojista digitando o mesmo número: a MESMA conta, não erro.
  const outra = await garanteCliente(pool.cru, { telefone });
  assert.equal(outra.criada, false);
  assert.equal(outra.cliente.id, cliente.id);
});

test('o mesmo telefone pode ser de um lojista e de um cliente ao mesmo tempo', async (t) => {
  const pool = poolApp();
  t.after(() => pool.end());

  const telefone = telefoneNovo();
  const { conta } = await cadastraLojista(pool, { nome: 'Dona da loja', telefone });
  const { cliente } = await garanteCliente(pool.cru, { telefone });

  assert.ok(conta.id && cliente.id);
  assert.notEqual(conta.id, cliente.id, 'são identidades distintas, não a mesma conta');
  assert.equal(cliente.telefone, conta.telefone);
});

test('reivindicar é idempotente e grava um evento só', async (t) => {
  const pool = poolApp();
  t.after(() => pool.end());

  const { cliente } = await garanteCliente(pool.cru, { telefone: telefoneNovo() });
  const primeira = await reivindica(pool.cru, { clienteId: cliente.id, nome: 'Maria' });
  assert.equal(primeira.repetida, false);
  assert.equal(primeira.cliente.nome, 'Maria');
  assert.ok(primeira.cliente.reivindicado_em);

  const segunda = await reivindica(pool.cru, { clienteId: cliente.id, nome: 'Maria' });
  assert.equal(segunda.repetida, true);

  const { rows } = await pool.cru.query(
    `SELECT count(*)::int AS n FROM eventos
     WHERE agregado_tipo = 'cliente' AND agregado_id = $1 AND tipo = 'cliente_reivindicado'`,
    [cliente.id],
  );
  assert.equal(rows[0].n, 1, 'reivindicação repetida não pode gerar segundo evento');
});

test('Lei 9 — 60 tentativas simultâneas com o mesmo telefone dão UMA conta', async (t) => {
  const pool = poolApp();
  t.after(() => pool.end());

  const telefone = telefoneNovo();
  const resultados = await emParalelo(
    Array.from({ length: 60 }, (_, i) => i), 60,
    () => garanteCliente(pool.cru, { telefone }).then((r) => r.cliente.id, (e) => `erro:${e.message}`),
  );

  const ids = new Set(resultados);
  assert.equal(ids.size, 1, `deveria existir uma conta só, apareceram ${ids.size}: ${[...ids].slice(0, 3)}`);

  const { rows } = await pool.cru.query(
    'SELECT count(*)::int AS n FROM clientes WHERE telefone = $1', [telefone],
  );
  assert.equal(rows[0].n, 1);
});

test('Lei 9 — 40 reivindicações simultâneas geram UM evento só', async (t) => {
  const pool = poolApp();
  t.after(() => pool.end());

  const { cliente } = await garanteCliente(pool.cru, { telefone: telefoneNovo() });
  await emParalelo(
    Array.from({ length: 40 }, (_, i) => i), 40,
    () => reivindica(pool.cru, { clienteId: cliente.id, nome: 'Ana' }).then(() => null, (e) => e),
  );

  const { rows } = await pool.cru.query(
    `SELECT count(*)::int AS n FROM eventos
     WHERE agregado_tipo = 'cliente' AND agregado_id = $1 AND tipo = 'cliente_reivindicado'`,
    [cliente.id],
  );
  assert.equal(rows[0].n, 1, 'o UPDATE condicional é quem arbitra, não a ordem de execução');
});

test('a corrida guarda cidade e cliente', async (t) => {
  const pool = poolApp();
  t.after(() => pool.end());

  const { conta } = await cadastraLojista(pool, { nome: 'Loja com cliente', telefone: telefoneNovo() });
  await registraCartao(pool, { lojistaId: conta.id, cartaoRef: 'cartao' });
  const { cliente } = await garanteCliente(pool.cru, { telefone: telefoneNovo() });

  const { corrida } = await criaCorrida(pool, {
    autorTipo: 'lojista',
    autorId: conta.id,
    payload: { cliente_id: cliente.id },
    chaveIdempotencia: randomUUID(),
  });

  assert.equal(corrida.cidade_id, SOBRAL);
  assert.equal(corrida.cliente_id, cliente.id);
});
