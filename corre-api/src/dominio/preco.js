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
//   partir do CENTRO DA ÚLTIMA ZONA (seção 8), com os fatores metros/grau
//   gravados como dado inteiro na versão da tabela.
// - Arredondamento num lugar só (regra 5): a distância é medida em
//   metros×1e6 e só é cortada UMA vez, no teto de km. Não há piso por eixo
//   antes disso — piso antes do teto cobraria por MENOS distância do que a
//   real.
// - Fronteira/sobreposição resolvem por MENOR ordem (ver resolveZona).

const { ErroDeDominio, CODIGOS } = require('./erros');

// REGRA DE ARREDONDAMENTO DECLARADA (regra 5), num lugar só: metros→km
// SEMPRE PARA CIMA (teto). É o ÚNICO arredondamento do caminho. A distância
// trafega em metros×1e6 (escala fina) até aqui.
const METROS_POR_KM_E6 = 1_000_000_000n; // 1000 m/km × 1e6

function kmTeto(distanciaEscaladaE6) {
  const d = BigInt(distanciaEscaladaE6);
  return (d + METROS_POR_KM_E6 - 1n) / METROS_POR_KM_E6;
}

// Raiz quadrada inteira (piso), em BigInt — sem Math.sqrt (float). Como
// opera sobre metros×1e6, o piso é sub-micrométrico e nunca cruza a
// fronteira de km sozinho; o teto acima é quem decide o balde de km.
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

// Distância em metros×1e6 (um único piso, em isqrt). Aproximação planar
// local: cada eixo em escala cheia (graus×1e6 · metros/grau = metros×1e6),
// Pitágoras e raiz inteira. Sem trigonometria, sem float.
function distanciaEscalada({
  latE6, lngE6, centroLatE6, centroLngE6, metrosPorGrauLat, metrosPorGrauLng,
}) {
  const aLat = BigInt(latE6 - centroLatE6) * BigInt(metrosPorGrauLat);
  const aLng = BigInt(lngE6 - centroLngE6) * BigInt(metrosPorGrauLng);
  return isqrt(aLat * aLat + aLng * aLng);
}

// Centavos cabem folgadamente em 53 bits para qualquer frete real; ainda
// assim, nunca deixe um valor acima do inteiro seguro virar Number em
// silêncio (perderia centavo) — sobe (nada de erro engolido).
function paraCentavosNumero(bigints) {
  const bi = BigInt(bigints);
  if (bi > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`frete acima do inteiro seguro (${bi} centavos)`);
  }
  return Number(bi);
}

// ------------------------------------------------------------- resolução

function pontoNaZona(zona, latE6, lngE6) {
  return latE6 >= zona.lat_min_e6 && latE6 <= zona.lat_max_e6
    && lngE6 >= zona.lng_min_e6 && lngE6 <= zona.lng_max_e6;
}

async function carregaTabela(pool, tabelaId) {
  const { rows: [tabela] } = await pool.query(
    `SELECT id, rotulo, exemplo, metros_por_grau_lat, metros_por_grau_lng, adicional_km_centavos
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

// Centro da "última zona" (seção 8): a de maior ordem. Como zonas vem
// ordenada por ordem asc, é a última. Ponto médio inteiro do retângulo.
function centroDaUltimaZona(zonas) {
  const ultima = zonas[zonas.length - 1];
  return {
    centroLatE6: Number((BigInt(ultima.lat_min_e6) + BigInt(ultima.lat_max_e6)) / 2n),
    centroLngE6: Number((BigInt(ultima.lng_min_e6) + BigInt(ultima.lng_max_e6)) / 2n),
  };
}

// Calcula o frete para um ponto, numa versão específica da tabela. Dentro
// de zona: preço da zona. Fora de todas: zona mais cara + adicional por km
// em linha reta a partir do centro da última zona (regra 3). Tudo em
// centavos, BigInt no caminho todo.
async function calculaFrete(pool, { tabelaId, latE6, lngE6 }) {
  if (!Number.isInteger(latE6) || !Number.isInteger(lngE6)) {
    throw new ErroDeDominio(
      CODIGOS.COORDENADA_INVALIDA,
      'coordenadas precisam ser graus × 1e6 inteiros',
    );
  }
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
      frete_centavos: paraCentavosNumero(BigInt(zona.preco_centavos)),
    };
  }

  // Fora de zona: zona mais cara desta versão + adicional por km (teto),
  // distância a partir do centro da última zona.
  const maisCaraCentavos = zonas.reduce(
    (max, z) => (BigInt(z.preco_centavos) > max ? BigInt(z.preco_centavos) : max),
    0n,
  );
  const { centroLatE6, centroLngE6 } = centroDaUltimaZona(zonas);
  const dist = distanciaEscalada({
    latE6,
    lngE6,
    centroLatE6,
    centroLngE6,
    metrosPorGrauLat: tabela.metros_por_grau_lat,
    metrosPorGrauLng: tabela.metros_por_grau_lng,
  });
  const km = kmTeto(dist);
  const total = maisCaraCentavos + km * BigInt(tabela.adicional_km_centavos);

  return {
    tabela_preco_id: tabela.id,
    zona_nome: null,
    dentro_de_zona: false,
    distancia_km: Number(km),
    frete_centavos: paraCentavosNumero(total),
  };
}

module.exports = {
  calculaFrete,
  resolveZona,
  distanciaEscalada,
  kmTeto,
  isqrt,
  tabelaVigente,
  carregaTabela,
};
