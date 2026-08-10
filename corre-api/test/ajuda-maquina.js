'use strict';

const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

const { criaCorrida, transiciona } = require('../src/dominio/corridas');
const {
  cadastraLojista, registraCartao, cadastraMotoboy, criaOperadorGenese,
} = require('../src/dominio/contas');
const { garanteCliente } = require('../src/dominio/clientes');
const { emTransacao } = require('../src/dominio/nucleo');
const { ErroDeDominio } = require('../src/dominio/erros');

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
  motoboy_aceitou: 'motoboy',
  cascata_esgotada: 'sistema',
  coleta_confirmada: 'motoboy',
  chegada_declarada: 'motoboy',
  retorno_sem_contato: 'motoboy',
  pagamento_confirmado: 'sistema',
  espera_vencida: 'motoboy',
  entrega_confirmada: 'motoboy',
  devolucao_concluida: 'motoboy',
  cancelada: 'painel',
};

// ATORES REAIS, e isto é o oposto do que estava aqui.
//
// Antes: `autorIdPara(tipo) { return tipo === 'sistema' ? null : randomUUID() }`
// — um UUID inventado por evento. O efeito não era ruído: os 232 testes
// gravavam eventos com autor que NÃO EXISTE, e a bateria virou GUARDIÃ do
// defeito. Exigir autor real quebrava a bateria inteira, e a pressão era
// afrouxar a correção em vez de consertar o auxiliar.
//
// Agora cada tipo tem uma conta de verdade, criada uma vez por processo e
// reaproveitada. O teste passa a exigir o comportamento certo.
const atores = new Map();

function digitoDeCpf(fatia, pesoInicial) {
  let soma = 0;
  for (let i = 0; i < fatia.length; i += 1) soma += Number(fatia[i]) * (pesoInicial - i);
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}
let contadorCpf = 0;
function cpfValido() {
  contadorCpf += 1;
  const base = String(process.pid % 1000).padStart(3, '0') + String(contadorCpf).padStart(6, '0');
  const d1 = digitoDeCpf(base, 10);
  return base + String(d1) + String(digitoDeCpf(base + String(d1), 11));
}

function telefoneNovo(prefixo) {
  return `${prefixo}${String(process.pid % 1e6).padStart(6, '0')}-${randomUUID().slice(0, 8)}`;
}

// O operador gênese é único no banco inteiro: quem chegar primeiro cria, os
// outros leem. É o mesmo padrão de `ajuda-contas.js`.
async function operadorReal(pool) {
  try {
    const { conta } = await criaOperadorGenese(pool, {
      nome: 'Operação da bateria', telefone: telefoneNovo('88 3'),
    });
    return conta.id;
  } catch (erro) {
    if (!(erro instanceof ErroDeDominio) || erro.codigo !== 'genese_ja_feita') throw erro;
    for (let tentativa = 0; tentativa < 50; tentativa += 1) {
      const { rows } = await pool.query('SELECT id FROM operadores WHERE genese');
      if (rows[0]) return rows[0].id;
      await new Promise((resolve) => { setTimeout(resolve, 100); });
    }
    throw new Error('gênese existe mas não apareceu na leitura');
  }
}

async function criaAtor(pool, tipo) {
  if (tipo === 'sistema') return null;
  if (tipo === 'lojista') return lojistaApto(pool);
  if (tipo === 'motoboy') {
    const cpf = cpfValido();
    const { conta } = await cadastraMotoboy(pool, {
      nome: 'Motoboy da bateria',
      telefone: telefoneNovo('88 9'),
      cpf,
      chavePix: cpf,
      cnhRef: 'cnh',
      crlvRef: 'crlv',
      selfieRef: 'selfie',
      aparelhoId: `aparelho-${randomUUID()}`,
    });
    return conta.id;
  }
  if (tipo === 'cliente') {
    const { cliente } = await garanteCliente(pool, {
      telefone: telefoneNovo('88 4'), lojistaId: await lojistaApto(pool),
    });
    return cliente.id;
  }
  if (tipo === 'painel') return operadorReal(pool);
  throw new Error(`tipo de ator desconhecido: ${tipo}`);
}

// Um ator por tipo, por processo. Quem precisa de DOIS atores do mesmo tipo
// (para provar que o alheio é recusado) chama `atorNovo`.
function atorPara(pool, autorTipo) {
  if (autorTipo === 'sistema') return null;
  if (!atores.has(autorTipo)) atores.set(autorTipo, criaAtor(pool, autorTipo));
  return atores.get(autorTipo);
}

