'use strict';

// API HTTP da Etapa 2: cadastro e sessão. Sem HTTP de negócio além disso.
//
// Regra 7 da etapa: identidade e papel saem SEMPRE do servidor (sessão →
// banco). Nada do corpo da requisição participa de autorização.
// A autorização de painel mora no domínio (contas.js), num lugar só; aqui
// só se resolve a sessão e se mapeia erro de domínio para status HTTP.

const express = require('express');

const { ErroDeDominio } = require('../dominio/erros');
const contas = require('../dominio/contas');
const { emiteSessao, emiteSessaoDeMotoboy, resolveSessao } = require('./sessoes');

const STATUS_POR_CODIGO = {
  campo_obrigatorio: 422,
  cpf_invalido: 422,
  chave_pix_de_outro_cpf: 422,
  cpf_ja_cadastrado: 409,
  telefone_ja_cadastrado: 409,
  genese_ja_feita: 409,
  conflito_de_concorrencia: 409,
  chave_reutilizada: 409,
  aparelho_nao_autorizado: 403,
  papel_insuficiente: 403,
  conta_bloqueada: 403,
  sessao_invalida: 401,
  conta_inexistente: 404,
  lojista_inexistente: 404,
  corrida_inexistente: 404,
  cartao_de_garantia_ausente: 422,
};

