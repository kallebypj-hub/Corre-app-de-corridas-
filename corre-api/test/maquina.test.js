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
  poolApp, AUTOR_PADRAO, PAYLOAD_MINIMO, atorPara, atorNovo, aplica, levaAte, lojistaApto,
} = require('./ajuda-maquina');

// CÓPIA INDEPENDENTE das arestas legais (com autores permitidos), de
// propósito: o teste é a testemunha da tabela declarativa, não um derivado
// dela. Se alguém mexer na tabela (sabotagem ou descuido), a divergência
// aparece aqui.
//
// São 14 arestas além da criação (seção 4). A tabela da Etapa 1 tinha 13,
// começava em "Aguardando pagamento" e chegava a Entregue direto do estado
// "Com a mercadoria" — esta não chega a Entregue senão pelo Pago.
const ARESTAS = [
  { de: null, tipo: 'criada', para: 1, autor: 'lojista', autorizados: ['lojista'] },

  { de: 1, tipo: 'motoboy_aceitou', para: 2, autor: 'motoboy', autorizados: ['motoboy'] },
  { de: 1, tipo: 'cascata_esgotada', para: 9, autor: 'sistema', autorizados: ['sistema'] },
  { de: 1, tipo: 'cancelada', para: 10, autor: 'lojista', autorizados: ['lojista', 'cliente', 'painel'] },

  { de: 2, tipo: 'coleta_confirmada', para: 3, autor: 'motoboy', autorizados: ['motoboy', 'lojista'] },
  { de: 2, tipo: 'cancelada', para: 10, autor: 'painel', autorizados: ['painel'], payload: { motivo: 'loja fechou no meio' } },

  { de: 3, tipo: 'chegada_declarada', para: 4, autor: 'motoboy', autorizados: ['motoboy'] },
  { de: 3, tipo: 'retorno_sem_contato', para: 6, autor: 'motoboy', autorizados: ['motoboy'], payload: { motivo: 'endereço não localizado' } },
  { de: 3, tipo: 'cancelada', para: 10, autor: 'painel', autorizados: ['painel'], payload: { motivo: 'mercadoria errada' } },

  { de: 4, tipo: 'pagamento_confirmado', para: 5, autor: 'sistema', autorizados: ['sistema'] },
  { de: 4, tipo: 'espera_vencida', para: 6, autor: 'motoboy', autorizados: ['motoboy'], payload: { caso: 'cliente_ausente' } },
  { de: 4, tipo: 'cancelada', para: 10, autor: 'painel', autorizados: ['painel'], payload: { motivo: 'acordo com o cliente' } },

  { de: 5, tipo: 'entrega_confirmada', para: 8, autor: 'motoboy', autorizados: ['motoboy'] },

  { de: 6, tipo: 'devolucao_concluida', para: 11, autor: 'motoboy', autorizados: ['motoboy', 'lojista'] },
  { de: 6, tipo: 'cancelada', para: 10, autor: 'painel', autorizados: ['painel'], payload: { motivo: 'lojista desistiu do retorno' } },
];

// Estados com prazo gravado: 1 (cascata de 5 min) e 4 (espera na porta).
const COM_PRAZO = [E.PROCURANDO_MOTOBOY, E.NA_PORTA_COBRANDO];

const ESTADOS_ALCANCAVEIS = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11];
const TIPOS = Object.keys(AUTOR_PADRAO);
const PARTES = ['lojista', 'cliente', 'motoboy', 'painel', 'sistema'];

// Payload que satisfaz TODAS as exigências de qualquer transição, para que a
// recusa na matriz venha por ILEGALIDADE e nunca por motivo/caso faltando.
const PAYLOAD_COMPLETO = { motivo: 'matriz exaustiva', caso: 'cliente_ausente' };

