-- Etapa 4 — multi-cidade e o cliente como ator.
--
-- Duas coisas nesta migration, e a primeira é a que dá trabalho:
--
-- 1. CIDADE COMO ENTIDADE DE PRIMEIRA CLASSE, com o isolamento imposto por
--    ROW LEVEL SECURITY contra o papel `corre_app` — não por disciplina de
--    quem escreve consulta (CORRE.md, seção 20). Disciplina não se prova por
--    efeito e depende de ninguém esquecer.
--
--    A política FECHA POR PADRÃO: a cidade vem de uma variável de sessão, e
--    variável não definida ⇒ NENHUMA linha. Esquecer de declarar a cidade
--    CEGA, nunca vaza.
--
--    E a variável é de TRANSAÇÃO (`SET LOCAL`), nunca de conexão: conexão de
--    pool é reaproveitada, e cidade presa à conexão vaza para a requisição
--    seguinte — em silêncio e só sob carga.
--
-- 2. O CLIENTE COMO ATOR. Nasce sozinho quando o lojista digita o telefone e
--    passa a ser dele quando entra pelo código de 6 dígitos. NÃO tem cidade:
--    é da plataforma e recebe entrega onde estiver — por isso `clientes` não
--    tem RLS. O que o isolamento protege é o que importa: as CORRIDAS dele
--    são da cidade.

CREATE TABLE cidades (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          TEXT NOT NULL CHECK (nome <> ''),
  uf            TEXT NOT NULL CHECK (uf ~ '^[A-Z]{2}$'),
  -- Código IBGE: identidade estável da cidade, que nome e UF não dão
  -- (existe mais de uma "Bom Jesus" no mesmo estado).
  ibge          TEXT NOT NULL CHECK (ibge ~ '^[0-9]{7}$'),
  -- O outro número do prazo estimado (seção 8): dado da cidade.
  tempo_base_coleta_min INTEGER NOT NULL CHECK (tempo_base_coleta_min >= 0),
  -- Valor de exemplo enquanto o real não vem (seção 17, item 5).
  exemplo       BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cidades_ibge_unico UNIQUE (ibge)
);

COMMENT ON TABLE cidades IS
  'Cidade é entidade de primeira classe desde a primeira migration (seção 20). Sobral é a cidade 1.';

-- Sobral tem id FIXO. Não é enfeite: é o que permite ao código e à bateria
-- endereçarem a cidade 1 sem uma consulta prévia — e uma consulta prévia
-- para descobrir a cidade seria, ela mesma, uma consulta sem cidade. Os
-- dígitos do meio são o código IBGE.
INSERT INTO cidades (id, nome, uf, ibge, tempo_base_coleta_min, exemplo)
VALUES ('00000001-2312-4908-8000-000000000001', 'Sobral', 'CE', '2312908', 10, true);

-- A cidade da requisição, lida da variável de TRANSAÇÃO. NULL quando não
-- declarada — e é isso que faz a política fechar por padrão.
-- NULLIF protege contra a variável definida como string vazia, que faria
-- o cast explodir em vez de cegar.
CREATE FUNCTION corre_cidade_atual() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('corre.cidade_id', true), '')::UUID
$$;

COMMENT ON FUNCTION corre_cidade_atual IS
  'Cidade da transação corrente. NULL se não declarada — e política com NULL não devolve linha nenhuma.';

-- ----------------------------------------------------------- cidade_id

ALTER TABLE motoboys           ADD COLUMN cidade_id UUID REFERENCES cidades (id);
ALTER TABLE lojistas           ADD COLUMN cidade_id UUID REFERENCES cidades (id);
ALTER TABLE tabelas_preco      ADD COLUMN cidade_id UUID REFERENCES cidades (id);
ALTER TABLE zonas              ADD COLUMN cidade_id UUID REFERENCES cidades (id);
ALTER TABLE configuracoes_taxa ADD COLUMN cidade_id UUID REFERENCES cidades (id);
ALTER TABLE corridas           ADD COLUMN cidade_id UUID REFERENCES cidades (id);

UPDATE motoboys           SET cidade_id = (SELECT id FROM cidades WHERE ibge = '2312908');
UPDATE lojistas           SET cidade_id = (SELECT id FROM cidades WHERE ibge = '2312908');
UPDATE tabelas_preco      SET cidade_id = (SELECT id FROM cidades WHERE ibge = '2312908');
UPDATE zonas              SET cidade_id = (SELECT id FROM cidades WHERE ibge = '2312908');
UPDATE configuracoes_taxa SET cidade_id = (SELECT id FROM cidades WHERE ibge = '2312908');
UPDATE corridas           SET cidade_id = (SELECT id FROM cidades WHERE ibge = '2312908');