function montaApi(pool) {
  const roteador = express.Router();
  roteador.use(express.json());

  function tokenDaRequisicao(req) {
    const autorizacao = req.get('authorization') || '';
    if (autorizacao.startsWith('Bearer ')) return autorizacao.slice(7);
    return req.get('x-sessao') || null;
  }

  // Sessão resolvida no servidor; o corpo da requisição NÃO participa.
  function exigeSessao(...tipos) {
    return async (req, res, next) => {
      try {
        const ator = await resolveSessao(pool, tokenDaRequisicao(req));
        if (!ator) {
          res.status(401).json({ erro: 'sessao_invalida' });
          return;
        }
        if (!tipos.includes(ator.tipo)) {
          res.status(403).json({ erro: 'papel_insuficiente' });
          return;
        }
        req.ator = ator;
        next();
      } catch (erro) {
        next(erro);
      }
    };
  }

  // O operador que autoriza uma ação de painel é SEMPRE a linha do banco
  // apontada pela sessão — nunca qualquer campo do corpo.
  async function operadorDaSessao(req) {
    const operador = await contas.buscaOperador(pool, req.ator.id);
    return operador;
  }

  function trata(handler) {
    return async (req, res, next) => {
      try {
        await handler(req, res);
      } catch (erro) {
        if (erro instanceof ErroDeDominio) {
          res.status(STATUS_POR_CODIGO[erro.codigo] || 422).json({
            erro: erro.codigo,
            mensagem: erro.message,
          });
          return;
        }
        next(erro);
      }
    };
  }

  roteador.get('/saude', (req, res) => res.json({ ok: true }));

  // ------------------------------------------------------------- motoboy
  roteador.post('/motoboys', trata(async (req, res) => {
    const corpo = req.body || {};
    const { conta, repetida } = await contas.cadastraMotoboy(pool, {
      nome: corpo.nome,
      telefone: corpo.telefone,
      cpf: corpo.cpf,
      chavePix: corpo.chave_pix,
      cnhRef: corpo.cnh_ref,
      crlvRef: corpo.crlv_ref,
      selfieRef: corpo.selfie_ref,
      aparelhoId: corpo.aparelho_id,
      chaveIdempotencia: corpo.chave_idempotencia,
    });
    const sessao = await emiteSessao(pool, {
      atorTipo: 'motoboy', atorId: conta.id, aparelhoId: conta.aparelho_id,
    });
    res.status(repetida ? 200 : 201).json({
      motoboy: {
        id: conta.id, situacao: conta.situacao, primeiro_saque: conta.primeiro_saque,
      },
      sessao: { token: sessao.token },
    });
  }));

  roteador.post('/sessoes/motoboy', trata(async (req, res) => {
    const corpo = req.body || {};
    const sessao = await emiteSessaoDeMotoboy(pool, {
      cpf: corpo.cpf, aparelhoId: corpo.aparelho_id,
    });
    res.status(201).json({ sessao: { token: sessao.token } });
  }));

  // ------------------------------------------------------------- lojista
  roteador.post('/lojistas', trata(async (req, res) => {
    const corpo = req.body || {};
    const { conta, repetida } = await contas.cadastraLojista(pool, {
      nome: corpo.nome, telefone: corpo.telefone, chaveIdempotencia: corpo.chave_idempotencia,
    });
    const sessao = await emiteSessao(pool, { atorTipo: 'lojista', atorId: conta.id });
    res.status(repetida ? 200 : 201).json({
      lojista: {
        id: conta.id,
        situacao: conta.situacao,
        pode_pedir: conta.cartao_registrado_em !== null,
      },
      sessao: { token: sessao.token },
    });
  }));

  roteador.post('/lojistas/cartao', exigeSessao('lojista'), trata(async (req, res) => {
    const corpo = req.body || {};
    const { conta } = await contas.registraCartao(pool, {
      lojistaId: req.ator.id, cartaoRef: corpo.cartao_ref, chaveIdempotencia: corpo.chave_idempotencia,
    });
    res.status(201).json({
      lojista: { id: conta.id, pode_pedir: conta.cartao_registrado_em !== null },
    });
  }));

  // -------------------------------------------------------------- painel
  roteador.post('/operadores', exigeSessao('operador'), trata(async (req, res) => {
    const corpo = req.body || {};
    const autor = await operadorDaSessao(req);
    const { conta } = await contas.criaOperador(pool, {
      nome: corpo.nome, papel: corpo.papel, autor, chaveIdempotencia: corpo.chave_idempotencia,
    });
    const sessao = await emiteSessao(pool, { atorTipo: 'operador', atorId: conta.id });
    res.status(201).json({
      operador: { id: conta.id, papel: conta.papel },
      sessao: { token: sessao.token },
    });
  }));

  roteador.post('/painel/motoboys/:id/bloqueio', exigeSessao('operador'), trata(async (req, res) => {
    const autor = await operadorDaSessao(req);
    await contas.bloqueiaMotoboy(pool, {
      motoboyId: req.params.id,
      motivo: (req.body || {}).motivo,
      autor,
      chaveIdempotencia: (req.body || {}).chave_idempotencia,
    });
    res.status(204).end();
  }));

  roteador.post('/painel/motoboys/:id/liberacao-de-saque', exigeSessao('operador'), trata(async (req, res) => {
    const autor = await operadorDaSessao(req);
    await contas.liberaPrimeiroSaque(pool, {
      motoboyId: req.params.id,
      autor,
      chaveIdempotencia: (req.body || {}).chave_idempotencia,
    });
    res.status(204).end();
  }));

  roteador.post('/painel/motoboys/:id/troca-de-aparelho', exigeSessao('operador'), trata(async (req, res) => {
    const autor = await operadorDaSessao(req);
    await contas.trocaAparelho(pool, {
      motoboyId: req.params.id,
      novoAparelhoId: (req.body || {}).aparelho_id,
      autor,
      chaveIdempotencia: (req.body || {}).chave_idempotencia,
    });
    res.status(204).end();
  }));

  roteador.post('/painel/corridas/:id/estorno', exigeSessao('operador'), trata(async (req, res) => {
    const autor = await operadorDaSessao(req);
    await contas.autorizaEstornoSemEfeito(pool, {
      corridaId: req.params.id,
      autor,
      chaveIdempotencia: (req.body || {}).chave_idempotencia,
    });
    res.status(202).json({ efeito: 'nenhum_ate_a_etapa_4' });
  }));

  return roteador;
}

module.exports = { montaApi };
