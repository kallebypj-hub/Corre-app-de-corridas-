'use strict';

// Sessão não confia no cliente (regra 7 da Etapa 2): o token opaco (só o
// hash fica no banco) resolve identidade e papel SEMPRE no servidor.
// Motoboy: a sessão só nasce no aparelho único vinculado à conta — a posse
// do aparelho é a credencial (um aparelho por conta, seção 10).

const { createHash, randomBytes } = require('node:crypto');

const { ErroDeDominio, CODIGOS } = require('../dominio/erros');
const { emTransacao } = require('../dominio/nucleo');
const { buscaMotoboyPorCpf } = require('../dominio/contas');

const VALIDADE_DIAS = 30;

function hashDoToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

// A CIDADE VEM DA SESSÃO, nunca do corpo da requisição (CORRE.md, seção 20).
// Ela é gravada aqui, no instante em que a sessão nasce, a partir da conta do
// ator — e é ela que a requisição declara na transação antes de ler qualquer
// coisa. Isso também resolve o ovo-e-galinha do RLS: ler a conta para
// descobrir a cidade exigiria a cidade.
//
// NULL para cliente (é da plataforma, não tem cidade) e para operador (a
// escolha de cidade do painel é da Etapa 11). NULL significa não enxergar
// tabela por cidade nenhuma — fecha por padrão, que é o certo até lá.
async function emiteSessao(pool, {
  atorTipo, atorId, aparelhoId, cidadeId,
}) {
  const token = randomBytes(32).toString('hex');
  const cidade = cidadeId === undefined ? (pool.cidadeId || null) : cidadeId;
  await pool.query(
    `INSERT INTO sessoes (token_hash, ator_tipo, ator_id, aparelho_id, expira_em, cidade_id)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5), $6)`,
    [hashDoToken(token), atorTipo, atorId, aparelhoId || null, VALIDADE_DIAS, cidade],
  );
  return { token, atorTipo, atorId, cidadeId: cidade };
}

// Re-entrada do motoboy: CPF + aparelho vinculado. Aparelho diferente é
// recusado — segundo aparelho só entra por troca feita pela operação.
async function emiteSessaoDeMotoboy(pool, { cpf, aparelhoId }) {
  const motoboy = await buscaMotoboyPorCpf(pool, cpf);
  if (!motoboy) {
    throw new ErroDeDominio(CODIGOS.CONTA_INEXISTENTE, 'motoboy não cadastrado');
  }
  if (motoboy.situacao !== 'ativa') {
    throw new ErroDeDominio(CODIGOS.CONTA_BLOQUEADA, 'conta bloqueada');
  }
  if (motoboy.aparelho_id !== aparelhoId) {
    throw new ErroDeDominio(
      CODIGOS.APARELHO_NAO_AUTORIZADO,
      'aparelho não autorizado: um aparelho por conta; troca só pela operação',
    );
  }
  return emiteSessao(pool, { atorTipo: 'motoboy', atorId: motoboy.id, aparelhoId });
}

// Resolve o token em ator {tipo, id} — identidade nunca vem do corpo, e a
// sessão é revalidada contra a CONTA VIVA a cada requisição: conta
// bloqueada não resolve (bloqueio imediato, seção 12) e, para o motoboy, o
// aparelho da sessão tem que continuar sendo o vinculado à conta (um
// aparelho por conta — troca invalida o token antigo na hora). Não basta a
// revogação por DELETE no ato: a revalidação fecha a janela mesmo que uma
// sessão sobreviva.
async function resolveSessao(pool, token) {
  if (!token) return null;
  // `sessoes` não tem RLS de propósito: é aqui que se DESCOBRE a cidade, e
  // uma tabela que só se lê depois de saber a cidade não serviria para isso.
  const { rows: [sessao] } = await pool.query(
    `SELECT ator_tipo, ator_id, aparelho_id, cidade_id FROM sessoes
     WHERE token_hash = $1 AND expira_em > now()`,
    [hashDoToken(token)],
  );
  if (!sessao) return null;

  const TABELA = {
    motoboy: 'motoboys', lojista: 'lojistas', operador: 'operadores', cliente: 'clientes',
  };
  // A revalidação contra a conta viva acontece JÁ DENTRO da cidade da
  // sessão: motoboys e lojistas estão sob RLS, e sem declarar a cidade a
  // consulta cegaria — a sessão pareceria inválida em vez de válida.
  const leConta = async (executor) => {
    const { rows } = await executor.query(
      `SELECT * FROM ${TABELA[sessao.ator_tipo]} WHERE id = $1`,
      [sessao.ator_id],
    );
    return rows[0];
  };
  const conta = sessao.cidade_id
    ? await emTransacao(pool, leConta, { cidadeId: sessao.cidade_id })
    : await leConta(pool);

  if (!conta || conta.situacao !== 'ativa') return null;
  if (sessao.ator_tipo === 'motoboy' && conta.aparelho_id !== sessao.aparelho_id) return null;

  return {
    tipo: sessao.ator_tipo,
    id: sessao.ator_id,
    aparelhoId: sessao.aparelho_id,
    cidadeId: sessao.cidade_id,
  };
}

module.exports = { emiteSessao, emiteSessaoDeMotoboy, resolveSessao };
