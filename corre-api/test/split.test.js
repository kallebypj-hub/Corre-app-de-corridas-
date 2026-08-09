'use strict';

// Trava de configuração de taxa e conta do split.
//
// O que esta bateria tem que provar:
//   1. as contas publicadas na especificação batem, ao centavo;
//   2. o split FECHA sempre: lojista + motoboy + corre + taxa === total, e
//      nenhuma parcela fica negativa;
//   3. a fórmula do banco e a do JavaScript dão o MESMO número — duas
//      implementações que divergem em silêncio seriam pior que uma só;
//   4. uma configuração capaz de dar prejuízo NÃO PODE SER PUBLICADA;
//   5. com a configuração ausente ou no prejuízo, a corrida NÃO É CRIADA e
//      nada é gravado — a plataforma se recusa a operar em vez de operar no
//      prejuízo;
//   6. configuração publicada é imutável para a aplicação (Lei 9: não há
//      janela entre ler a configuração e gravar a corrida).
//
// NOTA DE ISOLAMENTO: `node --test` roda os arquivos em PARALELO. Nenhum
// teste daqui pode publicar uma configuração que quebre outro arquivo — por
// isso as que são publicadas são todas VÁLIDAS (o banco não deixaria ser
// outra coisa) e nenhuma é apagada: apagar corre risco de violar a FK de uma
// corrida que outro arquivo acabou de criar.

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const { calculaSplit, configuracaoVigente } = require('../src/dominio/split');
const { criaCorrida, exigeConfiguracaoQueFecha } = require('../src/dominio/corridas');
const { ErroDeDominio, CODIGOS, ehFalhaDeConfiguracao } = require('../src/dominio/erros');
const { conectaDono, conectaApp, esperaErro } = require('./ajuda');
const { poolApp, lojistaApto } = require('./ajuda-maquina');

// A configuração de exemplo que a migration publica, replicada aqui como
// objeto para os testes puros. Os números são de TABELA, não contratados.
const EXEMPLO = {
  id: 'exemplo',
  rotulo: 'exemplo-2026-08-09',
  comissao_bps: 500, // 5% do frete
  taxa_percentual_bps: 119, // 1,19% do total
  taxa_fixa_centavos: '0',
  portador_taxa_percentual: 'lojista',
  frete_minimo_centavos: '500',
  mercadoria_maxima_centavos: '50000',
};

const com = (extra) => ({ ...EXEMPLO, ...extra });

// ------------------------------------------------- 1. as contas publicadas

test('a conta publicada na spec: mercadoria R$ 100 + frete R$ 10, taxa no lojista', () => {
  const s = calculaSplit({ mercadoriaCentavos: 10000, freteCentavos: 1000, configuracao: EXEMPLO });
  assert.equal(s.total_centavos, 11000);
  assert.equal(s.taxa_centavos, 131); // teto de 1,19% de 11000 = 130,9
  assert.equal(s.lojista_centavos, 9869); // 10000 - 131
  assert.equal(s.motoboy_centavos, 950); // frete - 5%
  assert.equal(s.corre_centavos, 50); // INTACTO
});

test('a conta publicada na spec: mercadoria R$ 500 + frete R$ 10 — a margem não muda', () => {
  const s = calculaSplit({ mercadoriaCentavos: 50000, freteCentavos: 1000, configuracao: EXEMPLO });
  assert.equal(s.total_centavos, 51000);
  assert.equal(s.taxa_centavos, 607); // teto de 1,19% de 51000 = 606,9
  assert.equal(s.lojista_centavos, 49393);
  assert.equal(s.motoboy_centavos, 950);
  assert.equal(s.corre_centavos, 50); // IMUNE ao valor da mercadoria
});

test('rateio proporcional: o Corre fica com 49 e o motoboy paga 11', () => {
  const s = calculaSplit({
    mercadoriaCentavos: 10000,
    freteCentavos: 1000,
    configuracao: com({ portador_taxa_percentual: 'proporcional' }),
  });
  assert.equal(s.corre_centavos, 49);
  assert.equal(s.motoboy_centavos, 939);
  assert.equal(s.lojista_centavos, 9881);
  assert.equal(s.taxa_centavos, 131);
});

