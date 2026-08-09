-- Etapa 3 — zonas e preço. O motor de preço: matriz de zonas, resolução de
-- endereço para zona, cálculo do frete. Sem tela, sem pedido, sem pagamento.
--
-- Regra 1: a tabela de zonas é DADO, versionado — alterar preço cria uma
-- versão nova, nunca sobrescreve. Toda corrida guarda qual versão usou, para
-- auditar um preço cobrado seis meses atrás.
-- Regra 4/Lei 1: todo dinheiro é inteiro em centavos.

-- Uma versão da tabela de preços. Publicada uma vez, é imutável (as corridas
-- apontam para ela). Nova alteração = nova versão.
CREATE TABLE tabelas_preco (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rotulo        TEXT NOT NULL CHECK (rotulo <> ''),
  -- Marca claramente dado de exemplo: a tabela real de Sobral ainda não
  -- existe (regra 7). Nenhuma versão de exemplo deve ir a produção.
  exemplo       BOOLEAN NOT NULL DEFAULT true,
  -- O centro de referência para "fora de zona" é o centro da ÚLTIMA zona
  -- (maior ordem), derivado do retângulo dela (seção 8) — não é dado da
  -- tabela.
  -- Fatores de conversão graus→metros, como DADO inteiro (não há cos/float
  -- no caminho do cálculo, regra 4): metros por grau de latitude (~111320)
  -- e por grau de longitude (~111320·cos(lat_centro)), pré-calculados na
  -- importação e gravados aqui. Assim a distância em linha reta é aritmética
  -- inteira pura.
  metros_por_grau_lat INTEGER NOT NULL CHECK (metros_por_grau_lat > 0),
  metros_por_grau_lng INTEGER NOT NULL CHECK (metros_por_grau_lng > 0),
  -- Adicional por km fora de zona (centavos por km), Lei 1. Valor de exemplo.
  adicional_km_centavos BIGINT NOT NULL CHECK (adicional_km_centavos >= 0),
  publicada_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE tabelas_preco IS
  'Versões da tabela de preço. Imutável após publicada; nova alteração cria nova versão (Etapa 3, regra 1).';

-- Uma zona dentro de uma versão. Preço fixo por zona (centavos). A geometria
-- do MVP é um retângulo em lat/lng (graus × 1e6, inteiro) — resolução por
-- contenção, sem API externa (regra 3). ordem desempata sobreposição e
-- fronteira de forma DETERMINÍSTICA (regra: menor ordem vence).
CREATE TABLE zonas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tabela_id       UUID NOT NULL REFERENCES tabelas_preco (id),
  nome            TEXT NOT NULL CHECK (nome <> ''),
  ordem           INTEGER NOT NULL CHECK (ordem >= 0),
  preco_centavos  BIGINT NOT NULL CHECK (preco_centavos >= 0),
  -- Retângulo inclusivo [min,max] em graus × 1e6.
  lat_min_e6      INTEGER NOT NULL,
  lat_max_e6      INTEGER NOT NULL,
  lng_min_e6      INTEGER NOT NULL,
  lng_max_e6      INTEGER NOT NULL,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT zonas_retangulo_valido CHECK (lat_min_e6 <= lat_max_e6 AND lng_min_e6 <= lng_max_e6),
  CONSTRAINT zonas_ordem_unica_por_tabela UNIQUE (tabela_id, ordem)
);

CREATE INDEX zonas_por_tabela ON zonas (tabela_id, ordem);

-- Corrida guarda a versão da tabela e o preço que usou — auditoria (regra 1).
-- Preenchidos no pedido (Etapa 4); nesta etapa a coluna nasce anulável.
ALTER TABLE corridas
  ADD COLUMN tabela_preco_id UUID REFERENCES tabelas_preco (id),
  ADD COLUMN frete_centavos  BIGINT CHECK (frete_centavos IS NULL OR frete_centavos >= 0),
  ADD COLUMN zona_nome       TEXT;

-- Tabela de preço é dado versionado, não log de eventos: o app só LÊ.
-- A publicação de versões é feita por migration/seed (corre_dono), nunca
-- pela aplicação — versão publicada é imutável.
REVOKE ALL ON tabelas_preco, zonas FROM PUBLIC;
GRANT SELECT ON tabelas_preco TO corre_app;
GRANT SELECT ON zonas TO corre_app;

GRANT INSERT (tabela_preco_id, frete_centavos, zona_nome) ON corridas TO corre_app;
