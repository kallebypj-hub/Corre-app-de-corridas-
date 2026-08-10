'use strict';

// Motor da máquina de estados da corrida.
//
// Garantias e onde elas moram:
// - Legalidade da transição: só na tabela declarativa (transicoes.js).
// - Um vencedor por posição do log: UNIQUE (agregado_tipo, agregado_id, seq)
//   no banco. O código NÃO serializa (sem SELECT FOR UPDATE) de propósito —
//   a constraint é a garantia (Lei 4), não a verificação em código.
// - Idempotência: UNIQUE em eventos.chave_idempotencia (Lei 5). Repetir a
//   mesma operação com a mesma chave devolve o resultado original.
// - Tempo: sempre do servidor de banco (now()); payload com instante do
//   cliente é recusado (regra 3 da Etapa 1).
// - Corrida sem lojista real é impossível por construção (seção 14): a
//   criação valida o lojista e o cartão de garantia (Etapa 2) e grava o
//   vínculo com FK.

const { randomUUID } = require('node:crypto');

const E = require('./estados');
const { TRANSICOES } = require('./transicoes');
const { ErroDeDominio, CODIGOS } = require('./erros');
const { calculaSplit, configuracaoVigente } = require('./split');
const { calculaPrazo } = require('./prazo');
const { tabelaVigente } = require('./preco');
const {
  emTransacao, agoraDoBanco, ehDisputaDePosicao, tentaReplayEvento,
} = require('./nucleo');

const AGREGADO = 'corrida';
// Tempo é do servidor, e prazo é tempo: nenhum destes vem do cliente. O
// prazo é DERIVADO da versão da tabela e dos dois pontos (prazo.js); aceitar
// um prazo digitado seria aceitar promessa que o motor não fez.
const CHAVES_DO_SERVIDOR = [
  'vence_em', 'criado_em',
  'prazo_minutos', 'prazo_min_minutos', 'prazo_max_minutos',
  // A VERSÃO DA TABELA TAMBÉM É DO SERVIDOR. Ela vinha do payload e isso
  // deixava quem pede escolher a promessa que a corrida ia carregar: uma
  // versão antiga com minutos menores mostra ao cliente uma faixa que a
  // operação já abandonou, e ainda troca a âncora de auditoria do preço.
  // A versão é sempre a VIGENTE da cidade. (Achado da auditoria da Etapa 5.)
  'tabela_preco_id',
];

function higienizaPayload(payload) {
  const dado = payload === undefined || payload === null ? {} : payload;
  if (typeof dado !== 'object' || Array.isArray(dado)) {
    throw new ErroDeDominio(CODIGOS.TEMPO_DO_CLIENTE, 'payload precisa ser objeto');
  }
  for (const chave of CHAVES_DO_SERVIDOR) {
    if (chave in dado) {
      throw new ErroDeDominio(
        CODIGOS.TEMPO_DO_CLIENTE,
        `tempo é do servidor: payload não pode trazer "${chave}"`,
      );
    }
  }
  return dado;
}

function regraDe(tipo) {
  const regra = TRANSICOES[tipo];
  if (!regra) {
    throw new ErroDeDominio(CODIGOS.TIPO_DESCONHECIDO, `transição desconhecida: ${tipo}`);
  }
  return regra;
}

