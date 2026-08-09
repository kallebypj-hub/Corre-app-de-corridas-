'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const contas = require('../src/dominio/contas');
const { criaCorrida } = require('../src/dominio/corridas');
const { ErroDeDominio } = require('../src/dominio/erros');
const { poolApp } = require('./ajuda-maquina');
const {
  geraCpfValido, cadastroValidoDeMotoboy, donoDeTeste, atendimentoDeTeste,
} = require('./ajuda-contas');

async function eventoDe(pool, agregadoTipo, agregadoId, tipo) {
  const { rows } = await pool.query(
    `SELECT tipo, autor_tipo, autor_id, payload FROM eventos
     WHERE agregado_tipo = $1 AND agregado_id = $2 AND tipo = $3`,
    [agregadoTipo, agregadoId, tipo],
  );
  return rows;
}

test('cadastro e travas (Etapa 2)', async (t) => {
  const pool = poolApp();
  t.after(() => pool.end());

  await t.test('chave Pix de CPF diferente do cadastro é recusada no ato', async () => {
    await assert.rejects(
      () => contas.cadastraMotoboy(pool, cadastroValidoDeMotoboy({ chavePix: geraCpfValido() })),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'chave_pix_de_outro_cpf',
    );
    // Recusada é recusada: nada ficou gravado.
    const dados = cadastroValidoDeMotoboy({ chavePix: geraCpfValido() });
    await assert.rejects(() => contas.cadastraMotoboy(pool, dados), ErroDeDominio);
    const { rows } = await pool.query('SELECT count(*) AS n FROM motoboys WHERE cpf = $1', [dados.cpf]);
    assert.equal(rows[0].n, '0');
  });

  await t.test('CPF inválido é recusado no ato', async () => {
    await assert.rejects(
      () => contas.cadastraMotoboy(pool, cadastroValidoDeMotoboy({ cpf: '12345678900', chavePix: '12345678900' })),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'cpf_invalido',
    );
    await assert.rejects(
      () => contas.cadastraMotoboy(pool, cadastroValidoDeMotoboy({ cpf: '11111111111', chavePix: '11111111111' })),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'cpf_invalido',
    );
  });

  await t.test('motoboy recém-cadastrado está ativo na hora e o primeiro saque nasce travado', async () => {
    const { conta } = await contas.cadastraMotoboy(pool, cadastroValidoDeMotoboy());
    assert.equal(conta.situacao, 'ativa', 'aprovação automática: entra rodando');
    assert.equal(conta.primeiro_saque, 'travado', 'o que fica preso é o dinheiro, não a porta');

    const eventos = await eventoDe(pool, 'motoboy', conta.id, 'motoboy_cadastrado');
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].autor_tipo, 'motoboy');
    assert.equal(eventos[0].autor_id, conta.id);
  });

  await t.test('cadastro idempotente: mesma chave devolve a mesma conta', async () => {
    const dados = cadastroValidoDeMotoboy();
    const chave = `cadastro-${randomUUID()}`;
    const primeira = await contas.cadastraMotoboy(pool, { ...dados, chaveIdempotencia: chave });
    const segunda = await contas.cadastraMotoboy(pool, { ...dados, chaveIdempotencia: chave });
    assert.equal(segunda.repetida, true);
    assert.equal(segunda.conta.id, primeira.conta.id);
  });

  await t.test('CPF já cadastrado é recusado (chave nova, conta velha)', async () => {
    const dados = cadastroValidoDeMotoboy();
    await contas.cadastraMotoboy(pool, dados);
    await assert.rejects(
      () => contas.cadastraMotoboy(pool, cadastroValidoDeMotoboy({ cpf: dados.cpf, chavePix: dados.cpf })),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'cpf_ja_cadastrado',
    );
  });

  await t.test('lojista entra com nome e telefone; sem cartão de garantia não cria pedido; com cartão cria', async () => {
    const { conta: lojista } = await contas.cadastraLojista(pool, {
      nome: 'Mercadinho São João',
      telefone: `88 3${randomUUID().slice(0, 10)}`,
    });
    assert.equal(lojista.situacao, 'ativa', 'pode ENTRAR');
    assert.equal(lojista.cartao_registrado_em, null, 'ainda não pode PEDIR');

    await assert.rejects(
      () => criaCorrida(pool, { autorTipo: 'lojista', autorId: lojista.id, payload: {} }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'cartao_de_garantia_ausente',
      'pedido sem cartão de garantia tem que ser recusado',
    );

    const { conta: comCartao } = await contas.registraCartao(pool, {
      lojistaId: lojista.id, cartaoRef: 'cartao-valido-sem-cobranca',
    });
    assert.notEqual(comCartao.cartao_registrado_em, null);
    const eventos = await eventoDe(pool, 'lojista', lojista.id, 'cartao_registrado');
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].autor_tipo, 'lojista');

    const { corrida } = await criaCorrida(pool, {
      autorTipo: 'lojista', autorId: lojista.id, payload: {},
    });
    assert.equal(corrida.estado, 1);
    assert.equal(corrida.lojista_id, lojista.id, 'corrida nasce amarrada ao lojista real');
  });

  await t.test('lojista inexistente não cria corrida — impossível por construção', async () => {
    await assert.rejects(
      () => criaCorrida(pool, { autorTipo: 'lojista', autorId: randomUUID(), payload: {} }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'lojista_inexistente',
    );
  });

  await t.test('bloqueio de motoboy é exclusivo do dono e grava evento com autor', async () => {
    const { conta: motoboy } = await contas.cadastraMotoboy(pool, cadastroValidoDeMotoboy());
    const atendimento = await atendimentoDeTeste(pool);
    await assert.rejects(
      () => contas.bloqueiaMotoboy(pool, { motoboyId: motoboy.id, motivo: 'fraude', autor: atendimento }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'papel_insuficiente',
    );

    const dono = await donoDeTeste(pool);
    const { conta: bloqueado } = await contas.bloqueiaMotoboy(pool, {
      motoboyId: motoboy.id, motivo: 'fraude comprovada', autor: dono,
    });
    assert.equal(bloqueado.situacao, 'bloqueada');
    const eventos = await eventoDe(pool, 'motoboy', motoboy.id, 'motoboy_bloqueado');
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].autor_tipo, 'painel');
    assert.equal(eventos[0].autor_id, dono.id);
    assert.equal(eventos[0].payload.motivo, 'fraude comprovada');
  });

  await t.test('liberação do primeiro saque é do dia a dia (atendimento) e grava evento', async () => {
    const { conta: motoboy } = await contas.cadastraMotoboy(pool, cadastroValidoDeMotoboy());
    const atendimento = await atendimentoDeTeste(pool);
    const { conta: liberado } = await contas.liberaPrimeiroSaque(pool, {
      motoboyId: motoboy.id, autor: atendimento,
    });
    assert.equal(liberado.primeiro_saque, 'liberado');
    const eventos = await eventoDe(pool, 'motoboy', motoboy.id, 'primeiro_saque_liberado');
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].autor_id, atendimento.id);
  });

  await t.test('troca de aparelho é ação da operação e grava evento de/para', async () => {
    const dados = cadastroValidoDeMotoboy();
    const { conta: motoboy } = await contas.cadastraMotoboy(pool, dados);
    const atendimento = await atendimentoDeTeste(pool);
    const { conta: trocado } = await contas.trocaAparelho(pool, {
      motoboyId: motoboy.id, novoAparelhoId: 'aparelho-novo-1', autor: atendimento,
    });
    assert.equal(trocado.aparelho_id, 'aparelho-novo-1');
    const eventos = await eventoDe(pool, 'motoboy', motoboy.id, 'aparelho_trocado');
    assert.equal(eventos.length, 1);
    assert.deepEqual(eventos[0].payload, { de: dados.aparelhoId, para: 'aparelho-novo-1' });
    assert.equal(eventos[0].autor_tipo, 'painel');
  });

  await t.test('só o dono cria operador; gênese só existe uma', async () => {
    const atendimento = await atendimentoDeTeste(pool);
    await assert.rejects(
      () => contas.criaOperador(pool, { nome: 'Intruso', papel: 'dono', autor: atendimento }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'papel_insuficiente',
    );
    await assert.rejects(
      () => contas.criaOperadorGenese(pool, { nome: 'Segundo Gênese' }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'genese_ja_feita',
    );
  });

  await t.test('histórico da conta é reconstruível: reconstrução bate com a projeção após as ações', async () => {
    const { conta: motoboy } = await contas.cadastraMotoboy(pool, cadastroValidoDeMotoboy());
    const dono = await donoDeTeste(pool);
    const atendimento = await atendimentoDeTeste(pool);
    await contas.trocaAparelho(pool, { motoboyId: motoboy.id, novoAparelhoId: 'ap-2', autor: atendimento });
    await contas.liberaPrimeiroSaque(pool, { motoboyId: motoboy.id, autor: atendimento });
    await contas.bloqueiaMotoboy(pool, { motoboyId: motoboy.id, motivo: 'teste', autor: dono });

    const derivado = await contas.reconstroiConta(pool, 'motoboy', motoboy.id);
    const gravado = await contas.buscaMotoboy(pool, motoboy.id);
    assert.deepEqual(
      {
        situacao: derivado.situacao,
        primeiro_saque: derivado.primeiro_saque,
        aparelho_id: derivado.aparelho_id,
        seq: derivado.seq,
      },
      {
        situacao: gravado.situacao,
        primeiro_saque: gravado.primeiro_saque,
        aparelho_id: gravado.aparelho_id,
        seq: gravado.seq,
      },
    );
    assert.equal(gravado.situacao, 'bloqueada');
    assert.equal(gravado.seq, 4);
  });
});
