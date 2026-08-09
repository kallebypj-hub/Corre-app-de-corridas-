'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const { criaCorrida, transiciona } = require('../src/dominio/corridas');
const { ErroDeDominio } = require('../src/dominio/erros');
const { poolApp, levaAte } = require('./ajuda-maquina');

const REPETICOES = 50;

test('idempotência (Lei 5)', async (t) => {
  const pool = poolApp();
  t.after(() => pool.end());

  await t.test(`criação repetida ${REPETICOES}x com a mesma chave gera um único evento e uma única corrida`, async () => {
    const chave = `idem-criacao-${randomUUID()}`;
    // Tudo junto, em paralelo: é a retentativa de rede real, não uma fila educada.
    const respostas = await Promise.all(
      Array.from({ length: REPETICOES }, () => criaCorrida(pool, {
        autorTipo: 'lojista',
        autorId: randomUUID(),
        payload: { origem: 'idempotencia' },
        chaveIdempotencia: chave,
      })),
    );

    const ids = new Set(respostas.map(({ corrida }) => corrida.id));
    assert.equal(ids.size, 1, 'todas as respostas apontam a mesma corrida');
    assert.equal(respostas.filter(({ repetida }) => !repetida).length, 1, 'exatamente uma execução real');
    assert.equal(respostas.filter(({ repetida }) => repetida).length, REPETICOES - 1);

    const { rows: [{ n }] } = await pool.query(
      'SELECT count(*) AS n FROM eventos WHERE chave_idempotencia = $1',
      [chave],
    );
    assert.equal(n, '1', 'um único evento para a chave');
  });

  await t.test(`transição repetida ${REPETICOES}x com a mesma chave gera um único evento — operação nula, não erro`, async () => {
    const corrida = await levaAte(pool, 1);
    const chave = `idem-transicao-${randomUUID()}`;

    const respostas = await Promise.all(
      Array.from({ length: REPETICOES }, () => transiciona(pool, {
        corridaId: corrida.id,
        tipo: 'pagamento_confirmado',
        autorTipo: 'sistema',
        autorId: null,
        chaveIdempotencia: chave,
      })),
    );

    for (const { corrida: resposta } of respostas) {
      assert.equal(resposta.estado, 2);
      assert.equal(resposta.seq, 2);
    }
    assert.equal(respostas.filter(({ repetida }) => !repetida).length, 1);

    const { rows: [{ n }] } = await pool.query(
      'SELECT count(*) AS n FROM eventos WHERE chave_idempotencia = $1',
      [chave],
    );
    assert.equal(n, '1', 'um único evento para a chave');

    const { rows: [final] } = await pool.query(
      'SELECT estado, seq FROM corridas WHERE id = $1',
      [corrida.id],
    );
    assert.equal(final.estado, 2);
    assert.equal(final.seq, 2, 'o log não cresceu com as repetições');
  });

  await t.test('a mesma chave em OUTRA operação é reuso indevido, não replay', async () => {
    const corrida = await levaAte(pool, 1);
    const chave = `idem-reuso-${randomUUID()}`;
    await transiciona(pool, {
      corridaId: corrida.id,
      tipo: 'pagamento_confirmado',
      autorTipo: 'sistema',
      autorId: null,
      chaveIdempotencia: chave,
    });

    await assert.rejects(
      () => transiciona(pool, {
        corridaId: corrida.id,
        tipo: 'motoboy_aceitou',
        autorTipo: 'motoboy',
        autorId: randomUUID(),
        chaveIdempotencia: chave,
      }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'chave_reutilizada',
    );

    const outra = await levaAte(pool, 1);
    await assert.rejects(
      () => transiciona(pool, {
        corridaId: outra.id,
        tipo: 'pagamento_confirmado',
        autorTipo: 'sistema',
        autorId: null,
        chaveIdempotencia: chave,
      }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'chave_reutilizada',
    );
  });
});
