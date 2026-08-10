'use strict';

const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

const { criaCorrida, transiciona } = require('../src/dominio/corridas');
const { cadastraLojista, registraCartao } = require('../src/dominio/contas');
const { emTransacao } = require('../src/dominio/nucleo');

// A cidade da bateria: Sobral, a cidade 1, com id fixo na migration 0010.
// Depois da Etapa 4 NENHUMA tabela por cidade se lê sem cidade declarada —
// um pool cru continua funcionando e continua CEGO, que é o certo.
const SOBRAL = '00000001-2312-4908-8000-000000000001';

function poolCru(max = 10) {
  if (!process.env.DATABASE_URL_APP) {
    throw new Error('DATABASE_URL_APP não definido — rode via scripts/bateria.sh');
  }
  return new Pool({ connectionString: process.env.DATABASE_URL_APP, max });
}

// Pool já amarrado a Sobral — é o que a maioria dos testes quer. Quem
// precisa do pool sem cidade (para provar que ele cega) usa `poolCru`.
function poolApp(max = 10, cidadeId = SOBRAL) {
  const cru = poolCru(max);
  return {
    cidadeId,
    cru,
    query: (texto, params) => emTransacao(cru, (c) => c.query(texto, params), { cidadeId }),
    connect: () => cru.connect(),
    end: () => cru.end(),
  };
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

// Corrida exige lojista real com cartão (Etapa 2): um por processo, criado
// sob demanda e compartilhado por todos os testes do arquivo.
let promessaLojista = null;
function lojistaApto(pool) {
  if (!promessaLojista) {
    promessaLojista = (async () => {
      const { conta } = await cadastraLojista(pool, {
        nome: 'Loja da Bateria',
        telefone: `88 8${String(process.pid % 1e7).padStart(7, '0')}-${randomUUID().slice(0, 8)}`,
      });
      await registraCartao(pool, { lojistaId: conta.id, cartaoRef: 'cartao-de-teste' });
      return conta.id;
    })();
  }
  return promessaLojista;
}

// Cria uma corrida nova e a leva até o estado pedido pelo caminho legal.
async function levaAte(pool, estadoAlvo, payloadInicial) {
  const caminho = CAMINHOS[estadoAlvo];
  if (!caminho) {
    throw new Error(`estado ${estadoAlvo} não é alcançável nesta etapa`);
  }
  let { corrida } = await criaCorrida(pool, {
    autorTipo: 'lojista',
    autorId: await lojistaApto(pool),
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
  poolCru,
  SOBRAL,
  AUTOR_PADRAO,
  CAMINHOS,
  autorIdPara,
  aplica,
  levaAte,
  lojistaApto,
  emParalelo,
};
