'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');

const { montaApi } = require('../src/http/api');
const { emiteSessao } = require('../src/http/sessoes');
const contas = require('../src/dominio/contas');
const { poolApp } = require('./ajuda-maquina');
const { cadastroValidoDeMotoboy, donoDeTeste, atendimentoDeTeste } = require('./ajuda-contas');

function corpoDeCadastro(dados) {
  return {
    nome: dados.nome,
    telefone: dados.telefone,
    cpf: dados.cpf,
    chave_pix: dados.chavePix,
    cnh_ref: dados.cnhRef,
    crlv_ref: dados.crlvRef,
    selfie_ref: dados.selfieRef,
    aparelho_id: dados.aparelhoId,
  };
}

test('API de cadastro e sessão', async (t) => {
  const pool = poolApp();
  const app = express();
  app.use(montaApi(pool));
  const servidor = app.listen(0);
  await new Promise((resolve) => { servidor.on('listening', resolve); });
  const base = `http://127.0.0.1:${servidor.address().port}`;

  t.after(async () => {
    servidor.close();
    await pool.end();
  });

  async function chama(metodo, caminho, { corpo, token } = {}) {
    const resposta = await fetch(base + caminho, {
      method: metodo,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await resposta.text();
    return { status: resposta.status, corpo: texto ? JSON.parse(texto) : null };
  }

  async function sessaoDeOperador(operador) {
    const { token } = await emiteSessao(pool, { atorTipo: 'operador', atorId: operador.id });
    return token;
  }

  await t.test('cadastro de motoboy pela API: 201, sessão emitida, saque travado', async () => {
    const { status, corpo } = await chama('POST', '/motoboys', {
      corpo: corpoDeCadastro(cadastroValidoDeMotoboy()),
    });
    assert.equal(status, 201);
    assert.equal(corpo.motoboy.situacao, 'ativa');
    assert.equal(corpo.motoboy.primeiro_saque, 'travado');
    assert.ok(corpo.sessao.token);
  });

  await t.test('chave Pix de outro CPF pela API: 422 no ato', async () => {
    const dados = cadastroValidoDeMotoboy();
    const outra = cadastroValidoDeMotoboy();
    const { status, corpo } = await chama('POST', '/motoboys', {
      corpo: { ...corpoDeCadastro(dados), chave_pix: outra.cpf },
    });
    assert.equal(status, 422);
    assert.equal(corpo.erro, 'chave_pix_de_outro_cpf');
  });

  await t.test('segundo aparelho na mesma conta é recusado; troca pela operação reabilita e grava evento', async () => {
    const dados = cadastroValidoDeMotoboy();
    const cadastro = await chama('POST', '/motoboys', { corpo: corpoDeCadastro(dados) });
    assert.equal(cadastro.status, 201);
    const motoboyId = cadastro.corpo.motoboy.id;

    // Mesmo aparelho: entra.
    const mesma = await chama('POST', '/sessoes/motoboy', {
      corpo: { cpf: dados.cpf, aparelho_id: dados.aparelhoId },
    });
    assert.equal(mesma.status, 201);

    // Segundo aparelho: recusado, não avisado.
    const segunda = await chama('POST', '/sessoes/motoboy', {
      corpo: { cpf: dados.cpf, aparelho_id: 'aparelho-roubado' },
    });
    assert.equal(segunda.status, 403);
    assert.equal(segunda.corpo.erro, 'aparelho_nao_autorizado');

    // Troca é ação da operação, registrada como evento — nunca automática.
    const atendimento = await atendimentoDeTeste(pool);
    const troca = await chama('POST', `/painel/motoboys/${motoboyId}/troca-de-aparelho`, {
      corpo: { aparelho_id: 'aparelho-novo' },
      token: await sessaoDeOperador(atendimento),
    });
    assert.equal(troca.status, 204);
    const { rows: eventos } = await pool.query(
      `SELECT autor_tipo, autor_id, payload FROM eventos
       WHERE agregado_tipo = 'motoboy' AND agregado_id = $1 AND tipo = 'aparelho_trocado'`,
      [motoboyId],
    );
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].autor_tipo, 'painel');
    assert.equal(eventos[0].autor_id, atendimento.id);

    const nova = await chama('POST', '/sessoes/motoboy', {
      corpo: { cpf: dados.cpf, aparelho_id: 'aparelho-novo' },
    });
    assert.equal(nova.status, 201);
    const velha = await chama('POST', '/sessoes/motoboy', {
      corpo: { cpf: dados.cpf, aparelho_id: dados.aparelhoId },
    });
    assert.equal(velha.status, 403);
  });

  await t.test('lojista: entra com nome e telefone; cartão exige a própria sessão', async () => {
    const cadastro = await chama('POST', '/lojistas', {
      corpo: { nome: 'Loja API', telefone: `88 2${randomUUID().slice(0, 10)}` },
    });
    assert.equal(cadastro.status, 201);
    assert.equal(cadastro.corpo.lojista.pode_pedir, false);
    const token = cadastro.corpo.sessao.token;

    const semSessao = await chama('POST', '/lojistas/cartao', {
      corpo: { cartao_ref: 'cartao-x' },
    });
    assert.equal(semSessao.status, 401);

    const comSessao = await chama('POST', '/lojistas/cartao', {
      corpo: { cartao_ref: 'cartao-x' }, token,
    });
    assert.equal(comSessao.status, 201);
    assert.equal(comSessao.corpo.lojista.pode_pedir, true);
  });

  await t.test('atendimento recebe 403 em estorno e em bloqueio; dono passa', async () => {
    const dados = cadastroValidoDeMotoboy();
    const cadastro = await chama('POST', '/motoboys', { corpo: corpoDeCadastro(dados) });
    const motoboyId = cadastro.corpo.motoboy.id;

    const dono = await donoDeTeste(pool);
    const atendimento = await atendimentoDeTeste(pool);
    const tokenDono = await sessaoDeOperador(dono);
    const tokenAtendimento = await sessaoDeOperador(atendimento);

    const estornoAtendimento = await chama('POST', `/painel/corridas/${randomUUID()}/estorno`, {
      corpo: {}, token: tokenAtendimento,
    });
    assert.equal(estornoAtendimento.status, 403);
    assert.equal(estornoAtendimento.corpo.erro, 'papel_insuficiente');

    const bloqueioAtendimento = await chama('POST', `/painel/motoboys/${motoboyId}/bloqueio`, {
      corpo: { motivo: 'tentativa' }, token: tokenAtendimento,
    });
    assert.equal(bloqueioAtendimento.status, 403);

    const estornoDono = await chama('POST', `/painel/corridas/${randomUUID()}/estorno`, {
      corpo: {}, token: tokenDono,
    });
    assert.equal(estornoDono.status, 202);
    assert.equal(estornoDono.corpo.efeito, 'nenhum_ate_a_etapa_4');
    const { rows: atos } = await pool.query(
      `SELECT autor_tipo, autor_id FROM eventos
       WHERE agregado_tipo = 'operador' AND agregado_id = $1 AND tipo = 'estorno_autorizado'`,
      [dono.id],
    );
    assert.ok(atos.length >= 1, 'estorno autorizado gera evento com autor');
    assert.equal(atos[0].autor_tipo, 'painel');

    const bloqueioDono = await chama('POST', `/painel/motoboys/${motoboyId}/bloqueio`, {
      corpo: { motivo: 'fraude' }, token: tokenDono,
    });
    assert.equal(bloqueioDono.status, 204);

    // Conta bloqueada não entra mais.
    const sessaoBloqueada = await chama('POST', '/sessoes/motoboy', {
      corpo: { cpf: dados.cpf, aparelho_id: dados.aparelhoId },
    });
    assert.equal(sessaoBloqueada.status, 403);
    assert.equal(sessaoBloqueada.corpo.erro, 'conta_bloqueada');
  });

  await t.test('requisição forjando papel de dono no corpo é ignorada — papel sai do servidor', async () => {
    const dados = cadastroValidoDeMotoboy();
    const cadastro = await chama('POST', '/motoboys', { corpo: corpoDeCadastro(dados) });
    const motoboyId = cadastro.corpo.motoboy.id;

    const dono = await donoDeTeste(pool);
    const atendimento = await atendimentoDeTeste(pool);
    const tokenAtendimento = await sessaoDeOperador(atendimento);

    const forjada = await chama('POST', `/painel/motoboys/${motoboyId}/bloqueio`, {
      corpo: {
        motivo: 'golpe',
        papel: 'dono',
        ator_id: dono.id,
        id: dono.id,
        situacao: 'ativa',
      },
      token: tokenAtendimento,
    });
    assert.equal(forjada.status, 403, 'papel do corpo não pode valer');

    const forjadaEstorno = await chama('POST', `/painel/corridas/${randomUUID()}/estorno`, {
      corpo: { papel: 'dono', id: dono.id }, token: tokenAtendimento,
    });
    assert.equal(forjadaEstorno.status, 403);

    const { rows: [motoboy] } = await pool.query('SELECT situacao FROM motoboys WHERE id = $1', [motoboyId]);
    assert.equal(motoboy.situacao, 'ativa', 'o bloqueio forjado não aconteceu');
  });

  await t.test('atendimento não cria operador; dono cria', async () => {
    const dono = await donoDeTeste(pool);
    const atendimento = await atendimentoDeTeste(pool);

    const negado = await chama('POST', '/operadores', {
      corpo: { nome: 'Novo', papel: 'atendimento' },
      token: await sessaoDeOperador(atendimento),
    });
    assert.equal(negado.status, 403);

    const criado = await chama('POST', '/operadores', {
      corpo: { nome: 'Novo Atendente', papel: 'atendimento' },
      token: await sessaoDeOperador(dono),
    });
    assert.equal(criado.status, 201);
    assert.equal(criado.corpo.operador.papel, 'atendimento');
  });

  await t.test('rota de painel sem sessão: 401; com sessão de motoboy: 403', async () => {
    const semSessao = await chama('POST', `/painel/motoboys/${randomUUID()}/bloqueio`, {
      corpo: { motivo: 'x' },
    });
    assert.equal(semSessao.status, 401);

    const dados = cadastroValidoDeMotoboy();
    const cadastro = await chama('POST', '/motoboys', { corpo: corpoDeCadastro(dados) });
    const comSessaoErrada = await chama('POST', `/painel/motoboys/${randomUUID()}/bloqueio`, {
      corpo: { motivo: 'x' }, token: cadastro.corpo.sessao.token,
    });
    assert.equal(comSessaoErrada.status, 403);
  });
});