function validaTransicao({ tipo, estadoAtual, autorTipo, payload }) {
  const regra = regraDe(tipo);
  if (!regra.de.includes(estadoAtual)) {
    const nome = estadoAtual === null ? '∅' : E.NOMES[estadoAtual];
    throw new ErroDeDominio(
      CODIGOS.TRANSICAO_ILEGAL,
      `transição ilegal: ${tipo} a partir de ${nome}`,
    );
  }
  const autorizados = regra.autorizados[String(estadoAtual)];
  if (!autorizados || !autorizados.includes(autorTipo)) {
    throw new ErroDeDominio(
      CODIGOS.AUTOR_NAO_AUTORIZADO,
      `${autorTipo} não pode aplicar ${tipo} a partir de ${estadoAtual === null ? '∅' : E.NOMES[estadoAtual]}`,
    );
  }
  if (
    regra.exigeMotivoNasOrigens
    && regra.exigeMotivoNasOrigens.includes(estadoAtual)
    && !(typeof payload.motivo === 'string' && payload.motivo.trim() !== '')
  ) {
    throw new ErroDeDominio(
      CODIGOS.MOTIVO_OBRIGATORIO,
      `${tipo} a partir de ${E.NOMES[estadoAtual]} exige motivo registrado`,
    );
  }
  // "O motoboy declara QUAL DOS DOIS CASOS foi" (seção 4). A lista é fechada
  // de propósito: a declaração é de parte interessada e vai virar reputação
  // do cliente (seção 12) — texto livre viraria acusação sem forma.
  if (regra.exigeCasoDeclarado && !regra.exigeCasoDeclarado.includes(payload.caso)) {
    throw new ErroDeDominio(
      CODIGOS.CASO_OBRIGATORIO,
      `${tipo} exige caso declarado: ${regra.exigeCasoDeclarado.join(' ou ')}`,
    );
  }
  return regra;
}

// Vencimento do estado que a transição abre, calculado com o relógio do
// SERVIDOR de banco — nunca com instante vindo do cliente.
function calculaVenceEm(regra, agora) {
  if (!regra.prazoDoDestinoMs) return null;
  return new Date(agora.getTime() + regra.prazoDoDestinoMs());
}

// `prazo_minutos` e `pago_em` NÃO entram aqui — e não é escolha de estilo: a
// aplicação não tem privilégio de SELECT nessas colunas (migration 0012), e
// pedi-las derrubaria a consulta. É o que impede o pontual de vazar POR
// DESCUIDO. Recalcular o número a partir das coordenadas do log continua
// possível, e isso é limite declarado (seção 8).
async function buscaCorrida(pool, corridaId) {
  const { rows } = await pool.query(
    `SELECT id, estado, seq, vence_em, lojista_id, cliente_id, cidade_id, tabela_preco_id,
            prazo_min_minutos, prazo_max_minutos, origem_zona_nome, destino_zona_nome,
            criado_em, atualizado_em
     FROM corridas WHERE id = $1`,
    [corridaId],
  );
  return rows[0] || null;
}

async function respostaDeReplay(pool, evento) {
  const corrida = await buscaCorrida(pool, evento.agregado_id);
  return { corrida, repetida: true };
}

async function tentaReplay(pool, { chave, tipo, corridaId, confereDados }) {
  const evento = await tentaReplayEvento(pool, {
    chave, tipo, agregadoTipo: AGREGADO, agregadoId: corridaId, confereDados,
  });
  if (!evento) return null;
  return respostaDeReplay(pool, evento);
}

// AUTOR DE EVENTO TEM QUE EXISTIR — Lei 11, e é o mesmo que `clientes.js` já
// fazia. `eventos.autor_id` é polimórfico e não tem FK: o `CHECK` só exige
// campo não nulo, não exige que aponte para alguém. A única defesa possível
// é esta, e sem ela o motor que MAIS grava log gravava autor inventado —
// irreversível pela Lei 3.
const TABELA_DO_ATOR = {
  lojista: 'lojistas',
  motoboy: 'motoboys',
  cliente: 'clientes',
  painel: 'operadores',
};

