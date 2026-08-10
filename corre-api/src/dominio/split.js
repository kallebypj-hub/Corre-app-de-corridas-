'use strict';

// O split e a trava de configuração de taxa.
//
// A CONTA. Uma cobrança só, na porta do cliente, com três recebedores
// declarados desde o nascimento (CORRE.md, seção 9):
//   mercadoria integral  -> lojista
//   frete menos 5%       -> motoboy
//   5% do frete          -> Corre
// A taxa do gateway incide sobre o TOTAL (mercadoria + frete), e a receita
// do Corre é só 5% do FRETE. Por isso "de quem sai a taxa" é dado de
// configuração, não detalhe de integração.
//
// A TRAVA. A parcela do Corre NUNCA pode resultar negativa nem zero. Se
// resultar, não é erro do usuário — é falha de configuração, e a corrida
// não é criada. A garantia forte mora no banco (migration 0009: uma
// configuração que possa dar prejuízo dentro do próprio envelope não pode
// ser publicada); esta conta por corrida é defesa em profundidade.
//
// ARREDONDAMENTOS DECLARADOS. Três, cada um com um princípio — e nenhum
// deles é o arredondamento do motor de preço (preco.js), que é outro
// caminho:
//   1. comissão: PISO. O centavo de arredondamento vai para o MOTOBOY,
//      nunca para a plataforma.
//   2. taxa: TETO. Nunca subestimar custo.
//   3. rateio: ninguém paga taxa maior que a própria parcela, e TODA sobra
//      e todo resto caem na PLATAFORMA — o arredondamento nunca cai em quem
//      não escolheu o gateway. É a parcela da plataforma que a trava vigia,
//      então é nela que a sobra tem que doer.
//
// FECHAMENTO (Lei 1): lojista + motoboy + corre + taxa === total, ao
// centavo, sempre. É asserção no código, não esperança.

const { ErroDeDominio, CODIGOS } = require('./erros');

const BPS = 10_000n;

// Divisão inteira para CIMA. Para não-negativos.
function teto(numerador) {
  return (numerador + BPS - 1n) / BPS;
}

// Divisão inteira para BAIXO. Para não-negativos, `/` de BigInt já trunca
// em direção a zero, que é o piso.
function piso(numerador, denominador) {
  return numerador / denominador;
}

// Aceita bigint, inteiro e string de dígitos — o driver do PostgreSQL
// devolve BIGINT como string, e converter isso para Number em silêncio é
// exatamente como se perde centavo (Lei 1).
function exigeInteiroNaoNegativo(valor, nome) {
  let inteiro;
  if (typeof valor === 'bigint') {
    inteiro = valor;
  } else if (typeof valor === 'number') {
    if (!Number.isInteger(valor)) {
      throw new ErroDeDominio(
        CODIGOS.VALOR_INVALIDO,
        `${nome} precisa ser inteiro em centavos (recebido: ${valor})`,
      );
    }
    inteiro = BigInt(valor);
  } else if (typeof valor === 'string' && /^-?\d+$/.test(valor)) {
    inteiro = BigInt(valor);
  } else {
    throw new ErroDeDominio(
      CODIGOS.VALOR_INVALIDO,
      `${nome} precisa ser inteiro em centavos (recebido: ${JSON.stringify(valor)})`,
    );
  }
  if (inteiro < 0n) {
    throw new ErroDeDominio(CODIGOS.VALOR_INVALIDO, `${nome} não pode ser negativo`);
  }
  return inteiro;
}

