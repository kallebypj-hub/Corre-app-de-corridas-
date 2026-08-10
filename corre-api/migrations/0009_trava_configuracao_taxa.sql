-- Trava de configuração de taxa.
--
-- O PROBLEMA QUE ELA RESOLVE. Desde a revisão de 2026-08-09 a cobrança leva
-- mercadoria + frete, e a taxa do gateway incide sobre esse total — mas a
-- receita do Corre é só 5% do FRETE. Se a taxa sair da comissão, o ponto de
-- equilíbrio é `mercadoria <= 3,2 × frete`: com frete de R$ 10, todo pedido
-- acima de ~R$ 32 de mercadoria dá prejuízo, e o prejuízo CRESCE com o preço
-- da mercadoria, que não é nosso. Isso aconteceria em SILÊNCIO — nada no
-- sistema falharia. Bastaria o parâmetro de concentração de taxa não estar
-- ativo: contrato diferente, gateway trocado, configuração errada.
--
-- A DECISÃO: a plataforma se recusa a operar em vez de operar no prejuízo.
--
-- ONDE A GARANTIA MORA. No banco, não no código, e no momento mais cedo
-- possível: uma configuração que possa produzir parcela do Corre <= 0 dentro
-- do próprio envelope que ela declara NÃO PODE SER PUBLICADA. Sem
-- configuração publicada não há corrida, e sem corrida não há cobrança. O
-- domínio repete a conta por corrida (defesa em profundidade), mas a trava
-- de verdade é este CHECK.

-- De quem sai a TAXA PERCENTUAL do gateway. A taxa FIXA não entra aqui de
-- propósito: nenhum gateway pesquisado permite rateá-la — ela cai
-- obrigatoriamente na plataforma, sempre. Por isso ela é sempre do Corre na
-- conta abaixo, e por isso custo fixo é eliminatório (Lei 7).
CREATE TYPE portador_taxa AS ENUM ('lojista', 'proporcional', 'corre');

COMMENT ON TYPE portador_taxa IS
  'Quem arca com a taxa PERCENTUAL do gateway no split. A taxa FIXA é sempre da plataforma — não é rateável em nenhum gateway.';

-- A conta da parcela do Corre, em centavos inteiros (Lei 1). É a MESMA
-- fórmula de src/dominio/split.js, e a bateria prova que as duas coincidem
-- em milhares de casos aleatórios — duas implementações que divergem em
-- silêncio seriam pior que uma só.
--
-- ARREDONDAMENTOS DECLARADOS (três, cada um com um princípio):
--   1. comissão: PISO — o centavo de arredondamento vai para o MOTOBOY,
--      nunca para a plataforma;
--   2. taxa: TETO — nunca subestimar custo;
--   3. rateio: ninguém paga taxa maior que a própria parcela, e toda sobra
--      e todo resto caem na PLATAFORMA — o arredondamento nunca cai em quem
--      não escolheu o gateway, e é na plataforma que a trava vigia.
CREATE FUNCTION parcela_corre_centavos(
  p_mercadoria   centavos,
  p_frete        centavos,
  p_comissao_bps INTEGER,
  p_taxa_pct_bps INTEGER,
  p_taxa_fixa    centavos,
  p_portador     portador_taxa
) RETURNS centavos
LANGUAGE sql IMMUTABLE STRICT AS $$
  WITH base AS (
    SELECT
      (p_mercadoria + p_frete)::BIGINT               AS total,
      -- PISO: divisão inteira de não-negativos trunca para baixo.
      ((p_frete * p_comissao_bps) / 10000)::BIGINT   AS corre_bruto
  ), com_taxa AS (
    SELECT base.*,
      base.total - base.corre_bruto - p_mercadoria           AS motoboy_bruto,
      -- TETO.
      ((base.total * p_taxa_pct_bps + 9999) / 10000)::BIGINT AS taxa_pct
    FROM base
  ), pretensao AS (
    SELECT com_taxa.*,
      CASE p_portador
        WHEN 'lojista' THEN com_taxa.taxa_pct
        WHEN 'corre'   THEN 0::BIGINT
        ELSE CASE WHEN com_taxa.total = 0 THEN 0::BIGINT
                  ELSE (com_taxa.taxa_pct * p_mercadoria) / com_taxa.total END
      END AS quer_lojista,
      CASE WHEN p_portador = 'proporcional' AND com_taxa.total > 0
           THEN (com_taxa.taxa_pct * com_taxa.motoboy_bruto) / com_taxa.total
           ELSE 0::BIGINT
      END AS quer_motoboy
    FROM com_taxa
  ), teto_por_parcela AS (
    -- Ninguém paga taxa maior que a própria parcela.
    SELECT pretensao.*,
      LEAST(pretensao.quer_lojista, p_mercadoria::BIGINT)   AS taxa_lojista,
      LEAST(pretensao.quer_motoboy, pretensao.motoboy_bruto) AS taxa_motoboy
    FROM pretensao
  )
  -- A plataforma é o RESÍDUO: taxa fixa + o que sobrou do teto de cada um.
  SELECT (teto_por_parcela.corre_bruto
          - (p_taxa_fixa + teto_por_parcela.taxa_pct
             - teto_por_parcela.taxa_lojista - teto_por_parcela.taxa_motoboy))::centavos
  FROM teto_por_parcela;
$$;

