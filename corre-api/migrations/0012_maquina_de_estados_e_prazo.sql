-- Etapa 5 — a máquina de estados nova (entrega consignada ao pagamento) e o
-- prazo estimado.
--
-- A tabela de estados da Etapa 1 foi INVALIDADA pela revisão de 2026-08-09: o
-- pagamento saiu do começo do fluxo e foi para a porta do cliente. Não é
-- ajuste, é substituição — outros estados, outra numeração, outro conjunto de
-- arestas.
--
-- SUBSTITUIÇÃO SEM CAMINHO DE MIGRAÇÃO, e por que isso é legítimo AQUI:
-- nada está em produção e a bateria nasce do zero das migrations. Mas
-- "legítimo hoje" some sem aviso no dia em que existir cliente real, então a
-- regra não fica na cabeça de ninguém: o bloco abaixo RECUSA a migration se
-- houver uma corrida sequer. Quem tiver dado real é obrigado a declarar o
-- caminho antes de renumerar (CORRE.md, regime de trabalho).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM corridas) THEN
    RAISE EXCEPTION
      'corridas nao esta vazia: renumerar estado exige caminho de migracao declarado (CORRE.md, regime de trabalho)';
  END IF;
END
$$;

-- ---------------------------------------------------------------- estados
--
-- ANTES (Etapa 1)                    DEPOIS (esta migration)
--  1 aguardando_pagamento (morto)     1 procurando_motoboy
--  2 procurando_motoboy               2 a_caminho_da_loja
--  3 a_caminho_da_loja                3 com_a_mercadoria
--  4 com_a_mercadoria                 4 na_porta_cobrando   <- novo
--  5 em_retorno                       5 pago                <- novo
--  6 em_disputa                       6 em_retorno
--  7 entregue                         7 em_disputa
--  8 expirada (extinto)               8 entregue
--  9 sem_motoboy                      9 sem_motoboy
-- 10 cancelada                       10 cancelada
-- 11 devolvida                       11 devolvida
--
-- "Expirada" se extinguiu: ela existia para a corrida que ninguém pagava em
-- 15 minutos, e não se paga mais no começo. Corrida que ninguém aceita morre
-- em "Sem motoboy" e ponto.

COMMENT ON TABLE corridas IS
  'Projeção do estado atual; a verdade é a tabela eventos. Estados (seção 4): 1 procurando_motoboy, 2 a_caminho_da_loja, 3 com_a_mercadoria, 4 na_porta_cobrando, 5 pago, 6 em_retorno, 7 em_disputa, 8 entregue, 9 sem_motoboy, 10 cancelada, 11 devolvida.';

-- Vivos com prazo mudaram: agora são 1 (cascata de 5 min) e 4 (espera na
-- porta de 5 min). O índice do varredor segue os estados, não a numeração
-- antiga.
DROP INDEX corridas_vencidas;
CREATE INDEX corridas_vencidas ON corridas (vence_em)
  WHERE estado IN (1, 4) AND vence_em IS NOT NULL;

-- ------------------------------------------------- a invariante da etapa
--
-- "NENHUM CAMINHO CHEGA A ENTREGUE SEM PASSAR POR PAGO."
--
-- A tabela declarativa de transições já garante isso — 5→8 é a única aresta
-- que entra em 8. Mas essa garantia mora em JavaScript, e uma linha errada
-- em `transicoes.js` a desliga inteira, em silêncio. Aqui vai a SEGUNDA
-- camada, no banco, construída como a `cidade_id` de `eventos` (0011): por
-- DERIVAÇÃO, não por confiança.
--
-- `pago_em` é escrito por TRIGGER quando o estado vira 5, e a aplicação NÃO
-- TEM GRANT para escrevê-lo. Valor que o chamador não fornece é valor que o
-- chamador não forja. O CHECK então exige o fato: estado 8 sem `pago_em` é
-- linha impossível, mesmo que a tabela de arestas seja sabotada.
--
-- (Lei 10: com duas camadas, sabotar uma deixa a regra de pé. O controle
-- negativo desta invariante derruba AS DUAS.)
ALTER TABLE corridas ADD COLUMN pago_em TIMESTAMPTZ;

CREATE FUNCTION corridas_marca_pago() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- Uma vez pago, sempre pago: o fato não se desfaz por transição nenhuma.
  -- Depois do estado 5 o que existe é disputa e evento compensatório, nunca
  -- "despagar" (seção 5).
  IF TG_OP = 'UPDATE' AND OLD.pago_em IS NOT NULL THEN
    NEW.pago_em := OLD.pago_em;
  ELSIF NEW.estado = 5 THEN
    NEW.pago_em := now();
  ELSE
    NEW.pago_em := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER corridas_marca_pago
  BEFORE INSERT OR UPDATE ON corridas
  FOR EACH ROW EXECUTE FUNCTION corridas_marca_pago();

ALTER TABLE corridas ADD CONSTRAINT corridas_entregue_exige_pago
  CHECK (estado <> 8 OR pago_em IS NOT NULL);

-- ------------------------------------------------------ prazo estimado
--
-- Os minutos são DADO VERSIONADO, na mesma versão da tabela de preço e com a
-- mesma imutabilidade: um prazo mostrado hoje precisa ser reconstituível
-- daqui a dois anos, e constante de código muda sem deixar rastro. É a mesma
-- razão de `adicional_km_centavos` ser dado e não constante.
--
-- `tempo_base_coleta_minutos` é DADO DA CIDADE (uma coluna da versão), não da
-- loja. Override por loja é item 24 da seção 17, sem etapa dona: quando a
-- operação quiser, é uma versão nova da tabela.
ALTER TABLE tabelas_preco
  ADD COLUMN tempo_base_coleta_minutos INTEGER,
  ADD COLUMN adicional_km_minutos      INTEGER;