async function exigeAutorReal(pool, autorTipo, autorId, interno) {
  // 'SISTEMA' É TIPO, NÃO ATOR: ninguém prova ser o sistema, porque não há
  // credencial de sistema. Quem o declara está afirmando algo que não se
  // verifica — e a auditoria mostrou o preço disso: a chave do varredor é
  // `vencimento:<corrida>:<seq>`, DERIVÁVEL, e como o evento do sistema tem
  // autor nulo, a conferência de autor comparava null com null e entregava o
  // replay a qualquer chamador. Reproduzido: "chamador sem id RECEBEU replay
  // do evento do sistema? repetida = true".
  //
  // A partir daqui 'sistema' só vale para caminho INTERNO — o varredor de
  // prazos hoje, o webhook do gateway na Etapa 7. Nada que receba entrada de
  // fora pode passar `interno`.
  if (autorTipo === 'sistema') {
    if (!interno) {
      throw new ErroDeDominio(
        CODIGOS.AUTOR_NAO_AUTORIZADO,
        "'sistema' não é ator: só caminho interno aplica transição de sistema",
      );
    }
    return;
  }
  const tabela = TABELA_DO_ATOR[autorTipo];
  if (!tabela) {
    throw new ErroDeDominio(CODIGOS.AUTOR_NAO_AUTORIZADO, `autor de tipo desconhecido: ${autorTipo}`);
  }
  if (!autorId) {
    throw new ErroDeDominio(CODIGOS.AUTOR_NAO_AUTORIZADO, `${autorTipo} precisa ser identificado`);
  }
  const { rows } = await pool.query(`SELECT id FROM ${tabela} WHERE id = $1`, [autorId]);
  if (rows.length === 0) {
    // Não diz QUAL id: quem só acertou o formato não sai sabendo se existe.
    throw new ErroDeDominio(CODIGOS.AUTOR_NAO_AUTORIZADO, `${autorTipo} do evento não existe`);
  }
}

// O VÍNCULO com a corrida, por tipo de ator.
async function exigeVinculo(pool, corrida, autorTipo, autorId, interno) {
  await exigeAutorReal(pool, autorTipo, autorId, interno);
  if (autorTipo === 'lojista' && corrida.lojista_id !== autorId) {
    throw new ErroDeDominio(CODIGOS.AUTOR_NAO_AUTORIZADO, 'lojista não é o dono desta corrida');
  }
  if (autorTipo === 'cliente' && corrida.cliente_id !== autorId) {
    throw new ErroDeDominio(CODIGOS.AUTOR_NAO_AUTORIZADO, 'cliente não é o destinatário desta corrida');
  }
  // 'painel' não tem vínculo com a corrida — a operação age sobre qualquer
  // uma da cidade dela, por desenho. O que ela precisa é ser operador DE
  // VERDADE, e é o que `exigeAutorReal` acabou de exigir: antes disto, um
  // UUID inventado cancelava corrida com a mercadoria já na rua.
  // O 'motoboy' fica sem vínculo até a Etapa 6 (dívida declarada), mas a
  // EXISTÊNCIA já é exigida acima.
}

// O DESTINATÁRIO da corrida, quando o pedido traz um. É `cliente_id` que
// decide, lá na frente, quem pode mover a corrida como 'cliente' — então um
// id que não aponta para ninguém não pode entrar. Hoje só a FK barraria, e
// FK devolve erro de driver, não erro de domínio: o chamador receberia 500
// no lugar de "esse cliente não existe".
//
// Não há dono a conferir aqui: cliente é da plataforma, não do lojista
// (seção 20) — dois lojistas mandam para o mesmo número e é o caso normal.
// O que se conferiria é OUTRA coisa (se aquele número autorizou receber
// daquela loja), e isso ninguém desenhou ainda. Fica dito, não fingido.
async function exigeDestinatarioReal(pool, clienteId) {
  if (clienteId === undefined || clienteId === null) return;
  const { rows } = await pool.query('SELECT id FROM clientes WHERE id = $1', [clienteId]);
  if (rows.length === 0) {
    throw new ErroDeDominio(CODIGOS.CLIENTE_INEXISTENTE, 'destinatário do pedido não existe');
  }
}

