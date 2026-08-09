'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

const E = require('../src/dominio/estados');
const { TRANSICOES } = require('../src/dominio/transicoes');
const { criaCorrida, transiciona } = require('../src/dominio/corridas');
const { ErroDeDominio } = require('../src/dominio/erros');
const {
  poolApp, AUTOR_PADRAO, autorIdPara, aplica, levaAte, lojistaApto,
} = require('./ajuda-maquina');

// CÓPIA INDEPENDENTE das arestas legais (com autores permitidos), de
// propósito: o teste é a testemunha da tabela declarativa, não um derivado
// dela. Se alguém mexer na tabela (sabotagem ou descuido), a divergência
// aparece aqui.
const ARESTAS = [
  { de: null, tipo: 'criada', para: 1, autor: 'lojista', autorizados: ['lojista'] },
  { de: 1, tipo: 'pagamento_confirmado', para: 2, autor: 'sistema', autorizados: ['sistema'] },
  { de: 1, tipo: 'expirou', para: 8, autor: 'sistema', autorizados: ['sistema'] },
  { de: 1, tipo: 'cancelada', para: 10, autor: 'lojista', autorizados: ['lojista', 'cliente', 'painel'] },
  { de: 2, tipo: 'motoboy_aceitou', para: 3, autor: 'motoboy', autorizados: ['motoboy'] },
  { de: 2, tipo: 'cascata_esgotada', para: 9, autor: 'sistema', autorizados: ['sistema'] },
  { de: 2, tipo: 'cancelada', para: 10, autor: 'cliente', autorizados: ['lojista', 'cliente', 'painel'] },
  { de: 3, tipo: 'coleta_confirmada', para: 4, autor: 'motoboy', autorizados: ['motoboy', 'lojista'] },
  { de: 3, tipo: 'cancelada', para: 10, autor: 'painel', autorizados: ['painel'], payload: { motivo: 'loja fechou no meio' } },
  { de: 4, tipo: 'pin_validado', para: 7, autor: 'motoboy', autorizados: ['motoboy'] },
  { de: 4, tipo: 'entrega_falhou', para: 5, autor: 'motoboy', autorizados: ['motoboy'] },
  { de: 4, tipo: 'cancelada', para: 10, autor: 'painel', autorizados: ['painel'], payload: { motivo: 'mercadoria errada' } },
  { de: 5, tipo: 'devolucao_concluida', para: 11, autor: 'motoboy', autorizados: ['motoboy', 'lojista'] },
  { de: 5, tipo: 'cancelada', para: 10, autor: 'painel', autorizados: ['painel'], payload: { motivo: 'acordo com o cliente' } },
];

const ESTADOS_ALCANCAVEIS = [1, 2, 3, 4, 5, 7, 8, 9, 10, 11];
const TIPOS = Object.keys(AUTOR_PADRAO);
const PARTES = ['lojista', 'cliente', 'motoboy', 'painel', 'sistema'];

