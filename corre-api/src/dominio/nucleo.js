'use strict';

// Infra comum aos agregados (corridas e contas): transação, relógio do
// servidor, replay idempotente e disputa de posição no log.

const { ErroDeDominio, CODIGOS } = require('./erros');

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

const CONSTRAINTS_DE_POSICAO = ['eventos_chave_idempotencia_unica', 'eventos_agregado_seq_unico'];

// Disputa pela posição do log: ou o UNIQUE de seq/chave (23505), ou o
// trigger anti-buraco (CR001) quando o log já andou entre a leitura e o
// INSERT. Nos dois casos a chave decide se é replay ou derrota.
function ehDisputaDePosicao(erro) {
  if (!erro) return false;
  if (erro.code === '23505' && CONSTRAINTS_DE_POSICAO.includes(erro.constraint)) return true;
  if (erro.code === 'CR001') return true;
  return false;
}

// Retentativa idempotente: se a chave já gravou evento, e foi para ESTA
// mesma operação, devolve o evento original. Se foi para outra operação —
// tipo/agregado diferentes OU mesmos dados de identidade divergentes — é
// reuso indevido, nunca replay silencioso (senão um cadastro com a chave
// reaproveitada de outra pessoa devolveria a conta alheia). Se a chave não
// gravou nada, devolve null.
//
// `confereDados(payloadGravado)` é opcional: devolve false quando o payload
// do evento existente não corresponde aos dados desta tentativa.
async function tentaReplayEvento(pool, {
  chave, tipo, agregadoTipo, agregadoId, confereDados,
}) {
  const { rows } = await pool.query(
    'SELECT id, tipo, agregado_tipo, agregado_id, seq, payload FROM eventos WHERE chave_idempotencia = $1',
    [chave],
  );
  const evento = rows[0];
  if (!evento) return null;
  const mesmaOperacao = evento.tipo === tipo
    && evento.agregado_tipo === agregadoTipo
    && (!agregadoId || evento.agregado_id === agregadoId)
    && (!confereDados || confereDados(evento.payload));
  if (!mesmaOperacao) {
    throw new ErroDeDominio(
      CODIGOS.CHAVE_REUTILIZADA,
      `chave de idempotência já usada em outra operação (${evento.tipo} em ${evento.agregado_tipo} ${evento.agregado_id})`,
    );
  }
  return evento;
}

module.exports = {
  emTransacao,
  agoraDoBanco,
  ehDisputaDePosicao,
  tentaReplayEvento,
};
