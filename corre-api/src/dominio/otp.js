'use strict';

// Re-login por código de 6 dígitos (SMS), para lojista e operador.
//
// Garantias:
// - Código nunca em claro: só o hash (sha256, ligado ao telefone) fica no
//   banco — mesmo tratamento do token de sessão.
// - Expira em 10 min, uso único, no máximo 5 tentativas erradas por código
//   (ao estourar, o código morre e é preciso pedir outro).
// - Limite de envios por telefone e por IP, para o endpoint não virar
//   torneira de SMS pago.
// - Tempo é sempre do servidor (now() do banco).
// - Envio de SMS é injetado (interface): nenhum provedor real aqui.

const { createHash, randomInt } = require('node:crypto');

const config = require('../config');
const { ErroDeDominio, CODIGOS } = require('./erros');
const { emTransacao } = require('./nucleo');
const {
  buscaLojistaPorTelefone, buscaOperadorPorTelefone, registraLogin,
} = require('./contas');

function hashDoCodigo(telefone, codigo) {
  return createHash('sha256').update(`${telefone}:${codigo}`).digest('hex');
}

function geraCodigo() {
  // 6 dígitos, sem viés (randomInt é uniforme), sem ponto flutuante.
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

async function resolveAtor(pool, atorTipo, telefone) {
  if (atorTipo === 'lojista') return buscaLojistaPorTelefone(pool, telefone);
  if (atorTipo === 'operador') return buscaOperadorPorTelefone(pool, telefone);
  throw new ErroDeDominio(CODIGOS.CAMPO_OBRIGATORIO, 'ator_tipo precisa ser lojista ou operador');
}

// Solicita um código. Sempre registra a tentativa de envio (conta para o
// limite, mesmo com telefone inexistente — anti-abuso e anti-enumeração) e
// só envia SMS se houver conta ativa com aquele telefone. Resposta é
// genérica: não revela se o telefone existe.
async function solicitaCodigo(pool, {
  telefone, atorTipo, ip, enviarSms,
}) {
  if (typeof telefone !== 'string' || telefone.trim() === '') {
    throw new ErroDeDominio(CODIGOS.CAMPO_OBRIGATORIO, 'telefone obrigatório');
  }
  if (!['lojista', 'operador'].includes(atorTipo)) {
    throw new ErroDeDominio(CODIGOS.CAMPO_OBRIGATORIO, 'ator_tipo precisa ser lojista ou operador');
  }
  const janelaSegs = config.otpJanelaEnviosMs() / 1000;

  // Limite por telefone e por IP, ATÔMICO: check-then-insert serializado por
  // advisory lock de transação (por telefone e por IP), senão N pedidos
  // concorrentes leem a mesma contagem e furam o limite (torneira de SMS).
  const veredito = await emTransacao(pool, async (conexao) => {
    await conexao.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`otp-tel:${telefone}`]);
    if (ip) {
      await conexao.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`otp-ip:${ip}`]);
    }
    const { rows: [contaTelefone] } = await conexao.query(
      `SELECT count(*)::int AS n FROM otp_envios
       WHERE telefone = $1 AND criado_em > now() - make_interval(secs => $2)`,
      [telefone, janelaSegs],
    );
    if (contaTelefone.n >= config.otpMaxEnviosPorTelefone()) {
      return { ok: false };
    }
    if (ip) {
      const { rows: [contaIp] } = await conexao.query(
        `SELECT count(*)::int AS n FROM otp_envios
         WHERE ip = $1 AND criado_em > now() - make_interval(secs => $2)`,
        [ip, janelaSegs],
      );
      if (contaIp.n >= config.otpMaxEnviosPorIp()) {
        return { ok: false };
      }
    }
    // A tentativa conta para o limite antes de qualquer envio.
    await conexao.query('INSERT INTO otp_envios (telefone, ip) VALUES ($1, $2)', [telefone, ip || null]);
    return { ok: true };
  });
  if (!veredito.ok) {
    throw new ErroDeDominio(CODIGOS.LIMITE_DE_ENVIO, 'limite de envios atingido');
  }

  const ator = await resolveAtor(pool, atorTipo, telefone);
  if (!ator || ator.situacao !== 'ativa') {
    // Não revela existência; nada é enviado.
    return { enviado: false };
  }

  const codigo = geraCodigo();
  await pool.query(
    `INSERT INTO codigos_otp (ator_tipo, ator_id, telefone, codigo_hash, max_tentativas, expira_em)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
    [atorTipo, ator.id, telefone, hashDoCodigo(telefone, codigo), config.otpMaxTentativas(), config.otpExpiraMs() / 1000],
  );

  await enviarSms({ telefone, texto: `Corre: seu código é ${codigo}` });
  return { enviado: true };
}

// Confirma um código. No sucesso, grava evento de login e devolve o ator;
// a emissão de sessão fica com a camada http (DI, sem dependência circular).
async function confirmaCodigo(pool, { telefone, atorTipo, codigo }) {
  if (typeof codigo !== 'string' || !/^[0-9]{6}$/.test(codigo)) {
    throw new ErroDeDominio(CODIGOS.CODIGO_INVALIDO, 'código inválido');
  }
  if (!['lojista', 'operador'].includes(atorTipo)) {
    throw new ErroDeDominio(CODIGOS.CAMPO_OBRIGATORIO, 'ator_tipo precisa ser lojista ou operador');
  }

  // Só o código MAIS RECENTE do telefone vale; pedir outro invalida o
  // anterior. Expiração é julgada pelo relógio do BANCO (now()), não do
  // processo — relógio de processo pode divergir.
  const { rows: [registro] } = await pool.query(
    `SELECT id, ator_id, tentativas, max_tentativas,
            (now() >= expira_em) AS expirado, usado_em, morto_em
     FROM codigos_otp
     WHERE ator_tipo = $1 AND telefone = $2
     ORDER BY criado_em DESC LIMIT 1`,
    [atorTipo, telefone],
  );
  if (!registro || registro.usado_em || registro.morto_em) {
    throw new ErroDeDominio(CODIGOS.CODIGO_INVALIDO, 'código inválido');
  }
  if (registro.expirado) {
    throw new ErroDeDominio(CODIGOS.CODIGO_EXPIRADO, 'código expirado');
  }

  // CLAIM ATÔMICO de um slot de tentativa ANTES de comparar o hash: o
  // incremento condicionado (tentativas < max) serializa no banco, então
  // no máximo max_tentativas comparações contra o código vivo acontecem,
  // mesmo sob N confirmações concorrentes (senão o cap de força bruta é
  // furado por lost update). Relógio do banco no WHERE.
  const { rows: [slot] } = await pool.query(
    `UPDATE codigos_otp SET tentativas = tentativas + 1
     WHERE id = $1 AND usado_em IS NULL AND morto_em IS NULL
       AND now() < expira_em AND tentativas < max_tentativas
     RETURNING tentativas, max_tentativas, codigo_hash, ator_id`,
    [registro.id],
  );
  if (!slot) {
    // Corrida: entre o SELECT e agora o código foi usado/morto/expirou ou
    // esgotou as tentativas.
    throw new ErroDeDominio(CODIGOS.CODIGO_INVALIDO, 'código inválido');
  }

  const confere = hashDoCodigo(telefone, codigo) === slot.codigo_hash;
  if (!confere) {
    if (slot.tentativas >= slot.max_tentativas) {
      // Esgotou: o código morre (é preciso pedir outro).
      await pool.query(
        'UPDATE codigos_otp SET morto_em = now() WHERE id = $1 AND morto_em IS NULL',
        [registro.id],
      );
    }
    throw new ErroDeDominio(
      CODIGOS.CODIGO_INCORRETO,
      slot.tentativas >= slot.max_tentativas ? 'código incorreto; tentativas esgotadas, peça outro' : 'código incorreto',
    );
  }

  // Acerto: consome o código (uso único) e grava o login, atômico.
  return emTransacao(pool, async (conexao) => {
    const { rowCount } = await conexao.query(
      'UPDATE codigos_otp SET usado_em = now() WHERE id = $1 AND usado_em IS NULL',
      [registro.id],
    );
    if (rowCount !== 1) {
      // Corrida: outro pedido consumiu o mesmo código primeiro.
      throw new ErroDeDominio(CODIGOS.CODIGO_INVALIDO, 'código inválido');
    }
    await registraLogin(conexao, { atorTipo, atorId: slot.ator_id, via: 'otp' });
    return { atorTipo, atorId: slot.ator_id };
  });
}

module.exports = { solicitaCodigo, confirmaCodigo, hashDoCodigo };
