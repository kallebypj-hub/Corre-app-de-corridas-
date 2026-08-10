'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

const { criaCorrida, reconstroiEstado } = require('../src/dominio/corridas');
const {
  poolApp, aplica, emParalelo, lojistaApto,
} = require('./ajuda-maquina');

const TOTAL = 5000;

// Passeio aleatório pelas transições legais: cada corrida sintética anda
// um caminho diferente; algumas terminam em estado final, outras ficam
// vivas — o estado gravado tem que bater com o reconstruído em TODAS.
const PASSOS = {
  1: [
    ['motoboy_aceitou', 0.6], ['cascata_esgotada', 0.15], ['cancelada', 0.12], [null, 0.13],
  ],
  2: [
    ['coleta_confirmada', 0.7], ['cancelada', 0.15], [null, 0.15],
  ],
  3: [
    ['chegada_declarada', 0.6], ['retorno_sem_contato', 0.15], ['cancelada', 0.1], [null, 0.15],
  ],
  4: [
    ['pagamento_confirmado', 0.55], ['espera_vencida', 0.2], ['cancelada', 0.1], [null, 0.15],
  ],
  5: [
    ['entrega_confirmada', 0.75], [null, 0.25],
  ],
  6: [
    ['devolucao_concluida', 0.6], ['cancelada', 0.2], [null, 0.2],
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

// Cancelar é livre no estado 1 e só da operação do 2 em diante (seção 5).
function autorDeCancelamento(estado) {
  return estado >= 2 ? 'painel' : 'lojista';
}

// O que cada transição exige no payload para ser legal.
const EXIGE = {
  cancelada: { motivo: 'passeio sintético' },
  retorno_sem_contato: { motivo: 'endereço não localizado no passeio' },
  espera_vencida: { caso: 'cliente_ausente' },
};

test(`reconstrução: ${TOTAL} corridas sintéticas, estado derivado dos eventos bate com o gravado`, async (t) => {
  const pool = poolApp(16);
  t.after(() => pool.end());

  const lojistaId = await lojistaApto(pool);
  const ids = await emParalelo(Array.from({ length: TOTAL }, (v, i) => i), 16, async () => {
    let { corrida } = await criaCorrida(pool, {
      autorTipo: 'lojista',
      autorId: lojistaId,
      payload: { origem: 'reconstrucao_5000' },
    });
    for (;;) {
      const tipo = sorteiaPasso(corrida.estado);
      if (!tipo) break;
      const sobrescreve = {};
      if (tipo === 'cancelada') sobrescreve.autorTipo = autorDeCancelamento(corrida.estado);
      if (EXIGE[tipo]) sobrescreve.payload = { ...EXIGE[tipo] };
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
    autorId: await lojistaApto(pool),
    payload: { origem: 'controle_interno_reconstrucao' },
  });
  // Adulteração para o estado 7 (em disputa): é o estado sem aresta nenhuma,
  // logo impossível de alcançar pelo log — e não exige `pago_em`, que o
  // banco cobraria se a mentira fosse "entregue".
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
