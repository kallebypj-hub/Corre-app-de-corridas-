'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const { criaCorrida, transiciona } = require('../src/dominio/corridas');
const { ErroDeDominio } = require('../src/dominio/erros');
const { poolApp, levaAte, lojistaApto, atorPara } = require('./ajuda-maquina');

const REPETICOES = 50;

test('idempotência (Lei 5)', async (t) => {
  const pool = poolApp();
  t.after(() => pool.end());

  await t.test(`criação repetida ${REPETICOES}x com a mesma chave gera um único evento e uma única corrida`, async () => {
    const chave = `idem-criacao-${randomUUID()}`;
    // Tudo junto, em paralelo: é a retentativa de rede real, não uma fila educada.
    const lojistaId = await lojistaApto(pool);
    const respostas = await Promise.all(
      Array.from({ length: REPETICOES }, () => criaCorrida(pool, {
        autorTipo: 'lojista',
        autorId: lojistaId,
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

    // O MESMO autor nas 50: é um aparelho retentando, não 50 aparelhos. A
    // chave é do autor (Lei 11) — 50 autores diferentes com a mesma chave é
    // reuso indevido, e tem teste próprio em maquina.test.js.
    // E é um motoboy DE VERDADE: com UUID inventado a bateria provava a Lei 5
    // sobre um evento que o banco nem deveria ter aceitado.
    const aparelho = await atorPara(pool, 'motoboy');
    const respostas = await Promise.all(
      Array.from({ length: REPETICOES }, () => transiciona(pool, {
        corridaId: corrida.id,
        tipo: 'motoboy_aceitou',
        autorTipo: 'motoboy',
        autorId: aparelho,
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

  await t.test('retentativa sequencial pós-commit devolve o resultado original — um único evento, replay em vez de erro', async () => {
    // O caso canônico da Lei 5: a operação chegou, a RESPOSTA se perdeu, o
    // chamador re-envia a mesma chave depois do commit. Não é o Promise.all
    // (que disputa antes do commit) — é retry com a corrida já movida.
    const cenarios = [
      { ate: 1, tipo: 'motoboy_aceitou', autorTipo: 'motoboy', estadoFinal: 2 },
      { ate: 2, tipo: 'coleta_confirmada', autorTipo: 'motoboy', estadoFinal: 3 },
      // O par que mais importa: a confirmação do gateway é o caminho do
      // dinheiro, e é a retentativa dela que não pode virar dois Pagos.
      { ate: 4, tipo: 'pagamento_confirmado', autorTipo: 'sistema', estadoFinal: 5 },
      { ate: 3, tipo: 'cancelada', autorTipo: 'painel', payload: { motivo: 'retentativa de rede' }, estadoFinal: 10 },
    ];
    for (const cenario of cenarios) {
      const corrida = await levaAte(pool, cenario.ate);
      const chave = `idem-sequencial-${randomUUID()}`;
      const autor = await atorPara(pool, cenario.autorTipo);
      const argumentos = {
        corridaId: corrida.id,
        tipo: cenario.tipo,
        autorTipo: cenario.autorTipo,
        autorId: autor,
        interno: cenario.autorTipo === 'sistema',
        payload: cenario.payload,
        chaveIdempotencia: chave,
      };
      const primeira = await transiciona(pool, argumentos);
      assert.equal(primeira.repetida, false);

      const segunda = await transiciona(pool, argumentos);
      assert.equal(segunda.repetida, true, `retentativa de ${cenario.tipo} deveria replayar, não errar`);
      assert.equal(segunda.corrida.estado, cenario.estadoFinal);
      assert.equal(segunda.corrida.seq, primeira.corrida.seq, 'o log não anda na retentativa');

      const { rows: [{ n }] } = await pool.query(
        'SELECT count(*) AS n FROM eventos WHERE chave_idempotencia = $1',
        [chave],
      );
      assert.equal(n, '1');
    }
  });

  await t.test('a chave de idempotência NÃO é chave-mestra: repetida por outro lojista é reuso, não replay', async () => {
    // Achado CRÍTICO da auditoria da Etapa 5. Sem a conferência de dono, a
    // chave repetida devolvia a corrida DO OUTRO lojista — e devolvia ANTES
    // da validação de autor, então motoboy, cliente, painel e até 'sistema'
    // recebiam o pedido alheio. E o segundo pedido nunca era criado: sumia.
    const { cadastraLojista, registraCartao } = require('../src/dominio/contas');
    const { criaCorrida } = require('../src/dominio/corridas');
    async function lojistaNovo(nome) {
      const { conta } = await cadastraLojista(pool, { nome, telefone: `88 9${randomUUID().slice(0, 10)}` });
      await registraCartao(pool, { lojistaId: conta.id, cartaoRef: 'cartao' });
      return conta.id;
    }
    const A = await lojistaNovo('Loja A');
    const B = await lojistaNovo('Loja B');
    const chave = `pedido-${randomUUID()}`;

    const primeira = await criaCorrida(pool, {
      autorTipo: 'lojista', autorId: A, payload: { origem: 'A' }, chaveIdempotencia: chave,
    });
    assert.equal(primeira.repetida, false);

    await assert.rejects(
      () => criaCorrida(pool, {
        autorTipo: 'lojista', autorId: B, payload: { origem: 'B' }, chaveIdempotencia: chave,
      }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'chave_reutilizada',
      'a chave de outro lojista não pode devolver a corrida dele',
    );

    // Nem por outro tipo de autor — que sem chave já seria recusado.
    for (const autorTipo of ['motoboy', 'cliente', 'painel', 'sistema']) {
      const autor = await atorPara(pool, autorTipo);
      await assert.rejects(
        () => criaCorrida(pool, {
          autorTipo, autorId: autor, payload: {}, chaveIdempotencia: chave,
        }),
        (erro) => erro instanceof ErroDeDominio
          && ['chave_reutilizada', 'autor_nao_autorizado'].includes(erro.codigo),
        `${autorTipo} com a chave alheia não pode receber a corrida`,
      );
    }

    // A mensagem do reuso NÃO pode entregar o id do agregado alheio.
    const vazou = await criaCorrida(pool, {
      autorTipo: 'lojista', autorId: B, payload: { origem: 'B' }, chaveIdempotencia: chave,
    }).then(() => null, (erro) => erro.message);
    assert.ok(vazou && !vazou.includes(primeira.corrida.id), `a mensagem vazou o id alheio: ${vazou}`);

    // E o DONO legítimo continua replayando: a Lei 5 não pode ter quebrado.
    const repetida = await criaCorrida(pool, {
      autorTipo: 'lojista', autorId: A, payload: { origem: 'A' }, chaveIdempotencia: chave,
    });
    assert.equal(repetida.repetida, true);
    assert.equal(repetida.corrida.id, primeira.corrida.id);
  });

  await t.test('a mesma chave em OUTRA operação é reuso indevido, não replay', async () => {
    const corrida = await levaAte(pool, 1);
    const chave = `idem-reuso-${randomUUID()}`;
    const aparelhoUnico = await atorPara(pool, 'motoboy');
    await transiciona(pool, {
      corridaId: corrida.id,
      tipo: 'motoboy_aceitou',
      autorTipo: 'motoboy',
      autorId: aparelhoUnico,
      chaveIdempotencia: chave,
    });

    await assert.rejects(
      () => transiciona(pool, {
        corridaId: corrida.id,
        tipo: 'coleta_confirmada',
        autorTipo: 'motoboy',
        autorId: aparelhoUnico,
        chaveIdempotencia: chave,
      }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'chave_reutilizada',
    );

    const outra = await levaAte(pool, 1);
    await assert.rejects(
      () => transiciona(pool, {
        corridaId: outra.id,
        tipo: 'motoboy_aceitou',
        autorTipo: 'motoboy',
        autorId: aparelhoUnico,
        chaveIdempotencia: chave,
      }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'chave_reutilizada',
    );
  });
});