function atorNovo(pool, autorTipo) {
  return criaAtor(pool, autorTipo);
}

// O mínimo que cada transição exige no payload para ser LEGAL. Só `levaAte`
// usa isto — `aplica` NÃO completa payload sozinha, senão os testes que
// provam a exigência (motivo em branco, caso ausente) passariam por engano.
const PAYLOAD_MINIMO = {
  retorno_sem_contato: { motivo: 'endereço não localizado' },
  espera_vencida: { caso: 'cliente_ausente' },
  cancelada: { motivo: 'cancelamento da bateria' },
};

// Caminho legal até cada estado alcançável. O 7 (em disputa) NÃO é
// alcançável: ele nasce sem aresta nenhuma até a Etapa 11 (seção 5).
const CAMINHOS = {
  1: [],
  2: ['motoboy_aceitou'],
  3: ['motoboy_aceitou', 'coleta_confirmada'],
  4: ['motoboy_aceitou', 'coleta_confirmada', 'chegada_declarada'],
  5: ['motoboy_aceitou', 'coleta_confirmada', 'chegada_declarada', 'pagamento_confirmado'],
  6: ['motoboy_aceitou', 'coleta_confirmada', 'retorno_sem_contato'],
  8: ['motoboy_aceitou', 'coleta_confirmada', 'chegada_declarada', 'pagamento_confirmado', 'entrega_confirmada'],
  9: ['cascata_esgotada'],
  10: ['cancelada'],
  11: ['motoboy_aceitou', 'coleta_confirmada', 'retorno_sem_contato', 'devolucao_concluida'],
};

async function aplica(pool, corridaId, tipo, sobrescreve = {}) {
  const autorTipo = sobrescreve.autorTipo || AUTOR_PADRAO[tipo];
  // Lei 11: lojista tem que ser O lojista da corrida. As corridas da bateria
  // nascem todas do mesmo lojista (`lojistaApto`), então é ele. Quem quiser
  // provar a RECUSA de um lojista alheio passa `autorId` explícito.
  const autorId = 'autorId' in sobrescreve
    ? sobrescreve.autorId
    : await atorPara(pool, autorTipo);
  return transiciona(pool, {
    corridaId,
    tipo,
    autorTipo,
    autorId,
    payload: sobrescreve.payload,
    chaveIdempotencia: sobrescreve.chaveIdempotencia,
    // 'sistema' só por caminho interno (Lei 11). A bateria monta cenário e
    // por isso o declara; quem prova a RECUSA passa `interno: false`.
    interno: 'interno' in sobrescreve ? sobrescreve.interno : autorTipo === 'sistema',
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
//
// A corrida nasce COM DESTINATÁRIO: `corridas.cliente_id` é o que decide, em
// `exigeVinculo`, se um 'cliente' pode movê-la. Enquanto a bateria criava
// corrida sem cliente nenhum, "cliente cancela no estado 1" (seção 5) passava
// por um caminho que não conferia vínculo — e passaria igual se o vínculo
// nunca tivesse sido escrito. Com o destinatário de verdade, o teste exerce
// a regra em vez de contorná-la; o cliente ALHEIO tem recusa própria.
async function levaAte(pool, estadoAlvo, payloadInicial) {
  const caminho = CAMINHOS[estadoAlvo];
  if (!caminho) {
    throw new Error(`estado ${estadoAlvo} não é alcançável nesta etapa`);
  }
  const base = payloadInicial || { origem: 'bateria_etapa_1' };
  let { corrida } = await criaCorrida(pool, {
    autorTipo: 'lojista',
    autorId: await lojistaApto(pool),
    payload: 'cliente_id' in base ? base : { ...base, cliente_id: await atorPara(pool, 'cliente') },
  });
  for (const tipo of caminho) {
    // Cancelar a partir do estado 1 é livre (seção 5) e é o caminho mais
    // curto até o 10; dali em diante exige operação e motivo.
    const sobrescreve = tipo === 'cancelada' ? { autorTipo: 'lojista' } : {};
    if (PAYLOAD_MINIMO[tipo]) sobrescreve.payload = { ...PAYLOAD_MINIMO[tipo] };
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
  PAYLOAD_MINIMO,
  atorPara,
  atorNovo,
  aplica,
  levaAte,
  lojistaApto,
  emParalelo,
};