test('máquina de estados', async (t) => {
  const pool = poolApp();
  t.after(() => pool.end());

  for (const aresta of ARESTAS) {
    const nomeDe = aresta.de === null ? '∅' : `${aresta.de} ${E.NOMES[aresta.de]}`;
    await t.test(`aresta ${nomeDe} → ${aresta.para} ${E.NOMES[aresta.para]} por ${aresta.tipo}`, async () => {
      let corrida;
      let resultado;
      if (aresta.de === null) {
        ({ corrida } = await criaCorrida(pool, {
          autorTipo: aresta.autor,
          autorId: await lojistaApto(pool),
          payload: { origem: 'teste_arestas' },
        }));
        resultado = corrida;
      } else {
        corrida = await levaAte(pool, aresta.de);
        const seqAntes = corrida.seq;
        ({ corrida: resultado } = await aplica(pool, corrida.id, aresta.tipo, {
          autorTipo: aresta.autor,
          payload: aresta.payload,
        }));
        assert.equal(resultado.seq, seqAntes + 1, 'seq avança exatamente 1');
      }
      assert.equal(resultado.estado, aresta.para);

      // O evento é a verdade: gravado com o tipo, o seq e o autor certos.
      const { rows: [evento] } = await pool.query(
        `SELECT tipo, autor_tipo, payload FROM eventos
         WHERE agregado_tipo = 'corrida' AND agregado_id = $1 AND seq = $2`,
        [resultado.id, resultado.seq],
      );
      assert.equal(evento.tipo, aresta.tipo);
      assert.equal(evento.autor_tipo, aresta.autor);

      // Regra 2: estados com prazo (1 e 2) nascem com vence_em gravado na
      // corrida E no payload do evento; os demais ficam sem prazo.
      if (aresta.para === E.AGUARDANDO_PAGAMENTO || aresta.para === E.PROCURANDO_MOTOBOY) {
        assert.ok(resultado.vence_em, 'estado com prazo tem vence_em');
        assert.equal(new Date(evento.payload.vence_em).getTime(), resultado.vence_em.getTime());
      } else {
        assert.equal(resultado.vence_em, null);
      }
    });
  }

  await t.test('matriz exaustiva do conjunto: a tabela declarativa tem exatamente os tipos e as arestas esperados', () => {
    const tiposEsperados = [...new Set(ARESTAS.map((a) => a.tipo))].sort();
    assert.deepEqual(Object.keys(TRANSICOES).sort(), tiposEsperados, 'tipo a mais ou a menos na tabela');

    const triplasDaTabela = Object.entries(TRANSICOES)
      .flatMap(([tipo, regra]) => regra.de.map((de) => `${de}→${tipo}→${regra.para}`))
      .sort();
    const triplasEsperadas = ARESTAS.map((a) => `${a.de}→${a.tipo}→${a.para}`).sort();
    assert.deepEqual(triplasDaTabela, triplasEsperadas, 'aresta a mais ou a menos na tabela');

    for (const aresta of ARESTAS) {
      const daTabela = TRANSICOES[aresta.tipo].autorizados[String(aresta.de)];
      assert.deepEqual(
        [...daTabela].sort(),
        [...aresta.autorizados].sort(),
        `autorizados divergem em ${aresta.tipo} a partir de ${aresta.de}`,
      );
    }
  });

  await t.test('matriz exaustiva: para cada par estado × transição, ou é permitida ou é recusada — sem terceira possibilidade', async () => {
    // O estado 6 entra na matriz por semeadura via credencial de dono
    // (adulteração deliberada da projeção, só para exercitar a recusa do
    // MOTOR — não existe caminho legal até ele nesta etapa).
    const dono = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    t.after(() => dono.end());
    async function corridaNoEstado(de) {
      if (de !== E.EM_DISPUTA) return levaAte(pool, de);
      const corrida = await levaAte(pool, 1);
      await dono.query('UPDATE corridas SET estado = $2, vence_em = NULL WHERE id = $1', [corrida.id, E.EM_DISPUTA]);
      return { ...corrida, estado: E.EM_DISPUTA };
    }

    let permitidas = 0;
    let recusadas = 0;
    for (const de of [...ESTADOS_ALCANCAVEIS, E.EM_DISPUTA]) {
      for (const tipo of TIPOS) {
        if (tipo === 'criada') continue; // criação não parte de estado
        const esperada = ARESTAS.find((a) => a.de === de && a.tipo === tipo);
        const corrida = await corridaNoEstado(de);
        // Payload com motivo e autor da aresta (ou o natural): quando a
        // recusa vier, tem que ser por ILEGALIDADE, não por autor/motivo.
        const autorTipo = esperada ? esperada.autor : AUTOR_PADRAO[tipo];
        try {
          const { corrida: depois } = await transiciona(pool, {
            corridaId: corrida.id,
            tipo,
            autorTipo,
            autorId: autorIdPara(autorTipo),
            payload: { motivo: 'matriz exaustiva' },
          });
          assert.ok(esperada, `${tipo} a partir de ${de} (${E.NOMES[de]}) deveria ser recusada, mas passou`);
          assert.equal(depois.estado, esperada.para, `${tipo} de ${de} foi para ${depois.estado}, esperava ${esperada.para}`);
          permitidas += 1;
        } catch (erro) {
          assert.ok(!esperada, `${tipo} a partir de ${de} (${E.NOMES[de]}) deveria ser permitida, mas falhou: ${erro.message}`);
          assert.ok(erro instanceof ErroDeDominio, `recusa tem que ser erro de domínio, veio: ${erro.message}`);
          assert.equal(erro.codigo, 'transicao_ilegal', `recusa de ${tipo} a partir de ${de} pelo motivo errado: ${erro.codigo}`);
          recusadas += 1;
        }
      }
    }
    const combinacoes = (ESTADOS_ALCANCAVEIS.length + 1) * (TIPOS.length - 1);
    assert.equal(permitidas + recusadas, combinacoes);
    assert.equal(permitidas, ARESTAS.length - 1, 'todas as arestas legais (menos a criação) apareceram na matriz');
  });

  await t.test('autorização exaustiva: cada aresta aceita só os autores da regra, e recusa os demais', async () => {
    for (const aresta of ARESTAS) {
      if (aresta.de === null) continue; // criação coberta em teste próprio
      const alvoDasRecusas = await levaAte(pool, aresta.de);
      for (const autorTipo of PARTES.filter((parte) => !aresta.autorizados.includes(parte))) {
        await assert.rejects(
          () => aplica(pool, alvoDasRecusas.id, aresta.tipo, {
            autorTipo,
            payload: { motivo: 'autorização exaustiva' },
          }),
          (erro) => erro instanceof ErroDeDominio && erro.codigo === 'autor_nao_autorizado',
          `${aresta.tipo} a partir de ${aresta.de} por ${autorTipo} deveria ser recusada`,
        );
      }
      for (const autorTipo of aresta.autorizados) {
        const corrida = await levaAte(pool, aresta.de);
        const { corrida: depois } = await aplica(pool, corrida.id, aresta.tipo, {
          autorTipo,
          payload: aresta.payload || { motivo: 'autorização exaustiva' },
        });
        assert.equal(depois.estado, aresta.para, `${aresta.tipo} por ${autorTipo} deveria ser permitida`);
      }
    }
  });

  await t.test('estado 6 (em disputa) não tem transições nesta etapa — decisão do dono, 2026-08-09', async () => {
    for (const [tipo, regra] of Object.entries(TRANSICOES)) {
      assert.ok(!regra.de.includes(E.EM_DISPUTA), `${tipo} não pode partir de em_disputa nesta etapa`);
      assert.notEqual(regra.para, E.EM_DISPUTA, `${tipo} não pode levar a em_disputa nesta etapa`);
    }
    const corrida = await levaAte(pool, 4);
    await assert.rejects(
      () => transiciona(pool, {
        corridaId: corrida.id, tipo: 'disputa_aberta', autorTipo: 'painel', autorId: randomUUID(),
      }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'tipo_desconhecido',
    );
  });

  await t.test('criada só por lojista', async () => {
    for (const autorTipo of ['motoboy', 'cliente', 'painel', 'sistema']) {
      await assert.rejects(
        () => criaCorrida(pool, { autorTipo, autorId: randomUUID(), payload: {} }),
        (erro) => erro instanceof ErroDeDominio && erro.codigo === 'autor_nao_autorizado',
        `criada por ${autorTipo} deveria ser recusada`,
      );
    }
  });

  await t.test('pagamento_confirmado só pelo sistema', async () => {
    const corrida = await levaAte(pool, 1);
    await assert.rejects(
      () => aplica(pool, corrida.id, 'pagamento_confirmado', { autorTipo: 'lojista' }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'autor_nao_autorizado',
    );
  });

  await t.test('aceite só por motoboy', async () => {
    const corrida = await levaAte(pool, 2);
    await assert.rejects(
      () => aplica(pool, corrida.id, 'motoboy_aceitou', { autorTipo: 'lojista' }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'autor_nao_autorizado',
    );
  });

  await t.test('cancelamento do estado 3 em diante: só a operação (seção 5)', async () => {
    for (const de of [3, 4, 5]) {
      for (const autorTipo of ['lojista', 'cliente', 'motoboy']) {
        const corrida = await levaAte(pool, de);
        await assert.rejects(
          () => aplica(pool, corrida.id, 'cancelada', { autorTipo, payload: { motivo: 'tentativa indevida' } }),
          (erro) => erro instanceof ErroDeDominio && erro.codigo === 'autor_nao_autorizado',
          `cancelada de ${de} por ${autorTipo} deveria ser recusada`,
        );
      }
    }
  });

  await t.test('cancelamento pela operação exige motivo registrado', async () => {
    for (const de of [3, 4, 5]) {
      const corrida = await levaAte(pool, de);
      await assert.rejects(
        () => aplica(pool, corrida.id, 'cancelada', { autorTipo: 'painel' }),
        (erro) => erro instanceof ErroDeDominio && erro.codigo === 'motivo_obrigatorio',
        `cancelada de ${de} sem motivo deveria ser recusada`,
      );
      await assert.rejects(
        () => aplica(pool, corrida.id, 'cancelada', { autorTipo: 'painel', payload: { motivo: '   ' } }),
        (erro) => erro instanceof ErroDeDominio && erro.codigo === 'motivo_obrigatorio',
        `cancelada de ${de} com motivo em branco deveria ser recusada`,
      );
    }
  });

  await t.test('transição em corrida inexistente é recusada', async () => {
    await assert.rejects(
      () => transiciona(pool, {
        corridaId: randomUUID(), tipo: 'pagamento_confirmado', autorTipo: 'sistema', autorId: null,
      }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'corrida_inexistente',
    );
  });

  await t.test('tipo desconhecido é recusado', async () => {
    const corrida = await levaAte(pool, 1);
    await assert.rejects(
      () => transiciona(pool, {
        corridaId: corrida.id, tipo: 'teletransporte', autorTipo: 'sistema', autorId: null,
      }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'tipo_desconhecido',
    );
  });
});
