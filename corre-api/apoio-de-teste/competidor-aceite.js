#!/usr/bin/env node
// Apoio de teste: um PROCESSO competidor disputando o aceite da mesma
// corrida (concorrência real entre processos, como manda a lei de teste).
// Uso: node apoio-de-teste/competidor-aceite.js <corridaId> <tentativas>
// Imprime JSON {vencedoras, conflitos, ilegais} no stdout.
'use strict';

const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { emTransacao } = require('../src/dominio/nucleo');
const { transiciona } = require('../src/dominio/corridas');
const { cadastraMotoboy } = require('../src/dominio/contas');
const { ErroDeDominio, CODIGOS } = require('../src/dominio/erros');

// Etapa 4: processo de apoio também opera dentro de uma cidade. Sobral tem id
// fixo (migration 0010), então não é preciso consultar para descobri-la — e
// consultar para descobrir a cidade seria, ela mesma, consulta sem cidade.
const SOBRAL = '00000001-2312-4908-8000-000000000001';
function daCidade(cru, cidadeId = process.env.CORRE_CIDADE_ID || SOBRAL) {
  return {
    cidadeId,
    query: (t, p) => emTransacao(cru, (c) => c.query(t, p), { cidadeId }),
    connect: () => cru.connect(),
    end: () => cru.end(),
  };
}


async function main() {
  const corridaId = process.argv[2];
  const tentativas = Number.parseInt(process.argv[3], 10);
  if (!corridaId || !Number.isInteger(tentativas) || tentativas <= 0) {
    throw new Error('uso: competidor-aceite.js <corridaId> <tentativas>');
  }

  const pool = daCidade(new Pool({
    connectionString: process.env.DATABASE_URL_APP,
    max: 10,
  }));
  // LEI 11: autor de evento tem que existir. Um motoboy REAL por processo —
  // são 4 aparelhos disputando com 50 retentativas cada, que é o cenário da
  // esquina. Antes cada tentativa inventava um UUID, e o log ficava cheio de
  // autor que não existe.
  const cpfDoProcesso = (() => {
    const base = String(process.pid % 1000).padStart(3, '0') + String(process.hrtime.bigint() % 1000000n).padStart(6, '0');
    const digito = (fatia, peso) => {
      let soma = 0;
      for (let i = 0; i < fatia.length; i += 1) soma += Number(fatia[i]) * (peso - i);
      const resto = (soma * 10) % 11;
      return resto === 10 ? 0 : resto;
    };
    const d1 = digito(base, 10);
    return base + String(d1) + String(digito(base + String(d1), 11));
  })();
  const { conta: motoboy } = await cadastraMotoboy(pool, {
    nome: 'Competidor',
    telefone: `88 9${randomUUID().slice(0, 10)}`,
    cpf: cpfDoProcesso,
    chavePix: cpfDoProcesso,
    cnhRef: 'cnh',
    crlvRef: 'crlv',
    selfieRef: 'selfie',
    aparelhoId: `aparelho-${randomUUID()}`,
  });

  const placar = { vencedoras: 0, conflitos: 0, ilegais: 0 };
  try {
    // Todas as tentativas disparam juntas: é a corrida contra o relógio
    // entre aparelhos que a Lei 4 manda o banco arbitrar.
    await Promise.all(
      Array.from({ length: tentativas }, async () => {
        try {
          const { repetida } = await transiciona(pool, {
            corridaId,
            tipo: 'motoboy_aceitou',
            autorTipo: 'motoboy',
            autorId: motoboy.id,
            chaveIdempotencia: randomUUID(),
          });
          if (repetida) throw new Error('replay inesperado: chaves são únicas por tentativa');
          placar.vencedoras += 1;
        } catch (erro) {
          if (erro instanceof ErroDeDominio && erro.codigo === CODIGOS.CONFLITO_DE_CONCORRENCIA) {
            placar.conflitos += 1;
          } else if (erro instanceof ErroDeDominio && erro.codigo === CODIGOS.TRANSICAO_ILEGAL) {
            // Leu o estado já pós-aceite: perdeu a corrida do mesmo jeito.
            placar.ilegais += 1;
          } else {
            throw erro;
          }
        }
      }),
    );
    console.log(JSON.stringify(placar));
  } finally {
    await pool.end();
  }
}

main().catch((erro) => {
  console.error(erro.message);
  process.exit(1);
});