test('mercadoria zero: a taxa cai na plataforma e a comissão vira 38 centavos', () => {
  // Sem parcela de mercadoria não há de onde debitar (venda já acertada
  // fora — CORRE.md, seção 3). Fecha sempre, porque 1,19% do frete é muito
  // menor que 5% do frete.
  const s = calculaSplit({ mercadoriaCentavos: 0, freteCentavos: 1000, configuracao: EXEMPLO });
  assert.equal(s.total_centavos, 1000);
  assert.equal(s.taxa_centavos, 12); // teto de 1,19% de 1000 = 11,9
  assert.equal(s.lojista_centavos, 0);
  assert.equal(s.motoboy_centavos, 950);
  assert.equal(s.corre_centavos, 38); // 50 - 12, a taxa não tinha outro bolso
  assert.equal(s.taxa_por_parcela.corre, 12);
  assert.equal(s.taxa_por_parcela.lojista, 0);
});

test('mercadoria menor que a taxa não deixa o lojista negativo', () => {
  // 5 centavos de mercadoria e R$ 10 de frete: a taxa é 12 c, maior que a
  // parcela dele. Ele paga no máximo a própria parcela; a sobra é da
  // plataforma.
  const s = calculaSplit({ mercadoriaCentavos: 5, freteCentavos: 1000, configuracao: EXEMPLO });
  assert.equal(s.lojista_centavos, 0);
  assert.equal(s.taxa_por_parcela.lojista, 5);
  assert.equal(s.taxa_por_parcela.corre, 7);
  assert.equal(s.corre_centavos, 43);
  assert.equal(s.lojista_centavos + s.motoboy_centavos + s.corre_centavos + s.taxa_centavos, 1005);
});

test('o centavo de arredondamento da comissão vai para o motoboy, nunca para a plataforma', () => {
  // Frete de 1999 c: 5% = 99,95. Piso = 99 para o Corre, 1900 para o motoboy.
  const s = calculaSplit({ mercadoriaCentavos: 0, freteCentavos: 1999, configuracao: EXEMPLO });
  assert.equal(s.motoboy_centavos, 1900);
  assert.equal(s.corre_centavos + s.taxa_por_parcela.corre, 99);
});

test('a taxa é estimada para CIMA — nunca subestimar custo', () => {
  // 1,19% de 101 = 1,2019 -> 2, não 1.
  const s = calculaSplit({ mercadoriaCentavos: 1, freteCentavos: 100, configuracao: EXEMPLO });
  assert.equal(s.taxa_centavos, 2);
});

// ------------------------------------------------------- 2. o split fecha

test('o split fecha ao centavo em 20.001 combinações, nos três portadores', () => {
  let casos = 0;
  for (const portador of ['lojista', 'proporcional', 'corre']) {
    const configuracao = com({ portador_taxa_percentual: portador });
    for (let i = 0; i < 6667; i += 1) {
      const frete = 500 + ((i * 7919) % 4500); // 500..4999
      // Com a taxa saindo do Corre o envelope seguro é mercadoria <= 3,2 ×
      // frete; fora dele a trava DEVE disparar, e isso tem teste próprio.
      const teto = portador === 'corre' ? frete * 2 : 50000;
      const mercadoria = (i * 104729) % (teto + 1);
      const s = calculaSplit({ mercadoriaCentavos: mercadoria, freteCentavos: frete, configuracao });
      assert.equal(
        s.lojista_centavos + s.motoboy_centavos + s.corre_centavos + s.taxa_centavos,
        s.total_centavos,
        `não fechou em ${portador} m=${mercadoria} f=${frete}`,
      );
      assert.equal(
        s.taxa_por_parcela.lojista + s.taxa_por_parcela.motoboy + s.taxa_por_parcela.corre,
        s.taxa_centavos,
        `a taxa não se reparte inteira em ${portador}`,
      );
      assert.ok(s.lojista_centavos >= 0 && s.motoboy_centavos >= 0, 'parcela negativa');
      assert.ok(s.corre_centavos > 0, `parcela do Corre não positiva em ${portador}`);
      casos += 1;
    }
  }
  assert.equal(casos, 20001);
});

// -------------------------------------------- 3. banco e JavaScript batem

