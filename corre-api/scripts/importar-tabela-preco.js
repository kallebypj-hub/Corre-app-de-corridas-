#!/usr/bin/env node
// Importa uma versão da tabela de preço a partir de um arquivo JSON.
// Publicar versões é ato de dono (corre_dono), nunca da aplicação — versão
// publicada é imutável; alterar preço = importar uma versão nova.
//
// Uso: DATABASE_URL=... node scripts/importar-tabela-preco.js <arquivo.json>
// Sem argumento, usa dados/tabela-preco-exemplo.json (marcada como exemplo).
'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

async function importar() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL não definido (importação roda como corre_dono)');
  }
  const arquivo = process.argv[2]
    || path.join(__dirname, '..', 'dados', 'tabela-preco-exemplo.json');
  const dados = JSON.parse(readFileSync(arquivo, 'utf8'));

  // A tabela real de Sobral tem DUAS colunas por anel — preço e minutos
  // (seção 8) —, e os minutos são exigidos aqui: versão sem eles é versão
  // que não calcula prazo, e o motor descobriria isso só na primeira corrida.
  for (const campo of [
    'rotulo', 'metros_por_grau_lat', 'metros_por_grau_lng', 'adicional_km_centavos',
    'tempo_base_coleta_minutos', 'adicional_km_minutos', 'zonas',
  ]) {
    if (dados[campo] === undefined) throw new Error(`campo ausente no arquivo: ${campo}`);
  }
  for (const chave of [
    'metros_por_grau_lat', 'metros_por_grau_lng', 'adicional_km_centavos',
    'tempo_base_coleta_minutos', 'adicional_km_minutos',
  ]) {
    if (!Number.isInteger(dados[chave])) {
      throw new Error(`${chave} precisa ser inteiro (sem ponto flutuante) — Lei 1`);
    }
  }
  for (const zona of dados.zonas) {
    for (const chave of [
      'preco_centavos', 'minutos', 'ordem', 'lat_min_e6', 'lat_max_e6', 'lng_min_e6', 'lng_max_e6',
    ]) {
      if (!Number.isInteger(zona[chave])) {
        throw new Error(`zona ${zona.nome}: ${chave} precisa ser inteiro`);
      }
    }
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const { rows: [tabela] } = await client.query(
      `INSERT INTO tabelas_preco
         (rotulo, exemplo, metros_por_grau_lat, metros_por_grau_lng, adicional_km_centavos,
          tempo_base_coleta_minutos, adicional_km_minutos, cidade_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               COALESCE($8, (SELECT id FROM cidades WHERE ibge = '2312908'))) RETURNING id`,
      [
        dados.rotulo,
        dados.exemplo !== false,
        dados.metros_por_grau_lat, dados.metros_por_grau_lng, dados.adicional_km_centavos,
        dados.tempo_base_coleta_minutos, dados.adicional_km_minutos,
        dados.cidade_id || null,
      ],
    );
    for (const zona of dados.zonas) {
      await client.query(
        `INSERT INTO zonas (tabela_id, nome, ordem, preco_centavos, minutos, lat_min_e6, lat_max_e6, lng_min_e6, lng_max_e6, cidade_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, (SELECT cidade_id FROM tabelas_preco WHERE id = $1))`,
        [tabela.id, zona.nome, zona.ordem, zona.preco_centavos, zona.minutos,
          zona.lat_min_e6, zona.lat_max_e6, zona.lng_min_e6, zona.lng_max_e6],
      );
    }
    await client.query('COMMIT');
    console.log(`tabela de preço importada: ${tabela.id} (${dados.zonas.length} zonas, exemplo=${dados.exemplo !== false})`);
  } catch (erro) {
    await client.query('ROLLBACK').catch((e) => console.error(`rollback falhou: ${e.message}`));
    throw erro;
  } finally {
    await client.end();
  }
}

importar().catch((erro) => {
  console.error(`importação falhou: ${erro.message}`);
  process.exit(1);
});
