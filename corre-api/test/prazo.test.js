'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

const { calculaPrazo, faixaDePrazo } = require('../src/dominio/prazo');
const { criaCorrida } = require('../src/dominio/corridas');
const { ErroDeDominio } = require('../src/dominio/erros');
const { poolApp, SOBRAL, lojistaApto, emParalelo } = require('./ajuda-maquina');
const { publicaTabela, ZONAS, PONTOS } = require('./ajuda-preco');

// Os números da tabela de exemplo usados nas contas abaixo:
//   tempo base de coleta        10 min
//   minutos por km adicional     3 min
//   Centro 8 · Anel 1 14 · Anel 2 22
const BASE = 10;
const POR_KM = 3;
const MIN = { Centro: 8, 'Anel 1': 14, 'Anel 2': 22 };

// O prazo esperado de um par DENTRO de zona, calculado à mão a partir de UMA
// VERSÃO NOMEADA. É reimplementação deliberada: usar prazo.js para prever o
// que prazo.js faz seria tautologia.
//
// A versão vem por PARÂMETRO, e isso é a correção de um verde que dependia
// de tempo: ler a "vigente" antes de criar a corrida e conferir depois é uma
// corrida contra os outros arquivos da bateria, que publicam versões novas
// no meio (uma tabela não-exemplo passa a ser vigente no instante em que é
// publicada). Passou local e ficou vermelho na CI — que é o pior jeito de
// descobrir. Agora a expectativa é calculada sobre a versão que a corrida
// REGISTROU, e a prova continua exata: o prazo bate com a versão gravada.
async function esperadoDaVersao(dono, id, a, b) {
  const { rows: [tabela] } = await dono.query(
    'SELECT tempo_base_coleta_minutos AS base FROM tabelas_preco WHERE id = $1', [id],
  );
  const { rows: zonas } = await dono.query(
    `SELECT nome, minutos, lat_min_e6, lat_max_e6, lng_min_e6, lng_max_e6
     FROM zonas WHERE tabela_id = $1 ORDER BY ordem`, [id],
  );
  const anelDe = (ponto) => zonas.find((z) => ponto.latE6 >= z.lat_min_e6 && ponto.latE6 <= z.lat_max_e6
    && ponto.lngE6 >= z.lng_min_e6 && ponto.lngE6 <= z.lng_max_e6);
  const za = anelDe(a);
  const zb = anelDe(b);
  assert.ok(za && zb, 'este auxiliar só vale para pontos DENTRO de zona');
  return {
    tabelaId: id,
    minutos: tabela.base + Math.max(za.minutos, zb.minutos),
    zonaA: za.nome,
    zonaB: zb.nome,
  };
}

// Cria a corrida e devolve, junto, a expectativa calculada sobre a versão que
// ELA registrou. Sem janela entre ler a versão e usá-la.
async function criaEConfere(pool, dono, { lojista, a, b }) {
  const { corrida } = await criaCorrida(pool, {
    autorTipo: 'lojista',
    autorId: lojista,
    payload: {
      origem_lat_e6: a.latE6,
      origem_lng_e6: a.lngE6,
      destino_lat_e6: b.latE6,
      destino_lng_e6: b.lngE6,
    },
  });
  assert.ok(corrida.tabela_preco_id, 'prazo sem versão não se audita');
  const alvo = await esperadoDaVersao(dono, corrida.tabela_preco_id, a, b);
  return { corrida, alvo };
}

