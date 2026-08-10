'use strict';

// Publicação de versões de tabela de preço para a bateria. Publicar é ato de
// DONO (a aplicação só tem SELECT), então tudo aqui roda com `dono`.
//
// Desde a Etapa 5 a versão carrega preço E prazo: minutos por anel, tempo
// base de coleta da cidade e minutos por km adicional (seção 8). Publicar
// versão sem os minutos é impossível — o banco recusa.

const { SOBRAL } = require('./ajuda-maquina');

async function publicaTabela(dono, {
  rotulo,
  adicionalKmCentavos = 150,
  tempoBaseColetaMinutos = 10,
  adicionalKmMinutos = 3,
  zonas,
  exemplo = true,
  metrosPorGrauLat = 111320,
  metrosPorGrauLng = 111100,
  cidadeId = SOBRAL,
}) {
  const { rows: [tabela] } = await dono.query(
    `INSERT INTO tabelas_preco
       (rotulo, exemplo, metros_por_grau_lat, metros_por_grau_lng, adicional_km_centavos,
        tempo_base_coleta_minutos, adicional_km_minutos, cidade_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      rotulo, exemplo, metrosPorGrauLat, metrosPorGrauLng, adicionalKmCentavos,
      tempoBaseColetaMinutos, adicionalKmMinutos, cidadeId,
    ],
  );
  for (const z of zonas) {
    await dono.query(
      `INSERT INTO zonas (tabela_id, nome, ordem, preco_centavos, minutos, lat_min_e6, lat_max_e6, lng_min_e6, lng_max_e6, cidade_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [tabela.id, z.nome, z.ordem, z.preco, z.minutos, z.latMin, z.latMax, z.lngMin, z.lngMax, cidadeId],
    );
  }
  return tabela.id;
}

// Três zonas aninhadas (centro dentro do anel 1 dentro do anel 2), como a
// tabela de exemplo. Menor ordem vence na sobreposição/fronteira.
// Os minutos crescem para fora, que é o caso normal — e é o que faz o
// `max(origem, destino)` ter efeito observável nos testes.
const ZONAS = [
  { nome: 'Centro', ordem: 0, preco: 500, minutos: 8, latMin: -3690000, latMax: -3682000, lngMin: -40353000, lngMax: -40345000 },
  { nome: 'Anel 1', ordem: 1, preco: 700, minutos: 14, latMin: -3700000, latMax: -3672000, lngMin: -40363000, lngMax: -40335000 },
  { nome: 'Anel 2', ordem: 2, preco: 900, minutos: 22, latMin: -3720000, latMax: -3652000, lngMin: -40383000, lngMax: -40315000 },
];

// Pontos que caem em cada zona (os mesmos que a bateria de preço usa).
const PONTOS = {
  centro: { latE6: -3686000, lngE6: -40349000 },
  anel1: { latE6: -3686000, lngE6: -40340000 },
  anel2: { latE6: -3686000, lngE6: -40320000 },
  foraDeZona: { latE6: -3686000, lngE6: -40300000 },
};

module.exports = { publicaTabela, ZONAS, PONTOS };
