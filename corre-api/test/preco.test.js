'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Pool } = require('pg');

const { calculaFrete } = require('../src/dominio/preco');
const { poolApp, SOBRAL } = require('./ajuda-maquina');

const executa = promisify(execFile);
const IMPORTADOR = path.join(__dirname, '..', 'scripts', 'importar-tabela-preco.js');

// Publica uma versão de tabela de preço como dono (publicar é ato de dono).
async function publicaTabela(dono, {
  rotulo, adicionalKmCentavos = 150, zonas, exemplo = true,
  metrosPorGrauLat = 111320, metrosPorGrauLng = 111100,
}) {
  const { rows: [tabela] } = await dono.query(
    `INSERT INTO tabelas_preco
       (rotulo, exemplo, metros_por_grau_lat, metros_por_grau_lng, adicional_km_centavos, cidade_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [rotulo, exemplo, metrosPorGrauLat, metrosPorGrauLng, adicionalKmCentavos, SOBRAL],
  );
  for (const z of zonas) {
    await dono.query(
      `INSERT INTO zonas (tabela_id, nome, ordem, preco_centavos, lat_min_e6, lat_max_e6, lng_min_e6, lng_max_e6, cidade_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [tabela.id, z.nome, z.ordem, z.preco, z.latMin, z.latMax, z.lngMin, z.lngMax, SOBRAL],
    );
  }
  return tabela.id;
}

// Três zonas aninhadas (centro dentro do anel 1 dentro do anel 2), como a
// tabela de exemplo. Menor ordem vence na sobreposição/fronteira.
const ZONAS = [
  { nome: 'Centro', ordem: 0, preco: 500, latMin: -3690000, latMax: -3682000, lngMin: -40353000, lngMax: -40345000 },
  { nome: 'Anel 1', ordem: 1, preco: 700, latMin: -3700000, latMax: -3672000, lngMin: -40363000, lngMax: -40335000 },
  { nome: 'Anel 2', ordem: 2, preco: 900, latMin: -3720000, latMax: -3652000, lngMin: -40383000, lngMax: -40315000 },
];

