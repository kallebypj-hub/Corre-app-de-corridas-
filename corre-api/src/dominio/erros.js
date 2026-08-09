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
  // Etapa 2 — cadastro e sessão
  CAMPO_OBRIGATORIO: 'campo_obrigatorio',
  CPF_INVALIDO: 'cpf_invalido',
  CHAVE_PIX_DE_OUTRO_CPF: 'chave_pix_de_outro_cpf',
  CPF_JA_CADASTRADO: 'cpf_ja_cadastrado',
  TELEFONE_JA_CADASTRADO: 'telefone_ja_cadastrado',
  APARELHO_NAO_AUTORIZADO: 'aparelho_nao_autorizado',
  PAPEL_INSUFICIENTE: 'papel_insuficiente',
  CONTA_BLOQUEADA: 'conta_bloqueada',
  CONTA_INEXISTENTE: 'conta_inexistente',
  LOJISTA_INEXISTENTE: 'lojista_inexistente',
  CARTAO_DE_GARANTIA_AUSENTE: 'cartao_de_garantia_ausente',
  GENESE_JA_FEITA: 'genese_ja_feita',
  SESSAO_INVALIDA: 'sessao_invalida',
  // Re-login OTP
  LIMITE_DE_ENVIO: 'limite_de_envio',
  CODIGO_INVALIDO: 'codigo_invalido',
  CODIGO_EXPIRADO: 'codigo_expirado',
  CODIGO_INCORRETO: 'codigo_incorreto',
  // Etapa 3 — zonas e preço
  TABELA_PRECO_INEXISTENTE: 'tabela_preco_inexistente',
  COORDENADA_INVALIDA: 'coordenada_invalida',
  // Trava de configuração de taxa. Estes dois NÃO são erro do usuário: são
  // falha de configuração da plataforma, e a mensagem e o código dizem isso.
  CONFIGURACAO_DE_TAXA_AUSENTE: 'configuracao_de_taxa_ausente',
  CONFIGURACAO_DE_TAXA_INVALIDA: 'configuracao_de_taxa_invalida',
  VALOR_INVALIDO: 'valor_invalido',
};

// Falha nossa, não do chamador. Serve para o painel e o log separarem "o
// usuário errou" de "a plataforma está mal configurada e parou de operar".
const CODIGOS_DE_CONFIGURACAO = new Set([
  CODIGOS.CONFIGURACAO_DE_TAXA_AUSENTE,
  CODIGOS.CONFIGURACAO_DE_TAXA_INVALIDA,
]);

function ehFalhaDeConfiguracao(erro) {
  return erro instanceof ErroDeDominio && CODIGOS_DE_CONFIGURACAO.has(erro.codigo);
}

module.exports = { ErroDeDominio, CODIGOS, ehFalhaDeConfiguracao };
