'use strict';

// Motor de preço (Etapa 3). Matriz de zonas versionada, resolução de
// endereço para zona, cálculo do frete.
//
// Invariantes:
// - Dinheiro é inteiro em centavos (Lei 1). NENHUM ponto flutuante em
//   nenhuma etapa do cálculo, incluindo o adicional por km — tudo BigInt.
// - Determinismo (regra 2): mesma consulta, mesmo centavo, sempre. Não há
//   relógio, aleatório ou parâmetro de tempo no cálculo (regra 6).
// - Sem API externa (regra 3): fora de zona é distância em LINHA RETA a
//   partir do centro da tabela, com os fatores metros/grau gravados como
//   dado inteiro na versão da tabela.
// - Fronteira/sobreposição resolvem por MENOR ordem (regra declarada, ver
//   resolveZona) — nunca aleatório.

const { ErroDeDominio, CODIGOS } = require('./erros');

// -------------------------------------------------------- arredondamento
//
// REGRA DE ARREDONDAMENTO DECLARADA (regra 5), num lugar só:
// a distância em metros é convertida para km SEMPRE PARA CIMA (teto) — o
// cliente nunca paga por menos distância do que a real. Todo o resto do
// cálculo é inteiro por construção (centavos), sem qualquer arredondamento
// adicional. Usada em todo lugar que precise de km.
function kmTetoDeMetros(metros) {
  const m = BigInt(metros);
  const MIL = 1000n;
  // teto da divisão inteira, sem float.
  return (m + MIL - 1n) / MIL;
}

// Raiz quadrada inteira (piso), em BigInt — sem Math.sqrt (float).
function isqrt(valor) {
  const n = BigInt(valor);
  if (n < 0n) throw new Error('isqrt de negativo');
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

// Distância em metros (inteiro), aproximação planar local: converte cada
// eixo para metros com o fator inteiro da tabela e aplica Pitágoras com
// raiz inteira. Sem trigonometria, sem float.
function distanciaMetros({
  latE6, lngE6, centroLatE6, centroLngE6, metrosPorGrauLat, metrosPorGrauLng,
}) {
  const dLat = BigInt(latE6 - centroLatE6); // em graus × 1e6
  const dLng = BigInt(lngE6 - centroLngE6);
  const E6 = 1_000_000n;
  const metrosLat = (dLat * BigInt(metrosPorGrauLat)) / E6;
  const metrosLng = (dLng * BigInt(metrosPorGrauLng)) / E6;
  return isqrt(metrosLat * metrosLat + metrosLng * metrosLng);
}

// ------------------------------------------------------------- resolução

function pontoNaZona(zona, latE6, lngE6) {
  return latE6 >= zona.lat_min_e6 && latE6 <= zona.lat_max_e6
    && lngE6 >= zona.lng_min_e6 && lngE6 <= zona.lng_max_e6;
}

async function carregaTabela(pool, tabelaId) {
  const { rows: [tabela] } = await pool.query(
    `SELECT id, rotulo, exemplo, centro_lat_e6, centro_lng_e6,
            metros_por_grau_lat, metros_por_grau_lng, adicional_km_centavos
     FROM tabelas_preco WHERE id = $1`,
    [tabelaId],
  );
  if (!tabela) {
    throw new ErroDeDominio(CODIGOS.TABELA_PRECO_INEXISTENTE, `tabela de preço ${tabelaId} não existe`);
  }
  const { rows: zonas } = await pool.query(
    `SELECT nome, ordem, preco_centavos, lat_min_e6, lat_max_e6, lng_min_e6, lng_max_e6
     FROM zonas WHERE tabela_id = $1 ORDER BY ordem`,
    [tabelaId],
  );
  return { tabela, zonas };
}

// A versão vigente é a última publicada e NÃO de exemplo; em dev/teste, se
// só houver exemplo, usa a última publicada (marcada exemplo).
async function tabelaVigente(pool) {
  const { rows } = await pool.query(
    `SELECT id FROM tabelas_preco
     ORDER BY (NOT exemplo) DESC, publicada_em DESC, criado_em DESC
     LIMIT 1`,
  );
  if (rows.length === 0) {
    throw new ErroDeDominio(CODIGOS.TABELA_PRECO_INEXISTENTE, 'nenhuma tabela de preço publicada');
  }
  return rows[0].id;
}

// Resolve o ponto para uma zona. REGRA DE FRONTEIRA/SOBREPOSIÇÃO DECLARADA:
// as zonas são testadas em ordem crescente de `ordem` e vence a PRIMEIRA que
// contém o ponto (menor ordem). Retângulos inclusivos nas duas bordas, então
// um ponto exatamente na fronteira entre duas zonas cai sempre na de menor
// ordem — determinístico, nunca aleatório.
function resolveZona(zonas, latE6, lngE6) {
  for (const zona of zonas) {
    if (pontoNaZona(zona, latE6, lngE6)) return zona;
  }
  return null;
}

// Calcula o frete para um ponto, numa versão específica da tabela.
// Dentro de zona: preço da zona. Fora de todas: zona mais cara + adicional
// por km em linha reta a partir do centro (regra 3). Tudo em centavos,
// BigInt no caminho todo; devolve Number seguro no fim (cabe em 53 bits).
async function calculaFrete(pool, { tabelaId, latE6, lngE6 }) {
  const alvo = tabelaId || await tabelaVigente(pool);
  const { tabela, zonas } = await carregaTabela(pool, alvo);
  if (zonas.length === 0) {
    throw new ErroDeDominio(CODIGOS.TABELA_PRECO_INEXISTENTE, 'tabela de preço sem zonas');
  }

  const zona = resolveZona(zonas, latE6, lngE6);
  if (zona) {
    return {
      tabela_preco_id: tabela.id,
      zona_nome: zona.nome,
      dentro_de_zona: true,
      distancia_km: 0,
      frete_centavos: Number(BigInt(zona.preco_centavos)),
    };
  }

  // Fora de zona: zona mais cara desta versão + adicional por km (teto).
  const maisCaraCentavos = zonas.reduce(
    (max, z) => (BigInt(z.preco_centavos) > max ? BigInt(z.preco_centavos) : max),
    0n,
  );
  const metros = distanciaMetros({
    latE6,
    lngE6,
    centroLatE6: tabela.centro_lat_e6,
    centroLngE6: tabela.centro_lng_e6,
    metrosPorGrauLat: tabela.metros_por_grau_lat,
    metrosPorGrauLng: tabela.metros_por_grau_lng,
  });
  const km = kmTetoDeMetros(metros);
  const adicional = km * BigInt(tabela.adicional_km_centavos);
  const total = maisCaraCentavos + adicional;

  return {
    tabela_preco_id: tabela.id,
    zona_nome: null,
    dentro_de_zona: false,
    distancia_km: Number(km),
    frete_centavos: Number(total),
  };
}

module.exports = {
  calculaFrete,
  resolveZona,
  distanciaMetros,
  kmTetoDeMetros,
  isqrt,
  tabelaVigente,
  carregaTabela,
};