// Pode ENTRAR é uma coisa; pode PEDIR é outra (seção 10). O pedido exige
// lojista real, ativo e com cartão de garantia registrado.
async function exigeLojistaApto(pool, lojistaId) {
  if (!lojistaId) {
    throw new ErroDeDominio(CODIGOS.LOJISTA_INEXISTENTE, 'corrida exige lojista identificado');
  }
  const { rows: [lojista] } = await pool.query(
    'SELECT id, situacao, cartao_registrado_em FROM lojistas WHERE id = $1',
    [lojistaId],
  );
  if (!lojista) {
    throw new ErroDeDominio(CODIGOS.LOJISTA_INEXISTENTE, `lojista ${lojistaId} não existe`);
  }
  if (lojista.situacao !== 'ativa') {
    throw new ErroDeDominio(CODIGOS.CONTA_BLOQUEADA, 'lojista bloqueado não cria corrida');
  }
  if (!lojista.cartao_registrado_em) {
    throw new ErroDeDominio(
      CODIGOS.CARTAO_DE_GARANTIA_AUSENTE,
      'cartão de garantia é exigido antes do primeiro pedido (seção 10)',
    );
  }
  return lojista;
}

// A TRAVA DE CONFIGURAÇÃO DE TAXA. Roda antes de a corrida existir, porque
// a decisão é "recusar-se a operar", não "descobrir o prejuízo depois".
//
// Confere duas coisas, nesta ordem:
//   1. o PIOR PONTO do envelope que a própria configuração declara (frete
//      mínimo com mercadoria no teto). Não depende de nada vindo do cliente,
//      e por isso já morde hoje, antes de a corrida carregar valores;
//   2. os valores REAIS do pedido, quando eles vierem (Etapa 7).
//
// A garantia forte não é esta: é o CHECK da migration 0009, que impede
// PUBLICAR uma configuração capaz de dar prejuízo. Isto aqui é defesa em
// profundidade — e é o que fica vermelho no controle negativo.
async function exigeConfiguracaoQueFecha(pool, dados) {
  const configuracao = await configuracaoVigente(pool);

  calculaSplit({
    mercadoriaCentavos: configuracao.mercadoria_maxima_centavos,
    freteCentavos: configuracao.frete_minimo_centavos,
    configuracao,
  });

  if (dados.mercadoria_centavos !== undefined && dados.frete_centavos !== undefined) {
    calculaSplit({
      mercadoriaCentavos: dados.mercadoria_centavos,
      freteCentavos: dados.frete_centavos,
      configuracao,
    });
  }
  return configuracao;
}

// O prazo estimado da criação (seção 8), ou nada.
//
// As quatro coordenadas andam JUNTAS: com as quatro, o prazo é calculado e
// gravado; sem nenhuma, a corrida nasce sem prazo — endereço é da Etapa 15 e
// não se inventa aqui. Meia coordenada é ERRO, nunca "prazo opcional": o
// pedido que traz origem e esquece destino é pedido quebrado, e devolver
// silêncio esconderia o defeito no lugar de mostrá-lo.
const COORDENADAS = ['origem_lat_e6', 'origem_lng_e6', 'destino_lat_e6', 'destino_lng_e6'];

async function prazoDaCriacao(pool, dados) {
  const presentes = COORDENADAS.filter((chave) => dados[chave] !== undefined);
  if (presentes.length === 0) return null;
  if (presentes.length !== COORDENADAS.length) {
    const faltando = COORDENADAS.filter((chave) => dados[chave] === undefined);
    throw new ErroDeDominio(
      CODIGOS.COORDENADA_INVALIDA,
      `prazo exige as quatro coordenadas; faltando: ${faltando.join(', ')}`,
    );
  }
  const tabelaId = await tabelaVigente(pool);
  return calculaPrazo(pool, {
    tabelaId,
    origemLatE6: dados.origem_lat_e6,
    origemLngE6: dados.origem_lng_e6,
    destinoLatE6: dados.destino_lat_e6,
    destinoLngE6: dados.destino_lng_e6,
  });
}

