-- Etapa 0 — fundação.
--
-- Lei 1 — Dinheiro é inteiro em centavos. Nunca float, nunca decimal em
-- ponto flutuante. Toda coluna de dinheiro deste banco usa este domínio;
-- a conversão para reais acontece só na renderização.
CREATE DOMAIN centavos AS BIGINT;

COMMENT ON DOMAIN centavos IS
  'Valor monetário em centavos, inteiro (Lei 1). Nunca float. Reais só na renderização.';
