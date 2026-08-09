'use strict';

// Erro de regra de negócio: esperado, com código estável para o chamador.
// Erro de infraestrutura não passa por aqui — sobe cru (nada de catch vazio).

class ErroDeDominio extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'ErroDeDominio';
    this.codigo = codigo;
  }
}

const CODIGOS = {
  TIPO_DESCONHECIDO: 'tipo_desconhecido',
  TRANSICAO_ILEGAL: 'transicao_ilegal',
  AUTOR_NAO_AUTORIZADO: 'autor_nao_autorizado',
  MOTIVO_OBRIGATORIO: 'motivo_obrigatorio',
  TEMPO_DO_CLIENTE: 'tempo_do_cliente',
  CONFLITO_DE_CONCORRENCIA: 'conflito_de_concorrencia',
  CHAVE_REUTILIZADA: 'chave_reutilizada',
  CORRIDA_INEXISTENTE: 'corrida_inexistente',
};

module.exports = { ErroDeDominio, CODIGOS };
