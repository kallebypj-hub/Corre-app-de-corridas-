'use strict';

const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

const { criaCorrida, transiciona } = require('../src/dominio/corridas');

function poolApp(max = 10) {
  if (!process.env.DATABASE_URL_APP) {
    throw new Error('DATABASE_URL_APP não definido — rode via scripts/bateria.sh');
  }
  return new Pool({ connectionString: process.env.DATABASE_URL_APP, max });
}

// Autor "natural" de cada tipo, para montar cenários.
const AUTOR_PADRAO = {
  criada: 'lojista',
  pagamento_confirmado: 'sistema',
  expirou: 'sistema',
  motoboy_aceitou: 'motoboy',
  cascata_esgotada: 'sistema',
  coleta_confirmada: 'motoboy',
  entrega_falhou: 'motoboy',
  pin_validado: 'motoboy',
  devolucao_concluida: 'motoboy',
  cancelada: 'painel',
};

function autorIdPara(autorTipo) {
  return autorTipo === 'sistema' ? null : randomUUID();
}

// Caminho legal até cada estado alcançável (6 não é alcançável nesta etapa
// — decisão do dono, 2026-08-09).
const CAMINHOS = {
  1: [],
  2: ['pagamento_confirmado'],
  3: ['pagamento_confirmado', 'motoboy_aceitou'],
  4: ['pagamento_confirmado', 'motoboy_aceitou', 'coleta_confirmada'],
  5: ['pagamento_confirmado', 'motoboy_aceitou', 'coleta_confirmada', 'entrega_falhou'],
  7: ['pagamento_confirmado', 'motoboy_aceitou', 'coleta_confirmada', 'pin_validado'],
  8: ['expirou'],
  9: ['pagamento_confirmado', 'cascata_esgotada'],
  10: ['cancelada'],
  11: ['pagamento_confirmado', 'motoboy_aceitou', 'coleta_confirmada', 'entrega_falhou', 'devolucao_concluida'],
};

async function aplica(pool, corridaId, tipo, sobrescreve = {}) {
  const autorTipo = sobrescreve.autorTipo || AUTOR_PADRAO[tipo];
  return transiciona(pool, {
    corridaId,
    tipo,
    autorTipo,
    autorId: autorIdPara(autorTipo),
    payload: sobrescreve.payload,
    chaveIdempotencia: sobrescreve.chaveIdempotencia,
  });
}

// Cria uma corrida nova e a leva até o estado pedido pelo caminho legal.
async function levaAte(pool, estadoAlvo, payloadInicial) {
  const caminho = CAMINHOS[estadoAlvo];
  if (!caminho) {
    throw new Error(`estado ${estadoAlvo} não é alcançável nesta etapa`);
  }
  let { corrida } = await criaCorrida(pool, {
    autorTipo: 'lojista',
    autorId: randomUUID(),
    payload: payloadInicial || { origem: 'bateria_etapa_1' },
  });
  for (const tipo of caminho) {
    const sobrescreve = tipo === 'cancelada' ? { autorTipo: 'lojista' } : {};
    ({ corrida } = await aplica(pool, corrida.id, tipo, sobrescreve));
  }
  return corrida;
}

// Fila simples de trabalho com concorrência limitada (para volume).
async function emParalelo(itens, limite, trabalho) {
  const resultados = new Array(itens.length);
  let proximo = 0;
  async function operario() {
    while (proximo < itens.length) {
      const indice = proximo;
      proximo += 1;
      resultados[indice] = await trabalho(itens[indice], indice);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, operario));
  return resultados;
}

module.exports = {
  poolApp,
  AUTOR_PADRAO,
  CAMINHOS,
  autorIdPara,
  aplica,
  levaAte,
  emParalelo,
};