test('motor de preço (Etapa 3)', async (t) => {
  const pool = poolApp();
  const dono = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  t.after(async () => {
    await pool.end();
    await dono.end();
  });

  const tabelaId = await publicaTabela(dono, { rotulo: `t1-${process.pid}`, zonas: ZONAS });

  await t.test('endereço em cada zona devolve o preço daquela zona', async () => {
    // Ponto só do Centro (centro dos retângulos).
    const centro = await calculaFrete(pool, { tabelaId, latE6: -3686000, lngE6: -40349000 });
    assert.equal(centro.zona_nome, 'Centro');
    assert.equal(centro.frete_centavos, 500);

    // Ponto no Anel 1 mas fora do Centro (lng além do centro, dentro do anel1).
    const anel1 = await calculaFrete(pool, { tabelaId, latE6: -3686000, lngE6: -40340000 });
    assert.equal(anel1.zona_nome, 'Anel 1');
    assert.equal(anel1.frete_centavos, 700);

    // Ponto no Anel 2 mas fora do Anel 1.
    const anel2 = await calculaFrete(pool, { tabelaId, latE6: -3686000, lngE6: -40320000 });
    assert.equal(anel2.zona_nome, 'Anel 2');
    assert.equal(anel2.frete_centavos, 900);
  });

  await t.test('mesma consulta 1.000 vezes devolve exatamente o mesmo centavo (determinismo)', async () => {
    // Dentro e fora de zona: nada de relógio/aleatório no cálculo (regra 6).
    const dentro = { tabelaId, latE6: -3686000, lngE6: -40349000 };
    const fora = { tabelaId, latE6: -3600000, lngE6: -40349000 };
    const baseDentro = await calculaFrete(pool, dentro);
    const baseFora = await calculaFrete(pool, fora);
    for (let i = 0; i < 1000; i += 1) {
      const d = await calculaFrete(pool, dentro);
      const f = await calculaFrete(pool, fora);
      assert.equal(d.frete_centavos, baseDentro.frete_centavos);
      assert.equal(f.frete_centavos, baseFora.frete_centavos);
    }
    assert.equal(baseDentro.frete_centavos, 500);
    assert.equal(baseFora.frete_centavos, 2400);
  });

  await t.test('fora de todas as zonas: zona mais cara + adicional por km em linha reta (valor exato)', async () => {
    // Bem ao norte de todas as zonas.
    const fora = await calculaFrete(pool, { tabelaId, latE6: -3600000, lngE6: -40349000 });
    assert.equal(fora.dentro_de_zona, false);
    assert.equal(fora.zona_nome, null);
    // Distância: Δlat = 86000 e6 → metros = 86000*111320/1e6 = 9573 m (floor);
    // km teto = ceil(9573/1000) = 10; adicional = 10*150 = 1500; mais cara = 900.
    assert.equal(fora.distancia_km, 10);
    assert.equal(fora.frete_centavos, 900 + 1500);
    assert.ok(Number.isInteger(fora.frete_centavos));
  });

  await t.test('fora de zona em DIAGONAL (dLng≠0), soma não-quadrado-perfeito: valor exato', async () => {
    // Centro = ponto médio da última zona (Anel 2) = (-3686000, -40349000).
    // dLat=86000, dLng=49000 → dist²=(86000·111320)²+(49000·111100)² não é
    // quadrado perfeito; km teto = 12; frete = 900 + 12·150 = 2700.
    const r = await calculaFrete(pool, { tabelaId, latE6: -3600000, lngE6: -40300000 });
    assert.equal(r.dentro_de_zona, false);
    assert.equal(r.distancia_km, 12);
    assert.equal(r.frete_centavos, 2700);
    assert.ok(Number.isInteger(r.frete_centavos));
  });

  await t.test('ponto logo acima do múltiplo de km: teto cobra o km cheio, sem piso por eixo', async () => {
    // dLat=35933 → distância real ≈ 4000,07 m (acima de 4 km). Com o teto
    // único a distância vira 5 km (1650). Um piso por eixo antes do teto
    // truncaria para 4 km (1500) — cobrando a MENOS que a distância real.
    const r = await calculaFrete(pool, { tabelaId, latE6: -3650067, lngE6: -40349000 });
    assert.equal(r.dentro_de_zona, false);
    assert.equal(r.distancia_km, 5);
    assert.equal(r.frete_centavos, 1650);
  });

  await t.test('adicional por km arredonda para CIMA (teto), regra declarada', async () => {
    // -3646000 está fora do anel 2 (lat_max = -3652000). Δlat do centro
    // (-3686000) = 40000 e6 → metros = 40000*111320/1e6 = 4452 (floor) →
    // km teto = ceil(4452/1000) = 5 (o piso daria 4; a regra é teto).
    const r = await calculaFrete(pool, { tabelaId, latE6: -3646000, lngE6: -40349000 });
    assert.equal(r.dentro_de_zona, false);
    assert.equal(r.distancia_km, 5);
    assert.equal(r.frete_centavos, 900 + 5 * 150);
  });

  await t.test('fronteira entre zonas resolve de forma determinística e documentada (menor ordem vence)', async () => {
    // Canto exato compartilhado: lat_max/lng_max do Centro é ponto do Centro
    // e também do Anel 1 (aninhado). Menor ordem (Centro) vence, sempre.
    const fronteira = { tabelaId, latE6: -3682000, lngE6: -40345000 };
    for (let i = 0; i < 200; i += 1) {
      const r = await calculaFrete(pool, fronteira);
      assert.equal(r.zona_nome, 'Centro');
      assert.equal(r.frete_centavos, 500);
    }
  });

  await t.test('nova versão da tabela não altera o preço de uma corrida em versão antiga', async () => {
    const antigo = await calculaFrete(pool, { tabelaId, latE6: -3686000, lngE6: -40349000 });
    assert.equal(antigo.frete_centavos, 500);

    // Publica versão nova, com o Centro mais caro.
    const zonasNovas = ZONAS.map((z) => (z.nome === 'Centro' ? { ...z, preco: 999 } : z));
    const novaId = await publicaTabela(dono, { rotulo: `t2-${process.pid}`, zonas: zonasNovas });

    const naNova = await calculaFrete(pool, { tabelaId: novaId, latE6: -3686000, lngE6: -40349000 });
    assert.equal(naNova.frete_centavos, 999, 'a versão nova cobra o preço novo');

    // A versão antiga, consultada explicitamente, segue com o preço antigo.
    const naAntiga = await calculaFrete(pool, { tabelaId, latE6: -3686000, lngE6: -40349000 });
    assert.equal(naAntiga.frete_centavos, 500, 'a versão antiga não muda');
  });

  await t.test('zero chamadas de rede externas durante o cálculo', async () => {
    const fetchOriginal = global.fetch;
    const httpReq = http.request;
    const httpsReq = https.request;
    const proibir = () => { throw new Error('chamada de rede externa proibida no cálculo de preço'); };
    global.fetch = proibir;
    http.request = proibir;
    https.request = proibir;
    try {
      const r = await calculaFrete(pool, { tabelaId, latE6: -3600000, lngE6: -40349000 });
      assert.equal(r.frete_centavos, 900 + 1500);
    } finally {
      global.fetch = fetchOriginal;
      http.request = httpReq;
      https.request = httpsReq;
    }
  });

  await t.test('tabela vigente: versão real (exemplo=false) vence a de exemplo; calculaFrete sem tabelaId usa a vigente', async () => {
    // Publica uma versão REAL depois da de exemplo; a vigente passa a ser a real.
    const real = await publicaTabela(dono, {
      rotulo: `real-${process.pid}`,
      exemplo: false,
      zonas: ZONAS.map((z) => (z.nome === 'Centro' ? { ...z, preco: 555 } : z)),
    });
    const vigente = await require('../src/dominio/preco').tabelaVigente(pool);
    assert.equal(vigente, real, 'a versão real (não-exemplo) vence a de exemplo');

    const semTabela = await calculaFrete(pool, { latE6: -3686000, lngE6: -40349000 });
    assert.equal(semTabela.tabela_preco_id, real);
    assert.equal(semTabela.frete_centavos, 555);
  });

  await t.test('coordenada não inteira é recusada como erro de domínio, não erro cru', async () => {
    const { ErroDeDominio } = require('../src/dominio/erros');
    await assert.rejects(
      () => calculaFrete(pool, { tabelaId, latE6: -3686000.5, lngE6: -40349000 }),
      (erro) => erro instanceof ErroDeDominio && erro.codigo === 'coordenada_invalida',
    );
  });

  await t.test('frete é sempre inteiro em centavos (Lei 1) — dentro e fora de zona', async () => {
    for (const ponto of [
      { latE6: -3686000, lngE6: -40349000 },
      { latE6: -3600000, lngE6: -40349000 },
      { latE6: -3642000, lngE6: -40349000 },
    ]) {
      const r = await calculaFrete(pool, { tabelaId, ...ponto });
      assert.ok(Number.isInteger(r.frete_centavos), `frete não inteiro: ${r.frete_centavos}`);
    }
  });
});

