'use strict';

// O cliente como ator (Etapa 4).
//
// Ele é diferente dos outros três em duas coisas que decidem o desenho:
//
// 1. NÃO TEM CIDADE. É da plataforma e recebe entrega onde estiver (seção
//    20). Por isso `clientes` não tem RLS — o que o isolamento protege é o
//    que importa: as CORRIDAS dele são da cidade.
//
// 2. A CONTA NASCE SOZINHA, quando o primeiro lojista digita o telefone, e
//    só passa a ser dele quando ele entra pelo código de 6 dígitos. Até
//    então ela está NÃO REIVINDICADA, e falta de pagamento não entra na
//    reputação de quem nunca soube que a conta existia (seção 10).
//
// Telefone é único DENTRO deste papel. O mesmo número pode ser de um
// lojista, de um motoboy e de um cliente ao mesmo tempo: em Sobral a mesma
// pessoa é os três. Decisão deliberada (seção 20), não omissão.

const { randomUUID } = require('node:crypto');

const { ErroDeDominio, CODIGOS } = require('./erros');
const { emTransacao, ehDisputaDePosicao, tentaReplayEvento } = require('./nucleo');

function exigeTexto(valor, nome) {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new ErroDeDominio(CODIGOS.CAMPO_OBRIGATORIO, `${nome} é obrigatório`);
  }
  return valor.trim();
}

async function buscaCliente(pool, clienteId) {
  const { rows } = await pool.query('SELECT * FROM clientes WHERE id = $1', [clienteId]);
  return rows[0] || null;
}

async function buscaClientePorTelefone(pool, telefone) {
  const { rows } = await pool.query('SELECT * FROM clientes WHERE telefone = $1', [telefone]);
  return rows[0] || null;
}

// Chamado quando o lojista digita o telefone do cliente. Se a conta já
// existe, DEVOLVE A EXISTENTE — dois lojistas mandando para o mesmo cliente
// não criam duas contas, e não é erro: é o caso normal.
//
// A conta nasce NÃO REIVINDICADA. Só o próprio dono do número a reivindica,
// entrando pelo código de 6 dígitos.
// AUTOR DE EVENTO TEM QUE EXISTIR (Lei 11). Antes, um `lojistaId` inventado
// era gravado como autor do evento de criação — e a Lei 3 torna isso
// IRREVERSÍVEL: autor falso em log append-only não se apaga. O `CHECK` de
// autor identificado só exigia que o campo não fosse nulo; não exigia que
// apontasse para alguém.
async function exigeAutorReal(pool, lojistaId, interno) {
  // 'SISTEMA' É TIPO, NÃO ATOR, e aqui ele nascia por OMISSÃO: bastava não
  // mandar `lojistaId` para o evento sair com `autor_tipo: 'sistema'`. A
  // ausência de um campo virava a autoridade mais alta do sistema.
  //
  // Agora todo caminho que age como sistema precisa de ORIGEM VERIFICÁVEL —
  // `interno: true`, que só o próprio código passa —, nunca de omissão.
  if (!lojistaId) {
    if (!interno) {
      throw new ErroDeDominio(
        CODIGOS.LOJISTA_INEXISTENTE,
        'evento de cliente exige lojista identificado: omitir não vira sistema',
      );
    }
    return null;
  }
  const { rows: [lojista] } = await pool.query(
    'SELECT id FROM lojistas WHERE id = $1', [lojistaId],
  );
  if (!lojista) {
    throw new ErroDeDominio(
      CODIGOS.LOJISTA_INEXISTENTE,
      'autor de evento precisa existir: lojista informado não existe nesta cidade',
    );
  }
  return lojista.id;
}