function paraNumero(bigint, nome) {
  if (bigint > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${nome} acima do inteiro seguro (${bigint} centavos)`);
  }
  return Number(bigint);
}

// Calcula as três parcelas líquidas e a taxa, em centavos inteiros.
// Devolve também `taxa_por_parcela`, porque na hora de declarar o split ao
// gateway é preciso dizer de qual recebedor a taxa sai.
function calculaSplit({ mercadoriaCentavos, freteCentavos, configuracao }) {
  const mercadoria = exigeInteiroNaoNegativo(mercadoriaCentavos, 'mercadoria');
  const frete = exigeInteiroNaoNegativo(freteCentavos, 'frete');
  if (frete === 0n) {
    throw new ErroDeDominio(CODIGOS.VALOR_INVALIDO, 'frete precisa ser maior que zero');
  }
  if (!configuracao) {
    throw new ErroDeDominio(
      CODIGOS.CONFIGURACAO_DE_TAXA_AUSENTE,
      'nenhuma configuração de taxa publicada — a corrida não é criada',
    );
  }

  const comissaoBps = exigeInteiroNaoNegativo(configuracao.comissao_bps, 'comissao_bps');
  const taxaPctBps = exigeInteiroNaoNegativo(configuracao.taxa_percentual_bps, 'taxa_percentual_bps');
  const taxaFixa = exigeInteiroNaoNegativo(configuracao.taxa_fixa_centavos, 'taxa_fixa_centavos');
  const portador = configuracao.portador_taxa_percentual;

  const total = mercadoria + frete;

  // 1. Comissão: PISO — o centavo sobra para o motoboy.
  const correBruto = piso(frete * comissaoBps, BPS);
  const motoboyBruto = frete - correBruto;
  const lojistaBruto = mercadoria;

  // 2. Taxa percentual: TETO — nunca subestimar custo.
  const taxaPercentual = teto(total * taxaPctBps);

  // 3. De quem sai. Primeiro a PRETENSÃO de cada um, conforme o portador.
  let pretendidoLojista;
  let pretendidoMotoboy;
  if (portador === 'lojista') {
    pretendidoLojista = taxaPercentual;
    pretendidoMotoboy = 0n;
  } else if (portador === 'corre') {
    pretendidoLojista = 0n;
    pretendidoMotoboy = 0n;
  } else if (portador === 'proporcional') {
    pretendidoLojista = piso(taxaPercentual * lojistaBruto, total);
    pretendidoMotoboy = piso(taxaPercentual * motoboyBruto, total);
  } else {
    throw new ErroDeDominio(
      CODIGOS.CONFIGURACAO_DE_TAXA_INVALIDA,
      `portador de taxa desconhecido: ${portador}`,
    );
  }

  // Ninguém paga taxa maior que a própria parcela. É o que impede a parcela
  // do lojista de ficar negativa quando a mercadoria é ZERO ou muito menor
  // que a taxa — caso real: a venda já foi acertada fora e o QR cobra só o
  // frete (CORRE.md, seção 3).
  const taxaDoLojista = pretendidoLojista > lojistaBruto ? lojistaBruto : pretendidoLojista;
  const taxaDoMotoboy = pretendidoMotoboy > motoboyBruto ? motoboyBruto : pretendidoMotoboy;

  // A PLATAFORMA É O RESÍDUO: a taxa fixa (que nenhum gateway rateia), o que
  // sobrou do teto de cada um, e o resto do arredondamento. Definir a
  // parcela do Corre como resíduo é o que faz a soma fechar por construção,
  // e é onde a trava tem que doer.
  const taxaDoCorre = taxaFixa + taxaPercentual - taxaDoLojista - taxaDoMotoboy;

  const lojista = lojistaBruto - taxaDoLojista;
  const motoboy = motoboyBruto - taxaDoMotoboy;
  const corre = correBruto - taxaDoCorre;

  // A TRAVA, na conta por corrida. Não é erro do usuário — é falha de
  // configuração, e o código diz isso.
  if (corre <= 0n) {
    throw new ErroDeDominio(
      CODIGOS.CONFIGURACAO_DE_TAXA_INVALIDA,
      `configuração "${configuracao.rotulo}" deixaria o Corre com ${corre} centavos `
      + `numa cobrança de ${total} (mercadoria ${mercadoria} + frete ${frete}): `
      + 'a plataforma se recusa a operar no prejuízo',
    );
  }
  if (lojista < 0n || motoboy < 0n) {
    throw new ErroDeDominio(
      CODIGOS.CONFIGURACAO_DE_TAXA_INVALIDA,
      `configuração "${configuracao.rotulo}" produziria parcela negativa `
      + `(lojista ${lojista}, motoboy ${motoboy})`,
    );
  }

  // Fechamento ao centavo (Lei 1). Se isto quebrar, é defeito de código —
  // sobe cru, não vira erro de negócio.
  const taxaTotal = taxaDoLojista + taxaDoMotoboy + taxaDoCorre;
  if (lojista + motoboy + corre + taxaTotal !== total) {
    throw new Error(
      `split não fecha: ${lojista} + ${motoboy} + ${corre} + ${taxaTotal} !== ${total}`,
    );
  }

  return {
    configuracao_taxa_id: configuracao.id,
    total_centavos: paraNumero(total, 'total'),
    lojista_centavos: paraNumero(lojista, 'parcela do lojista'),
    motoboy_centavos: paraNumero(motoboy, 'parcela do motoboy'),
    corre_centavos: paraNumero(corre, 'parcela do Corre'),
    taxa_centavos: paraNumero(taxaTotal, 'taxa'),
    taxa_por_parcela: {
      lojista: paraNumero(taxaDoLojista, 'taxa do lojista'),
      motoboy: paraNumero(taxaDoMotoboy, 'taxa do motoboy'),
      corre: paraNumero(taxaDoCorre, 'taxa do Corre'),
    },
  };
}

// A configuração vigente: a última publicada e NÃO de exemplo; se só houver
// exemplo (desenvolvimento e bateria), a última publicada. O desempate é por
// ordem_publicacao, que é monotônica — duas publicações simultâneas não
// deixam a vigente ambígua (Lei 9).
//
// Qualquer configuração publicada é segura por construção: o banco recusa
// publicar uma que possa dar prejuízo no próprio envelope (migration 0009).
async function configuracaoVigente(pool) {
  const { rows } = await pool.query(
    `SELECT id, ordem_publicacao, rotulo, gateway, comissao_bps, taxa_percentual_bps,
            taxa_fixa_centavos, portador_taxa_percentual,
            frete_minimo_centavos, mercadoria_maxima_centavos, exemplo
     FROM configuracoes_taxa
     ORDER BY (NOT exemplo) DESC, ordem_publicacao DESC
     LIMIT 1`,
  );
  if (rows.length === 0) {
    throw new ErroDeDominio(
      CODIGOS.CONFIGURACAO_DE_TAXA_AUSENTE,
      'nenhuma configuração de taxa publicada — a plataforma não opera sem saber de quem sai a taxa',
    );
  }
  return rows[0];
}

module.exports = { calculaSplit, configuracaoVigente };
