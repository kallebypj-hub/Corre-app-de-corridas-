'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: espera } = require('node:timers/promises');
const path = require('node:path');

const { Pool } = require('pg');

const E = require('../src/dominio/estados');
const {
  criaCorrida, transiciona, expiraVencidas, corridasParadas,
} = require('../src/dominio/corridas');
const { ErroDeDominio } = require('../src/dominio/erros');
const { poolApp, levaAte, lojistaApto, aplica } = require('./ajuda-maquina');

const executa = promisify(execFile);
const CRIA = path.join(__dirname, '..', 'apoio-de-teste', 'cria-corrida.js');
const VARRE = path.join(__dirname, '..', 'src', 'bin', 'expira-vencidas.js');

test('prazos e tempo do servidor', async (t) => {
  const pool = poolApp();
  t.after(() => pool.end());

  await t.test('vence_em nasce do relógio do servidor: criação abre a cascata de 5 min', async () => {
    const { corrida } = await criaCorrida(pool, {
      autorTipo: 'lojista', autorId: await lojistaApto(pool), payload: {},
    });
    const { rows: [{ agora }] } = await pool.query('SELECT now() AS agora');
    const esperado = agora.getTime() + 5 * 60 * 1000;
    assert.ok(
      Math.abs(corrida.vence_em.getTime() - esperado) < 5000,
      `vence_em da criação fora da janela: ${corrida.vence_em.toISOString()}`,
    );
  });

  await t.test('a chegada na porta abre a espera de 5 min — o mesmo relógio do QR', async () => {
    const naPorta = await levaAte(pool, E.NA_PORTA_COBRANDO);
    const { rows: [{ agora }] } = await pool.query('SELECT now() AS agora');
    assert.ok(naPorta.vence_em, 'o estado 4 nasce com prazo gravado');
    assert.ok(
      Math.abs(naPorta.vence_em.getTime() - (agora.getTime() + 5 * 60 * 1000)) < 10_000,
      `espera na porta fora da janela: ${naPorta.vence_em.toISOString()}`,
    );

    // E o vencimento está no payload do evento, não só na projeção.
    const { rows: [evento] } = await pool.query(
      `SELECT payload FROM eventos WHERE agregado_tipo = 'corrida' AND agregado_id = $1 AND seq = $2`,
      [naPorta.id, naPorta.seq],
    );
    assert.equal(new Date(evento.payload.vence_em).getTime(), naPorta.vence_em.getTime());
  });

  await t.test('estados sem prazo declarado nascem sem vence_em (2, 3, 5, 6 — Etapa 8)', async () => {
    for (const estado of [E.A_CAMINHO_DA_LOJA, E.COM_A_MERCADORIA, E.PAGO, E.EM_RETORNO]) {
      const corrida = await levaAte(pool, estado);
      assert.equal(corrida.vence_em, null, `estado ${estado} não devia ter prazo nesta etapa`);
    }
  });

  await t.test('tempo é do servidor: payload do cliente com instante é recusado', async () => {
    const lojistaId = await lojistaApto(pool);
    await assert.rejects(
      () => criaCorrida(pool, {
        autorTipo: 'lojista',
        autorId: lojistaId,
        payload: { vence_em: '2099-01-01T00:00:00Z' },
      }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'tempo_do_cliente',
      'criação aceitou vence_em do cliente',
    );

    const corrida = await levaAte(pool, 1);
    await assert.rejects(
      () => transiciona(pool, {
        corridaId: corrida.id,
        tipo: 'motoboy_aceitou',
        autorTipo: 'motoboy',
        autorId: null,
        payload: { criado_em: '2000-01-01T00:00:00Z' },
      }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'tempo_do_cliente',
      'transição aceitou criado_em do cliente',
    );
  });

  await t.test('cascata vencida é detectada com o processo reiniciado no meio (1 → 9)', async () => {
    // Processo A cria a corrida com prazo curto e MORRE. Processo B, novinho,
    // só consulta o banco: o prazo é dado, não timer.
    const { stdout } = await executa('node', [CRIA, 'procurando_motoboy'], {
      env: { ...process.env, CORRE_PRAZO_CASCATA_MS: '250' },
      timeout: 30_000,
    });
    const corridaId = stdout.trim();
    assert.ok(corridaId, 'apoio imprimiu o id da corrida');

    await espera(600);
    await executa('node', [VARRE], { env: process.env, timeout: 30_000 });

    const { rows: [linha] } = await pool.query('SELECT estado FROM corridas WHERE id = $1', [corridaId]);
    assert.equal(linha.estado, E.SEM_MOTOBOY, 'cascata vencida virou sem_motoboy (estado 9)');
  });

  await t.test('cascata vencida NÃO move dinheiro nenhum — ninguém pagou nada', async () => {
    const { stdout } = await executa('node', [CRIA, 'procurando_motoboy'], {
      env: { ...process.env, CORRE_PRAZO_CASCATA_MS: '250' },
      timeout: 30_000,
    });
    const corridaId = stdout.trim();
    await espera(600);
    await executa('node', [VARRE], { env: process.env, timeout: 30_000 });

    const dono = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    try {
      const { rows: [linha] } = await dono.query(
        'SELECT estado, pago_em FROM corridas WHERE id = $1', [corridaId],
      );
      assert.equal(linha.estado, E.SEM_MOTOBOY);
      assert.equal(linha.pago_em, null, 'corrida sem motoboy não pode ter fato de pagamento');
    } finally {
      await dono.end();
    }
  });

  await t.test('corrida dentro do prazo não é tocada pelo varredor', async () => {
    const corrida = await levaAte(pool, 1);
    await expiraVencidas(pool);
    const { rows: [linha] } = await pool.query('SELECT estado FROM corridas WHERE id = $1', [corrida.id]);
    assert.equal(linha.estado, 1);
  });

  await t.test('LIMITE DECLARADO: a espera vencida na porta NÃO é aplicada pelo varredor', async () => {
    // A saída do estado 4 exige que o MOTOBOY declare qual dos dois casos foi
    // (seção 4), e varredor não declara pelos outros. Quem aplica isso é a
    // Etapa 8a, com o aviso registrado. Até lá o 4 vencido fica vivo e
    // aparece em `corridasParadas` — este teste vigia que continue assim, em
    // vez de o limite virar surpresa.
    const dono = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    try {
      const naPorta = await levaAte(pool, E.NA_PORTA_COBRANDO);
      await dono.query(
        "UPDATE corridas SET vence_em = now() - interval '1 hour' WHERE id = $1", [naPorta.id],
      );
      const aplicadas = await expiraVencidas(pool);
      assert.equal(aplicadas, 0, 'o varredor não pode mover o estado 4 sozinho');

      const { rows: [linha] } = await pool.query('SELECT estado FROM corridas WHERE id = $1', [naPorta.id]);
      assert.equal(linha.estado, E.NA_PORTA_COBRANDO);

      // Mas o motoboy declara e a corrida sai.
      const { corrida: depois } = await aplica(pool, naPorta.id, 'espera_vencida', {
        payload: { caso: 'presente_e_nao_pagou' },
      });
      assert.equal(depois.estado, E.EM_RETORNO);
    } finally {
      await dono.end();
    }
  });

  await t.test('trava de segurança: corrida em estado vivo há mais de 24 horas aparece na consulta de paradas', async () => {
    // Medida provisória até a Etapa 8: os estados 2, 3, 5 e 6 não têm prazo,
    // e o 5 é o pior — o dinheiro já foi dividido. O recuo do relógio é
    // adulteração deliberada via dono, só para simular o esquecimento.
    const dono = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    try {
      const parada = await levaAte(pool, E.PAGO);
      const recente = await levaAte(pool, E.PAGO);
      const finalizada = await levaAte(pool, E.ENTREGUE);
      await dono.query(
        "UPDATE corridas SET atualizado_em = now() - interval '25 hours' WHERE id = ANY($1::uuid[])",
        [[parada.id, finalizada.id]],
      );

      const paradas = await corridasParadas(pool);
      const ids = new Set(paradas.map((linha) => linha.id));
      assert.ok(ids.has(parada.id), 'corrida parada em Pago há 25h tem que aparecer');
      assert.ok(!ids.has(recente.id), 'corrida viva recém-movida não aparece');
      assert.ok(!ids.has(finalizada.id), 'corrida em estado final não aparece');

      const linha = paradas.find((p) => p.id === parada.id);
      assert.equal(linha.estado, E.PAGO);
    } finally {
      await dono.end();
    }
  });

  await t.test('PROIBIDO: nada fecha o estado Pago por decurso de prazo', async () => {
    // A saída fácil seria carimbar "Entregue" depois de N minutos, e ela
    // está proibida (seção 4): seria dar por entregue o que talvez não tenha
    // sido. O varredor não pode ter aprendido esse atalho.
    const dono = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    try {
      const pago = await levaAte(pool, E.PAGO);
      await dono.query(
        "UPDATE corridas SET vence_em = now() - interval '1 day' WHERE id = $1", [pago.id],
      );
      await expiraVencidas(pool);
      const { rows: [linha] } = await pool.query('SELECT estado FROM corridas WHERE id = $1', [pago.id]);
      assert.equal(linha.estado, E.PAGO, 'Pago não pode virar Entregue sozinho');
    } finally {
      await dono.end();
    }
  });

  await t.test('varredor é idempotente: rodar duas vezes não duplica evento', async () => {
    const { stdout } = await executa('node', [CRIA, 'procurando_motoboy'], {
      env: { ...process.env, CORRE_PRAZO_CASCATA_MS: '250' },
      timeout: 30_000,
    });
    const corridaId = stdout.trim();
    await espera(600);
    await Promise.all([
      executa('node', [VARRE], { env: process.env, timeout: 30_000 }),
      executa('node', [VARRE], { env: process.env, timeout: 30_000 }),
    ]);
    await expiraVencidas(pool);

    const { rows: [{ n }] } = await pool.query(
      `SELECT count(*) AS n FROM eventos
       WHERE agregado_tipo = 'corrida' AND agregado_id = $1 AND tipo = 'cascata_esgotada'`,
      [corridaId],
    );
    assert.equal(n, '1');
  });
});