async function garanteCliente(pool, { telefone, lojistaId, chaveIdempotencia, interno = false }) {
  const telefoneLimpo = exigeTexto(telefone, 'telefone');
  const chave = chaveIdempotencia || randomUUID();
  // Confere ANTES de qualquer escrita: descobrir o autor falso depois de
  // gravar seria descobrir tarde demais.
  const autorReal = await exigeAutorReal(pool, lojistaId, interno);

  const existente = await buscaClientePorTelefone(pool, telefoneLimpo);
  if (existente) return { cliente: existente, criada: false };

  if (chaveIdempotencia) {
    const replayPrevio = await tentaReplayEvento(pool, {
      chave, tipo: 'cliente_criado', agregadoTipo: 'cliente', agregadoId: null,
      confereDados: (p) => p.telefone === telefoneLimpo,
    });
    if (replayPrevio) {
      return { cliente: await buscaCliente(pool, replayPrevio.agregado_id), criada: false };
    }
  }

  try {
    return await emTransacao(pool, async (conexao) => {
      const { rows: [cliente] } = await conexao.query(
        `INSERT INTO clientes (seq, telefone, situacao) VALUES (1, $1, 'ativa') RETURNING *`,
        [telefoneLimpo],
      );
      await conexao.query(
        `INSERT INTO eventos (tipo, agregado_tipo, agregado_id, seq, payload, autor_tipo, autor_id, chave_idempotencia)
         VALUES ('cliente_criado', 'cliente', $1, 1, $2, $4, $5, $3)`,
        [
          cliente.id, JSON.stringify({ telefone: telefoneLimpo, reivindicado: false }), chave,
          // Quem digitou o telefone é o autor. Sem lojista identificado (uso
          // interno, migração), o autor é o sistema — nunca um lojista
          // anônimo, que o CHECK de autor identificado recusa e com razão.
          autorReal ? 'lojista' : 'sistema', autorReal,
        ],
      );
      return { cliente, criada: true };
    });
  } catch (erro) {
    // Dois lojistas digitando o mesmo telefone ao mesmo tempo: o UNIQUE
    // arbitra e o perdedor lê a conta do vencedor. Nunca duas contas para
    // o mesmo número (Lei 9 — a garantia é a constraint, não a ordem).
    if (erro && erro.code === '23505' && erro.constraint === 'clientes_telefone_unico') {
      const cliente = await buscaClientePorTelefone(pool, telefoneLimpo);
      if (cliente) return { cliente, criada: false };
    }
    if (ehDisputaDePosicao(erro)) {
      const replay = await tentaReplayEvento(pool, {
        chave, tipo: 'cliente_criado', agregadoTipo: 'cliente', agregadoId: null,
        confereDados: (p) => p.telefone === telefoneLimpo,
      });
      if (replay) return { cliente: await buscaCliente(pool, replay.agregado_id), criada: false };
      const cliente = await buscaClientePorTelefone(pool, telefoneLimpo);
      if (cliente) return { cliente, criada: false };
      throw new Error(`chave de idempotência ${chave} conflitou mas não foi encontrada`);
    }
    throw erro;
  }
}

// A conta passa a ser dele. Idempotente por natureza: reivindicar duas vezes
// não muda nada e não é erro — a segunda vez é a mesma verdade.
//
// O UPDATE é CONDICIONAL (`reivindicado_em IS NULL`) e o evento só é gravado
// se ele tiver mudado a linha: é assim que duas confirmações simultâneas do
// mesmo código não geram dois eventos de reivindicação (Lei 9).
async function reivindica(pool, { clienteId, nome }) {
  const nomeLimpo = nome === undefined || nome === null ? null : exigeTexto(nome, 'nome');

  return emTransacao(pool, async (conexao) => {
    const { rows: [reivindicado] } = await conexao.query(
      `UPDATE clientes
          SET reivindicado_em = now(), nome = COALESCE($2, nome), seq = seq + 1, atualizado_em = now()
        WHERE id = $1 AND reivindicado_em IS NULL
        RETURNING *`,
      [clienteId, nomeLimpo],
    );
    if (!reivindicado) {
      const jaExiste = await conexao.query('SELECT * FROM clientes WHERE id = $1', [clienteId]);
      if (!jaExiste.rows[0]) {
        throw new ErroDeDominio(CODIGOS.CLIENTE_INEXISTENTE, `cliente ${clienteId} não existe`);
      }
      return { cliente: jaExiste.rows[0], repetida: true };
    }
    await conexao.query(
      `INSERT INTO eventos (tipo, agregado_tipo, agregado_id, seq, payload, autor_tipo, autor_id)
       VALUES ('cliente_reivindicado', 'cliente', $1, $2, $3, 'cliente', $1)`,
      [clienteId, reivindicado.seq, JSON.stringify({ nome: nomeLimpo })],
    );
    return { cliente: reivindicado, repetida: false };
  });
}

module.exports = {
  garanteCliente, reivindica, buscaCliente, buscaClientePorTelefone,
};