// Cria a corrida (∅ → procurando motoboy). Toda escrita aceita chave de
// idempotência (Lei 5); sem chave fornecida, gera-se uma — a retentativa do
// chamador que quer idempotência DEVE mandar a própria chave.
async function criaCorrida(pool, { autorTipo, autorId, payload, chaveIdempotencia }) {
  const chave = chaveIdempotencia || randomUUID();
  const dados = higienizaPayload(payload);

  // Lei 5, caso canônico: a resposta se perdeu e o chamador re-envia a
  // MESMA operação depois do commit. A chave decide antes de validar.
  //
  // "MESMA operação" INCLUI O MESMO DONO. Sem esta conferência, a chave
  // repetida por outro lojista devolvia a corrida DELE — e devolvia ANTES da
  // validação de autor, então motoboy, cliente, painel e até 'sistema'
  // recebiam o pedido alheio com um id de chave acertado. Era vazamento e
  // desvio de autorização ao mesmo tempo, e ainda engolia em silêncio o
  // segundo pedido, que nunca era criado. (Achado da auditoria da Etapa 5;
  // `contas.js` e `clientes.js` já faziam a conferência — só a criação de
  // corrida estava aberta.)
  const doMesmoDono = (payloadDoEvento) => payloadDoEvento.lojista_id === autorId;
  if (chaveIdempotencia) {
    const replayPrevio = await tentaReplay(pool, {
      chave, tipo: 'criada', corridaId: null, confereDados: doMesmoDono,
    });
    if (replayPrevio) return replayPrevio;
  }

  const regra = validaTransicao({ tipo: 'criada', estadoAtual: null, autorTipo, payload: dados });
  // Validação no domínio dá erro claro ao chamador; o trigger de banco
  // (migration 0006) é a garantia por construção, defesa em profundidade.
  const lojista = await exigeLojistaApto(pool, autorId);
  await exigeDestinatarioReal(pool, dados.cliente_id);
  const configuracao = await exigeConfiguracaoQueFecha(pool, dados);
  const prazo = await prazoDaCriacao(pool, dados);

  try {
    return await emTransacao(pool, async (conexao) => {
      const agora = await agoraDoBanco(conexao);
      const venceEm = calculaVenceEm(regra, agora);
      const { rows: [corrida] } = await conexao.query(
        `INSERT INTO corridas (
           estado, seq, vence_em, lojista_id, configuracao_taxa_id, mercadoria_centavos,
           cidade_id, cliente_id,
           tabela_preco_id, prazo_minutos, prazo_min_minutos, prazo_max_minutos,
           origem_zona_nome, destino_zona_nome)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id, estado, seq, vence_em, lojista_id, configuracao_taxa_id, mercadoria_centavos,
                   cidade_id, cliente_id, tabela_preco_id,
                   prazo_min_minutos, prazo_max_minutos, origem_zona_nome, destino_zona_nome,
                   criado_em, atualizado_em`,
        [
          regra.para, venceEm, lojista.id, configuracao.id,
          dados.mercadoria_centavos === undefined ? null : dados.mercadoria_centavos,
          pool.cidadeId, dados.cliente_id === undefined ? null : dados.cliente_id,
          prazo ? prazo.tabela_preco_id : null,
          prazo ? prazo.prazo_minutos : null,
          prazo ? prazo.prazo_min_minutos : null,
          prazo ? prazo.prazo_max_minutos : null,
          prazo ? prazo.origem_zona_nome : null,
          prazo ? prazo.destino_zona_nome : null,
        ],
      );
      await conexao.query(
        `INSERT INTO eventos (tipo, agregado_tipo, agregado_id, seq, payload, autor_tipo, autor_id, chave_idempotencia)
         VALUES ($1, $2, $3, 1, $4, $5, $6, $7)`,
        [
          'criada',
          AGREGADO,
          corrida.id,
          // NO LOG VAI A FAIXA, NUNCA O VALOR PONTUAL. O payload do evento é
          // legível pela aplicação; gravar o pontual aqui devolveria pela
          // janela o que o privilégio de coluna tirou pela porta.
          JSON.stringify({
            ...dados,
            // O DONO fica no payload: é o que faz a chave de idempotência
            // valer por chamador, e não virar chave-mestra de quem acertar.
            lojista_id: lojista.id,
            vence_em: venceEm.toISOString(),
            ...(prazo ? {
              tabela_preco_id: prazo.tabela_preco_id,
              prazo_min_minutos: prazo.prazo_min_minutos,
              prazo_max_minutos: prazo.prazo_max_minutos,
              origem_zona_nome: prazo.origem_zona_nome,
              destino_zona_nome: prazo.destino_zona_nome,
            } : {}),
          }),
          autorTipo,
          autorId,
          chave,
        ],
      );
      return { corrida, repetida: false };
    }, { cidadeId: pool.cidadeId });
  } catch (erro) {
    if (ehDisputaDePosicao(erro)) {
      const replay = await tentaReplay(pool, {
        chave, tipo: 'criada', corridaId: null, confereDados: doMesmoDono,
      });
      if (replay) return replay;
      // A chave conflitou mas não gravou nada: só aconteceria com evento
      // apagado, o que o banco proíbe. Erro cru — não é caso de negócio.
      throw new Error(`chave de idempotência ${chave} conflitou mas não foi encontrada`);
    }
    throw erro;
  }
}

