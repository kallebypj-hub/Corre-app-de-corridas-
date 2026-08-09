'use strict';

// Motor da máquina de estados da corrida.
//
// Garantias e onde elas moram:
// - Legalidade da transição: só na tabela declarativa (transicoes.js).
// - Um vencedor por posição do log: UNIQUE (agregado_tipo, agregado_id, seq)
//   no banco. O código NÃO serializa (sem SELECT FOR UPDATE) de propósito —
//   a constraint é a garantia (Lei 4), não a verificação em código.
// - Idempotência: UNIQUE em eventos.chave_idempotencia (Lei 5). Repetir a
//   mesma operação com a mesma chave devolve o resultado original.
// - Tempo: sempre do servidor de banco (now()); payload com instante do
//   cliente é recusado (regra 3 da Etapa 1).

const { randomUUID } = require('node:crypto');

const E = require('./estados');
const { TRANSICOES } = require('./transicoes');
const { ErroDeDominio, CODIGOS } = require('./erros');

const AGREGADO = 'corrida';
const CHAVES_DO_SERVIDOR = ['vence_em', 'criado_em'];

function higienizaPayload(payload) {
  const dado = payload === undefined || payload === null ? {} : payload;
  if (typeof dado !== 'object' || Array.isArray(dado)) {
    throw new ErroDeDominio(CODIGOS.TEMPO_DO_CLIENTE, 'payload precisa ser objeto');
  }
  for (const chave of CHAVES_DO_SERVIDOR) {
    if (chave in dado) {
      throw new ErroDeDominio(
        CODIGOS.TEMPO_DO_CLIENTE,
        `tempo é do servidor: payload não pode trazer "${chave}"`,
      );
    }
  }
  return dado;
}

function regraDe(tipo) {
  const regra = TRANSICOES[tipo];
  if (!regra) {
    throw new ErroDeDominio(CODIGOS.TIPO_DESCONHECIDO, `transição desconhecida: ${tipo}`);
  }
  return regra;
}

function validaTransicao({ tipo, estadoAtual, autorTipo, payload }) {
  const regra = regraDe(tipo);
  if (!regra.de.includes(estadoAtual)) {
    const nome = estadoAtual === null ? '∅' : E.NOMES[estadoAtual];
    throw new ErroDeDominio(
      CODIGOS.TRANSICAO_ILEGAL,
      `transição ilegal: ${tipo} a partir de ${nome}`,
    );
  }
  const autorizados = regra.autorizados[String(estadoAtual)];
  if (!autorizados || !autorizados.includes(autorTipo)) {
    throw new ErroDeDominio(
      CODIGOS.AUTOR_NAO_AUTORIZADO,
      `${autorTipo} não pode aplicar ${tipo} a partir de ${estadoAtual === null ? '∅' : E.NOMES[estadoAtual]}`,
    );
  }
  if (
    regra.exigeMotivoNasOrigens
    && regra.exigeMotivoNasOrigens.includes(estadoAtual)
    && !(typeof payload.motivo === 'string' && payload.motivo.trim() !== '')
  ) {
    throw new ErroDeDominio(
      CODIGOS.MOTIVO_OBRIGATORIO,
      `${tipo} a partir de ${E.NOMES[estadoAtual]} exige motivo registrado`,
    );
  }
  return regra;
}

// Vencimento do estado que a transição abre, calculado com o relógio do
// SERVIDOR de banco — nunca com instante vindo do cliente.
function calculaVenceEm(regra, agora) {
  if (!regra.prazoDoDestinoMs) return null;
  return new Date(agora.getTime() + regra.prazoDoDestinoMs());
}

async function emTransacao(pool, trabalho) {
  const conexao = await pool.connect();
  try {
    await conexao.query('BEGIN');
    try {
      const resultado = await trabalho(conexao);
      await conexao.query('COMMIT');
      return resultado;
    } catch (erro) {
      try {
        await conexao.query('ROLLBACK');
      } catch (erroRollback) {
        console.error(`rollback falhou: ${erroRollback.message}`);
      }
      throw erro;
    }
  } finally {
    conexao.release();
  }
}