test('máquina de estados (Etapa 5)', async (t) => {
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

      // Prazo é dado gravado, nunca timer: o vencimento vai na corrida E no
      // payload do evento que abriu o estado.
      if (COM_PRAZO.includes(aresta.para)) {
        assert.ok(resultado.vence_em, 'estado com prazo tem vence_em');
        assert.equal(new Date(evento.payload.vence_em).getTime(), resultado.vence_em.getTime());
      } else {
        assert.equal(resultado.vence_em, null);
      }
    });
  }

  await t.test('são exatamente 14 arestas além da criação (seção 4)', () => {
    const daTabela = Object.values(TRANSICOES).reduce((total, regra) => total + regra.de.length, 0);
    assert.equal(daTabela - 1, 14, 'a tabela declarativa não tem 14 arestas além da criação');
    assert.equal(ARESTAS.length - 1, 14, 'a testemunha do teste não tem 14 arestas além da criação');
  });

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

  // ------------------------------------------------ A INVARIANTE DA ETAPA
  await t.test('INVARIANTE: nenhum caminho chega a Entregue sem passar por Pago — no grafo', () => {
    // Varredura de todos os caminhos do grafo declarativo a partir da
    // criação. Não é leitura de código: é busca exaustiva sobre a tabela.
    const arestas = Object.entries(TRANSICOES)
      .flatMap(([tipo, regra]) => regra.de.map((de) => ({ de, tipo, para: regra.para })));

    const caminhosAteEntregue = [];
    const pilha = [{ estado: E.PROCURANDO_MOTOBOY, visitados: [E.PROCURANDO_MOTOBOY] }];
    while (pilha.length > 0) {
      const atual = pilha.pop();
      if (atual.estado === E.ENTREGUE) {
        caminhosAteEntregue.push(atual.visitados);
        continue;
      }
      for (const aresta of arestas.filter((a) => a.de === atual.estado)) {
        if (atual.visitados.includes(aresta.para)) continue; // sem ciclo
        pilha.push({ estado: aresta.para, visitados: [...atual.visitados, aresta.para] });
      }
    }

    assert.ok(caminhosAteEntregue.length > 0, 'Entregue tem que ser alcançável');
    for (const caminho of caminhosAteEntregue) {
      assert.ok(
        caminho.includes(E.PAGO),
        `caminho até Entregue sem passar por Pago: ${caminho.map((e) => E.NOMES[e]).join(' → ')}`,
      );
    }
    // E a forma forte: 8 só tem uma aresta de entrada, e ela vem do 5.
    const entradasEmEntregue = arestas.filter((a) => a.para === E.ENTREGUE);
    assert.equal(entradasEmEntregue.length, 1, 'Entregue tem mais de uma aresta de entrada');
    assert.equal(entradasEmEntregue[0].de, E.PAGO);
  });

  await t.test('INVARIANTE: o BANCO recusa Entregue sem pagamento, mesmo com a tabela de arestas sabotada', async () => {
    // A camada de cima (a tabela declarativa) é JavaScript e uma linha
    // errada a desliga em silêncio. Aqui prova-se a camada de baixo: nem o
    // DONO consegue gravar uma corrida entregue sem `pago_em`, e `pago_em`
    // não se escreve — é derivado por trigger quando o estado vira 5.
    const dono = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    t.after(() => dono.end());

    const naPorta = await levaAte(pool, E.NA_PORTA_COBRANDO);
    await assert.rejects(
      () => dono.query('UPDATE corridas SET estado = 8 WHERE id = $1', [naPorta.id]),
      /corridas_entregue_exige_pago/,
      'pular do estado 4 direto para Entregue tem que bater na constraint',
    );

    // E tentar forjar o pagamento junto também não passa: o trigger reescreve
    // `pago_em` pelo estado, e no estado 8 o estado não é 5.
    await assert.rejects(
      () => dono.query('UPDATE corridas SET estado = 8, pago_em = now() WHERE id = $1', [naPorta.id]),
      /corridas_entregue_exige_pago/,
      'forjar pago_em na mesma linha não pode funcionar',
    );

    // O caminho legal grava o fato, e ele é do banco, não do chamador.
    const pago = await levaAte(pool, E.PAGO);
    const { rows: [linha] } = await dono.query('SELECT pago_em FROM corridas WHERE id = $1', [pago.id]);
    assert.ok(linha.pago_em, 'entrar no estado 5 grava pago_em');
  });

  await t.test('INVARIANTE: pago_em vem do FATO no log, não do número do estado', async () => {
    // Achado da auditoria da Etapa 5, e é o coração da segunda camada. A
    // 0012 derivava `pago_em` de `NEW.estado = 5` — e `estado` é a coluna que
    // o chamador escreve. Duas camadas decidindo pelo mesmo número, com o
    // mesmo dono, caem juntas: dois UPDATEs levavam qualquer corrida a
    // Entregue com o log inteiro sendo `criada`. A 0013 deriva do evento
    // `pagamento_confirmado`.
    const dono = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    t.after(() => dono.end());

    const corrida = await levaAte(pool, E.PROCURANDO_MOTOBOY);

    // Com a credencial DA APLICAÇÃO, sem tocar em código: mover o estado
    // para 5 não fabrica o fato, e por isso o 8 continua impossível.
    await pool.query('UPDATE corridas SET estado = 5 WHERE id = $1', [corrida.id]);
    const { rows: [semFato] } = await dono.query('SELECT pago_em FROM corridas WHERE id = $1', [corrida.id]);
    assert.equal(semFato.pago_em, null, 'estado 5 sem evento de pagamento não pode carimbar pago_em');
    await assert.rejects(
      () => pool.query('UPDATE corridas SET estado = 8 WHERE id = $1', [corrida.id]),
      /corridas_entregue_exige_pago/,
      'dois UPDATEs não podem levar a Entregue',
    );

    // O caminho legal grava o evento primeiro (Lei 2), e é ele que carimba.
    const legitima = await levaAte(pool, E.PAGO);
    const { rows: [comFato] } = await dono.query('SELECT pago_em FROM corridas WHERE id = $1', [legitima.id]);
    assert.ok(comFato.pago_em, 'com o evento no log, o fato é carimbado');
  });

  await t.test('INVARIANTE: pago não se desfaz — nem por transição, nem por UPDATE do dono', async () => {
    const dono = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    t.after(() => dono.end());
    const pago = await levaAte(pool, E.PAGO);
    await dono.query('UPDATE corridas SET pago_em = NULL WHERE id = $1', [pago.id]);
    const { rows: [linha] } = await dono.query('SELECT pago_em FROM corridas WHERE id = $1', [pago.id]);
    assert.ok(linha.pago_em, 'apagar pago_em não pode surtir efeito');
  });

  await t.test('a aplicação não tem privilégio para escrever pago_em', async () => {
    const corrida = await levaAte(pool, 1);
    await assert.rejects(
      () => pool.query('UPDATE corridas SET pago_em = now() WHERE id = $1', [corrida.id]),
      /permission denied|permissão negada/i,
    );
  });

  await t.test('matriz exaustiva: para cada par estado × transição, ou é permitida ou é recusada — sem terceira possibilidade', async () => {
    // O estado 7 (em disputa) entra na matriz por semeadura via credencial de
    // dono (adulteração deliberada da projeção, só para exercitar a recusa do
    // MOTOR — não existe caminho legal até ele até a Etapa 11).
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
        const autorTipo = esperada ? esperada.autor : AUTOR_PADRAO[tipo];
        // Lei 11: lojista tem que ser O lojista da corrida, senão a recusa
        // viria por autor não autorizado e a matriz mediria outra coisa.
        const autorId = await atorPara(pool, autorTipo);
        try {
          const { corrida: depois } = await transiciona(pool, {
            corridaId: corrida.id,
            tipo,
            autorTipo,
            autorId,
            payload: PAYLOAD_COMPLETO,
            // 'sistema' só existe por caminho interno (Lei 11); a matriz
            // mede LEGALIDADE de aresta, não a porta de entrada.
            interno: autorTipo === 'sistema',
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
            payload: PAYLOAD_COMPLETO,
          }),
          (erro) => erro instanceof ErroDeDominio && erro.codigo === 'autor_nao_autorizado',
          `${aresta.tipo} a partir de ${aresta.de} por ${autorTipo} deveria ser recusada`,
        );
      }
      for (const autorTipo of aresta.autorizados) {
        const corrida = await levaAte(pool, aresta.de);
        const { corrida: depois } = await aplica(pool, corrida.id, aresta.tipo, {
          autorTipo,
          payload: aresta.payload || PAYLOAD_COMPLETO,
        });
        assert.equal(depois.estado, aresta.para, `${aresta.tipo} por ${autorTipo} deveria ser permitida`);
      }
    }
  });

  await t.test('LEI 11: lojista alheio não move a corrida de outro — e a do motoboy é dívida declarada da Etapa 6', async () => {
    const { cadastraLojista, registraCartao } = require('../src/dominio/contas');
    const { conta: outro } = await cadastraLojista(pool, {
      nome: 'Loja vizinha', telefone: `88 7${randomUUID().slice(0, 10)}`,
    });
    await registraCartao(pool, { lojistaId: outro.id, cartaoRef: 'cartao' });

    const corrida = await levaAte(pool, E.A_CAMINHO_DA_LOJA);
    await assert.rejects(
      () => aplica(pool, corrida.id, 'coleta_confirmada', { autorTipo: 'lojista', autorId: outro.id }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'autor_nao_autorizado',
      'lojista que não é o dono da corrida não pode movê-la',
    );
    // E o dono move.
    const { corrida: depois } = await aplica(pool, corrida.id, 'coleta_confirmada', { autorTipo: 'lojista' });
    assert.equal(depois.estado, E.COM_A_MERCADORIA);
  });

  await t.test('LEI 11: cliente alheio não move a corrida de outro — o vínculo é `corridas.cliente_id`', async () => {
    const outro = await atorNovo(pool, 'cliente');
    const corrida = await levaAte(pool, E.PROCURANDO_MOTOBOY);

    await assert.rejects(
      () => aplica(pool, corrida.id, 'cancelada', { autorTipo: 'cliente', autorId: outro }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'autor_nao_autorizado',
      'cliente que não é o destinatário não pode cancelar a corrida',
    );
    // E não é que o cancelamento esteja fechado: o DESTINATÁRIO cancela.
    const { corrida: depois } = await aplica(pool, corrida.id, 'cancelada', { autorTipo: 'cliente' });
    assert.equal(depois.estado, E.CANCELADA);
  });

  await t.test('LEI 11: autor de evento tem que EXISTIR — em todos os quatro papéis, e nada é gravado', async () => {
    // O log é append-only (Lei 3): autor forjado gravado não se apaga. Por
    // isso a conferência é ANTES de qualquer escrita, e vale para os quatro
    // papéis — inclusive 'painel', que não tem vínculo com a corrida e por
    // isso dependia SÓ da existência para não ser um UUID qualquer
    // cancelando corrida com a mercadoria na rua.
    const casos = [
      { autorTipo: 'lojista', tipo: 'coleta_confirmada', ate: E.A_CAMINHO_DA_LOJA },
      { autorTipo: 'motoboy', tipo: 'motoboy_aceitou', ate: E.PROCURANDO_MOTOBOY },
      { autorTipo: 'cliente', tipo: 'cancelada', ate: E.PROCURANDO_MOTOBOY },
      { autorTipo: 'painel', tipo: 'cancelada', ate: E.PROCURANDO_MOTOBOY },
    ];
    for (const caso of casos) {
      const corrida = await levaAte(pool, caso.ate);
      const inventado = randomUUID();
      await assert.rejects(
        () => aplica(pool, corrida.id, caso.tipo, {
          autorTipo: caso.autorTipo, autorId: inventado, payload: PAYLOAD_COMPLETO,
        }),
        (erro) => erro instanceof ErroDeDominio && erro.codigo === 'autor_nao_autorizado',
        `${caso.autorTipo} inventado não pode mover corrida`,
      );
      const { rows } = await pool.query(
        'SELECT count(*) AS n FROM eventos WHERE autor_id = $1', [inventado],
      );
      assert.equal(rows[0].n, '0', 'autor forjado não pode ter chegado ao log');
      // A recusa não diz QUAL id: quem acertou só o formato não sai sabendo
      // se aquele id existe em algum lugar.
      const mensagem = await aplica(pool, corrida.id, caso.tipo, {
        autorTipo: caso.autorTipo, autorId: inventado, payload: PAYLOAD_COMPLETO,
      }).then(() => null, (erro) => erro.message);
      assert.ok(mensagem && !mensagem.includes(inventado), `a recusa devolveu o id: ${mensagem}`);
    }
  });

  await t.test("LEI 11: 'sistema' é tipo, não ator — só caminho interno o declara", async () => {
    const corrida = await levaAte(pool, E.NA_PORTA_COBRANDO);
    // Sem `interno`, é o que um chamador de fora consegue mandar.
    await assert.rejects(
      () => transiciona(pool, {
        corridaId: corrida.id, tipo: 'pagamento_confirmado', autorTipo: 'sistema', autorId: null,
      }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'autor_nao_autorizado',
      "chamador de fora não vira 'sistema' só por declarar",
    );
    // Nem com um id qualquer no lugar do nulo.
    await assert.rejects(
      () => transiciona(pool, {
        corridaId: corrida.id, tipo: 'pagamento_confirmado', autorTipo: 'sistema', autorId: randomUUID(),
      }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'autor_nao_autorizado',
    );
    // O caminho interno continua funcionando: a trava é de origem, não de tipo.
    const { corrida: paga } = await transiciona(pool, {
      corridaId: corrida.id, tipo: 'pagamento_confirmado', autorTipo: 'sistema', autorId: null, interno: true,
    });
    assert.equal(paga.estado, E.PAGO);
  });

  await t.test('LEI 11: o autor é conferido ANTES do replay — chave derivável não entrega evento alheio', async () => {
    // O quinto achado da auditoria, reproduzido antes de corrigido: a chave
    // do varredor é `vencimento:<corrida>:<seq>`, e os dois campos saem da
    // resposta que o próprio chamador recebe. Como o evento do sistema tem
    // autor nulo, `payload.autor_id === (autorId || null)` comparava null com
    // null e o replay era entregue a qualquer um que acertasse a chave —
    // antes de qualquer validação, porque o replay vinha primeiro.
    const corrida = await levaAte(pool, E.PROCURANDO_MOTOBOY);
    const chaveDerivada = `vencimento:${corrida.id}:${corrida.seq}`;
    const doVarredor = {
      corridaId: corrida.id,
      tipo: 'cascata_esgotada',
      autorTipo: 'sistema',
      autorId: null,
      chaveIdempotencia: chaveDerivada,
    };
    await transiciona(pool, { ...doVarredor, interno: true });

    // Mesma chave, mesmo tipo, sem id — o formato exato do que passava. E o
    // estado JÁ ANDOU: sem a conferência de autor antes do replay, a resposta
    // voltaria pelo atalho, sem passar por validação nenhuma.
    await assert.rejects(
      () => transiciona(pool, doVarredor),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'autor_nao_autorizado',
      'a chave derivável não pode devolver o evento do sistema a quem não é o sistema',
    );

    // E não é a chave que está quebrada: o varredor repete e recebe replay.
    const replay = await transiciona(pool, { ...doVarredor, interno: true });
    assert.equal(replay.repetida, true);
  });

  await t.test('LEI 11: destinatário inventado não vira corrida — e o pedido não é gravado', async () => {
    const inventado = randomUUID();
    const dono = await lojistaApto(pool);
    await assert.rejects(
      () => criaCorrida(pool, {
        autorTipo: 'lojista',
        autorId: dono,
        payload: { origem: 'destinatario_falso', cliente_id: inventado },
      }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'cliente_inexistente',
      'id de cliente que não aponta para ninguém não pode virar destinatário',
    );
    const { rows } = await pool.query(
      'SELECT count(*) AS n FROM corridas WHERE cliente_id = $1', [inventado],
    );
    assert.equal(rows[0].n, '0');
  });

  await t.test('LEI 11: a chave de idempotência de transição é do AUTOR — outro aparelho não herda o aceite', async () => {
    const corrida = await levaAte(pool, E.PROCURANDO_MOTOBOY);
    const chave = `aceite-${randomUUID()}`;
    const primeiro = await atorPara(pool, 'motoboy');
    const outroAparelho = await atorNovo(pool, 'motoboy');
    const vencedor = await aplica(pool, corrida.id, 'motoboy_aceitou', { autorId: primeiro, chaveIdempotencia: chave });
    assert.equal(vencedor.repetida, false);

    await assert.rejects(
      () => aplica(pool, corrida.id, 'motoboy_aceitou', { autorId: outroAparelho, chaveIdempotencia: chave }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'chave_reutilizada',
      'outro aparelho com a mesma chave não pode receber "venceu"',
    );

    // O próprio autor continua replayando: a Lei 5 não pode ter quebrado.
    const repetida = await aplica(pool, corrida.id, 'motoboy_aceitou', { autorId: primeiro, chaveIdempotencia: chave });
    assert.equal(repetida.repetida, true);
  });

  await t.test('estado 7 (em disputa) não tem aresta nenhuma, nem de entrada, até a Etapa 11', async () => {
    for (const [tipo, regra] of Object.entries(TRANSICOES)) {
      assert.ok(!regra.de.includes(E.EM_DISPUTA), `${tipo} não pode partir de em_disputa nesta etapa`);
      assert.notEqual(regra.para, E.EM_DISPUTA, `${tipo} não pode levar a em_disputa nesta etapa`);
    }
    const corrida = await levaAte(pool, 4);
    const operador = await atorPara(pool, 'painel');
    await assert.rejects(
      () => transiciona(pool, {
        corridaId: corrida.id, tipo: 'disputa_aberta', autorTipo: 'painel', autorId: operador,
      }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'tipo_desconhecido',
    );
  });

  await t.test('depois do estado 5 (Pago) não se cancela — seção 5', async () => {
    for (const autorTipo of PARTES) {
      const corrida = await levaAte(pool, E.PAGO);
      await assert.rejects(
        () => aplica(pool, corrida.id, 'cancelada', { autorTipo, payload: PAYLOAD_COMPLETO }),
        (erro) => erro instanceof ErroDeDominio && erro.codigo === 'transicao_ilegal',
        `cancelar o estado Pago por ${autorTipo} deveria ser ilegal`,
      );
    }
  });

  await t.test('a saída da porta sem pagamento exige o caso declarado, e só os dois da spec', async () => {
    for (const payload of [undefined, {}, { caso: '' }, { caso: 'nao_quis' }, { caso: 'cliente ausente' }]) {
      const corrida = await levaAte(pool, E.NA_PORTA_COBRANDO);
      await assert.rejects(
        () => aplica(pool, corrida.id, 'espera_vencida', { payload }),
        (erro) => erro instanceof ErroDeDominio && erro.codigo === 'caso_obrigatorio',
        `espera_vencida com caso ${JSON.stringify(payload)} deveria ser recusada`,
      );
    }
    for (const caso of ['cliente_ausente', 'presente_e_nao_pagou']) {
      const corrida = await levaAte(pool, E.NA_PORTA_COBRANDO);
      const { corrida: depois } = await aplica(pool, corrida.id, 'espera_vencida', { payload: { caso } });
      assert.equal(depois.estado, E.EM_RETORNO);
      const { rows: [evento] } = await pool.query(
        `SELECT payload FROM eventos WHERE agregado_tipo = 'corrida' AND agregado_id = $1 AND seq = $2`,
        [depois.id, depois.seq],
      );
      assert.equal(evento.payload.caso, caso, 'a declaração do motoboy fica no log');
    }
  });

  await t.test('retorno antes da chegada exige motivo registrado', async () => {
    const corrida = await levaAte(pool, E.COM_A_MERCADORIA);
    await assert.rejects(
      () => aplica(pool, corrida.id, 'retorno_sem_contato', { payload: { motivo: '  ' } }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'motivo_obrigatorio',
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

  await t.test('pagamento_confirmado só pelo sistema — não é declaração de parte', async () => {
    for (const autorTipo of ['lojista', 'cliente', 'motoboy', 'painel']) {
      const corrida = await levaAte(pool, E.NA_PORTA_COBRANDO);
      await assert.rejects(
        () => aplica(pool, corrida.id, 'pagamento_confirmado', { autorTipo }),
        (erro) => erro instanceof ErroDeDominio && erro.codigo === 'autor_nao_autorizado',
        `pagamento confirmado por ${autorTipo} deveria ser recusado`,
      );
    }
  });

  await t.test('aceite só por motoboy', async () => {
    const corrida = await levaAte(pool, 1);
    await assert.rejects(
      () => aplica(pool, corrida.id, 'motoboy_aceitou', { autorTipo: 'lojista' }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'autor_nao_autorizado',
    );
  });

  await t.test('cancelamento do estado 2 em diante: só a operação (seção 5)', async () => {
    for (const de of [2, 3, 4, 6]) {
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

  await t.test('cancelamento no estado 1 é livre para qualquer parte — ninguém saiu do lugar', async () => {
    for (const autorTipo of ['lojista', 'cliente', 'painel']) {
      const corrida = await levaAte(pool, 1);
      const { corrida: depois } = await aplica(pool, corrida.id, 'cancelada', { autorTipo });
      assert.equal(depois.estado, E.CANCELADA, `cancelar em 1 por ${autorTipo} tem que ser livre e sem motivo`);
    }
  });

  await t.test('cancelamento pela operação exige motivo registrado', async () => {
    for (const de of [2, 3, 4, 6]) {
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

  await t.test('todo estado alcançável tem caminho legal, e o 7 não tem', () => {
    const { CAMINHOS } = require('./ajuda-maquina');
    assert.deepEqual(
      Object.keys(CAMINHOS).map(Number).sort((a, b) => a - b),
      ESTADOS_ALCANCAVEIS,
      'a lista de caminhos legais divergiu dos estados alcançáveis',
    );
    assert.equal(CAMINHOS[E.EM_DISPUTA], undefined);
    assert.ok(PAYLOAD_MINIMO.espera_vencida.caso, 'o caso da espera vencida tem que estar declarado');
  });

  await t.test('transição em corrida inexistente é recusada', async () => {
    const motoboy = await atorPara(pool, 'motoboy');
    await assert.rejects(
      () => transiciona(pool, {
        corridaId: randomUUID(), tipo: 'motoboy_aceitou', autorTipo: 'motoboy', autorId: motoboy,
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