test('importação da tabela de exemplo (caminho real de carga)', async (t) => {
  const pool = poolApp();
  t.after(() => pool.end());

  await t.test('o importador carrega a tabela de exemplo, marcada como exemplo', async () => {
    // Roda o script de importação de verdade (como o dono faria), com o
    // arquivo de exemplo padrão.
    const { stdout } = await executa('node', [IMPORTADOR], {
      env: { ...process.env },
      timeout: 30_000,
    });
    assert.match(stdout, /tabela de preço importada/);
    assert.match(stdout, /exemplo=true/);

    const { rows: [tabela] } = await pool.query(
      "SELECT id, exemplo FROM tabelas_preco WHERE rotulo = 'exemplo-v1' ORDER BY criado_em DESC LIMIT 1",
    );
    assert.ok(tabela, 'tabela de exemplo carregada');
    assert.equal(tabela.exemplo, true, 'marcada como exemplo (regra 7)');

    const { rows: [{ n }] } = await pool.query(
      'SELECT count(*)::int AS n FROM zonas WHERE tabela_id = $1', [tabela.id],
    );
    assert.equal(n, 3, 'as 3 zonas de exemplo foram carregadas');

    // E o motor calcula sobre a tabela recém-importada.
    const centro = await calculaFrete(pool, { tabelaId: tabela.id, latE6: -3686000, lngE6: -40349000 });
    assert.equal(centro.frete_centavos, 500);
  });
});