ALTER TABLE motoboys           ALTER COLUMN cidade_id SET NOT NULL;
ALTER TABLE lojistas           ALTER COLUMN cidade_id SET NOT NULL;
ALTER TABLE tabelas_preco      ALTER COLUMN cidade_id SET NOT NULL;
ALTER TABLE zonas              ALTER COLUMN cidade_id SET NOT NULL;
ALTER TABLE configuracoes_taxa ALTER COLUMN cidade_id SET NOT NULL;
ALTER TABLE corridas           ALTER COLUMN cidade_id SET NOT NULL;

-- A configuração de taxa passou a ser POR CIDADE (seção 20): a carta de
-- lançamento com taxa zero nos primeiros 90 dias é inerentemente por cidade,
-- e transformar global em por-cidade depois seria migração em tabela com
-- dinheiro apontando para ela. O rótulo deixa de ser único no mundo e passa
-- a ser único DENTRO da cidade.
ALTER TABLE configuracoes_taxa DROP CONSTRAINT configuracoes_taxa_rotulo_key;
ALTER TABLE configuracoes_taxa ADD CONSTRAINT configuracoes_taxa_rotulo_por_cidade UNIQUE (cidade_id, rotulo);

-- ------------------------------------------- a cidade casa entre tabelas
--
-- O BANCO IMPÕE, NÃO O CÓDIGO. Chaves compostas: uma corrida não consegue
-- apontar para lojista, tabela de preço ou configuração de OUTRA cidade —
-- é impossível por construção, não recusado por verificação.
ALTER TABLE lojistas           ADD CONSTRAINT lojistas_id_cidade UNIQUE (id, cidade_id);
ALTER TABLE tabelas_preco      ADD CONSTRAINT tabelas_preco_id_cidade UNIQUE (id, cidade_id);
ALTER TABLE configuracoes_taxa ADD CONSTRAINT configuracoes_taxa_id_cidade UNIQUE (id, cidade_id);

ALTER TABLE corridas ADD CONSTRAINT corridas_lojista_da_mesma_cidade
  FOREIGN KEY (lojista_id, cidade_id) REFERENCES lojistas (id, cidade_id);
ALTER TABLE corridas ADD CONSTRAINT corridas_tabela_preco_da_mesma_cidade
  FOREIGN KEY (tabela_preco_id, cidade_id) REFERENCES tabelas_preco (id, cidade_id);
ALTER TABLE corridas ADD CONSTRAINT corridas_configuracao_da_mesma_cidade
  FOREIGN KEY (configuracao_taxa_id, cidade_id) REFERENCES configuracoes_taxa (id, cidade_id);
ALTER TABLE zonas ADD CONSTRAINT zonas_tabela_da_mesma_cidade
  FOREIGN KEY (tabela_id, cidade_id) REFERENCES tabelas_preco (id, cidade_id);

-- (A trava equivalente para o MOTOBOY é critério HERDADO da Etapa 6:
--  `corridas` só ganha coluna de motoboy lá. Registrado na tabela de etapas
--  para não se perder no caminho.)

-- ------------------------------------------------------------- clientes
--
-- O cliente é da PLATAFORMA, não da cidade (seção 20) — por isso esta tabela
-- não tem cidade_id e não tem RLS.
--
-- Telefone é único DENTRO de clientes. O mesmo número pode ser de um lojista,
-- de um motoboy e de um cliente ao mesmo tempo: em Sobral a mesma pessoa é os
-- três, e papéis são identidades distintas que por acaso compartilham um
-- número. É decisão deliberada (seção 20), não omissão.
CREATE TABLE clientes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq            INTEGER NOT NULL CHECK (seq >= 1),
  telefone       TEXT NOT NULL CHECK (telefone <> ''),
  -- O lojista digita o telefone; o nome só existe quando o cliente entra.
  nome           TEXT,
  situacao       TEXT NOT NULL CHECK (situacao IN ('ativa', 'bloqueada')),
  -- A conta nasce sozinha e passa a ser dele quando entra pelo código de 6
  -- dígitos. Enquanto não for reivindicada, falta de pagamento NÃO entra na
  -- reputação (seção 10): punir quem nunca soube que existia é punir o
  -- inocente.
  reivindicado_em TIMESTAMPTZ,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT clientes_telefone_unico UNIQUE (telefone)
);

COMMENT ON TABLE clientes IS
  'Cliente é da plataforma, não da cidade (seção 20) — sem cidade_id e sem RLS. Telefone único DENTRO deste papel.';

-- A corrida aponta para o cliente já aqui, na etapa de modelo de dados:
-- acrescentar coluna depois, com eventos apontando para a tabela, é caro sem
-- motivo. Anulável enquanto o fluxo de criação com cliente é da Etapa 5.
ALTER TABLE corridas ADD COLUMN cliente_id UUID REFERENCES clientes (id);
CREATE INDEX corridas_por_cliente ON corridas (cliente_id);

