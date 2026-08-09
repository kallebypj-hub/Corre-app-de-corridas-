'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const SERVIDOR = path.join(__dirname, '..', 'src', 'servidor.js');

function sobeServidor(env) {
  const processo = spawn('node', [SERVIDOR], { env: { ...process.env, ...env } });
  let stdout = '';
  let stderr = '';
  processo.stdout.on('data', (pedaco) => { stdout += pedaco; });
  processo.stderr.on('data', (pedaco) => { stderr += pedaco; });

  const encerrado = new Promise((resolve) => {
    processo.on('close', (codigo) => resolve({ codigo, stdout, stderr }));
  });

  // O que vier primeiro: escutar ou encerrar. Nunca espera para sempre —
  // teste que trava não é teste que falha (Lei 8).
  function primeiroDesfecho() {
    return new Promise((resolve, reject) => {
      const relogio = setTimeout(
        () => reject(new Error('servidor não escutou nem encerrou em 15s')),
        15_000,
      );
      let resolvido = false;
      function entrega(valor) {
        if (!resolvido) {
          resolvido = true;
          clearTimeout(relogio);
          resolve(valor);
        }
      }
      function confere() {
        const casado = stdout.match(/escutando :(\d+)/);
        if (casado) entrega({ tipo: 'escutou', porta: Number(casado[1]), stdout, stderr });
      }
      processo.stdout.on('data', confere);
      encerrado.then((resultado) => entrega({ tipo: 'encerrou', ...resultado }));
      confere();
    });
  }

  return { processo, encerrado, primeiroDesfecho };
}

async function exigeRecusaDeBoot(env, motivoEsperado) {
  const { processo, primeiroDesfecho } = sobeServidor(env);
  try {
    const desfecho = await primeiroDesfecho();
    assert.equal(desfecho.tipo, 'encerrou', 'servidor chegou a escutar — a trava de boot não agiu');
    assert.equal(desfecho.codigo, 1, 'processo encerra com erro');
    // Estrito: só a recusa GENUÍNA da trava passa, com o motivo certo.
    // Banco fora do ar ou erro qualquer de boot não podem passar por recusa.
    assert.match(desfecho.stderr, /boot recusado: a credencial/);
    assert.match(desfecho.stderr, motivoEsperado);
    assert.doesNotMatch(desfecho.stdout, /escutando/, 'não pode ter chegado a escutar');
  } finally {
    // Se a trava estiver sabotada, o servidor sobrevive: não fica pendurado.
    processo.kill('SIGKILL');
  }
}

test('ponto de entrada com trava de boot', async (t) => {
  await t.test('servidor com credencial de dono encerra antes de servir a primeira requisição', async () => {
    // Simula a configuração errada: a URL "da aplicação" aponta o dono.
    await exigeRecusaDeBoot({ DATABASE_URL_APP: process.env.DATABASE_URL }, /é dono da tabela eventos/);
  });

  await t.test('servidor com credencial de superusuário encerra antes de servir', async () => {
    await exigeRecusaDeBoot({ DATABASE_URL_APP: process.env.DATABASE_URL_SUPER }, /é superusuário/);
  });

  await t.test('servidor com a credencial restrita sobe e responde /saude', async () => {
    const { processo, encerrado, primeiroDesfecho } = sobeServidor({ PORTA: '0' });
    try {
      const desfecho = await primeiroDesfecho();
      assert.equal(desfecho.tipo, 'escutou', `servidor encerrou em vez de escutar: ${desfecho.stderr}`);

      const resposta = await fetch(`http://127.0.0.1:${desfecho.porta}/saude`);
      assert.equal(resposta.status, 200);
      assert.deepEqual(await resposta.json(), { ok: true });
    } finally {
      processo.kill('SIGTERM');
    }
    const { codigo } = await encerrado;
    assert.equal(codigo, 0, 'encerramento limpo no SIGTERM');
  });
});
