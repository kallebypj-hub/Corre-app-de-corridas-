'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');

const { montaApi } = require('../src/http/api');
const { smsFake } = require('../src/http/sms');
const { hashDoCodigo, solicitaCodigo, confirmaCodigo } = require('../src/dominio/otp');
const { ErroDeDominio } = require('../src/dominio/erros');
const contas = require('../src/dominio/contas');
const { poolApp } = require('./ajuda-maquina');
const { donoDeTeste } = require('./ajuda-contas');

// Extrai o código do texto do SMS fake (só existe em teste).
function codigoDoSms(mensagem) {
  const casado = (mensagem.texto || '').match(/(\d{6})/);
  return casado ? casado[1] : null;
}

test('re-login por código OTP (SMS)', async (t) => {
  const pool = poolApp();
  const sms = smsFake();
  const app = express();
  app.use(montaApi(pool, { enviarSms: sms }));
  const servidor = app.listen(0);
  await new Promise((resolve) => { servidor.on('listening', resolve); });
  const base = `http://127.0.0.1:${servidor.address().port}`;

  t.after(async () => {
    servidor.close();
    await pool.end();
  });

  async function chama(caminho, corpo, headers = {}) {
    const resposta = await fetch(base + caminho, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(corpo),
    });
    const texto = await resposta.text();
    return { status: resposta.status, corpo: texto ? JSON.parse(texto) : null };
  }

  async function lojistaComTelefone() {
    const telefone = `88 9${String(Math.trunc(Math.random() * 1e8)).padStart(8, '0')}-${randomUUID().slice(0, 6)}`;
    const { conta } = await contas.cadastraLojista(pool, { nome: 'Loja OTP', telefone });
    return { id: conta.id, telefone };
  }

  await t.test('fluxo feliz: solicita, recebe código no SMS, confirma e recebe sessão; login gera evento', async () => {
    const loja = await lojistaComTelefone();
    const solicitou = await chama('/sessoes/otp/solicitar', { telefone: loja.telefone, ator_tipo: 'lojista' });
    assert.equal(solicitou.status, 202);

    const codigo = codigoDoSms(sms.ultimoPara(loja.telefone));
    assert.match(codigo, /^\d{6}$/);

    const confirmou = await chama('/sessoes/otp/confirmar', {
      telefone: loja.telefone, ator_tipo: 'lojista', codigo,
    });
    assert.equal(confirmou.status, 201);
    assert.ok(confirmou.corpo.sessao.token);

    const { rows } = await pool.query(
      `SELECT autor_tipo FROM eventos
       WHERE agregado_tipo = 'lojista' AND agregado_id = $1 AND tipo = 'login_efetuado'`,
      [loja.id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].autor_tipo, 'lojista');
  });

  await t.test('código nunca em claro: nem no banco (só hash) nem no texto além do envio', async () => {
    const loja = await lojistaComTelefone();
    await chama('/sessoes/otp/solicitar', { telefone: loja.telefone, ator_tipo: 'lojista' });
    const codigo = codigoDoSms(sms.ultimoPara(loja.telefone));

    // O que está no banco é o hash ligado ao telefone, nunca o código.
    const emClaro = await pool.query('SELECT 1 FROM codigos_otp WHERE codigo_hash = $1', [codigo]);
    assert.equal(emClaro.rowCount, 0);
    const porHash = await pool.query(
      'SELECT telefone FROM codigos_otp WHERE codigo_hash = $1',
      [hashDoCodigo(loja.telefone, codigo)],
    );
    assert.equal(porHash.rowCount, 1);
  });

  await t.test('código expirado é recusado', async () => {
    const loja = await lojistaComTelefone();
    await chama('/sessoes/otp/solicitar', { telefone: loja.telefone, ator_tipo: 'lojista' });
    const codigo = codigoDoSms(sms.ultimoPara(loja.telefone));

    // Envelhece o código pelo dono (corre_app não mexe em expira_em).
    const { Pool } = require('pg');
    const dono = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    try {
      await dono.query(
        "UPDATE codigos_otp SET expira_em = now() - interval '1 minute' WHERE telefone = $1",
        [loja.telefone],
      );
    } finally {
      await dono.end();
    }

    const confirmou = await chama('/sessoes/otp/confirmar', {
      telefone: loja.telefone, ator_tipo: 'lojista', codigo,
    });
    assert.equal(confirmou.status, 401);
    assert.equal(confirmou.corpo.erro, 'codigo_expirado');
  });

  await t.test('código reusado é recusado (uso único)', async () => {
    const loja = await lojistaComTelefone();
    await chama('/sessoes/otp/solicitar', { telefone: loja.telefone, ator_tipo: 'lojista' });
    const codigo = codigoDoSms(sms.ultimoPara(loja.telefone));

    const primeira = await chama('/sessoes/otp/confirmar', {
      telefone: loja.telefone, ator_tipo: 'lojista', codigo,
    });
    assert.equal(primeira.status, 201);

    const segunda = await chama('/sessoes/otp/confirmar', {
      telefone: loja.telefone, ator_tipo: 'lojista', codigo,
    });
    assert.equal(segunda.status, 401);
    assert.equal(segunda.corpo.erro, 'codigo_invalido');
  });

  await t.test('6ª tentativa errada mata o código; o código certo depois não vale mais', async () => {
    const loja = await lojistaComTelefone();
    await chama('/sessoes/otp/solicitar', { telefone: loja.telefone, ator_tipo: 'lojista' });
    const codigo = codigoDoSms(sms.ultimoPara(loja.telefone));
    const errado = codigo === '000000' ? '111111' : '000000';

    for (let i = 1; i <= 5; i += 1) {
      const tentativa = await chama('/sessoes/otp/confirmar', {
        telefone: loja.telefone, ator_tipo: 'lojista', codigo: errado,
      });
      assert.equal(tentativa.status, 401);
      assert.equal(tentativa.corpo.erro, 'codigo_incorreto');
    }
    // Código morto: nem o correto entra mais.
    const comCerto = await chama('/sessoes/otp/confirmar', {
      telefone: loja.telefone, ator_tipo: 'lojista', codigo,
    });
    assert.equal(comCerto.status, 401);
    assert.equal(comCerto.corpo.erro, 'codigo_invalido');
  });

  await t.test('limite de envios por telefone bloqueia novo envio', async () => {
    const loja = await lojistaComTelefone();
    // O padrão (5/telefone) bloqueia a partir do 6º; conta os aceites.
    let bloqueou = false;
    for (let i = 0; i < 10; i += 1) {
      const r = await chama('/sessoes/otp/solicitar', { telefone: loja.telefone, ator_tipo: 'lojista' });
      if (r.status === 429) { bloqueou = true; break; }
    }
    assert.ok(bloqueou, 'o limite de envios por telefone tem que bloquear');
  });

  await t.test('operador também entra por OTP (caminho de sucesso), com login gravado', async () => {
    const dono = await donoDeTeste(pool);
    const solicitou = await chama('/sessoes/otp/solicitar', { telefone: dono.telefone, ator_tipo: 'operador' });
    assert.equal(solicitou.status, 202);
    const codigo = codigoDoSms(sms.ultimoPara(dono.telefone));
    assert.match(codigo, /^\d{6}$/);
    const confirmou = await chama('/sessoes/otp/confirmar', {
      telefone: dono.telefone, ator_tipo: 'operador', codigo,
    });
    assert.equal(confirmou.status, 201);
    assert.ok(confirmou.corpo.sessao.token);

    const { rows } = await pool.query(
      `SELECT autor_tipo FROM eventos
       WHERE agregado_tipo = 'operador' AND agregado_id = $1 AND tipo = 'login_efetuado'`,
      [dono.id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].autor_tipo, 'painel');
  });

  await t.test('motoboy não usa OTP; ator_tipo inválido é recusado', async () => {
    const r = await chama('/sessoes/otp/solicitar', { telefone: '88 90000-0000', ator_tipo: 'motoboy' });
    assert.equal(r.status, 422);
  });
});

