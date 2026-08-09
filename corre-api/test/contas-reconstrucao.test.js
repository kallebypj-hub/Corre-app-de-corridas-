'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const contas = require('../src/dominio/contas');
const { poolApp, emParalelo } = require('./ajuda-maquina');
const { cadastroValidoDeMotoboy, donoDeTeste, atendimentoDeTeste } = require('./ajuda-contas');

const TOTAL = 5000;

test(`reconstrução de contas: ${TOTAL} contas sintéticas, estado derivado dos eventos bate com o gravado`, async (t) => {
  const pool = poolApp(16);
  t.after(() => pool.end());

  const dono = await donoDeTeste(pool);
  const atendimento = await atendimentoDeTeste(pool);

  // Metade motoboys, metade lojistas; cada conta anda um caminho aleatório
  // de ações reais da operação — nada é escrito por fora do domínio.
  const planos = Array.from({ length: TOTAL }, (vazio, i) => (i % 2 === 0 ? 'motoboy' : 'lojista'));

  const criadas = await emParalelo(planos, 16, async (tipoConta) => {
    if (tipoConta === 'motoboy') {
      const { conta } = await contas.cadastraMotoboy(pool, cadastroValidoDeMotoboy());
      const sorte = Math.random();
      if (sorte < 0.25) {
        await contas.trocaAparelho(pool, {
          motoboyId: conta.id, novoAparelhoId: `ap-${randomUUID().slice(0, 8)}`, autor: atendimento,
        });
      }
      if (sorte >= 0.25 && sorte < 0.45) {
        await contas.liberaPrimeiroSaque(pool, { motoboyId: conta.id, autor: atendimento });
      }
      if (sorte >= 0.45 && sorte < 0.55) {
        await contas.bloqueiaMotoboy(pool, { motoboyId: conta.id, motivo: 'sintético', autor: dono });
      }
      return { tipo: 'motoboy', id: conta.id };
    }
    const { conta } = await contas.cadastraLojista(pool, {
      nome: 'Loja Sintética',
      telefone: `88 5${randomUUID()}`,
    });
    if (Math.random() < 0.5) {
      await contas.registraCartao(pool, { lojistaId: conta.id, cartaoRef: 'cartao-sintetico' });
    }
    return { tipo: 'lojista', id: conta.id };
  });

  assert.equal(criadas.length, TOTAL);

  const divergencias = [];
  await emParalelo(criadas, 16, async ({ tipo, id }) => {
    const derivado = await contas.reconstroiConta(pool, tipo, id);
    if (tipo === 'motoboy') {
      const gravado = await contas.buscaMotoboy(pool, id);
      const bate = derivado.situacao === gravado.situacao
        && derivado.primeiro_saque === gravado.primeiro_saque
        && derivado.aparelho_id === gravado.aparelho_id
        && derivado.seq === gravado.seq;
      if (!bate) divergencias.push({ tipo, id, derivado, gravado });
    } else {
      const gravado = await contas.buscaLojista(pool, id);
      const bate = derivado.situacao === gravado.situacao
        && derivado.cartao_registrado === (gravado.cartao_registrado_em !== null)
        && derivado.seq === gravado.seq;
      if (!bate) divergencias.push({ tipo, id, derivado, gravado });
    }
  });

  assert.deepEqual(divergencias, [], `reconstrução divergiu em ${divergencias.length} conta(s)`);
});

test('controle interno da reconstrução de contas: projeção adulterada por fora é detectada', async (t) => {
  const pool = poolApp(2);
  const { Pool } = require('pg');
  const dono = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  t.after(async () => {
    await pool.end();
    await dono.end();
  });

  const { conta } = await contas.cadastraMotoboy(pool, cadastroValidoDeMotoboy());
  await dono.query("UPDATE motoboys SET primeiro_saque = 'liberado' WHERE id = $1", [conta.id]);

  const derivado = await contas.reconstroiConta(pool, 'motoboy', conta.id);
  const gravado = await contas.buscaMotoboy(pool, conta.id);
  assert.equal(gravado.primeiro_saque, 'liberado', 'a adulteração foi aplicada');
  assert.equal(derivado.primeiro_saque, 'travado', 'a reconstrução vem do log, não da projeção');
  assert.notEqual(derivado.primeiro_saque, gravado.primeiro_saque);
});
