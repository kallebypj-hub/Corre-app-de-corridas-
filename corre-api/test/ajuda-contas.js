'use strict';

const { randomUUID } = require('node:crypto');
const { setTimeout: espera } = require('node:timers/promises');

const {
  criaOperadorGenese, criaOperador,
} = require('../src/dominio/contas');
const { ErroDeDominio } = require('../src/dominio/erros');

// CPFs válidos e ÚNICOS entre processos paralelos da bateria: prefixo do
// pid + contador sequencial — sem sorteio, sem colisão de aniversário.
let contador = 0;
const PREFIXO = String(process.pid % 1000).padStart(3, '0');

function digitoDeCpf(fatia, pesoInicial) {
  let soma = 0;
  for (let i = 0; i < fatia.length; i += 1) {
    soma += Number(fatia[i]) * (pesoInicial - i);
  }
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

function geraCpfValido() {
  contador += 1;
  const base = PREFIXO + String(contador).padStart(6, '0');
  const d1 = digitoDeCpf(base, 10);
  const d2 = digitoDeCpf(base + String(d1), 11);
  return base + String(d1) + String(d2);
}

function cadastroValidoDeMotoboy(sobrescreve = {}) {
  const cpf = sobrescreve.cpf || geraCpfValido();
  return {
    nome: 'Zé do Corre',
    telefone: `88 9${String(Math.trunc(Math.random() * 1e8)).padStart(8, '0')}`,
    cpf,
    chavePix: cpf,
    cnhRef: 'docs/cnh.jpg',
    crlvRef: 'docs/crlv.jpg',
    selfieRef: 'docs/selfie.jpg',
    aparelhoId: `aparelho-${randomUUID()}`,
    ...sobrescreve,
  };
}

// O operador gênese é único no banco inteiro (constraint): o primeiro
// arquivo da bateria que chegar cria; os outros esperam e leem.
let promessaDono = null;
function donoDeTeste(pool) {
  if (!promessaDono) {
    promessaDono = (async () => {
      try {
        const { conta } = await criaOperadorGenese(pool, {
          nome: 'Dono Gênese', telefone: `dono-${process.pid}`,
        });
        return conta;
      } catch (erro) {
        if (erro instanceof ErroDeDominio && erro.codigo === 'genese_ja_feita') {
          for (let tentativa = 0; tentativa < 50; tentativa += 1) {
            const { rows } = await pool.query('SELECT * FROM operadores WHERE genese');
            if (rows[0]) return rows[0];
            await espera(100);
          }
          throw new Error('gênese existe mas não apareceu na leitura');
        }
        throw erro;
      }
    })();
  }
  return promessaDono;
}

async function atendimentoDeTeste(pool) {
  const dono = await donoDeTeste(pool);
  const { conta } = await criaOperador(pool, {
    nome: `Atendimento ${randomUUID().slice(0, 8)}`,
    telefone: `at-${randomUUID()}`,
    papel: 'atendimento',
    autor: dono,
  });
  return conta;
}

module.exports = {
  geraCpfValido,
  cadastroValidoDeMotoboy,
  donoDeTeste,
  atendimentoDeTeste,
};