// Limite por IP e concorrência do cap de tentativas: usam o domínio direto
// com pool próprio (concorrência real de conexões contra o banco).
test('OTP — limite por IP e cap de tentativas sob concorrência', async (t) => {
  const pool = poolApp(20);
  t.after(() => pool.end());

  async function lojista() {
    const telefone = `88 7${String(Math.trunc(Math.random() * 1e8)).padStart(8, '0')}-${randomUUID().slice(0, 6)}`;
    const { conta } = await contas.cadastraLojista(pool, { nome: 'Loja IP', telefone });
    return { id: conta.id, telefone };
  }

  await t.test('limite de envios por IP bloqueia, mesmo variando o telefone', async () => {
    const sms = smsFake();
    const ip = `ip-${randomUUID()}`;
    // Padrão: 20/IP. Cada solicitação usa telefone novo (para não bater no
    // limite por telefone antes), mas o mesmo IP.
    let bloqueou = false;
    for (let i = 0; i < 25; i += 1) {
      const loja = await lojista();
      try {
        await solicitaCodigo(pool, {
          telefone: loja.telefone, atorTipo: 'lojista', ip, enviarSms: sms,
        });
      } catch (erro) {
        if (erro instanceof ErroDeDominio && erro.codigo === 'limite_de_envio') { bloqueou = true; break; }
        throw erro;
      }
    }
    assert.ok(bloqueou, 'o limite de envios por IP tem que bloquear');
  });

  await t.test('concorrência não fura o teto de tentativas (no máx max_tentativas comparações)', async () => {
    const sms = smsFake();
    const loja = await lojista();
    await solicitaCodigo(pool, {
      telefone: loja.telefone, atorTipo: 'lojista', ip: `ip-${randomUUID()}`, enviarSms: sms,
    });
    const codigoCerto = codigoDoSms(sms.ultimoPara(loja.telefone));
    const errado = codigoCerto === '000000' ? '111111' : '000000';

    // 30 confirmações ERRADAS concorrentes (conexões distintas do pool).
    const resultados = await Promise.all(
      Array.from({ length: 30 }, () => confirmaCodigo(pool, {
        telefone: loja.telefone, atorTipo: 'lojista', codigo: errado,
      }).then(() => 'aceitou').catch((erro) => (erro instanceof ErroDeDominio ? erro.codigo : 'erro_cru'))),
    );
    const comparacoes = resultados.filter((r) => r === 'codigo_incorreto').length;
    const invalidos = resultados.filter((r) => r === 'codigo_invalido').length;
    const crus = resultados.filter((r) => r === 'erro_cru' || r === 'aceitou').length;

    assert.equal(crus, 0, 'nenhum erro cru nem aceite indevido de código errado');
    assert.ok(
      comparacoes <= 5,
      `no máximo 5 comparações contra o código vivo; houve ${comparacoes}`,
    );
    assert.equal(comparacoes + invalidos, 30);
  });
});
