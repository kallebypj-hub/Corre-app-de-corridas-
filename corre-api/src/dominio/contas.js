'use strict';

// Cadastro dos três atores (motoboy, lojista, operador) — Etapa 2.
//
// Princípio da etapa: trava o dinheiro, não a porta. Cadastro aprova na
// hora; o que nasce travado é o PRIMEIRO SAQUE do motoboy, até conferência
// de documentos pela operação.
//
// Lei 2 vale para contas: todo ato relevante de cadastro grava evento na
// MESMA tabela eventos (agregados 'motoboy', 'lojista', 'operador'), com o
// mesmo UNIQUE de sequência, o mesmo trigger anti-buraco e a mesma
// idempotência por chave. As tabelas motoboys/lojistas/operadores são
// projeção; o estado é reconstruível do log (REDUTORES abaixo).
//
// Autorização do painel mora AQUI (um lugar só): estorno e bloqueio são
// exclusivos do dono; o HTTP apenas resolve a sessão e repassa o operador.

const { randomUUID } = require('node:crypto');

const { ErroDeDominio, CODIGOS } = require('./erros');
const { normalizaCpf, cpfValido } = require('./cpf');
const {
  emTransacao, ehDisputaDePosicao, tentaReplayEvento,
} = require('./nucleo');

function exigeTexto(valor, campo) {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new ErroDeDominio(CODIGOS.CAMPO_OBRIGATORIO, `campo obrigatório: ${campo}`);
  }
  return valor.trim();
}

// Papel exigido conferido contra a LINHA do operador no banco — nunca
// contra qualquer coisa vinda do cliente.
function exigePapelDoOperador(operador, papeis) {
  if (!operador || operador.situacao !== 'ativa') {
    throw new ErroDeDominio(CODIGOS.CONTA_INEXISTENTE, 'operador inexistente ou inativo');
  }
  if (!papeis.includes(operador.papel)) {
    throw new ErroDeDominio(
      CODIGOS.PAPEL_INSUFICIENTE,
      `ação exige papel ${papeis.join(' ou ')}; ${operador.papel} não pode`,
    );
  }
}

async function buscaConta(pool, tabela, id) {
  const { rows } = await pool.query(`SELECT * FROM ${tabela} WHERE id = $1`, [id]);
  return rows[0] || null;
}

const buscaMotoboy = (pool, id) => buscaConta(pool, 'motoboys', id);
const buscaLojista = (pool, id) => buscaConta(pool, 'lojistas', id);
const buscaOperador = (pool, id) => buscaConta(pool, 'operadores', id);

async function buscaMotoboyPorCpf(pool, cpf) {
  const { rows } = await pool.query('SELECT * FROM motoboys WHERE cpf = $1', [normalizaCpf(cpf)]);
  return rows[0] || null;
}

const TABELAS = { motoboy: 'motoboys', lojista: 'lojistas', operador: 'operadores' };

async function respostaDeReplay(pool, evento) {
  const conta = await buscaConta(pool, TABELAS[evento.agregado_tipo], evento.agregado_id);
  return { conta, repetida: true };
}