COMMENT ON FUNCTION parcela_corre_centavos IS
  'Parcela líquida do Corre em centavos. Espelha src/dominio/split.js; a bateria prova a equivalência.';

-- Uma versão da configuração de taxa. Publicada uma vez, é imutável — as
-- corridas apontam para ela, e um split cobrado precisa ser auditável anos
-- depois. Nova negociação = nova versão.
CREATE TABLE configuracoes_taxa (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Ordem de publicação monotônica: decide a versão vigente de forma
  -- DETERMINÍSTICA mesmo com duas publicações simultâneas (Lei 9). Sem ela
  -- o desempate cairia em timestamp, que empata.
  ordem_publicacao   BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  rotulo             TEXT NOT NULL UNIQUE CHECK (rotulo <> ''),
  -- Qual fornecedor esta configuração descreve. A escolha está REABERTA
  -- (CORRE.md, seção 17, item 1), daí 'nao_escolhido' ser um valor legítimo.
  gateway            TEXT NOT NULL CHECK (gateway <> ''),

  -- A comissão do Corre, em pontos-base do FRETE. 500 = 5%.
  comissao_bps       INTEGER NOT NULL CHECK (comissao_bps > 0 AND comissao_bps <= 10000),
  -- A taxa do gateway, em pontos-base do TOTAL (mercadoria + frete).
  taxa_percentual_bps INTEGER NOT NULL CHECK (taxa_percentual_bps >= 0 AND taxa_percentual_bps < 10000),
  -- Componente FIXO da taxa. Cai sempre na plataforma (ver portador_taxa).
  taxa_fixa_centavos centavos NOT NULL DEFAULT 0 CHECK (taxa_fixa_centavos >= 0),
  portador_taxa_percentual portador_taxa NOT NULL,

  -- O ENVELOPE que a configuração declara operar. É contra ele que o CHECK
  -- abaixo prova a segurança — uma configuração só é publicável se fechar
  -- em TODO o envelope que ela mesma declara.
  frete_minimo_centavos      centavos NOT NULL CHECK (frete_minimo_centavos > 0),
  mercadoria_maxima_centavos centavos NOT NULL CHECK (mercadoria_maxima_centavos >= 0),

  exemplo            BOOLEAN NOT NULL DEFAULT true,
  publicada_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A TRAVA. Avaliada nos dois extremos do envelope, porque a parcela do
  -- Corre é monótona em mercadoria para 'corre' (pior no teto) e constante
  -- para 'lojista'; em 'proporcional' varia por no máximo um centavo entre
  -- os extremos, e os dois são conferidos.
  CONSTRAINT configuracao_taxa_nunca_opera_no_prejuizo CHECK (
    parcela_corre_centavos(
      0::centavos, frete_minimo_centavos,
      comissao_bps, taxa_percentual_bps, taxa_fixa_centavos, portador_taxa_percentual
    ) > 0
    AND parcela_corre_centavos(
      mercadoria_maxima_centavos, frete_minimo_centavos,
      comissao_bps, taxa_percentual_bps, taxa_fixa_centavos, portador_taxa_percentual
    ) > 0
  )
);

COMMENT ON TABLE configuracoes_taxa IS
  'Versões da configuração de taxa. Imutável após publicada. Configuração que possa dar prejuízo no próprio envelope é RECUSADA pelo banco.';
COMMENT ON CONSTRAINT configuracao_taxa_nunca_opera_no_prejuizo ON configuracoes_taxa IS
  'A plataforma se recusa a operar em vez de operar no prejuízo. Sem configuração publicada não há corrida.';

-- A corrida guarda a configuração que usou — auditar um split anos depois.
-- Preenchida no pedido (Etapa 7); aqui a coluna nasce anulável.
ALTER TABLE corridas
  ADD COLUMN configuracao_taxa_id UUID REFERENCES configuracoes_taxa (id),
  ADD COLUMN mercadoria_centavos  centavos CHECK (mercadoria_centavos IS NULL OR mercadoria_centavos >= 0);

-- Configuração é dado versionado, não log: o app só LÊ. Publicar é ato de
-- dono. Sem UPDATE e sem DELETE para a aplicação, versão publicada é
-- imutável — e é por isso que ler-a-configuração-e-depois-gravar-a-corrida
-- não é leitura-e-depois-escrita: não existe janela para a configuração
-- mudar entre as duas (Lei 9).
REVOKE ALL ON configuracoes_taxa FROM PUBLIC;
GRANT SELECT ON configuracoes_taxa TO corre_app;
GRANT INSERT (configuracao_taxa_id, mercadoria_centavos) ON corridas TO corre_app;

-- Configuração de EXEMPLO, para a bateria e o desenvolvimento rodarem. O
-- gateway ainda não foi escolhido (CORRE.md, seção 17, item 1) e nenhum
-- número aqui é contratado: 1,19% é preço de TABELA, e o portador 'lojista'
-- pressupõe o parâmetro de concentração de taxa por recebedor, que só a
-- assinatura do contrato confirma. Marcada exemplo = true.
INSERT INTO configuracoes_taxa (
  rotulo, gateway, comissao_bps, taxa_percentual_bps, taxa_fixa_centavos,
  portador_taxa_percentual, frete_minimo_centavos, mercadoria_maxima_centavos, exemplo
) VALUES (
  'exemplo-2026-08-09', 'nao_escolhido', 500, 119, 0, 'lojista', 500, 50000, true
);
