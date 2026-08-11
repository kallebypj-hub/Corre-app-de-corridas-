'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');

const { createHash } = require('node:crypto');
const { Pool } = require('pg');

const { montaApi } = require('../src/http/api');
const { emiteSessao, resolveSessao } = require('../src/http/sessoes');
const contas = require('../src/dominio/contas');
const { poolApp, SOBRAL } = require('./ajuda-maquina');
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

  // Antes de existir sessão a cidade vem do corpo (a API exige). A bateria
  // injeta Sobral em todo POST que não declare outra — o teste de isolamento
  // por cidade é outro, e declara as duas de propósito.
  async function chama(metodo, caminho, { corpo, token } = {}) {
    if (metodo === 'POST' && corpo && typeof corpo === 'object' && corpo.cidade_id === undefined) {
      corpo = { ...corpo, cidade_id: SOBRAL };
    }
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

  await t.test('REPLAY NÃO EMITE CREDENCIAL: (CPF + chave) de outro aparelho não vira sessão do motoboy', async () => {
    // A chave de idempotência é um id que o cliente gera — nunca foi
    // desenhada como segredo. Enquanto o replay emitia sessão a partir da
    // conta encontrada, ela era o ÚNICO fator entre um estranho e a conta:
    // devolvia token válido COM o aparelho da vítima, contornando a trava de
    // um-aparelho-por-conta sem nunca acionar `/sessoes/motoboy`.
    const dados = cadastroValidoDeMotoboy();
    const chave = `cad-${randomUUID()}`;
    const daVitima = await chama('POST', '/motoboys', {
      corpo: { ...corpoDeCadastro(dados), chave_idempotencia: chave },
    });
    assert.equal(daVitima.status, 201);
    const idDaVitima = daVitima.corpo.motoboy.id;

    // Controle: o login direto do atacante já era recusado — é a trava que
    // o replay contornava.
    const login = await chama('POST', '/sessoes/motoboy', {
      corpo: { cpf: dados.cpf, aparelho_id: 'aparelho-do-atacante' },
    });
    assert.equal(login.status, 403);
    assert.equal(login.corpo.erro, 'aparelho_nao_autorizado');

    // O ataque: mesma chave, mesmo CPF, OUTRO aparelho.
    const ataque = await chama('POST', '/motoboys', {
      corpo: {
        ...corpoDeCadastro({ ...dados, aparelhoId: 'aparelho-do-atacante' }),
        chave_idempotencia: chave,
      },
    });
    assert.ok(ataque.status >= 400, `o ataque recebeu ${ataque.status}`);
    assert.ok(!ataque.corpo.sessao, 'o ataque não pode receber sessão nenhuma');
    assert.ok(
      !JSON.stringify(ataque.corpo).includes(idDaVitima),
      'a resposta não pode confirmar a conta da vítima',
    );

    // E a Lei 5 continua de pé para o DONO: mesma chave, MESMO aparelho,
    // retentativa byte a byte idêntica é operação nula com sessão emitida
    // pela prova (CPF + aparelho), não pelo atalho.
    const retentativa = await chama('POST', '/motoboys', {
      corpo: { ...corpoDeCadastro(dados), chave_idempotencia: chave },
    });
    assert.equal(retentativa.status, 200);
    assert.equal(retentativa.corpo.motoboy.id, idDaVitima);
    const ator = await resolveSessao(pool, retentativa.corpo.sessao.token);
    assert.equal(ator.id, idDaVitima);
    assert.equal(ator.aparelhoId, dados.aparelhoId);
  });

  await t.test('REPLAY NÃO EMITE CREDENCIAL: (telefone + chave) do lojista não vira sessão nem confirma a conta', async () => {
    const telefone = `88 2${randomUUID().slice(0, 10)}`;
    const chave = `cad-${randomUUID()}`;
    const daVitima = await chama('POST', '/lojistas', {
      corpo: { nome: 'Loja da Vítima', telefone, chave_idempotencia: chave },
    });
    assert.equal(daVitima.status, 201);
    const idDaVitima = daVitima.corpo.lojista.id;

    const ataque = await chama('POST', '/lojistas', {
      corpo: { nome: 'Atacante', telefone, chave_idempotencia: chave },
    });
    // Lei 5: a retentativa é operação NULA, não erro. Mas não é login.
    assert.equal(ataque.status, 200);
    assert.equal(ataque.corpo.sessao, null, 'replay não emite credencial');
    assert.ok(
      !JSON.stringify(ataque.corpo).includes(idDaVitima),
      'a resposta repetida não pode confirmar a conta alheia',
    );

    // O cartão continua exigindo a sessão do próprio lojista: sem token, 401.
    const cartao = await chama('POST', '/lojistas/cartao', { corpo: { cartao_ref: 'do-atacante' } });
    assert.equal(cartao.status, 401);
  });

  await t.test('sessão nasce de PROVA: cadastro de motoboy bloqueado por fora não emite token nem no replay', async () => {
    // A porta é a mesma do login, então ela carrega o que o login carrega —
    // inclusive a recusa de conta bloqueada.
    const dados = cadastroValidoDeMotoboy();
    const chave = `cad-${randomUUID()}`;
    const cadastro = await chama('POST', '/motoboys', {
      corpo: { ...corpoDeCadastro(dados), chave_idempotencia: chave },
    });
    assert.equal(cadastro.status, 201);
    await pool.query('UPDATE motoboys SET situacao = $2 WHERE id = $1', [cadastro.corpo.motoboy.id, 'bloqueada']);

    const retentativa = await chama('POST', '/motoboys', {
      corpo: { ...corpoDeCadastro(dados), chave_idempotencia: chave },
    });
    assert.equal(retentativa.status, 403);
    assert.equal(retentativa.corpo.erro, 'conta_bloqueada');
  });

  await t.test('atendimento recebe 403 em estorno e em bloqueio; dono passa', async () => {
    const dados = cadastroValidoDeMotoboy();
    const cadastro = await chama('POST', '/motoboys', { corpo: corpoDeCadastro(dados) });
    const motoboyId = cadastro.corpo.motoboy.id;

    const dono = await donoDeTeste(pool);
    const atendimento = await atendimentoDeTeste(pool);
    const tokenDono = await sessaoDeOperador(dono);
    const tokenAtendimento = await sessaoDeOperador(atendimento);

    // Corrida real: o estorno passou a validar existência (auditoria não
    // referencia corrida fantasma). O 403 de papel vem antes desse check.
    const lojistaCad = await chama('POST', '/lojistas', {
      corpo: { nome: 'Loja Estorno', telefone: `88 4${randomUUID().slice(0, 10)}` },
    });
    await chama('POST', '/lojistas/cartao', {
      corpo: { cartao_ref: 'c' }, token: lojistaCad.corpo.sessao.token,
    });
    const { conta: lojista } = await contas.buscaLojista(pool, lojistaCad.corpo.lojista.id)
      .then((l) => ({ conta: l }));
    const { criaCorrida } = require('../src/dominio/corridas');
    const { corrida } = await criaCorrida(pool, {
      autorTipo: 'lojista', autorId: lojista.id, payload: {},
    });

    const estornoAtendimento = await chama('POST', `/painel/corridas/${corrida.id}/estorno`, {
      corpo: {}, token: tokenAtendimento,
    });
    assert.equal(estornoAtendimento.status, 403);
    assert.equal(estornoAtendimento.corpo.erro, 'papel_insuficiente');

    const bloqueioAtendimento = await chama('POST', `/painel/motoboys/${motoboyId}/bloqueio`, {
      corpo: { motivo: 'tentativa' }, token: tokenAtendimento,
    });
    assert.equal(bloqueioAtendimento.status, 403);

    const estornoDono = await chama('POST', `/painel/corridas/${corrida.id}/estorno`, {
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
      corpo: { nome: 'Novo', telefone: `op-${randomUUID()}`, papel: 'atendimento' },
      token: await sessaoDeOperador(atendimento),
    });
    assert.equal(negado.status, 403);

    const criado = await chama('POST', '/operadores', {
      corpo: { nome: 'Novo Atendente', telefone: `op-${randomUUID()}`, papel: 'atendimento' },
      token: await sessaoDeOperador(dono),
    });
    assert.equal(criado.status, 201);
    assert.equal(criado.corpo.operador.papel, 'atendimento');

    // Todo ato de cadastro relevante gera evento com autor (Lei 2 / regra 6).
    const { rows: eventos } = await pool.query(
      `SELECT autor_tipo, autor_id, payload FROM eventos
       WHERE agregado_tipo = 'operador' AND agregado_id = $1 AND tipo = 'operador_cadastrado'`,
      [criado.corpo.operador.id],
    );
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].autor_tipo, 'painel');
    assert.equal(eventos[0].autor_id, dono.id);
    assert.equal(eventos[0].payload.papel, 'atendimento');
  });

  await t.test('sessão vencida devolve 401 (validade é verificada)', async () => {
    const dados = cadastroValidoDeMotoboy();
    const cadastro = await chama('POST', '/motoboys', { corpo: corpoDeCadastro(dados) });
    const token = cadastro.corpo.sessao.token;

    // Retroage a validade como dono (corre_app não atualiza sessoes).
    const dono = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    try {
      const hash = createHash('sha256').update(token).digest('hex');
      const { rowCount } = await dono.query(
        "UPDATE sessoes SET expira_em = now() - interval '1 minute' WHERE token_hash = $1",
        [hash],
      );
      assert.equal(rowCount, 1);
    } finally {
      await dono.end();
    }

    // A rota de troca de aparelho exige sessão de operador; aqui o ponto é
    // que a sessão de motoboy vencida não resolve mais para nenhuma rota.
    const comVencida = await chama('POST', '/lojistas/cartao', {
      corpo: { cartao_ref: 'x' }, token,
    });
    assert.equal(comVencida.status, 401);
  });

  await t.test('só o hash do token fica no banco — nunca o token em claro', async () => {
    const dados = cadastroValidoDeMotoboy();
    const cadastro = await chama('POST', '/motoboys', { corpo: corpoDeCadastro(dados) });
    const token = cadastro.corpo.sessao.token;

    const emClaro = await pool.query('SELECT 1 FROM sessoes WHERE token_hash = $1', [token]);
    assert.equal(emClaro.rowCount, 0, 'o token em claro NÃO pode ser chave no banco');

    const hash = createHash('sha256').update(token).digest('hex');
    const porHash = await pool.query(
      'SELECT ator_tipo FROM sessoes WHERE token_hash = $1', [hash],
    );
    assert.equal(porHash.rowCount, 1);
    assert.equal(porHash.rows[0].ator_tipo, 'motoboy');
  });

  await t.test('resolveSessao revalida a conta viva: conta desativada por fora invalida o token mesmo sem apagar a sessão', async () => {
    // Isola a revalidação do segundo cinto (o DELETE no bloqueio): aqui a
    // situação é adulterada direto no banco, sem passar pelo domínio que
    // apagaria a sessão. Só a revalidação em resolveSessao segura.
    const dados = cadastroValidoDeMotoboy();
    const { conta } = await contas.cadastraMotoboy(pool, dados);
    const { token } = await emiteSessao(pool, {
      atorTipo: 'motoboy', atorId: conta.id, aparelhoId: dados.aparelhoId,
    });
    assert.ok(await resolveSessao(pool, token), 'sessão resolve enquanto a conta está ativa');

    const dono = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    try {
      await dono.query("UPDATE motoboys SET situacao = 'bloqueada' WHERE id = $1", [conta.id]);
    } finally {
      await dono.end();
    }
    assert.equal(
      await resolveSessao(pool, token),
      null,
      'conta desativada: a revalidação da conta viva invalida o token',
    );
  });

  await t.test('resolveSessao revalida o aparelho vinculado: sessão de aparelho que deixou de ser o da conta não resolve', async () => {
    const dados = cadastroValidoDeMotoboy();
    const { conta } = await contas.cadastraMotoboy(pool, dados);
    const { token } = await emiteSessao(pool, {
      atorTipo: 'motoboy', atorId: conta.id, aparelhoId: dados.aparelhoId,
    });
    assert.ok(await resolveSessao(pool, token));

    const dono = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    try {
      await dono.query("UPDATE motoboys SET aparelho_id = 'outro-aparelho' WHERE id = $1", [conta.id]);
    } finally {
      await dono.end();
    }
    assert.equal(await resolveSessao(pool, token), null, 'aparelho divergente invalida o token');
  });

  await t.test('bloqueio revoga a sessão viva do motoboy na hora (não vale 30 dias)', async () => {
    const dados = cadastroValidoDeMotoboy();
    const cadastro = await chama('POST', '/motoboys', { corpo: corpoDeCadastro(dados) });
    const motoboyId = cadastro.corpo.motoboy.id;
    const token = cadastro.corpo.sessao.token;

    // A sessão vale ANTES do bloqueio (prova por uma rota de motoboy).
    // Não há rota de negócio de motoboy nesta etapa; então valida-se via a
    // resolução direta: emite-se estado e confere-se pós-bloqueio.
    const dono = await donoDeTeste(pool);
    const bloqueio = await chama('POST', `/painel/motoboys/${motoboyId}/bloqueio`, {
      corpo: { motivo: 'fraude' }, token: await sessaoDeOperador(dono),
    });
    assert.equal(bloqueio.status, 204);

    // Sessão do token antigo não resolve mais: re-login também recusado.
    const reentrada = await chama('POST', '/sessoes/motoboy', {
      corpo: { cpf: dados.cpf, aparelho_id: dados.aparelhoId },
    });
    assert.equal(reentrada.status, 403);

    // E a sessão emitida ANTES do bloqueio foi de fato apagada.
    const { rowCount } = await pool.query(
      "SELECT 1 FROM sessoes WHERE ator_tipo = 'motoboy' AND ator_id = $1",
      [motoboyId],
    );
    assert.equal(rowCount, 0, 'bloqueio revogou as sessões vivas');
    void token;
  });

  await t.test('troca de aparelho invalida a sessão do aparelho antigo na hora', async () => {
    const dados = cadastroValidoDeMotoboy();
    const cadastro = await chama('POST', '/motoboys', { corpo: corpoDeCadastro(dados) });
    const motoboyId = cadastro.corpo.motoboy.id;

    const atendimento = await atendimentoDeTeste(pool);
    const troca = await chama('POST', `/painel/motoboys/${motoboyId}/troca-de-aparelho`, {
      corpo: { aparelho_id: 'aparelho-novo-x' }, token: await sessaoDeOperador(atendimento),
    });
    assert.equal(troca.status, 204);

    // A sessão emitida no cadastro (aparelho antigo) foi revogada.
    const { rowCount } = await pool.query(
      "SELECT 1 FROM sessoes WHERE ator_tipo = 'motoboy' AND ator_id = $1",
      [motoboyId],
    );
    assert.equal(rowCount, 0);

    // Re-login no aparelho antigo é recusado; no novo, aceito.
    const antigo = await chama('POST', '/sessoes/motoboy', {
      corpo: { cpf: dados.cpf, aparelho_id: dados.aparelhoId },
    });
    assert.equal(antigo.status, 403);
    const novo = await chama('POST', '/sessoes/motoboy', {
      corpo: { cpf: dados.cpf, aparelho_id: 'aparelho-novo-x' },
    });
    assert.equal(novo.status, 201);
  });

  await t.test('id malformado em rota de painel devolve 404, não 500', async () => {
    const dono = await donoDeTeste(pool);
    const token = await sessaoDeOperador(dono);
    const resposta = await chama('POST', '/painel/motoboys/nao-e-uuid/bloqueio', {
      corpo: { motivo: 'x' }, token,
    });
    assert.equal(resposta.status, 404);
    assert.equal(resposta.corpo.erro, 'conta_inexistente');

    const estorno = await chama('POST', '/painel/corridas/tambem-nao/estorno', {
      corpo: {}, token,
    });
    assert.equal(estorno.status, 404);
  });

  await t.test('JSON malformado não vaza stack: 4xx/500 com corpo genérico', async () => {
    const resposta = await fetch(`${base}/lojistas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ isto não é json',
    });
    const texto = await resposta.text();
    assert.ok(resposta.status >= 400);
    assert.doesNotMatch(texto, /at .*\/corre-api\//, 'não pode vazar caminho de arquivo/stack');
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
