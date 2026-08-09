'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { conectaApp, conectaDono, conectaSuper } = require('./ajuda');
const { exigePapelDeAplicacao } = require('../src/db/boot');

test('trava de boot: a aplicação só sobe com credencial restrita', async (t) => {
  await t.test('boot aceita a credencial restrita da aplicação (corre_app)', async () => {
    const app = await conectaApp();
    try {
      assert.equal(await exigePapelDeAplicacao(app), 'corre_app');
    } finally {
      await app.end();
    }
  });

  await t.test('boot recusa credencial de dono da tabela eventos', async () => {
    const dono = await conectaDono();
    try {
      await assert.rejects(
        () => exigePapelDeAplicacao(dono),
        /dono da tabela eventos/,
      );
    } finally {
      await dono.end();
    }
  });

  await t.test('boot recusa credencial de superusuário', async () => {
    const chefe = await conectaSuper();
    try {
      await assert.rejects(
        () => exigePapelDeAplicacao(chefe),
        /superusuário/,
      );
    } finally {
      await chefe.end();
    }
  });
});
