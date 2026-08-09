'use strict';

// Envio de SMS atrás de uma interface. Nenhum provedor real nesta etapa
// (decisão do escopo): a implementação padrão recusa envio, para não haver
// ilusão de que SMS sai em produção sem configuração explícita. Os testes
// injetam a implementação falsa (smsFake).
//
// Contrato: enviarSms({ telefone, texto }) => Promise<void>. Nunca receba o
// código por outro canal; nunca registre o texto em log.

function smsNaoConfigurado() {
  return async () => {
    throw new Error('provedor de SMS não configurado (nenhum provedor real nesta etapa)');
  };
}

// Implementação falsa para testes: guarda as mensagens em memória em vez de
// enviar. NÃO usar fora de teste.
function smsFake() {
  const enviados = [];
  const enviar = async ({ telefone, texto }) => {
    enviados.push({ telefone, texto });
  };
  enviar.enviados = enviados;
  enviar.ultimoPara = (telefone) => enviados.filter((m) => m.telefone === telefone).at(-1) || null;
  return enviar;
}

module.exports = { smsNaoConfigurado, smsFake };
