'use strict';

// Validação de CPF pelos dígitos verificadores — sem API externa.

function normalizaCpf(bruto) {
  return String(bruto || '').replace(/\D/g, '');
}

function cpfValido(bruto) {
  const cpf = normalizaCpf(bruto);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // 111.111.111-11 etc.

  const digito = (fatia, pesoInicial) => {
    let soma = 0;
    for (let i = 0; i < fatia.length; i += 1) {
      soma += Number(fatia[i]) * (pesoInicial - i);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return digito(cpf.slice(0, 9), 10) === Number(cpf[9])
    && digito(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

module.exports = { normalizaCpf, cpfValido };