async function agoraDoBanco(conexao) {
  const { rows } = await conexao.query('SELECT now() AS agora');
  return rows[0].agora;
}

async function eventoPorChave(pool, chave) {
  const { rows } = await pool.query(
    `SELECT id, tipo, agregado_id, seq FROM eventos
     WHERE chave_idempotencia = $1 AND agregado_tipo = $2`,
    [chave, AGREGADO],
  );
  return rows[0] || null;
}

async function buscaCorrida(pool, corridaId) {
  const { rows } = await pool.query(
    'SELECT id, estado, seq, vence_em, criado_em, atualizado_em FROM corridas WHERE id = $1',
    [corridaId],
  );
  return rows[0] || null;
}

// Retentativa idempotente: se a chave já gravou evento, e foi para ESTA
// mesma operação, é replay legítimo (operação nula). Se foi para outra
// operação, é reuso indevido. Se a chave não gravou nada, devolve null e o
// chamador decide o que o conflito significa.
async function tentaReplay(pool, { chave, tipo, corridaId }) {
  const evento = await eventoPorChave(pool, chave);
  if (!evento) return null;
  if (evento.tipo !== tipo || (corridaId && evento.agregado_id !== corridaId)) {
    throw new ErroDeDominio(
      CODIGOS.CHAVE_REUTILIZADA,
      `chave de idempotência já usada em outra operação (${evento.tipo} na corrida ${evento.agregado_id})`,
    );
  }
  const corrida = await buscaCorrida(pool, evento.agregado_id);
  return { corrida, repetida: true };
}

const CONSTRAINTS_DE_CORRIDA = ['eventos_chave_idempotencia_unica', 'eventos_agregado_seq_unico'];

// Disputa pela posição do log: ou o UNIQUE de seq/chave (23505), ou o
// trigger anti-buraco (CR001) quando o log já andou entre a leitura e o
// INSERT. Nos dois casos a chave decide se é replay ou derrota.
function ehDisputaDePosicao(erro) {
  if (!erro) return false;
  if (erro.code === '23505' && CONSTRAINTS_DE_CORRIDA.includes(erro.constraint)) return true;
  if (erro.code === 'CR001') return true;
  return false;
}

// Cria a corrida (∅ → aguardando_pagamento). Toda escrita aceita chave de
// idempotência (Lei 5); sem chave fornecida, gera-se uma — a retentativa do
// chamador que quer idempotência DEVE mandar a própria chave.
async function criaCorrida(pool, { autorTipo, autorId, payload, chaveIdempotencia }) {
  const chave = chaveIdempotencia || randomUUID();
  const dados = higienizaPayload(payload);

  // Lei 5, caso canônico: a resposta se perdeu e o chamador re-envia a
  // MESMA operação depois do commit. A chave decide antes de validar.
  if (chaveIdempotencia) {
    const replayPrevio = await tentaReplay(pool, { chave, tipo: 'criada', corridaId: null });
    if (replayPrevio) return replayPrevio;
  }

  const regra = validaTransicao({ tipo: 'criada', estadoAtual: null, autorTipo, payload: dados });

  try {
    return await emTransacao(pool, async (conexao) => {
      const agora = await agoraDoBanco(conexao);
      const venceEm = calculaVenceEm(regra, agora);
      const { rows: [corrida] } = await conexao.query(
        `INSERT INTO corridas (estado, seq, vence_em) VALUES ($1, 1, $2)
         RETURNING id, estado, seq, vence_em, criado_em, atualizado_em`,
        [regra.para, venceEm],
      );
      await conexao.query(
        `INSERT INTO eventos (tipo, agregado_tipo, agregado_id, seq, payload, autor_tipo, autor_id, chave_idempotencia)
         VALUES ($1, $2, $3, 1, $4, $5, $6, $7)`,
        [
          'criada',
          AGREGADO,
          corrida.id,
          JSON.stringify({ ...dados, vence_em: venceEm.toISOString() }),
          autorTipo,
          autorId,
          chave,
        ],
      );
      return { corrida, repetida: false };
    });
  } catch (erro) {
    if (ehDisputaDePosicao(erro)) {
      const replay = await tentaReplay(pool, { chave, tipo: 'criada', corridaId: null });
      if (replay) return replay;
      // A chave conflitou mas não gravou nada: só aconteceria com evento
      // apagado, o que o banco proíbe. Erro cru — não é caso de negócio.
      throw new Error(`chave de idempotência ${chave} conflitou mas não foi encontrada`);
    }
    throw erro;
  }
}

