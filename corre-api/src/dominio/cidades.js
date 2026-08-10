'use strict';

// Cidade e o isolamento por Row Level Security (Etapa 4).
//
// A GARANTIA NÃO MORA AQUI. Ela mora nas políticas da migration 0010, contra
// o papel `corre_app`, e FECHA POR PADRÃO: sem cidade declarada, nenhuma
// linha. Este módulo é só a forma conveniente de declarar a cidade — se
// alguém esquecer de usá-lo, a consulta CEGA, nunca vaza.
//
// A cidade é declarada POR TRANSAÇÃO, nunca por conexão. Conexão de pool é
// reaproveitada; cidade presa à conexão vaza para a requisição seguinte, em
// silêncio e só sob carga. Ver `declaraCidade` em nucleo.js.

const { ErroDeDominio, CODIGOS } = require('./erros');
const { emTransacao } = require('./nucleo');

// Executa leitura (ou leitura e escrita) dentro de uma transação com a
// cidade declarada. É o único caminho legítimo para tocar tabela com RLS.
async function naCidade(pool, cidadeId, trabalho) {
  if (!cidadeId) {
    throw new ErroDeDominio(
      CODIGOS.CIDADE_NAO_DECLARADA,
      'operação em tabela por cidade exige cidade declarada',
    );
  }
  return emTransacao(pool, trabalho, { cidadeId });
}

// `cidades` não tem RLS: é catálogo, e o app só lê.
async function buscaCidade(pool, cidadeId) {
  const { rows } = await pool.query(
    `SELECT id, nome, uf, ibge, exemplo
     FROM cidades WHERE id = $1`,
    [cidadeId],
  );
  if (!rows[0]) {
    throw new ErroDeDominio(CODIGOS.CIDADE_INEXISTENTE, `cidade ${cidadeId} não existe`);
  }
  return rows[0];
}

async function buscaCidadePorIbge(pool, ibge) {
  const { rows } = await pool.query(
    `SELECT id, nome, uf, ibge, exemplo
     FROM cidades WHERE ibge = $1`,
    [ibge],
  );
  if (!rows[0]) {
    throw new ErroDeDominio(CODIGOS.CIDADE_INEXISTENTE, `cidade de IBGE ${ibge} não existe`);
  }
  return rows[0];
}

async function listaCidades(pool) {
  const { rows } = await pool.query(
    'SELECT id, nome, uf, ibge, exemplo FROM cidades ORDER BY nome',
  );
  return rows;
}

// O pool de uma cidade. Toda leitura avulsa vira uma transação com a cidade
// declarada, e `cidadeId` fica visível para os `emTransacao` do domínio —
// que passam a declará-la também.
//
// NÃO existe atalho: quem quiser tocar tabela com RLS passa por aqui ou
// declara a cidade na própria transação. Um `pool` cru continua funcionando
// e continua **cego** — que é o comportamento certo.
function poolDaCidade(pool, cidadeId) {
  if (!cidadeId) {
    throw new ErroDeDominio(
      CODIGOS.CIDADE_NAO_DECLARADA,
      'pool de cidade exige cidade — sem ela a política do banco não devolve linha nenhuma',
    );
  }
  return {
    cidadeId,
    query: (texto, params) => emTransacao(pool, (c) => c.query(texto, params), { cidadeId }),
    connect: () => pool.connect(),
    end: () => pool.end(),
  };
}

module.exports = {
  naCidade, poolDaCidade, buscaCidade, buscaCidadePorIbge, listaCidades,
};