-- Cliente entra pelo mesmo mecanismo de código de 6 dígitos do lojista.
ALTER TABLE codigos_otp DROP CONSTRAINT codigos_otp_ator_tipo_check;
ALTER TABLE codigos_otp ADD CONSTRAINT codigos_otp_ator_tipo_check
  CHECK (ator_tipo IN ('lojista', 'operador', 'cliente'));

-- ------------------------------------------------- a cidade vem da sessão
--
-- Nunca do corpo da requisição (seção 20). A sessão guarda a cidade do ator
-- no instante em que nasce; a requisição abre transação, declara aquela
-- cidade e só então lê qualquer coisa. Também resolve o ovo-e-galinha: ler
-- o ator para descobrir a cidade exigiria a cidade.
--
-- NULL para cliente (não tem cidade) e para operador (a escolha de cidade do
-- painel é da Etapa 11) — e NULL significa não enxergar nada, que é o
-- comportamento certo até lá.
ALTER TABLE sessoes DROP CONSTRAINT sessoes_ator_tipo_check;
ALTER TABLE sessoes ADD CONSTRAINT sessoes_ator_tipo_check
  CHECK (ator_tipo IN ('motoboy', 'lojista', 'operador', 'cliente'));
ALTER TABLE sessoes ADD COLUMN cidade_id UUID REFERENCES cidades (id);
ALTER TABLE sessoes ADD CONSTRAINT sessoes_cidade_exigida_para_operacao
  CHECK (ator_tipo IN ('cliente', 'operador') OR cidade_id IS NOT NULL);

UPDATE sessoes SET cidade_id = (SELECT id FROM cidades WHERE ibge = '2312908')
WHERE ator_tipo IN ('motoboy', 'lojista');

-- --------------------------------------------------- ROW LEVEL SECURITY
--
-- Uma política por tabela, FOR ALL (leitura e escrita), só para corre_app.
-- USING vigia o que se lê; WITH CHECK impede gravar linha de outra cidade —
-- é o WITH CHECK que dá dente à trava, não o USING.
--
-- corre_dono é dono das tabelas e passa por cima das políticas: é o que as
-- migrations precisam. A garantia é contra corre_app, que é quem a aplicação
-- usa (CORRE.md, Stack).

ALTER TABLE motoboys           ENABLE ROW LEVEL SECURITY;
ALTER TABLE lojistas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tabelas_preco      ENABLE ROW LEVEL SECURITY;
ALTER TABLE zonas              ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracoes_taxa ENABLE ROW LEVEL SECURITY;
ALTER TABLE corridas           ENABLE ROW LEVEL SECURITY;

CREATE POLICY motoboys_da_cidade ON motoboys FOR ALL TO corre_app
  USING (cidade_id = corre_cidade_atual()) WITH CHECK (cidade_id = corre_cidade_atual());
CREATE POLICY lojistas_da_cidade ON lojistas FOR ALL TO corre_app
  USING (cidade_id = corre_cidade_atual()) WITH CHECK (cidade_id = corre_cidade_atual());
CREATE POLICY tabelas_preco_da_cidade ON tabelas_preco FOR ALL TO corre_app
  USING (cidade_id = corre_cidade_atual()) WITH CHECK (cidade_id = corre_cidade_atual());
CREATE POLICY zonas_da_cidade ON zonas FOR ALL TO corre_app
  USING (cidade_id = corre_cidade_atual()) WITH CHECK (cidade_id = corre_cidade_atual());
CREATE POLICY configuracoes_taxa_da_cidade ON configuracoes_taxa FOR ALL TO corre_app
  USING (cidade_id = corre_cidade_atual()) WITH CHECK (cidade_id = corre_cidade_atual());
CREATE POLICY corridas_da_cidade ON corridas FOR ALL TO corre_app
  USING (cidade_id = corre_cidade_atual()) WITH CHECK (cidade_id = corre_cidade_atual());

-- ------------------------------------------------------------ privilégios

REVOKE ALL ON cidades, clientes FROM PUBLIC;

GRANT SELECT ON cidades TO corre_app;
-- Cidade se abre por ato de dono, como a tabela de preço. A aplicação lê.

GRANT SELECT ON clientes TO corre_app;
GRANT INSERT (seq, telefone, nome, situacao) ON clientes TO corre_app;
GRANT UPDATE (seq, nome, situacao, reivindicado_em, atualizado_em) ON clientes TO corre_app;

GRANT INSERT (cidade_id) ON motoboys TO corre_app;
GRANT INSERT (cidade_id) ON lojistas TO corre_app;
GRANT INSERT (cidade_id, cliente_id) ON corridas TO corre_app;
GRANT INSERT (cidade_id) ON sessoes TO corre_app;
