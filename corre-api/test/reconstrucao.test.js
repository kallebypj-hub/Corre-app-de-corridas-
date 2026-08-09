'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

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
