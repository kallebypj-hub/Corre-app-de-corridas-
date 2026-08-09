'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

const { criaCorrida, reconstroiEstado } = require('../src/dominio/corridas');
const { poolApp, aplica, emParalelo } = require('./ajuda-maquina');

const TOTAL = 5000;

// Passeio aleatório pelas transições legais: cada corrida sintética anda
// um caminho diferente; algumas terminam em estado final, outras ficam
// vivas — o estado gravado tem que bater com o reconstruído em TODAS.
const PASSOS = {
  1: [
    ['pagamento_confirmado', 0.55], ['expirou', 0.15], ['cancelada', 0.15], [null, 0.15],
  ],
  2: [
    ['motoboy_aceitou', 0.55], ['cascata_esgotada', 0.15], ['cancelada', 0.15], [null, 0.15],
  ],
  3: [
    ['coleta_confirmada', 0.65], ['cancelada', 0.2], [null, 0.15],
  ],
  4: [
    ['pin_validado', 0.45], ['entrega_falhou', 0.3], ['cancelada', 0.1], [null, 0.15],
  ],
  5: [
    ['devolucao_concluida', 0.65], ['cancelada', 0.2], [null, 0.15],
  ],
};

function sorteiaPasso(estado) {
  const opcoes = PASSOS[estado];
  if (!opcoes) return null;
  let resto = Math.random();
  for (const [tipo, chance] of opcoes) {
    resto -= chance;
    if (resto <= 0) return tipo;
  }
  return opcoes[opcoes.length - 1][0];
}

function autorDeCancelamento(estado) {
  return estado >= 3 ? 'painel' : 'lojista';
}

test(`reconstrução: ${TOTAL} corridas sintéticas, estado derivado dos eventos bate com o gravado`, async (t) => {
  const pool = poolApp(16);
  t.after(() => pool.end());

  const ids = await emParalelo(Array.from({ length: TOTAL }, (v, i) => i), 16, async () => {
    let { corrida } = await criaCorrida(pool, {
      autorTipo: 'lojista',
      autorId: randomUUID(),
      payload: { origem: 'reconstrucao_5000' },
    });
    for (;;) {
      const tipo = sorteiaPasso(corrida.estado);
      if (!tipo) break;
      const sobrescreve = tipo === 'cancelada'
        ? { autorTipo: autorDeCancelamento(corrida.estado), payload: { motivo: 'passeio sintético' } }
        : {};
      ({ corrida } = await aplica(pool, corrida.id, tipo, sobrescreve));
    }
    return corrida.id;
  });

  assert.equal(ids.length, TOTAL);

  let conferidas = 0;
  const divergencias = [];
  await emParalelo(ids, 16, async (id) => {
    const [derivado, gravado] = await Promise.all([
      reconstroiEstado(pool, id),
      pool.query('SELECT estado, seq FROM corridas WHERE id = $1', [id]),
    ]);
    const linha = gravado.rows[0];
    if (!derivado || derivado.estado !== linha.estado || derivado.seq !== linha.seq) {
      divergencias.push({ id, derivado, gravado: linha });
    }
    conferidas += 1;
  });

  assert.equal(conferidas, TOTAL);
  assert.deepEqual(divergencias, [], `estado reconstruído divergiu em ${divergencias.length} corrida(s)`);
});

test('controle interno da reconstrução: projeção adulterada por fora é detectada', async (t) => {
  // Lei 8 dentro do próprio teste: se a projeção mentir, a comparação tem
  // que acusar. Um reconstrutor preguiçoso que lesse a própria projeção
  // passaria as 5.000 acima — e cai aqui.
  const pool = poolApp(2);
  const dono = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  t.after(async () => {
    await pool.end();
    await dono.end();
  });

  const { corrida } = await criaCorrida(pool, {
    autorTipo: 'lojista',
    autorId: randomUUID(),
    payload: { origem: 'controle_interno_reconstrucao' },
  });
  await dono.query('UPDATE corridas SET estado = 7 WHERE id = $1', [corrida.id]);

  const derivado = await reconstroiEstado(pool, corrida.id);
  const { rows: [gravado] } = await pool.query(
    'SELECT estado FROM corridas WHERE id = $1',
    [corrida.id],
  );
  assert.equal(gravado.estado, 7, 'a adulteração foi aplicada');
  assert.equal(derivado.estado, 1, 'a reconstrução vem do log, não da projeção');
  assert.notEqual(derivado.estado, gravado.estado, 'a mentira na projeção aparece na comparação');
});