test('a fórmula do banco e a do JavaScript dão o mesmo centavo em 2.000 casos', async (t) => {
  const dono = await conectaDono();
  t.after(() => dono.end());

  const portadores = ['lojista', 'proporcional', 'corre'];
  for (let i = 0; i < 2000; i += 1) {
    const c = {
      mercadoria: (i * 104729) % 60000,
      frete: 500 + ((i * 7919) % 4500),
      comissao: 100 + ((i * 13) % 900), // 1% a 10%
      taxaPct: (i * 37) % 500, // 0 a 4,99%
      taxaFixa: (i * 3) % 40,
      portador: portadores[i % 3],
    };
    const configuracao = com({
      comissao_bps: c.comissao,
      taxa_percentual_bps: c.taxaPct,
      taxa_fixa_centavos: String(c.taxaFixa),
      portador_taxa_percentual: c.portador,
    });

    const { rows: [{ parcela }] } = await dono.query(
      'SELECT parcela_corre_centavos($1::centavos, $2::centavos, $3, $4, $5::centavos, $6::portador_taxa) AS parcela',
      [c.mercadoria, c.frete, c.comissao, c.taxaPct, c.taxaFixa, c.portador],
    );
    const rotulo = `m=${c.mercadoria} f=${c.frete} com=${c.comissao} pct=${c.taxaPct} fixa=${c.taxaFixa} ${c.portador}`;

    let doJs;
    try {
      doJs = calculaSplit({
        mercadoriaCentavos: c.mercadoria, freteCentavos: c.frete, configuracao,
      }).corre_centavos;
    } catch (erro) {
      // A trava recusou. A função do banco é só aritmética — quem recusa lá
      // é o CHECK — então o que se confere é que ela também achou <= 0.
      if (!ehFalhaDeConfiguracao(erro)) throw erro;
      assert.ok(Number(parcela) <= 0, `JS recusou mas o banco devolveu ${parcela} (${rotulo})`);
      continue;
    }
    assert.equal(Number(parcela), doJs, `divergência banco×JS: ${rotulo}`);
  }
});

// ----------------------------- 4. configuração de prejuízo não é publicável

// Publica uma configuração. Só publica VÁLIDA — o banco não aceita outra —,
// e por isso é inofensiva para os arquivos de teste que rodam em paralelo:
// qualquer configuração publicada passa a conferência do envelope por
// construção.
async function publica(dono, extra = {}) {
  const b = {
    gateway: 'teste',
    comissao_bps: 500,
    taxa_percentual_bps: 119,
    taxa_fixa: 0,
    portador: 'lojista',
    frete_minimo: 500,
    mercadoria_maxima: 50000,
    ...extra,
  };
  const { rows: [linha] } = await dono.query(
    `INSERT INTO configuracoes_taxa
       (rotulo, gateway, comissao_bps, taxa_percentual_bps, taxa_fixa_centavos,
        portador_taxa_percentual, frete_minimo_centavos, mercadoria_maxima_centavos, exemplo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING id`,
    [`t-${randomUUID()}`, b.gateway, b.comissao_bps, b.taxa_percentual_bps, b.taxa_fixa,
      b.portador, b.frete_minimo, b.mercadoria_maxima],
  );
  return linha.id;
}

test('o banco RECUSA publicar configuração em que a taxa sai do Corre acima do equilíbrio', async (t) => {
  const dono = await conectaDono();
  t.after(() => dono.end());

  // Frete mínimo R$ 5 (comissão 25 c) e mercadoria até R$ 500: com a taxa no
  // Corre ela seria R$ 6,01. Prejuízo — a publicação tem que falhar.
  const erro = await esperaErro(
    dono,
    `INSERT INTO configuracoes_taxa
       (rotulo, gateway, comissao_bps, taxa_percentual_bps, taxa_fixa_centavos,
        portador_taxa_percentual, frete_minimo_centavos, mercadoria_maxima_centavos)
     VALUES ($1,'teste',500,119,0,'corre',500,50000)`,
    [`prejuizo-${randomUUID()}`],
  );
  assert.match(String(erro.constraint || erro.message), /configuracao_taxa_nunca_opera_no_prejuizo/);
});

test('o banco RECUSA taxa fixa que come a comissão do frete mínimo', async (t) => {
  const dono = await conectaDono();
  t.after(() => dono.end());

  // Frete mínimo R$ 5 -> comissão 25 c. Uma taxa fixa de 99 c (o R$ 0,99 que
  // a pesquisa apontou como risco real) come a comissão inteira — e taxa
  // fixa NÃO é rateável em nenhum gateway: cai sempre na plataforma.
  const erro = await esperaErro(
    dono,
    `INSERT INTO configuracoes_taxa
       (rotulo, gateway, comissao_bps, taxa_percentual_bps, taxa_fixa_centavos,
        portador_taxa_percentual, frete_minimo_centavos, mercadoria_maxima_centavos)
     VALUES ($1,'teste',500,119,99,'lojista',500,50000)`,
    [`fixa-${randomUUID()}`],
  );
  assert.match(String(erro.constraint || erro.message), /configuracao_taxa_nunca_opera_no_prejuizo/);
});

