'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');

function exigeEnv(nome) {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(`${nome} não definido — rode via scripts/bateria.sh`);
  }
  return valor;
}

async function conectaDono() {
  const client = new Client({ connectionString: exigeEnv('DATABASE_URL') });
  await client.connect();
  return client;
}

async function conectaApp() {
  const client = new Client({ connectionString: exigeEnv('DATABASE_URL_APP') });
  await client.connect();
  return client;
}

async function conectaSuper() {
  const client = new Client({ connectionString: exigeEnv('DATABASE_URL_SUPER') });
  await client.connect();
  return client;
}

// Executa a consulta esperando erro; devolve o erro para asserções extras.
async function esperaErro(client, sql, params = []) {
  try {
    await client.query(sql, params);
  } catch (erro) {
    return erro;
  }
  assert.fail(`deveria ter falhado, mas passou: ${sql}`);
  return null;
}

function eventoSintetico(extra = {}) {
  return {
    tipo: 'corrida_criada',
    agregado_tipo: 'corrida',
    agregado_id: randomUUID(),
    payload: { origem: 'bateria_etapa_0' },
    autor_tipo: 'sistema',
    autor_id: null,
    ...extra,
  };
}

async function insereEvento(client, evento) {
  const { rows } = await client.query(
    `INSERT INTO eventos (tipo, agregado_tipo, agregado_id, payload, autor_tipo, autor_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      evento.tipo,
      evento.agregado_tipo,
      evento.agregado_id,
      JSON.stringify(evento.payload),
      evento.autor_tipo,
      evento.autor_id,
    ],
  );
  return rows[0].id;
}

module.exports = {
  conectaDono,
  conectaApp,
  conectaSuper,
  esperaErro,
  eventoSintetico,
  insereEvento,
};
