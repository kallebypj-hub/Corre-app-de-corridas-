'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');

const { poolApp } = require('./ajuda-maquina');
const { geraCpfValido } = require('./ajuda-contas');

const executa = promisify(execFile);
const CADASTRADOR = path.join(__dirname, '..', 'apoio-de-teste', 'cadastrador-concorrente.js');
const PROCESSOS = 4;
const TENTATIVAS_POR_PROCESSO = 50;

test('concorrência de cadastro: 200 tentativas com o mesmo CPF resultam em exatamente uma conta', async (t) => {
  const pool = poolApp();
  t.after(() => pool.end());

  const cpf = geraCpfValido();

  const saidas = await Promise.all(
    Array.from({ length: PROCESSOS }, () => executa(
      'node',
      [CADASTRADOR, cpf, String(TENTATIVAS_POR_PROCESSO)],
      { env: process.env, timeout: 60_000 },
    )),
  );

  const placares = saidas.map(({ stdout }) => JSON.parse(stdout));
  const criadas = placares.reduce((soma, p) => soma + p.criadas, 0);
  const recusadas = placares.reduce((soma, p) => soma + p.recusadas, 0);

  assert.equal(criadas, 1, `esperava exatamente uma conta criada, houve ${criadas}`);
  assert.equal(recusadas, PROCESSOS * TENTATIVAS_POR_PROCESSO - 1);

  const { rows: [{ n }] } = await pool.query(
    'SELECT count(*) AS n FROM motoboys WHERE cpf = $1',
    [cpf],
  );
  assert.equal(n, '1');

  // E o log conta a mesma história: um único evento de cadastro.
  const { rows: [{ n: eventos }] } = await pool.query(
    `SELECT count(*) AS n FROM eventos e
     JOIN motoboys m ON m.id = e.agregado_id
     WHERE e.agregado_tipo = 'motoboy' AND e.tipo = 'motoboy_cadastrado' AND m.cpf = $1`,
    [cpf],
  );
  assert.equal(eventos, '1');
});
