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
  // Estado 1 (aguardando pagamento): expira em 15 minutos.
  prazoPagamentoMs: () => inteiroDeEnv('CORRE_PRAZO_PAGAMENTO_MS', 15 * 60 * 1000),
  // Estado 2 (procurando motoboy): cascata roda 5 minutos.
  prazoCascataMs: () => inteiroDeEnv('CORRE_PRAZO_CASCATA_MS', 5 * 60 * 1000),
};