test('o banco ACEITA a configuração que fecha — a trava recusa o prejuízo, não o portador', async (t) => {
  const dono = await conectaDono();
  t.after(() => dono.end());

  // DENTRO DE UMA TRANSAÇÃO DESFEITA. O CHECK é avaliado no INSERT, então a
  // aceitação fica provada — e a configuração não vaza para os arquivos que
  // rodam em paralelo. Uma configuração de envelope estreito virando vigente
  // quebra a criação de corrida dos outros; foi a própria bateria que pegou.
  await dono.query('BEGIN');
  try {
    assert.ok(await publica(dono));
    // Com a taxa no Corre dentro do equilíbrio (mercadoria <= 3,2 × frete)
    // também passa: a trava recusa o prejuízo, não o portador.
    assert.ok(await publica(dono, { portador: 'corre', frete_minimo: 1000, mercadoria_maxima: 3000 }));
  } finally {
    await dono.query('ROLLBACK');
  }
});

test('o domínio recusa a conta que o banco recusaria, com código de CONFIGURAÇÃO', () => {
  let capturado = null;
  try {
    // mercadoria R$ 500 com frete R$ 10 e a taxa no Corre: -557 c.
    calculaSplit({
      mercadoriaCentavos: 50000,
      freteCentavos: 1000,
      configuracao: com({ portador_taxa_percentual: 'corre' }),
    });
  } catch (erro) {
    capturado = erro;
  }
  assert.ok(capturado instanceof ErroDeDominio);
  assert.equal(capturado.codigo, CODIGOS.CONFIGURACAO_DE_TAXA_INVALIDA);
  assert.ok(ehFalhaDeConfiguracao(capturado), 'tem que ser classificado como falha de configuração');
  assert.match(capturado.message, /recusa a operar no prejuízo/);
});

test('o ponto de equilíbrio é mercadoria = 3,2 × frete, ao centavo', () => {
  const configuracao = com({ portador_taxa_percentual: 'corre' });
  const frete = 1000; // comissão 50 c
  // Acha a MAIOR mercadoria que ainda fecha. Prova o limite, não um caso
  // qualquer: 5% × 1000 = 50; teto(1,19% × (m + 1000)) <= 49 => m <= 3117.
  let maior = null;
  for (let m = 3000; m <= 3400; m += 1) {
    try {
      calculaSplit({ mercadoriaCentavos: m, freteCentavos: frete, configuracao });
      maior = m;
    } catch (erro) {
      if (!ehFalhaDeConfiguracao(erro)) throw erro;
      break;
    }
  }
  assert.equal(maior, 3117);
  assert.ok(maior > 3 * frete && maior < 3.3 * frete);
});

// -------------------------- 5. sem configuração, a corrida não é criada

// Pool falso: a configuração de prejuízo não existe no banco (o CHECK não
// deixa), então a única forma de exercitar a SEGUNDA camada é entregar a
// configuração ruim direto ao domínio. É exatamente o cenário que a trava
// existe para cobrir: gateway trocado, contrato diferente, CHECK removido.
const poolQueDevolve = (linhas) => ({ query: async () => ({ rows: linhas }) });

test('sem NENHUMA configuração publicada, a criação para antes de qualquer escrita', async () => {
  const erro = await exigeConfiguracaoQueFecha(poolQueDevolve([]), {}).then(() => null, (e) => e);
  assert.ok(erro instanceof ErroDeDominio);
  assert.equal(erro.codigo, CODIGOS.CONFIGURACAO_DE_TAXA_AUSENTE);
  assert.ok(ehFalhaDeConfiguracao(erro), 'é falha de configuração, não erro do usuário');
});

test('com a configuração no prejuízo, a criação para antes de qualquer escrita', async () => {
  const ruim = {
    ...com({ portador_taxa_percentual: 'corre' }),
    frete_minimo_centavos: '500',
    mercadoria_maxima_centavos: '50000',
  };
  const erro = await exigeConfiguracaoQueFecha(poolQueDevolve([ruim]), {}).then(() => null, (e) => e);
  assert.ok(erro instanceof ErroDeDominio);
  assert.equal(erro.codigo, CODIGOS.CONFIGURACAO_DE_TAXA_INVALIDA);
  assert.ok(ehFalhaDeConfiguracao(erro));
});