-- E O TEMPO BASE SAI DE `cidades`, onde a Etapa 4 o tinha posto.
--
-- Não é troca de gosto: ele estava em DOIS lugares, e dois lugares para o
-- mesmo número é o começo de um dar 10 e o outro 12. Ninguém calculava com
-- ele — a coluna era lida e devolvida, nunca somada —, então a escolha é
-- entre um dado MUTÁVEL em `cidades` e um dado VERSIONADO na tabela de
-- preço. O prazo mostrado hoje precisa ser reconstituível daqui a dois anos
-- (seção 8), e coluna mutável não reconstitui nada: ganha a versionada.
ALTER TABLE cidades DROP COLUMN tempo_base_coleta_min;

ALTER TABLE zonas ADD COLUMN minutos INTEGER;

-- Valores de exemplo para versões importadas ANTES desta migration (num
-- banco que nasce do zero não existe nenhuma). São exemplo como o resto da
-- tabela de exemplo é: a transcrição real de Sobral é o item 4 da seção 17.
UPDATE tabelas_preco SET tempo_base_coleta_minutos = 10, adicional_km_minutos = 3
  WHERE tempo_base_coleta_minutos IS NULL;
UPDATE zonas SET minutos = 10 WHERE minutos IS NULL;

ALTER TABLE tabelas_preco
  ALTER COLUMN tempo_base_coleta_minutos SET NOT NULL,
  ALTER COLUMN adicional_km_minutos      SET NOT NULL,
  ADD CONSTRAINT tabelas_preco_tempo_base_nao_negativo CHECK (tempo_base_coleta_minutos >= 0),
  ADD CONSTRAINT tabelas_preco_adicional_minutos_nao_negativo CHECK (adicional_km_minutos >= 0);

ALTER TABLE zonas
  ALTER COLUMN minutos SET NOT NULL,
  ADD CONSTRAINT zonas_minutos_nao_negativo CHECK (minutos >= 0);

-- O prazo gravado na corrida. Três colunas com papéis diferentes:
--
--   prazo_minutos     o valor PONTUAL calculado. Existe para auditoria.
--   prazo_min/max     a FAIXA, que é o que se mostra ("20 a 30 minutos").
--
-- O dono decidiu que o app NUNCA mostra o valor pontual, nem em tela de
-- detalhe — número exato vira promessa e erro de três minutos vira
-- reclamação. Isso podia ser disciplina de quem escreve tela; vira
-- IMPOSSIBILIDADE mais abaixo, quando `corre_app` perde o privilégio de LER
-- esta coluna. O que não se pode ler não vaza para tela nenhuma.
ALTER TABLE corridas
  ADD COLUMN prazo_minutos      INTEGER CHECK (prazo_minutos IS NULL OR prazo_minutos >= 0),
  ADD COLUMN prazo_min_minutos  INTEGER CHECK (prazo_min_minutos IS NULL OR prazo_min_minutos >= 0),
  ADD COLUMN prazo_max_minutos  INTEGER CHECK (prazo_max_minutos IS NULL OR prazo_max_minutos >= 0),
  -- O anel de cada ponta, para auditar o `max` que decidiu o prazo. NULL = a
  -- ponta caiu fora de zona.
  ADD COLUMN origem_zona_nome   TEXT,
  ADD COLUMN destino_zona_nome  TEXT,
  ADD CONSTRAINT corridas_faixa_de_prazo_coerente CHECK (
    (prazo_min_minutos IS NULL) = (prazo_max_minutos IS NULL)
    AND (prazo_min_minutos IS NULL OR prazo_min_minutos < prazo_max_minutos)
  ),
  -- Faixa sem valor pontual seria faixa sem lastro auditável.
  ADD CONSTRAINT corridas_faixa_exige_pontual CHECK (
    prazo_min_minutos IS NULL OR prazo_minutos IS NOT NULL
  ),
  -- "Gravado na criação JUNTO COM A VERSÃO DA TABELA" (seção 8). Prazo sem
  -- versão é prazo que ninguém consegue reconstituir depois — a promessa de
  -- auditoria da seção 8 morre em silêncio.
  ADD CONSTRAINT corridas_prazo_exige_versao_da_tabela CHECK (
    prazo_minutos IS NULL OR tabela_preco_id IS NOT NULL
  );

-- --------------------------------------------------------- privilégios
--
-- `corre_app` tinha SELECT na tabela inteira. Passa a ter SELECT COLUNA A
-- COLUNA, e `prazo_minutos` fica DE FORA — junto com `pago_em`, que a
-- aplicação também não precisa ler para nada.
--
-- O efeito colateral é uma vantagem: coluna nova em `corridas` nasce
-- INVISÍVEL para a aplicação até alguém conceder o privilégio de propósito.
-- Fecha por padrão, como a política de cidade.
REVOKE SELECT ON corridas FROM corre_app;
GRANT SELECT (
  id, estado, seq, vence_em, criado_em, atualizado_em,
  lojista_id, cliente_id, cidade_id,
  tabela_preco_id, frete_centavos, zona_nome,
  configuracao_taxa_id, mercadoria_centavos,
  prazo_min_minutos, prazo_max_minutos, origem_zona_nome, destino_zona_nome
) ON corridas TO corre_app;

-- Escreve o pontual, não o lê. E não escreve `pago_em` de jeito nenhum.
GRANT INSERT (
  prazo_minutos, prazo_min_minutos, prazo_max_minutos,
  origem_zona_nome, destino_zona_nome
) ON corridas TO corre_app;

GRANT SELECT (tempo_base_coleta_minutos, adicional_km_minutos) ON tabelas_preco TO corre_app;
GRANT SELECT (minutos) ON zonas TO corre_app;
