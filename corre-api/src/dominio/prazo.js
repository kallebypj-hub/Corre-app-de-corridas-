'use strict';

// Motor do prazo estimado (Etapa 5, seção 8).
//
// É O ÚNICO LUGAR onde minuto se calcula, como `preco.js` é o único onde
// centavo se calcula. A fórmula, o `max` dos anéis, o teto de km e a faixa
// moram todos aqui.
//
// Invariantes:
// - Determinismo: mesma corrida, mesmo prazo, para sempre. Não há relógio,
//   aleatório nem parâmetro de tempo no cálculo — só a versão da tabela e os
//   dois pontos.
// - Aritmética inteira (BigInt) do começo ao fim. Minuto não é dinheiro, mas
//   float aqui pelo mesmo motivo que float lá: ninguém audita 0,1 + 0,2.
// - Sem API de mapa: a distância fora de zona é a MESMA já calculada para o
//   preço (linha reta do centro da última zona), reaproveitada, não refeita.
//
// A REGRA QUE DECIDE O DESENHO: o prazo é PAR ORIGEM-DESTINO, e vale o anel
// MAIOR das duas pontas. Distância é simétrica — uma entrega do anel 2 para
// o Centro leva a travessia inteira, e o anel de destino sozinho prometeria
// metade dela. Prometer a menos é o erro caro: o cliente espera 10 minutos,
// chega em 25, e o prazo criou a reclamação que existia para evitar.

const { ErroDeDominio, CODIGOS } = require('./erros');
const {
  carregaTabela, resolveZona, centroDaUltimaZona, distanciaEscalada, kmTeto,
} = require('./preco');

// A FAIXA, declarada num lugar só (seção 8).
//
// O dono decidiu que o prazo se mostra como faixa e nunca como ponto:
// "20 a 30 minutos", nunca "25 minutos". Número exato vira promessa na
// cabeça de quem lê, e erro de três minutos vira reclamação.
//
//   teto = menor múltiplo de 5 ESTRITAMENTE maior que o calculado
//   piso = teto − 10
//   piso abaixo de 5 => a faixa é 5 a 15
//
// O "estritamente" é o que garante `teto > calculado` sempre: a faixa nunca
// promete menos do que a conta disse. A largura é sempre 10 minutos.
const PASSO_DA_FAIXA = 5n;
const LARGURA_DA_FAIXA = 10n;
const PISO_MINIMO = 5n;

function faixaDePrazo(minutos) {
  const calculado = BigInt(minutos);
  if (calculado < 0n) throw new Error(`prazo negativo: ${minutos}`);
  let teto = (calculado / PASSO_DA_FAIXA + 1n) * PASSO_DA_FAIXA;
  let piso = teto - LARGURA_DA_FAIXA;
  if (piso < PISO_MINIMO) {
    piso = PISO_MINIMO;
    teto = PISO_MINIMO + LARGURA_DA_FAIXA;
  }
  return { min: Number(piso), max: Number(teto) };
}

// O que cada ponta contribui: os minutos do anel onde ela está e, se estiver
// FORA de zona, os km que a separam do centro da última zona.
//
// Fora de zona a ponta vale o ANEL MAIS EXTERNO — o de maior `ordem`, que é
// uma afirmação de geometria, não de preço. (O preço usa a zona MAIS CARA
// para o mesmo caso; são critérios diferentes de propósito, porque "mais
// caro" e "mais longe" não são a mesma coisa.)
function pontaDoPrazo({ zonas, tabela, latE6, lngE6 }) {
  const zona = resolveZona(zonas, latE6, lngE6);
  if (zona) {
    return { zonaNome: zona.nome, minutosDoAnel: BigInt(zona.minutos), km: 0n };
  }
  const maisExterna = zonas[zonas.length - 1];
  const { centroLatE6, centroLngE6 } = centroDaUltimaZona(zonas);
  const distancia = distanciaEscalada({
    latE6,
    lngE6,
    centroLatE6,
    centroLngE6,
    metrosPorGrauLat: tabela.metros_por_grau_lat,
    metrosPorGrauLng: tabela.metros_por_grau_lng,
  });
  return {
    zonaNome: null,
    minutosDoAnel: BigInt(maisExterna.minutos),
    km: kmTeto(distancia),
  };
}

function exigeCoordenada(valor, nome) {
  if (!Number.isInteger(valor)) {
    throw new ErroDeDominio(
      CODIGOS.COORDENADA_INVALIDA,
      `${nome} precisa ser graus × 1e6 inteiro`,
    );
  }
  return valor;
}

function maior(a, b) {
  return a > b ? a : b;
}

// Calcula o prazo de um par origem-destino numa versão específica da tabela.
// Devolve o valor PONTUAL (que fica gravado para auditoria e a aplicação não
// tem privilégio de ler) e a FAIXA, que é o que se mostra.
async function calculaPrazo(pool, {
  tabelaId, origemLatE6, origemLngE6, destinoLatE6, destinoLngE6,
}) {
  exigeCoordenada(origemLatE6, 'origem_lat_e6');
  exigeCoordenada(origemLngE6, 'origem_lng_e6');
  exigeCoordenada(destinoLatE6, 'destino_lat_e6');
  exigeCoordenada(destinoLngE6, 'destino_lng_e6');

  const { tabela, zonas } = await carregaTabela(pool, tabelaId);
  if (zonas.length === 0) {
    throw new ErroDeDominio(CODIGOS.TABELA_PRECO_INEXISTENTE, 'tabela de preço sem zonas');
  }

  const origem = pontaDoPrazo({
    zonas, tabela, latE6: origemLatE6, lngE6: origemLngE6,
  });
  const destino = pontaDoPrazo({
    zonas, tabela, latE6: destinoLatE6, lngE6: destinoLngE6,
  });

  // max dos anéis e max dos km: as duas pontas concorrem, e vence a mais
  // distante. Ponta dentro de zona contribui 0 km.
  const minutos = BigInt(tabela.tempo_base_coleta_minutos)
    + maior(origem.minutosDoAnel, destino.minutosDoAnel)
    + maior(origem.km, destino.km) * BigInt(tabela.adicional_km_minutos);

  if (minutos > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`prazo acima do inteiro seguro (${minutos} minutos)`);
  }
  const calculado = Number(minutos);
  const faixa = faixaDePrazo(calculado);

  return {
    tabela_preco_id: tabela.id,
    prazo_minutos: calculado,
    prazo_min_minutos: faixa.min,
    prazo_max_minutos: faixa.max,
    origem_zona_nome: origem.zonaNome,
    destino_zona_nome: destino.zonaNome,
    // Fora de zona nas duas pontas ou numa só: quem audita precisa saber que
    // km entrou na conta.
    km_adicionais: Number(maior(origem.km, destino.km)),
  };
}

module.exports = { calculaPrazo, faixaDePrazo };