test('pedido fora do envelope da configuração vigente não vira corrida, e nada é gravado', async (t) => {
  const pool = poolApp();
  t.after(() => pool.end());
  const lojistaId = await lojistaApto(pool);

  const { rows: [{ n: antes }] } = await pool.query(
    'SELECT count(*)::int AS n FROM corridas WHERE lojista_id = $1', [lojistaId],
  );

  // Frete de 1 centavo: abaixo do mínimo que a configuração declara operar.
  // A comissão é 0 e a taxa é 1 — a plataforma pagaria para trabalhar.
  const erro = await criaCorrida(pool, {
    autorTipo: 'lojista',
    autorId: lojistaId,
    payload: { mercadoria_centavos: 0, frete_centavos: 1 },
    chaveIdempotencia: randomUUID(),
  }).then(() => null, (e) => e);

  assert.ok(erro instanceof ErroDeDominio, 'tinha que recusar');
  assert.equal(erro.codigo, CODIGOS.CONFIGURACAO_DE_TAXA_INVALIDA);
  assert.ok(ehFalhaDeConfiguracao(erro), 'é falha de configuração, não erro do usuário');

  const { rows: [{ n: depois }] } = await pool.query(
    'SELECT count(*)::int AS n FROM corridas WHERE lojista_id = $1', [lojistaId],
  );
  assert.equal(depois, antes, 'nenhuma corrida pode ter sido gravada');
});

test('pedido dentro do envelope vira corrida e guarda a configuração que usou', async (t) => {
  const pool = poolApp();
  t.after(() => pool.end());
  const lojistaId = await lojistaApto(pool);

  const { corrida } = await criaCorrida(pool, {
    autorTipo: 'lojista',
    autorId: lojistaId,
    payload: { mercadoria_centavos: 10000, frete_centavos: 1000 },
    chaveIdempotencia: randomUUID(),
  });
  assert.equal(Number(corrida.mercadoria_centavos), 10000);
  assert.ok(corrida.configuracao_taxa_id, 'a corrida tem que guardar a configuração — auditoria');

  const { rows } = await pool.query(
    'SELECT id FROM configuracoes_taxa WHERE id = $1', [corrida.configuracao_taxa_id],
  );
  assert.equal(rows.length, 1, 'a configuração gravada tem que existir');
});

// ------------------------------------ 6. configuração publicada é imutável

test('a aplicação não altera, não apaga e não publica configuração (Lei 9: sem janela)', async (t) => {
  const app = await conectaApp();
  t.after(() => app.end());

  for (const sql of [
    'UPDATE configuracoes_taxa SET comissao_bps = 1',
    'DELETE FROM configuracoes_taxa',
    `INSERT INTO configuracoes_taxa
       (rotulo, gateway, comissao_bps, taxa_percentual_bps, portador_taxa_percentual,
        frete_minimo_centavos, mercadoria_maxima_centavos)
     VALUES ('app','x',500,119,'lojista',500,50000)`,
  ]) {
    const erro = await esperaErro(app, sql);
    assert.match(String(erro.message), /permissão|permission/i, `deveria faltar permissão: ${sql}`);
  }
});

test('publicações simultâneas não deixam a vigente ambígua', async (t) => {
  const dono = await conectaDono();
  t.after(() => dono.end());

  // ordem_publicacao é IDENTITY: monotônica e única mesmo com inserções
  // concorrentes. Sem ela o desempate cairia em timestamp, que empata.
  const ids = await Promise.all(Array.from({ length: 12 }, () => publica(dono)));
  const { rows } = await dono.query(
    'SELECT id, ordem_publicacao FROM configuracoes_taxa WHERE id = ANY($1)', [ids],
  );
  const ordens = rows.map((r) => Number(r.ordem_publicacao));
  assert.equal(new Set(ordens).size, ordens.length, 'ordem_publicacao repetiu');

  // E a leitura da vigente é determinística: a de maior ordem_publicacao
  // entre as não-exemplo, ou entre todas se só houver exemplo.
  const vigente = await configuracaoVigente(dono);
  const { rows: [esperada] } = await dono.query(
    `SELECT id FROM configuracoes_taxa
     ORDER BY (NOT exemplo) DESC, ordem_publicacao DESC LIMIT 1`,
  );
  assert.equal(vigente.id, esperada.id);
});