// Grava um evento de conta na próxima posição do log do agregado e aplica
// a mudança na projeção — mesma disciplina do motor de corridas: quem
// arbitra concorrência é o UNIQUE de seq, não o código.
async function acrescentaEventoDeConta(pool, {
  agregadoTipo, agregadoId, seqAtual, tipo, payload, autorTipo, autorId, chave, atualizaProjecao,
}) {
  return emTransacao(pool, async (conexao) => {
    await conexao.query(
      `INSERT INTO eventos (tipo, agregado_tipo, agregado_id, seq, payload, autor_tipo, autor_id, chave_idempotencia)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tipo, agregadoTipo, agregadoId, seqAtual + 1, JSON.stringify(payload), autorTipo, autorId, chave],
    );
    const conta = await atualizaProjecao(conexao, seqAtual + 1);
    return { conta, repetida: false };
  });
}

// ---------------------------------------------------------------- motoboy

// Aprovação automática: entra ativo e já roda. O primeiro saque nasce
// 'travado' — estado gravado, derivado do evento de cadastro.
async function cadastraMotoboy(pool, {
  nome, telefone, cpf, chavePix, cnhRef, crlvRef, selfieRef, aparelhoId, chaveIdempotencia,
}) {
  const chave = chaveIdempotencia || randomUUID();
  const nomeLimpo = exigeTexto(nome, 'nome');
  const telefoneLimpo = exigeTexto(telefone, 'telefone');
  const cnh = exigeTexto(cnhRef, 'cnh_ref');
  const crlv = exigeTexto(crlvRef, 'crlv_ref');
  const selfie = exigeTexto(selfieRef, 'selfie_ref');
  const aparelho = exigeTexto(aparelhoId, 'aparelho_id');

  const cpfLimpo = normalizaCpf(exigeTexto(cpf, 'cpf'));
  if (!cpfValido(cpfLimpo)) {
    throw new ErroDeDominio(CODIGOS.CPF_INVALIDO, 'CPF inválido');
  }
  // Seções 10 e 14: chave Pix obrigatoriamente do MESMO CPF do cadastro.
  // Sem consulta DICT no MVP, a única chave verificável é o próprio CPF —
  // qualquer outra é recusada no ato, não avisada.
  const chavePixLimpa = normalizaCpf(exigeTexto(chavePix, 'chave_pix'));
  if (chavePixLimpa !== cpfLimpo) {
    throw new ErroDeDominio(
      CODIGOS.CHAVE_PIX_DE_OUTRO_CPF,
      'chave Pix precisa ser o CPF do próprio cadastro',
    );
  }

  if (chaveIdempotencia) {
    const replayPrevio = await tentaReplayEvento(pool, {
      chave, tipo: 'motoboy_cadastrado', agregadoTipo: 'motoboy', agregadoId: null,
      confereDados: (p) => p.cpf === cpfLimpo,
    });
    if (replayPrevio) return respostaDeReplay(pool, replayPrevio);
  }

  try {
    return await emTransacao(pool, async (conexao) => {
      // primeiro_saque não vai no INSERT: nasce 'travado' pelo DEFAULT do
      // banco (migration 0006) — corre_app nem tem INSERT nessa coluna.
      const { rows: [motoboy] } = await conexao.query(
        `INSERT INTO motoboys (seq, nome, telefone, cpf, chave_pix, cnh_ref, crlv_ref, selfie_ref, aparelho_id, situacao)
         VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, 'ativa')
         RETURNING *`,
        [nomeLimpo, telefoneLimpo, cpfLimpo, chavePixLimpa, cnh, crlv, selfie, aparelho],
      );
      await conexao.query(
        `INSERT INTO eventos (tipo, agregado_tipo, agregado_id, seq, payload, autor_tipo, autor_id, chave_idempotencia)
         VALUES ('motoboy_cadastrado', 'motoboy', $1, 1, $2, 'motoboy', $1, $3)`,
        [motoboy.id, JSON.stringify({
          nome: nomeLimpo, telefone: telefoneLimpo, cpf: cpfLimpo, aparelho_id: aparelho,
        }), chave],
      );
      return { conta: motoboy, repetida: false };
    });
  } catch (erro) {
    if (erro && erro.code === '23505' && erro.constraint === 'motoboys_cpf_unico') {
      // A retentativa da MESMA operação pode esbarrar no CPF único antes
      // da chave: replay primeiro, recusa depois.
      const replay = await tentaReplayEvento(pool, {
        chave, tipo: 'motoboy_cadastrado', agregadoTipo: 'motoboy', agregadoId: null,
        confereDados: (p) => p.cpf === cpfLimpo,
      });
      if (replay) return respostaDeReplay(pool, replay);
      throw new ErroDeDominio(CODIGOS.CPF_JA_CADASTRADO, 'CPF já cadastrado');
    }
    if (ehDisputaDePosicao(erro)) {
      const replay = await tentaReplayEvento(pool, {
        chave, tipo: 'motoboy_cadastrado', agregadoTipo: 'motoboy', agregadoId: null,
        confereDados: (p) => p.cpf === cpfLimpo,
      });
      if (replay) return respostaDeReplay(pool, replay);
      throw new Error(`chave de idempotência ${chave} conflitou mas não foi encontrada`);
    }
    throw erro;
  }
}

// Ação da operação sobre a conta do motoboy: sempre com evento e autor.
async function acaoDaOperacaoSobreMotoboy(pool, {
  motoboyId, autor, papeis, tipo, payload, mudancas, revogaSessoes, chaveIdempotencia,
}) {
  const chave = chaveIdempotencia || randomUUID();
  exigePapelDoOperador(autor, papeis);

  if (chaveIdempotencia) {
    const replayPrevio = await tentaReplayEvento(pool, {
      chave, tipo, agregadoTipo: 'motoboy', agregadoId: motoboyId,
    });
    if (replayPrevio) return respostaDeReplay(pool, replayPrevio);
  }

  const motoboy = await buscaMotoboy(pool, motoboyId);
  if (!motoboy) {
    throw new ErroDeDominio(CODIGOS.CONTA_INEXISTENTE, `motoboy ${motoboyId} não existe`);
  }

  try {
    return await acrescentaEventoDeConta(pool, {
      agregadoTipo: 'motoboy',
      agregadoId: motoboyId,
      seqAtual: motoboy.seq,
      tipo,
      payload,
      autorTipo: 'painel',
      autorId: autor.id,
      chave,
      atualizaProjecao: async (conexao, novoSeq) => {
        const { rows: [atualizado] } = await conexao.query(
          `UPDATE motoboys SET seq = $2, aparelho_id = $3, situacao = $4, primeiro_saque = $5, atualizado_em = now()
           WHERE id = $1 RETURNING *`,
          [
            motoboyId,
            novoSeq,
            mudancas.aparelho_id || motoboy.aparelho_id,
            mudancas.situacao || motoboy.situacao,
            mudancas.primeiro_saque || motoboy.primeiro_saque,
          ],
        );
        // Bloqueio e troca de aparelho revogam as sessões vivas na MESMA
        // transação do evento (a revalidação em resolveSessao é o segundo
        // cinto; este é o primeiro). DELETE inline para não criar
        // dependência circular com a camada http.
        if (revogaSessoes) {
          await conexao.query(
            "DELETE FROM sessoes WHERE ator_tipo = 'motoboy' AND ator_id = $1",
            [motoboyId],
          );
        }
        return atualizado;
      },
    });
  } catch (erro) {
    if (ehDisputaDePosicao(erro)) {
      const replay = await tentaReplayEvento(pool, {
        chave, tipo, agregadoTipo: 'motoboy', agregadoId: motoboyId,
      });
      if (replay) return respostaDeReplay(pool, replay);
      throw new ErroDeDominio(
        CODIGOS.CONFLITO_DE_CONCORRENCIA,
        `outra ação venceu a posição ${motoboy.seq + 1} da conta ${motoboyId}`,
      );
    }
    throw erro;
  }
}

// Bloqueio é exclusivo do DONO (seção 13).
function bloqueiaMotoboy(pool, { motoboyId, motivo, autor, chaveIdempotencia }) {
  return acaoDaOperacaoSobreMotoboy(pool, {
    motoboyId,
    autor,
    papeis: ['dono'],
    tipo: 'motoboy_bloqueado',
    payload: { motivo: exigeTexto(motivo, 'motivo') },
    mudancas: { situacao: 'bloqueada' },
    revogaSessoes: true,
    chaveIdempotencia,
  });
}

// Conferência de documentos é dia a dia: atendimento resolve.
function liberaPrimeiroSaque(pool, { motoboyId, autor, chaveIdempotencia }) {
  return acaoDaOperacaoSobreMotoboy(pool, {
    motoboyId,
    autor,
    papeis: ['dono', 'atendimento'],
    tipo: 'primeiro_saque_liberado',
    payload: {},
    mudancas: { primeiro_saque: 'liberado' },
    chaveIdempotencia,
  });
}

// Troca de aparelho NUNCA é automática: é ação da operação, com evento.
async function trocaAparelho(pool, { motoboyId, novoAparelhoId, autor, chaveIdempotencia }) {
  const aparelho = exigeTexto(novoAparelhoId, 'aparelho_id');
  const atual = await buscaMotoboy(pool, motoboyId);
  return acaoDaOperacaoSobreMotoboy(pool, {
    motoboyId,
    autor,
    papeis: ['dono', 'atendimento'],
    tipo: 'aparelho_trocado',
    payload: { de: atual ? atual.aparelho_id : null, para: aparelho },
    mudancas: { aparelho_id: aparelho },
    // Troca invalida o token do aparelho antigo na hora — o motoboy re-loga
    // no aparelho novo (um aparelho por conta).
    revogaSessoes: true,
    chaveIdempotencia,
  });
}

// ---------------------------------------------------------------- lojista

// Cadastro em um minuto: nome e telefone. Entra, olha, mexe. O cartão vem
// depois — antes do primeiro pedido, nunca no cadastro.
async function cadastraLojista(pool, { nome, telefone, chaveIdempotencia }) {
  const chave = chaveIdempotencia || randomUUID();
  const nomeLimpo = exigeTexto(nome, 'nome');
  const telefoneLimpo = exigeTexto(telefone, 'telefone');

  if (chaveIdempotencia) {
    const replayPrevio = await tentaReplayEvento(pool, {
      chave, tipo: 'lojista_cadastrado', agregadoTipo: 'lojista', agregadoId: null,
      confereDados: (p) => p.telefone === telefoneLimpo,
    });
    if (replayPrevio) return respostaDeReplay(pool, replayPrevio);
  }

  try {
    return await emTransacao(pool, async (conexao) => {
      const { rows: [lojista] } = await conexao.query(
        `INSERT INTO lojistas (seq, nome, telefone, situacao)
         VALUES (1, $1, $2, 'ativa') RETURNING *`,
        [nomeLimpo, telefoneLimpo],
      );
      await conexao.query(
        `INSERT INTO eventos (tipo, agregado_tipo, agregado_id, seq, payload, autor_tipo, autor_id, chave_idempotencia)
         VALUES ('lojista_cadastrado', 'lojista', $1, 1, $2, 'lojista', $1, $3)`,
        [lojista.id, JSON.stringify({ nome: nomeLimpo, telefone: telefoneLimpo }), chave],
      );
      return { conta: lojista, repetida: false };
    });
  } catch (erro) {
    if (erro && erro.code === '23505' && erro.constraint === 'lojistas_telefone_unico') {
      const replay = await tentaReplayEvento(pool, {
        chave, tipo: 'lojista_cadastrado', agregadoTipo: 'lojista', agregadoId: null,
        confereDados: (p) => p.telefone === telefoneLimpo,
      });
      if (replay) return respostaDeReplay(pool, replay);
      throw new ErroDeDominio(CODIGOS.TELEFONE_JA_CADASTRADO, 'telefone já cadastrado');
    }
    if (ehDisputaDePosicao(erro)) {
      const replay = await tentaReplayEvento(pool, {
        chave, tipo: 'lojista_cadastrado', agregadoTipo: 'lojista', agregadoId: null,
        confereDados: (p) => p.telefone === telefoneLimpo,
      });
      if (replay) return respostaDeReplay(pool, replay);
      throw new Error(`chave de idempotência ${chave} conflitou mas não foi encontrada`);
    }
    throw erro;
  }
}

// Registro de que existe cartão válido — sem cobrança nenhuma (Etapa 2).
async function registraCartao(pool, { lojistaId, cartaoRef, chaveIdempotencia }) {
  const chave = chaveIdempotencia || randomUUID();
  const cartao = exigeTexto(cartaoRef, 'cartao_ref');

  if (chaveIdempotencia) {
    const replayPrevio = await tentaReplayEvento(pool, {
      chave, tipo: 'cartao_registrado', agregadoTipo: 'lojista', agregadoId: lojistaId,
    });
    if (replayPrevio) return respostaDeReplay(pool, replayPrevio);
  }

  const lojista = await buscaLojista(pool, lojistaId);
  if (!lojista) {
    throw new ErroDeDominio(CODIGOS.LOJISTA_INEXISTENTE, `lojista ${lojistaId} não existe`);
  }

  try {
    return await acrescentaEventoDeConta(pool, {
      agregadoTipo: 'lojista',
      agregadoId: lojistaId,
      seqAtual: lojista.seq,
      tipo: 'cartao_registrado',
      payload: { cartao_ref: cartao },
      autorTipo: 'lojista',
      autorId: lojistaId,
      chave,
      atualizaProjecao: async (conexao, novoSeq) => {
        const { rows: [atualizado] } = await conexao.query(
          `UPDATE lojistas SET seq = $2, cartao_registrado_em = now(), atualizado_em = now()
           WHERE id = $1 RETURNING *`,
          [lojistaId, novoSeq],
        );
        return atualizado;
      },
    });
  } catch (erro) {
    if (ehDisputaDePosicao(erro)) {
      const replay = await tentaReplayEvento(pool, {
        chave, tipo: 'cartao_registrado', agregadoTipo: 'lojista', agregadoId: lojistaId,
      });
      if (replay) return respostaDeReplay(pool, replay);
      throw new ErroDeDominio(
        CODIGOS.CONFLITO_DE_CONCORRENCIA,
        `outra ação venceu a posição ${lojista.seq + 1} da conta ${lojistaId}`,
      );
    }
    throw erro;
  }
}

// --------------------------------------------------------------- operador

// O primeiro operador (gênese) nasce dono, sem autor humano, e só pode
// existir UM — garantido pelo índice único parcial, não por contagem.
async function criaOperadorGenese(pool, { nome, chaveIdempotencia }) {
  const chave = chaveIdempotencia || randomUUID();
  const nomeLimpo = exigeTexto(nome, 'nome');

  if (chaveIdempotencia) {
    const replayPrevio = await tentaReplayEvento(pool, {
      chave, tipo: 'operador_cadastrado', agregadoTipo: 'operador', agregadoId: null,
    });
    if (replayPrevio) return respostaDeReplay(pool, replayPrevio);
  }

  try {
    return await emTransacao(pool, async (conexao) => {
      const { rows: [operador] } = await conexao.query(
        `INSERT INTO operadores (seq, nome, papel, situacao, genese)
         VALUES (1, $1, 'dono', 'ativa', true) RETURNING *`,
        [nomeLimpo],
      );
      await conexao.query(
        `INSERT INTO eventos (tipo, agregado_tipo, agregado_id, seq, payload, autor_tipo, autor_id, chave_idempotencia)
         VALUES ('operador_cadastrado', 'operador', $1, 1, $2, 'sistema', NULL, $3)`,
        [operador.id, JSON.stringify({ nome: nomeLimpo, papel: 'dono', genese: true }), chave],
      );
      return { conta: operador, repetida: false };
    });
  } catch (erro) {
    if (erro && erro.code === '23505' && erro.constraint === 'operadores_genese_unica') {
      throw new ErroDeDominio(CODIGOS.GENESE_JA_FEITA, 'o operador gênese já existe');
    }
    if (ehDisputaDePosicao(erro)) {
      const replay = await tentaReplayEvento(pool, {
        chave, tipo: 'operador_cadastrado', agregadoTipo: 'operador', agregadoId: null,
      });
      if (replay) return respostaDeReplay(pool, replay);
      throw new Error(`chave de idempotência ${chave} conflitou mas não foi encontrada`);
    }
    throw erro;
  }
}

// Operadores seguintes: só o dono cria.
async function criaOperador(pool, { nome, papel, autor, chaveIdempotencia }) {
  const chave = chaveIdempotencia || randomUUID();
  const nomeLimpo = exigeTexto(nome, 'nome');
  if (!['dono', 'atendimento'].includes(papel)) {
    throw new ErroDeDominio(CODIGOS.CAMPO_OBRIGATORIO, 'papel precisa ser dono ou atendimento');
  }
  exigePapelDoOperador(autor, ['dono']);

  if (chaveIdempotencia) {
    const replayPrevio = await tentaReplayEvento(pool, {
      chave, tipo: 'operador_cadastrado', agregadoTipo: 'operador', agregadoId: null,
    });
    if (replayPrevio) return respostaDeReplay(pool, replayPrevio);
  }

  return emTransacao(pool, async (conexao) => {
    const { rows: [operador] } = await conexao.query(
      `INSERT INTO operadores (seq, nome, papel, situacao, genese)
       VALUES (1, $1, $2, 'ativa', false) RETURNING *`,
      [nomeLimpo, papel],
    );
    await conexao.query(
      `INSERT INTO eventos (tipo, agregado_tipo, agregado_id, seq, payload, autor_tipo, autor_id, chave_idempotencia)
       VALUES ('operador_cadastrado', 'operador', $1, 1, $2, 'painel', $3, $4)`,
      [operador.id, JSON.stringify({ nome: nomeLimpo, papel }), autor.id, chave],
    );
    return { conta: operador, repetida: false };
  });
}

// Estorno: a AUTORIZAÇÃO existe desde já e é exclusiva do dono; o efeito
// financeiro só existe a partir da Etapa 4 — o que se grava aqui é o ATO
// autorizado, com autor, no agregado do operador (não suja o log da
// corrida, que é só de transições).
async function autorizaEstornoSemEfeito(pool, { corridaId, autor, chaveIdempotencia }) {
  const chave = chaveIdempotencia || randomUUID();
  exigePapelDoOperador(autor, ['dono']);
  exigeTexto(corridaId, 'corrida_id');

  // Auditoria não referencia corrida fantasma: a corrida tem que existir.
  const { rows: [corrida] } = await pool.query('SELECT id FROM corridas WHERE id = $1', [corridaId]);
  if (!corrida) {
    throw new ErroDeDominio(CODIGOS.CORRIDA_INEXISTENTE, `corrida ${corridaId} não existe`);
  }

  if (chaveIdempotencia) {
    const replayPrevio = await tentaReplayEvento(pool, {
      chave, tipo: 'estorno_autorizado', agregadoTipo: 'operador', agregadoId: autor.id,
    });
    if (replayPrevio) return respostaDeReplay(pool, replayPrevio);
  }

  const operador = await buscaOperador(pool, autor.id);
  try {
    return await acrescentaEventoDeConta(pool, {
      agregadoTipo: 'operador',
      agregadoId: operador.id,
      seqAtual: operador.seq,
      tipo: 'estorno_autorizado',
      payload: { corrida_id: corridaId, efeito: 'nenhum_ate_a_etapa_4' },
      autorTipo: 'painel',
      autorId: operador.id,
      chave,
      atualizaProjecao: async (conexao, novoSeq) => {
        const { rows: [atualizado] } = await conexao.query(
          'UPDATE operadores SET seq = $2, atualizado_em = now() WHERE id = $1 RETURNING *',
          [operador.id, novoSeq],
        );
        return atualizado;
      },
    });
  } catch (erro) {
    if (ehDisputaDePosicao(erro)) {
      const replay = await tentaReplayEvento(pool, {
        chave, tipo: 'estorno_autorizado', agregadoTipo: 'operador', agregadoId: operador.id,
      });
      if (replay) return respostaDeReplay(pool, replay);
      throw new ErroDeDominio(
        CODIGOS.CONFLITO_DE_CONCORRENCIA,
        `outra ação venceu a posição ${operador.seq + 1} do operador ${operador.id}`,
      );
    }
    throw erro;
  }
}

// ----------------------------------------------------------- reconstrução

// Redutores declarativos: como cada tipo de evento muda o estado da conta.
// A reconstrução dobra o log com ESTES redutores e compara com a projeção.
const REDUTORES = {
  motoboy: {
    motoboy_cadastrado: (estado, payload) => ({
      situacao: 'ativa', primeiro_saque: 'travado', aparelho_id: payload.aparelho_id,
    }),
    aparelho_trocado: (estado, payload) => ({ ...estado, aparelho_id: payload.para }),
    motoboy_bloqueado: (estado) => ({ ...estado, situacao: 'bloqueada' }),
    primeiro_saque_liberado: (estado) => ({ ...estado, primeiro_saque: 'liberado' }),
  },
  lojista: {
    lojista_cadastrado: () => ({ situacao: 'ativa', cartao_registrado: false }),
    cartao_registrado: (estado) => ({ ...estado, cartao_registrado: true }),
  },
  operador: {
    operador_cadastrado: (estado, payload) => ({ situacao: 'ativa', papel: payload.papel }),
    estorno_autorizado: (estado) => ({ ...estado }),
  },
};

async function reconstroiConta(pool, agregadoTipo, id) {
  const redutores = REDUTORES[agregadoTipo];
  if (!redutores) throw new Error(`agregado desconhecido: ${agregadoTipo}`);
  const { rows } = await pool.query(
    `SELECT tipo, seq, payload FROM eventos
     WHERE agregado_tipo = $1 AND agregado_id = $2 ORDER BY seq`,
    [agregadoTipo, id],
  );
  if (rows.length === 0) return null;
  let estado = null;
  let esperado = 1;
  for (const evento of rows) {
    if (evento.seq !== esperado) {
      throw new Error(`log da conta ${id} com buraco: esperava seq ${esperado}, veio ${evento.seq}`);
    }
    const redutor = redutores[evento.tipo];
    if (!redutor) {
      throw new Error(`log da conta ${id} ilegal: tipo ${evento.tipo} sem redutor`);
    }
    estado = redutor(estado, evento.payload);
    esperado += 1;
  }
  return { ...estado, seq: rows.length };
}

module.exports = {
  cadastraMotoboy,
  bloqueiaMotoboy,
  liberaPrimeiroSaque,
  trocaAparelho,
  cadastraLojista,
  registraCartao,
  criaOperadorGenese,
  criaOperador,
  autorizaEstornoSemEfeito,
  reconstroiConta,
  buscaMotoboy,
  buscaMotoboyPorCpf,
  buscaLojista,
  buscaOperador,
  exigePapelDoOperador,
};