test('motor de prazo (Etapa 5)', async (t) => {
  const pool = poolApp();
  const dono = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  t.after(async () => {
    await pool.end();
    await dono.end();
  });

  const tabelaId = await publicaTabela(dono, { rotulo: `prazo-${process.pid}`, zonas: ZONAS });
  const lojistaDoArquivo = await lojistaApto(pool);

  const prazoDe = (origem, destino) => calculaPrazo(pool, {
    tabelaId,
    origemLatE6: origem.latE6,
    origemLngE6: origem.lngE6,
    destinoLatE6: destino.latE6,
    destinoLngE6: destino.lngE6,
  });

  // --------------------------------------------------------------- a faixa
  await t.test('a faixa: teto é o menor múltiplo de 5 estritamente maior; piso é teto − 10', () => {
    // O exemplo que o dono deu: 25 calculados viram "20 a 30".
    assert.deepEqual(faixaDePrazo(25), { min: 20, max: 30 });
    assert.deepEqual(faixaDePrazo(23), { min: 15, max: 25 });
    assert.deepEqual(faixaDePrazo(27), { min: 20, max: 30 });
    assert.deepEqual(faixaDePrazo(30), { min: 25, max: 35 });
    // Piso abaixo de 5 => faixa mínima 5 a 15.
    assert.deepEqual(faixaDePrazo(0), { min: 5, max: 15 });
    assert.deepEqual(faixaDePrazo(3), { min: 5, max: 15 });
    assert.deepEqual(faixaDePrazo(14), { min: 5, max: 15 });
    assert.deepEqual(faixaDePrazo(15), { min: 10, max: 20 });
  });

  await t.test('a faixa NUNCA promete menos do que a conta disse, e é monótona — 0 a 5.000 minutos', () => {
    let anterior = faixaDePrazo(0);
    for (let calculado = 0; calculado <= 5000; calculado += 1) {
      const faixa = faixaDePrazo(calculado);
      assert.ok(
        faixa.max > calculado,
        `faixa ${faixa.min}–${faixa.max} promete menos que os ${calculado} calculados`,
      );
      assert.ok(faixa.min < faixa.max, `faixa degenerada em ${calculado}`);
      assert.ok(faixa.min >= 5, `piso abaixo do mínimo em ${calculado}`);
      assert.equal(faixa.max % 5, 0, `teto fora do passo de 5 em ${calculado}`);
      assert.ok(faixa.min >= anterior.min && faixa.max >= anterior.max, `faixa andou para trás em ${calculado}`);
      anterior = faixa;
    }
  });

  // ---------------------------------------------------- par origem-destino
  await t.test('o prazo vale o anel MAIOR das duas pontas, não o do destino', async () => {
    // Do Anel 2 para o Centro: o destino é o Centro (8 min), mas a viagem é a
    // travessia inteira. O prazo tem que valer o Anel 2.
    const deForaParaDentro = await prazoDe(PONTOS.anel2, PONTOS.centro);
    assert.equal(deForaParaDentro.prazo_minutos, BASE + MIN['Anel 2']);
    assert.equal(deForaParaDentro.origem_zona_nome, 'Anel 2');
    assert.equal(deForaParaDentro.destino_zona_nome, 'Centro');

    // O erro que a regra evita: se valesse o anel de destino, seriam 18.
    assert.notEqual(deForaParaDentro.prazo_minutos, BASE + MIN.Centro);
  });

  await t.test('o prazo é simétrico: A→B e B→A dão o mesmo número', async () => {
    const pares = [
      [PONTOS.centro, PONTOS.anel1], [PONTOS.centro, PONTOS.anel2],
      [PONTOS.anel1, PONTOS.anel2], [PONTOS.centro, PONTOS.foraDeZona],
      [PONTOS.anel2, PONTOS.foraDeZona],
    ];
    for (const [a, b] of pares) {
      const ida = await prazoDe(a, b);
      const volta = await prazoDe(b, a);
      assert.equal(
        ida.prazo_minutos, volta.prazo_minutos,
        `distância é simétrica; o prazo tem que ser: ${JSON.stringify(a)} ↔ ${JSON.stringify(b)}`,
      );
      assert.deepEqual(
        [ida.prazo_min_minutos, ida.prazo_max_minutos],
        [volta.prazo_min_minutos, volta.prazo_max_minutos],
      );
    }
  });

  await t.test('as duas pontas na mesma zona: base + os minutos daquele anel', async () => {
    for (const [chave, nome] of [['centro', 'Centro'], ['anel1', 'Anel 1'], ['anel2', 'Anel 2']]) {
      const r = await prazoDe(PONTOS[chave], PONTOS[chave]);
      assert.equal(r.prazo_minutos, BASE + MIN[nome], `${nome} deu prazo errado`);
    }
  });

  // ------------------------------------------------------------ fora de zona
  await t.test('fora de zona: base + anel mais externo + minutos por km, com a MESMA distância do preço', async () => {
    // O ponto de teste está a 6 km do centro do Anel 2 (mesmo cálculo em
    // linha reta do motor de preço, sem API nenhuma).
    const r = await prazoDe(PONTOS.centro, PONTOS.foraDeZona);
    assert.equal(r.km_adicionais, 6, 'a distância em km tem que ser a mesma que o preço usa');
    assert.equal(r.prazo_minutos, BASE + MIN['Anel 2'] + 6 * POR_KM);
    assert.equal(r.destino_zona_nome, null, 'ponta fora de zona não tem anel');
    assert.deepEqual(
      { min: r.prazo_min_minutos, max: r.prazo_max_minutos },
      faixaDePrazo(BASE + MIN['Anel 2'] + 6 * POR_KM),
    );
  });

  await t.test('duas pontas fora de zona: vence a mais distante', async () => {
    const perto = { latE6: -3686000, lngE6: -40300000 }; // 6 km
    const longe = { latE6: -3600000, lngE6: -40349000 }; // 10 km
    const r = await prazoDe(perto, longe);
    assert.equal(r.km_adicionais, 10);
    assert.equal(r.prazo_minutos, BASE + MIN['Anel 2'] + 10 * POR_KM);
  });

  // ----------------------------------------------------------- determinismo
  await t.test('mesma consulta 1.000 vezes devolve exatamente o mesmo minuto', async () => {
    const alvo = await prazoDe(PONTOS.centro, PONTOS.anel2);
    for (let i = 0; i < 1000; i += 1) {
      const r = await prazoDe(PONTOS.centro, PONTOS.anel2);
      assert.equal(r.prazo_minutos, alvo.prazo_minutos);
      assert.equal(r.prazo_min_minutos, alvo.prazo_min_minutos);
      assert.equal(r.prazo_max_minutos, alvo.prazo_max_minutos);
    }
  });

  await t.test('zero chamadas de rede externas durante o cálculo', async () => {
    const fetchOriginal = global.fetch;
    const httpReq = http.request;
    const httpsReq = https.request;
    const proibir = () => { throw new Error('chamada de rede externa proibida no cálculo de prazo'); };
    global.fetch = proibir;
    http.request = proibir;
    https.request = proibir;
    try {
      const r = await prazoDe(PONTOS.centro, PONTOS.foraDeZona);
      assert.equal(r.prazo_minutos, BASE + MIN['Anel 2'] + 6 * POR_KM);
    } finally {
      global.fetch = fetchOriginal;
      http.request = httpReq;
      https.request = httpsReq;
    }
  });

  await t.test('versão nova da tabela não muda o prazo de quem foi calculado na antiga', async () => {
    const dobrada = await publicaTabela(dono, {
      rotulo: `prazo-v2-${process.pid}`,
      tempoBaseColetaMinutos: 40,
      zonas: ZONAS.map((z) => ({ ...z, minutos: z.minutos * 2 })),
    });
    const naNova = await calculaPrazo(pool, {
      tabelaId: dobrada,
      origemLatE6: PONTOS.centro.latE6,
      origemLngE6: PONTOS.centro.lngE6,
      destinoLatE6: PONTOS.centro.latE6,
      destinoLngE6: PONTOS.centro.lngE6,
    });
    assert.equal(naNova.prazo_minutos, 40 + MIN.Centro * 2);

    const naAntiga = await prazoDe(PONTOS.centro, PONTOS.centro);
    assert.equal(naAntiga.prazo_minutos, BASE + MIN.Centro, 'a versão antiga não muda');
  });

  // -------------------------------------------------- gravado na criação
  await t.test('a corrida nasce com a faixa e a versão da tabela gravadas', async () => {
    const { corrida, alvo } = await criaEConfere(pool, dono, {
      lojista: await lojistaApto(pool), a: PONTOS.centro, b: PONTOS.anel2,
    });
    const esperado = faixaDePrazo(alvo.minutos);
    assert.equal(corrida.prazo_min_minutos, esperado.min);
    assert.equal(corrida.prazo_max_minutos, esperado.max);
    assert.equal(corrida.origem_zona_nome, alvo.zonaA);
    assert.equal(corrida.destino_zona_nome, alvo.zonaB);

    // A versão gravada é uma versão PUBLICADA de verdade, na cidade certa.
    const { rows: [publicada] } = await dono.query(
      'SELECT cidade_id FROM tabelas_preco WHERE id = $1', [corrida.tabela_preco_id],
    );
    assert.equal(publicada.cidade_id, SOBRAL);

    // E o valor PONTUAL fica gravado — só que só o dono o enxerga.
    const { rows: [linha] } = await dono.query(
      'SELECT prazo_minutos FROM corridas WHERE id = $1', [corrida.id],
    );
    assert.equal(linha.prazo_minutos, alvo.minutos);
  });

  await t.test('quem pede NÃO escolhe a versão da tabela — ela é sempre a vigente', async () => {
    // Uma versão antiga com minutos menores mostraria ao cliente uma faixa
    // que a operação já abandonou, e trocaria a âncora de auditoria do preço.
    // (Achado da auditoria da Etapa 5.)
    await assert.rejects(
      () => criaCorrida(pool, {
        autorTipo: 'lojista',
        autorId: lojistaDoArquivo,
        payload: {
          tabela_preco_id: tabelaId,
          origem_lat_e6: PONTOS.centro.latE6,
          origem_lng_e6: PONTOS.centro.lngE6,
          destino_lat_e6: PONTOS.centro.latE6,
          destino_lng_e6: PONTOS.centro.lngE6,
        },
      }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'tempo_do_cliente',
      'tabela_preco_id vindo do payload tem que ser recusado',
    );
  });

  await t.test('a aplicação NÃO CONSEGUE LER o valor pontual — nem na corrida, nem no log', async () => {
    const { corrida, alvo } = await criaEConfere(pool, dono, {
      lojista: await lojistaApto(pool), a: PONTOS.centro, b: PONTOS.anel1,
    });

    // Privilégio de coluna: o que não se lê não vaza para tela nenhuma.
    await assert.rejects(
      () => pool.query('SELECT prazo_minutos FROM corridas WHERE id = $1', [corrida.id]),
      /permission denied|permissão negada/i,
      'corre_app não pode ter SELECT em prazo_minutos',
    );
    await assert.rejects(
      () => pool.query('SELECT * FROM corridas WHERE id = $1', [corrida.id]),
      /permission denied|permissão negada/i,
      'nem por SELECT *',
    );

    // E o log, que a aplicação LÊ, carrega só a faixa.
    const { rows: [evento] } = await pool.query(
      `SELECT payload FROM eventos WHERE agregado_tipo = 'corrida' AND agregado_id = $1 AND seq = 1`,
      [corrida.id],
    );
    assert.equal(evento.payload.prazo_minutos, undefined, 'o pontual não pode vazar pelo payload do evento');
    assert.equal(evento.payload.prazo_min_minutos, faixaDePrazo(alvo.minutos).min);
    assert.equal(evento.payload.prazo_max_minutos, faixaDePrazo(alvo.minutos).max);
  });

  await t.test('prazo digitado pelo cliente é recusado — prazo é derivado, não informado', async () => {
    const lojista = await lojistaApto(pool);
    for (const chave of ['prazo_minutos', 'prazo_min_minutos', 'prazo_max_minutos', 'tabela_preco_id']) {
      await assert.rejects(
        () => criaCorrida(pool, {
          autorTipo: 'lojista',
          autorId: lojista,
          payload: { [chave]: 1 },
        }),
        (erro) => erro instanceof ErroDeDominio && erro.codigo === 'tempo_do_cliente',
        `${chave} vindo do payload deveria ser recusado`,
      );
    }
  });

  await t.test('meia coordenada é erro, nunca "prazo opcional"', async () => {
    const lojista = await lojistaApto(pool);
    await assert.rejects(
      () => criaCorrida(pool, {
        autorTipo: 'lojista',
        autorId: lojista,
        payload: {
          origem_lat_e6: PONTOS.centro.latE6,
          origem_lng_e6: PONTOS.centro.lngE6,
        },
      }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'coordenada_invalida',
    );
    await assert.rejects(
      () => calculaPrazo(pool, {
        tabelaId,
        origemLatE6: -3686000.5,
        origemLngE6: PONTOS.centro.lngE6,
        destinoLatE6: PONTOS.anel1.latE6,
        destinoLngE6: PONTOS.anel1.lngE6,
      }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'coordenada_invalida',
    );
  });

  await t.test('sem coordenada nenhuma a corrida nasce sem prazo, e o banco não deixa faixa órfã', async () => {
    const { corrida } = await criaCorrida(pool, {
      autorTipo: 'lojista',
      autorId: await lojistaApto(pool),
      payload: { origem: 'sem endereço, como antes da Etapa 15' },
    });
    assert.equal(corrida.prazo_min_minutos, null);
    assert.equal(corrida.prazo_max_minutos, null);

    await assert.rejects(
      () => dono.query('UPDATE corridas SET prazo_min_minutos = 10, prazo_max_minutos = 20 WHERE id = $1', [corrida.id]),
      /corridas_faixa_exige_pontual/,
      'faixa sem valor pontual é faixa sem lastro',
    );
    await assert.rejects(
      () => dono.query('UPDATE corridas SET prazo_minutos = 25, tabela_preco_id = NULL WHERE id = $1', [corrida.id]),
      /corridas_prazo_exige_versao_da_tabela/,
      'prazo sem versão da tabela não se reconstitui depois',
    );
  });

  // ------------------------------------------------------------- Lei 9
  await t.test('Lei 9: 200 criações concorrentes com prazo, nenhuma faixa incoerente', async () => {
    const lojista = await lojistaApto(pool);
    const criadas = await emParalelo(Array.from({ length: 200 }, (_, i) => i), 20, async () => {
      const { corrida } = await criaCorrida(pool, {
        autorTipo: 'lojista',
        autorId: lojista,
        payload: {
          origem_lat_e6: PONTOS.anel1.latE6,
          origem_lng_e6: PONTOS.anel1.lngE6,
          destino_lat_e6: PONTOS.anel2.latE6,
          destino_lng_e6: PONTOS.anel2.lngE6,
        },
      });
      return corrida;
    });
    // Cada corrida é conferida contra a versão que ELA registrou: sob
    // concorrência a vigente pode mudar no meio, e o que a etapa promete não
    // é "todas iguais", é "cada uma coerente com a versão que gravou".
    for (const corrida of criadas) {
      const alvo = await esperadoDaVersao(dono, corrida.tabela_preco_id, PONTOS.anel1, PONTOS.anel2);
      const esperado = faixaDePrazo(alvo.minutos);
      assert.equal(corrida.prazo_min_minutos, esperado.min);
      assert.equal(corrida.prazo_max_minutos, esperado.max);
    }
    // Concorrência não pode ter inventado corrida a mais nem a menos.
    assert.equal(new Set(criadas.map((c) => c.id)).size, 200);
  });

  await t.test('Lei 9: a mesma chave de idempotência sob concorrência produz UMA corrida e UM prazo', async () => {
    const lojista = await lojistaApto(pool);
    const chave = `prazo-idem-${randomUUID()}`;
    const resultados = await emParalelo(Array.from({ length: 20 }, (_, i) => i), 20, async () => {
      const { corrida } = await criaCorrida(pool, {
        autorTipo: 'lojista',
        autorId: lojista,
        chaveIdempotencia: chave,
        payload: {
          origem_lat_e6: PONTOS.centro.latE6,
          origem_lng_e6: PONTOS.centro.lngE6,
          destino_lat_e6: PONTOS.anel2.latE6,
          destino_lng_e6: PONTOS.anel2.lngE6,
        },
      });
      return corrida;
    });
    assert.equal(new Set(resultados.map((c) => c.id)).size, 1, 'a chave tem que arbitrar uma corrida só');
    const alvoIdem = await esperadoDaVersao(dono, resultados[0].tabela_preco_id, PONTOS.centro, PONTOS.anel2);
    const esperado = faixaDePrazo(alvoIdem.minutos);
    for (const corrida of resultados) {
      assert.equal(corrida.prazo_min_minutos, esperado.min);
      assert.equal(corrida.prazo_max_minutos, esperado.max);
    }
  });

  // ---------------------------------------------------------- multi-cidade
  await t.test('duas cidades com minutos diferentes não se misturam', async () => {
    const { rows: [outra] } = await dono.query(
      `INSERT INTO cidades (nome, uf, ibge) VALUES ($1, 'CE', $2) RETURNING id`,
      [`Cidade do prazo ${process.pid}`, String(2300000 + (process.pid % 99999))],
    );
    const tabelaDaOutra = await publicaTabela(dono, {
      rotulo: `prazo-outra-${process.pid}`,
      cidadeId: outra.id,
      tempoBaseColetaMinutos: 99,
      zonas: ZONAS,
    });

    // Dentro da outra cidade, o prazo é o dela.
    const poolDaOutra = poolApp(4, outra.id);
    t.after(() => poolDaOutra.end());
    const naOutra = await calculaPrazo(poolDaOutra, {
      tabelaId: tabelaDaOutra,
      origemLatE6: PONTOS.centro.latE6,
      origemLngE6: PONTOS.centro.lngE6,
      destinoLatE6: PONTOS.centro.latE6,
      destinoLngE6: PONTOS.centro.lngE6,
    });
    assert.equal(naOutra.prazo_minutos, 99 + MIN.Centro);

    // De Sobral, a tabela da outra cidade não existe: a política cega antes
    // de qualquer conta.
    await assert.rejects(
      () => calculaPrazo(pool, {
        tabelaId: tabelaDaOutra,
        origemLatE6: PONTOS.centro.latE6,
        origemLngE6: PONTOS.centro.lngE6,
        destinoLatE6: PONTOS.centro.latE6,
        destinoLngE6: PONTOS.centro.lngE6,
      }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'tabela_preco_inexistente',
    );

    // E uma corrida de Sobral não consegue apontar para a versão da outra
    // cidade nem forçando: a chave composta recusa.
    const lojistaDeSobral = await lojistaApto(pool);
    await assert.rejects(
      () => dono.query(
        `INSERT INTO corridas (estado, seq, lojista_id, cidade_id, tabela_preco_id, prazo_minutos, prazo_min_minutos, prazo_max_minutos)
         VALUES (1, 1, $1, (SELECT cidade_id FROM lojistas WHERE id = $1), $2, 10, 5, 15)`,
        [lojistaDeSobral, tabelaDaOutra],
      ),
      /corridas_tabela_preco_da_mesma_cidade/,
    );
  });
});