// Aplica uma transição. Concorrência: todos os disputantes leem o mesmo seq
// e tentam gravar seq+1; o UNIQUE do banco escolhe exatamente um vencedor.
// `interno` é o que separa o varredor (e, na Etapa 7, o webhook do gateway)
// de qualquer chamador que declare 'sistema'. Ver `exigeAutorReal`.
async function transiciona(pool, {
  corridaId, tipo, autorTipo, autorId, payload, chaveIdempotencia, interno = false,
}) {
  const chave = chaveIdempotencia || randomUUID();
  const dados = higienizaPayload(payload);
  regraDe(tipo);

  // Lei 5, caso canônico: a operação original já venceu e moveu o estado;
  // a retentativa que chega DEPOIS do commit seria recusada como transição
  // ilegal se a chave não fosse consultada antes da validação.
  // O AUTOR É CONFERIDO ANTES DO REPLAY, e a ordem é o ponto.
  //
  // O replay é um atalho que devolve resultado sem passar pela validação de
  // estado — e enquanto ele vinha primeiro, quem acertasse a chave recebia a
  // resposta sem provar nada. Foi assim que a chave da criação virou
  // chave-mestra entre lojistas, e foi assim que o evento do 'sistema' (com
  // a chave derivável do varredor) era entregue a qualquer chamador sem id.
  // A Lei 11 diz isso com todas as letras: a conferência vale também para a
  // RESPOSTA REPETIDA.
  await exigeAutorReal(pool, autorTipo, autorId, interno);

  // Lei 11 na chave: replay é para QUEM FEZ a operação. Sem conferir o
  // autor, dois aparelhos com a mesma chave recebiam ambos "venceu" — e um
  // motoboy passava a crer que aceitou a corrida de outro.
  const doMesmoAutor = (payloadDoEvento) => payloadDoEvento.autor_id === (autorId || null);
  if (chaveIdempotencia) {
    const replayPrevio = await tentaReplay(pool, {
      chave, tipo, corridaId, confereDados: doMesmoAutor,
    });
    if (replayPrevio) return replayPrevio;
  }

  const corridaAtual = await buscaCorrida(pool, corridaId);
  if (!corridaAtual) {
    throw new ErroDeDominio(CODIGOS.CORRIDA_INEXISTENTE, `corrida ${corridaId} não existe`);
  }

  // LEI 11: tipo de ator não é ator. Validar que o chamador é UM lojista não
  // prova que é O lojista daquela corrida.
  //
  // Duas conferências, e a auditoria mostrou que a primeira versão desta
  // correção só fez a do lojista, alegando ser "a metade que dá para fechar
  // hoje". Era falso: `corridas.cliente_id` existe desde a migration 0010 e
  // estava sendo ignorado — um id qualquer declarado 'cliente' cancelava a
  // corrida alheia.
  //
  // A do MOTOBOY é a única que NÃO dá hoje: `corridas` não tem coluna de
  // motoboy, ela nasce na Etapa 6 — que por decisão do dono ABRE por este
  // vínculo, antes da cascata. Dívida declarada, com dono e prazo.
  await exigeVinculo(pool, corridaAtual, autorTipo, autorId, interno);

  let regra;
  try {
    regra = validaTransicao({
      tipo, estadoAtual: corridaAtual.estado, autorTipo, payload: dados,
    });
  } catch (erro) {
    // Lei 5 sob concorrência: a retentativa consultou a chave ANTES de a
    // original commitar (não achou nada) e leu o estado DEPOIS (já movido).
    // Sem esta segunda consulta ela receberia "transição ilegal" por ter
    // feito exatamente o que devia — repetir a mesma operação com a mesma
    // chave. A janela é estreita e por isso mesmo é traiçoeira: aparece na
    // rua, sob carga, e não na bateria de um teste por vez.
    if (chaveIdempotencia && erro instanceof ErroDeDominio
      && erro.codigo === CODIGOS.TRANSICAO_ILEGAL) {
      const replay = await tentaReplay(pool, {
        chave, tipo, corridaId, confereDados: doMesmoAutor,
      });
      if (replay) return replay;
    }
    throw erro;
  }
  const novoSeq = corridaAtual.seq + 1;

  try {
    return await emTransacao(pool, async (conexao) => {
      const agora = await agoraDoBanco(conexao);
      const venceEm = calculaVenceEm(regra, agora);
      const payloadDoEvento = {
        ...dados,
        // O autor no payload é o que faz a chave valer por chamador.
        autor_id: autorId || null,
        ...(venceEm === null ? {} : { vence_em: venceEm.toISOString() }),
      };
      await conexao.query(
        `INSERT INTO eventos (tipo, agregado_tipo, agregado_id, seq, payload, autor_tipo, autor_id, chave_idempotencia)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tipo, AGREGADO, corridaId, novoSeq, JSON.stringify(payloadDoEvento), autorTipo, autorId, chave],
      );
      const { rows: [corrida] } = await conexao.query(
        `UPDATE corridas SET estado = $2, seq = $3, vence_em = $4, atualizado_em = now()
         WHERE id = $1
         RETURNING id, estado, seq, vence_em, lojista_id, cliente_id, cidade_id, tabela_preco_id,
                   prazo_min_minutos, prazo_max_minutos, origem_zona_nome, destino_zona_nome,
                   criado_em, atualizado_em`,
        [corridaId, regra.para, novoSeq, venceEm],
      );
      return { corrida, repetida: false };
    }, { cidadeId: pool.cidadeId });
  } catch (erro) {
    // Sob corrida real, a MESMA retentativa pode esbarrar primeiro no UNIQUE
    // de seq ou no trigger anti-buraco (a operação original venceu a
    // posição) — por isso o replay é conferido em todas as disputas de
    // posição, sempre pela chave.
    if (ehDisputaDePosicao(erro)) {
      const replay = await tentaReplay(pool, {
        chave, tipo, corridaId, confereDados: doMesmoAutor,
      });
      if (replay) return replay;
      if (erro.constraint === 'eventos_chave_idempotencia_unica') {
        throw new Error(`chave de idempotência ${chave} conflitou mas não foi encontrada`);
      }
      throw new ErroDeDominio(
        CODIGOS.CONFLITO_DE_CONCORRENCIA,
        `outro evento venceu a posição ${novoSeq} da corrida ${corridaId}`,
      );
    }
    throw erro;
  }
}

// Reconstrói o estado só a partir do log de eventos, usando a MESMA tabela
// declarativa. Usado pela bateria para conferir a projeção (Lei 2).
async function reconstroiEstado(pool, corridaId) {
  const { rows } = await pool.query(
    `SELECT tipo, seq FROM eventos
     WHERE agregado_tipo = $1 AND agregado_id = $2
     ORDER BY seq`,
    [AGREGADO, corridaId],
  );
  if (rows.length === 0) return null;
  let estado = null;
  let esperado = 1;
  for (const evento of rows) {
    if (evento.seq !== esperado) {
      throw new Error(`log da corrida ${corridaId} com buraco: esperava seq ${esperado}, veio ${evento.seq}`);
    }
    const regra = regraDe(evento.tipo);
    if (!regra.de.includes(estado)) {
      throw new Error(`log da corrida ${corridaId} ilegal: ${evento.tipo} a partir de ${estado}`);
    }
    estado = regra.para;
    esperado += 1;
  }
  return { estado, seq: rows.length };
}

// A transição de vencimento de cada estado vem da PRÓPRIA tabela
// declarativa (porPrazo) — o varredor não re-declara regra em código.
const VENCIMENTO_POR_ESTADO = new Map(
  Object.entries(TRANSICOES).flatMap(
    ([tipo, regra]) => (regra.porPrazo ? regra.de.map((de) => [de, tipo]) : []),
  ),
);

// Regra 2 da Etapa 1: vencer é consulta ao banco, não timer em memória.
// Idempotente e seguro com vários varredores: a chave determinística e o
// UNIQUE de seq fazem cada vencimento ser aplicado no máximo uma vez.
async function expiraVencidas(pool) {
  const { rows: vencidas } = await pool.query(
    `SELECT id, estado, seq FROM corridas
     WHERE estado = ANY($1::int[]) AND vence_em IS NOT NULL AND vence_em <= now()`,
    [[...VENCIMENTO_POR_ESTADO.keys()]],
  );
  let aplicadas = 0;
  const problemas = [];
  for (const corrida of vencidas) {
    const tipo = VENCIMENTO_POR_ESTADO.get(corrida.estado);
    try {
      const { repetida } = await transiciona(pool, {
        corridaId: corrida.id,
        tipo,
        autorTipo: 'sistema',
        autorId: null,
        payload: {},
        interno: true,
        chaveIdempotencia: `vencimento:${corrida.id}:${corrida.seq}`,
      });
      if (!repetida) aplicadas += 1;
    } catch (erro) {
      // Outro varredor ou uma transição legítima venceu a corrida no meio:
      // não é falha, o vencimento deixou de valer.
      if (
        erro instanceof ErroDeDominio
        && [CODIGOS.CONFLITO_DE_CONCORRENCIA, CODIGOS.TRANSICAO_ILEGAL].includes(erro.codigo)
      ) {
        continue;
      }
      // UMA CORRIDA NÃO DERRUBA A VARREDURA DA CIDADE. Antes, qualquer outro
      // erro subia e abortava o laço — e uma única corrida envenenada (por
      // exemplo com a chave determinística `vencimento:<id>:<seq>` já
      // queimada por um chamador) parava o vencimento de TODAS as outras,
      // para sempre. O erro NÃO é engolido: é registrado, e se a lista
      // inteira falhar o erro sobe, porque aí não é uma corrida ruim, é o
      // varredor quebrado. (Achado da auditoria da Etapa 5; a queima da
      // chave em si é defeito aberto — ver HISTORICO.md.)
      problemas.push(erro);
      console.error(`varredor: corrida ${corrida.id} não venceu (${erro.message})`);
    }
  }
  if (aplicadas === 0 && problemas.length > 0 && problemas.length === vencidas.length) {
    throw problemas[0];
  }
  return aplicadas;
}

// Trava de segurança (medida provisória até a Etapa 8): os estados vivos 2,
// 3, 5 e 6 não têm prazo, e o 4 tem prazo gravado mas ninguém o aplica
// automaticamente — a saída dele exige a DECLARAÇÃO do motoboy, e varredor
// não declara pelos outros. Esta consulta lista toda corrida parada em
// estado vivo há mais de `horas`: mercadoria de terceiro nunca fica
// invisível, e no estado 5 o dinheiro já foi dividido.
async function corridasParadas(pool, { horas = 24 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, estado, seq, atualizado_em, now() - atualizado_em AS parada_ha
     FROM corridas
     WHERE estado = ANY($1::int[])
       AND atualizado_em <= now() - make_interval(hours => $2)
     ORDER BY atualizado_em`,
    [E.VIVOS, horas],
  );
  return rows;
}

module.exports = {
  criaCorrida,
  exigeConfiguracaoQueFecha,
  transiciona,
  reconstroiEstado,
  expiraVencidas,
  corridasParadas,
  buscaCorrida,
};
