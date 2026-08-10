'use strict';

// Prazos da máquina de estados (seção 4): valores de produção como padrão,
// sobrescritos por variável de ambiente apenas para encurtar testes.
// Tempo é sempre do servidor (regra 3 da Etapa 1) — nunca do cliente.

function inteiroDeEnv(nome, padrao) {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto === '') return padrao;
  const valor = Number.parseInt(bruto, 10);
  if (!Number.isInteger(valor) || valor <= 0) {
    throw new Error(`${nome} inválido: ${bruto} (esperado inteiro positivo em ms)`);
  }
  return valor;
}

module.exports = {
  // Estado 1 (procurando motoboy): a cascata roda 5 minutos (seção 6).
  prazoCascataMs: () => inteiroDeEnv('CORRE_PRAZO_CASCATA_MS', 5 * 60 * 1000),
  // Estado 4 (na porta, cobrando): a espera na porta é de 5 minutos, e é o
  // MESMO relógio da validade do QR (seção 4) — um número, não dois.
  prazoEsperaNaPortaMs: () => inteiroDeEnv('CORRE_PRAZO_ESPERA_PORTA_MS', 5 * 60 * 1000),

  // Re-login OTP (fechamento da Etapa 2).
  otpExpiraMs: () => inteiroDeEnv('CORRE_OTP_EXPIRA_MS', 10 * 60 * 1000),
  otpMaxTentativas: () => inteiroDeEnv('CORRE_OTP_MAX_TENTATIVAS', 5),
  otpJanelaEnviosMs: () => inteiroDeEnv('CORRE_OTP_JANELA_ENVIOS_MS', 60 * 60 * 1000),
  otpMaxEnviosPorTelefone: () => inteiroDeEnv('CORRE_OTP_MAX_ENVIOS_TELEFONE', 5),
  otpMaxEnviosPorIp: () => inteiroDeEnv('CORRE_OTP_MAX_ENVIOS_IP', 20),
};