// Aplica uma transição. Concorrência: todos os disputantes leem o mesmo seq
// e tentam gravar seq+1; o UNIQUE do banco escolhe exatamente um vencedor.
async function transiciona(pool, {
  corridaId, tipo, autorTipo, autorId, payload, chaveIdempotencia,
}) {
  const chave = chaveIdempotencia || randomUUID();
  const dados = higienizaPayload(payload);
  regraDe(tipo);

  // Lei 5, caso canônico: a operação original já venceu e moveu o estado;
  // a retentativa que chega DEPOIS do commit seria recusada como transição
  // ilegal se a chave não fosse consultada antes da validação.
  if (chaveIdempotencia) {
    const replayPrevio = await tentaReplay(pool, { chave, tipo, corridaId });
    if (replayPrevio) return replayPrevio;
  }

  const corridaAtual = await buscaCorrida(pool, corridaId);
  if (!corridaAtual) {
    throw new ErroDeDominio(CODIGOS.CORRIDA_INEXISTENTE, `corrida ${corridaId} não existe`);
  }
  const regra = validaTransicao({
    tipo, estadoAtual: corridaAtual.estado, autorTipo, payload: dados,
  });
  const novoSeq = corridaAtual.seq + 1;

  try {
    return await emTransacao(pool, async (conexao) => {
      const agora = await agoraDoBanco(conexao);
      const venceEm = calculaVenceEm(regra, agora);
      const payloadDoEvento = venceEm === null
        ? dados
        : { ...dados, vence_em: venceEm.toISOString() };
      await conexao.query(
        `INSERT INTO eventos (tipo, agregado_tipo, agregado_id, seq, payload, autor_tipo, autor_id, chave_idempotencia)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tipo, AGREGADO, corridaId, novoSeq, JSON.stringify(payloadDoEvento), autorTipo, autorId, chave],
      );
      const { rows: [corrida] } = await conexao.query(
        `UPDATE corridas SET estado = $2, seq = $3, vence_em = $4, atualizado_em = now()
         WHERE id = $1
         RETURNING id, estado, seq, vence_em, criado_em, atualizado_em`,
        [corridaId, regra.para, novoSeq, venceEm],
      );
      return { corrida, repetida: false };
    });
  } catch (erro) {
    // Sob corrida real, a MESMA retentativa pode esbarrar primeiro no UNIQUE
    // de seq ou no trigger anti-buraco (a operação original venceu a
    // posição) — por isso o replay é conferido em todas as disputas de
    // posição, sempre pela chave.
    if (ehDisputaDePosicao(erro)) {
      const replay = await tentaReplay(pool, { chave, tipo, corridaId });
      if (replay) return replay;
      if (erro.constraint === 'eventos_chave_idempotencia_unica') {
        throw new Error(`chave de idempotência ${chave} conflitou mas não foi encontrada`);
      }
      throw new ErroDeDominio(
        CODIGOS.CONFLITO_DE_CONCORRENCIA,
        `outro evento venceu a posição ${novoSeq} da corrida ${corridaId}`,
      );
    }
    throw erro;
  }
}

// Reconstrói o estado só a partir do log de eventos, usando a MESMA tabela
// declarativa. Usado pela bateria para conferir a projeção (Lei 2).
async function reconstroiEstado(pool, corridaId) {
  const { rows } = await pool.query(
    `SELECT tipo, seq FROM eventos
     WHERE agregado_tipo = $1 AND agregado_id = $2
     ORDER BY seq`,
    [AGREGADO, corridaId],
  );
  if (rows.length === 0) return null;
  let estado = null;
  let esperado = 1;
  for (const evento of rows) {
    if (evento.seq !== esperado) {
      throw new Error(`log da corrida ${corridaId} com buraco: esperava seq ${esperado}, veio ${evento.seq}`);
    }
    const regra = regraDe(evento.tipo);
    if (!regra.de.includes(estado)) {
      throw new Error(`log da corrida ${corridaId} ilegal: ${evento.tipo} a partir de ${estado}`);
    }
    estado = regra.para;
    esperado += 1;
  }
  return { estado, seq: rows.length };
}

// A transição de vencimento de cada estado vem da PRÓPRIA tabela
// declarativa (porPrazo) — o varredor não re-declara regra em código.
const VENCIMENTO_POR_ESTADO = new Map(
  Object.entries(TRANSICOES).flatMap(
    ([tipo, regra]) => (regra.porPrazo ? regra.de.map((de) => [de, tipo]) : []),
  ),
);

// Regra 2 da Etapa 1: vencer é consulta ao banco, não timer em memória.
// Idempotente e seguro com vários varredores: a chave determinística e o
// UNIQUE de seq fazem cada vencimento ser aplicado no máximo uma vez.
async function expiraVencidas(pool) {
  const { rows: vencidas } = await pool.query(
    `SELECT id, estado, seq FROM corridas
     WHERE estado = ANY($1::int[]) AND vence_em IS NOT NULL AND vence_em <= now()`,
    [[...VENCIMENTO_POR_ESTADO.keys()]],
  );
  let aplicadas = 0;
  for (const corrida of vencidas) {
    const tipo = VENCIMENTO_POR_ESTADO.get(corrida.estado);
    try {
      const { repetida } = await transiciona(pool, {
        corridaId: corrida.id,
        tipo,
        autorTipo: 'sistema',
        autorId: null,
        payload: {},
        chaveIdempotencia: `vencimento:${corrida.id}:${corrida.seq}`,
      });
      if (!repetida) aplicadas += 1;
    } catch (erro) {
      // Outro varredor ou uma transição legítima venceu a corrida no meio:
      // não é falha, o vencimento deixou de valer. Qualquer outro erro sobe.
      if (
        erro instanceof ErroDeDominio
        && [CODIGOS.CONFLITO_DE_CONCORRENCIA, CODIGOS.TRANSICAO_ILEGAL].includes(erro.codigo)
      ) {
        continue;
      }
      throw erro;
    }
  }
  return aplicadas;
}

// Trava de segurança (medida provisória até a Etapa 7, decisão do dono
// 2026-08-09): os estados vivos 3, 4 e 5 ainda não têm prazo e retêm
// dinheiro de terceiro. Esta consulta lista toda corrida parada em estado
// vivo há mais de `horas` — dinheiro preso nunca fica invisível.
async function corridasParadas(pool, { horas = 24 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, estado, seq, atualizado_em, now() - atualizado_em AS parada_ha
     FROM corridas
     WHERE estado = ANY($1::int[])
       AND atualizado_em <= now() - make_interval(hours => $2)
     ORDER BY atualizado_em`,
    [E.VIVOS, horas],
  );
  return rows;
}

module.exports = {
  criaCorrida,
  transiciona,
  reconstroiEstado,
  expiraVencidas,
  corridasParadas,
  buscaCorrida,
};
