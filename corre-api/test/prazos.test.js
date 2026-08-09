'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: espera } = require('node:timers/promises');
const path = require('node:path');

const { Pool } = require('pg');

const {
  criaCorrida, transiciona, expiraVencidas, corridasParadas,
} = require('../src/dominio/corridas');
const { ErroDeDominio } = require('../src/dominio/erros');
const { poolApp, levaAte, lojistaApto } = require('./ajuda-maquina');
const { randomUUID } = require('node:crypto');

const executa = promisify(execFile);
const CRIA = path.join(__dirname, '..', 'apoio-de-teste', 'cria-corrida.js');
const VARRE = path.join(__dirname, '..', 'src', 'bin', 'expira-vencidas.js');

test('prazos e tempo do servidor', async (t) => {
  const pool = poolApp();
  t.after(() => pool.end());

  await t.test('vence_em nasce do relógio do servidor: criação = agora + 15 min; cascata = agora + 5 min', async () => {
    const { corrida } = await criaCorrida(pool, {
      autorTipo: 'lojista', autorId: await lojistaApto(pool), payload: {},
    });
    const { rows: [{ agora }] } = await pool.query('SELECT now() AS agora');
    const esperado15 = agora.getTime() + 15 * 60 * 1000;
    assert.ok(
      Math.abs(corrida.vence_em.getTime() - esperado15) < 5000,
      `vence_em da criação fora da janela: ${corrida.vence_em.toISOString()}`,
    );

    const { corrida: buscando } = await transiciona(pool, {
      corridaId: corrida.id, tipo: 'pagamento_confirmado', autorTipo: 'sistema', autorId: null,
    });
    const esperado5 = agora.getTime() + 5 * 60 * 1000;
    assert.ok(
      Math.abs(buscando.vence_em.getTime() - esperado5) < 10_000,
      `vence_em da cascata fora da janela: ${buscando.vence_em.toISOString()}`,
    );
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
        tipo: 'pagamento_confirmado',
        autorTipo: 'sistema',
        autorId: null,
        payload: { criado_em: '2000-01-01T00:00:00Z' },
      }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'tempo_do_cliente',
      'transição aceitou criado_em do cliente',
    );
  });

  await t.test('corrida vencida é detectada mesmo com o processo reiniciado no meio (1 → 8)', async () => {
    // Processo A cria a corrida com prazo curto e MORRE.
    const { stdout } = await executa('node', [CRIA, 'aguardando_pagamento'], {
      env: { ...process.env, CORRE_PRAZO_PAGAMENTO_MS: '250' },
      timeout: 30_000,
    });
    const corridaId = stdout.trim();
    assert.ok(corridaId, 'apoio imprimiu o id da corrida');

    await espera(600);

    // Processo B, novinho, só consulta o banco: o prazo é dado, não timer.
    await executa('node', [VARRE], { env: process.env, timeout: 30_000 });

    const { rows: [linha] } = await pool.query('SELECT estado FROM corridas WHERE id = $1', [corridaId]);
    assert.equal(linha.estado, 8, 'corrida vencida virou expirada (estado 8)');
  });

  await t.test('cascata vencida é detectada após reinício (2 → 9)', async () => {
    const { stdout } = await executa('node', [CRIA, 'procurando_motoboy'], {
      env: { ...process.env, CORRE_PRAZO_CASCATA_MS: '250' },
      timeout: 30_000,
    });
    const corridaId = stdout.trim();

    await espera(600);
    await executa('node', [VARRE], { env: process.env, timeout: 30_000 });

    const { rows: [linha] } = await pool.query('SELECT estado FROM corridas WHERE id = $1', [corridaId]);
    assert.equal(linha.estado, 9, 'cascata vencida virou sem_motoboy (estado 9)');
  });

  await t.test('corrida dentro do prazo não é tocada pelo varredor', async () => {
    const corrida = await levaAte(pool, 1);
    await expiraVencidas(pool);
    const { rows: [linha] } = await pool.query('SELECT estado FROM corridas WHERE id = $1', [corrida.id]);
    assert.equal(linha.estado, 1);
  });

  await t.test('trava de segurança: corrida em estado vivo há mais de 24 horas aparece na consulta de paradas', async () => {
    // Medida provisória até a Etapa 7 (CORRE.md, seção 4, decisão 4):
    // estados 3-5 não têm prazo e retêm dinheiro — parada não pode sumir.
    // O recuo do relógio é adulteração deliberada via dono, só para
    // simular a corrida esquecida há 25 horas.
    const dono = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    try {
      const parada = await levaAte(pool, 3);
      const recente = await levaAte(pool, 3);
      const finalizada = await levaAte(pool, 7);
      await dono.query(
        "UPDATE corridas SET atualizado_em = now() - interval '25 hours' WHERE id = ANY($1::uuid[])",
        [[parada.id, finalizada.id]],
      );

      const paradas = await corridasParadas(pool);
      const ids = new Set(paradas.map((linha) => linha.id));
      assert.ok(ids.has(parada.id), 'corrida viva parada há 25h tem que aparecer');
      assert.ok(!ids.has(recente.id), 'corrida viva recém-movida não aparece');
      assert.ok(!ids.has(finalizada.id), 'corrida em estado final não aparece');

      const linha = paradas.find((p) => p.id === parada.id);
      assert.equal(linha.estado, 3);
    } finally {
      await dono.end();
    }
  });

  await t.test('varredor é idempotente: rodar duas vezes não duplica evento', async () => {
    const { stdout } = await executa('node', [CRIA, 'aguardando_pagamento'], {
      env: { ...process.env, CORRE_PRAZO_PAGAMENTO_MS: '250' },
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
       WHERE agregado_tipo = 'corrida' AND agregado_id = $1 AND tipo = 'expirou'`,
      [corridaId],
    );
    assert.equal(n, '1');
  });
});
