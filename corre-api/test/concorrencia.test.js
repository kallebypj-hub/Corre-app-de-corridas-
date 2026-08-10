'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');

const { poolApp, levaAte } = require('./ajuda-maquina');

const executa = promisify(execFile);
const COMPETIDOR = path.join(__dirname, '..', 'apoio-de-teste', 'competidor-aceite.js');
const PROCESSOS = 4;
const TENTATIVAS_POR_PROCESSO = 50;

test('concorrência: 200 tentativas de aceite na mesma corrida, exatamente uma vencedora', async (t) => {
  const pool = poolApp();
  t.after(() => pool.end());

  // A corrida NASCE procurando motoboy (estado 1): depois da Etapa 5 não há
  // mais pagamento antes do aceite, então a disputa começa na posição 2 do
  // log, não na 3.
  const corrida = await levaAte(pool, 1);

  // Concorrência real: 4 PROCESSOS separados disputando a mesma corrida,
  // 50 tentativas cada — como aparelhos de motoboy numa esquina.
  const saidas = await Promise.all(
    Array.from({ length: PROCESSOS }, () => executa(
      'node',
      [COMPETIDOR, corrida.id, String(TENTATIVAS_POR_PROCESSO)],
      { env: process.env, timeout: 60_000 },
    )),
  );

  const placares = saidas.map(({ stdout }) => JSON.parse(stdout));
  const vencedoras = placares.reduce((soma, p) => soma + p.vencedoras, 0);
  const perdedoras = placares.reduce((soma, p) => soma + p.conflitos + p.ilegais, 0);

  assert.equal(vencedoras, 1, `esperava exatamente 1 vencedora, houve ${vencedoras}`);
  assert.equal(perdedoras, PROCESSOS * TENTATIVAS_POR_PROCESSO - 1);

  // O banco conta a mesma história: um único evento na posição 2 do log,
  // e a corrida aceita uma única vez.
  const { rows: [{ n: eventosNaPosicao }] } = await pool.query(
    `SELECT count(*) AS n FROM eventos
     WHERE agregado_tipo = 'corrida' AND agregado_id = $1 AND seq = 2`,
    [corrida.id],
  );
  assert.equal(eventosNaPosicao, '1');

  const { rows: [final] } = await pool.query(
    'SELECT estado, seq FROM corridas WHERE id = $1',
    [corrida.id],
  );
  assert.equal(final.estado, 2);
  assert.equal(final.seq, 2);
});
