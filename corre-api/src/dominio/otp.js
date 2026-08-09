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
  const janela = config.otpJanelaEnviosMs();

  // Limite por telefone e por IP, na janela.
  const { rows: [porTelefone] } = await pool.query(
    `SELECT count(*)::int AS n FROM otp_envios
     WHERE telefone = $1 AND criado_em > now() - make_interval(secs => $2)`,
    [telefone, janela / 1000],
  );
  if (porTelefone.n >= config.otpMaxEnviosPorTelefone()) {
    throw new ErroDeDominio(CODIGOS.LIMITE_DE_ENVIO, 'limite de envios por telefone atingido');
  }
  if (ip) {
    const { rows: [porIp] } = await pool.query(
      `SELECT count(*)::int AS n FROM otp_envios
       WHERE ip = $1 AND criado_em > now() - make_interval(secs => $2)`,
      [ip, janela / 1000],
    );
    if (porIp.n >= config.otpMaxEnviosPorIp()) {
      throw new ErroDeDominio(CODIGOS.LIMITE_DE_ENVIO, 'limite de envios por IP atingido');
    }
  }

  // A tentativa conta para o limite antes de qualquer envio.
  await pool.query('INSERT INTO otp_envios (telefone, ip) VALUES ($1, $2)', [telefone, ip || null]);

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

  // Só o código MAIS RECENTE do telefone vale; pedir outro invalida o anterior.
  const { rows: [registro] } = await pool.query(
    `SELECT id, ator_id, codigo_hash, tentativas, max_tentativas, expira_em, usado_em, morto_em
     FROM codigos_otp
     WHERE ator_tipo = $1 AND telefone = $2
     ORDER BY criado_em DESC LIMIT 1`,
    [atorTipo, telefone],
  );
  // Código morto (tentativas esgotadas) é inválido. O USO ÚNICO é enforçado
  // num lugar só — o UPDATE atômico lá embaixo — para o controle negativo
  // ter um alvo único.
  if (!registro || registro.morto_em) {
    throw new ErroDeDominio(CODIGOS.CODIGO_INVALIDO, 'código inválido');
  }
  if (new Date(registro.expira_em).getTime() <= Date.now()) {
    throw new ErroDeDominio(CODIGOS.CODIGO_EXPIRADO, 'código expirado');
  }

  const confere = hashDoCodigo(telefone, codigo) === registro.codigo_hash;
  if (!confere) {
    // Tentativa errada: incrementa e, ao estourar, mata o código.
    const novasTentativas = registro.tentativas + 1;
    const morre = novasTentativas >= registro.max_tentativas;
    await pool.query(
      `UPDATE codigos_otp SET tentativas = $2, morto_em = CASE WHEN $3 THEN now() ELSE morto_em END
       WHERE id = $1`,
      [registro.id, novasTentativas, morre],
    );
    throw new ErroDeDominio(
      CODIGOS.CODIGO_INCORRETO,
      morre ? 'código incorreto; tentativas esgotadas, peça outro' : 'código incorreto',
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
      throw new ErroDeDominio(CODIGOS.CODIGO_INVALIDO, 'código inválido ou já usado');
    }
    await registraLogin(conexao, { atorTipo, atorId: registro.ator_id, via: 'otp' });
    return { atorTipo, atorId: registro.ator_id };
  });
}

module.exports = { solicitaCodigo, confirmaCodigo, hashDoCodigo };
