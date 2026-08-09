-- Etapa 1 — máquina de estados: projeção de corridas, sequência do log e
-- idempotência.
--
-- eventos continua sendo a fonte da verdade (Leis 2 e 3). corridas é a
-- projeção materializada do estado atual — derivável dos eventos e conferida
-- contra eles pela bateria.
--
-- Regra 4 da Etapa 1 / Lei 4: a ordem do log é do banco. Dois eventos
-- concorrentes na mesma corrida disputam a MESMA posição na sequência e o
-- UNIQUE decide um vencedor único. O código não serializa (sem SELECT FOR
-- UPDATE): a constraint é a garantia, não a verificação em código.
--
-- Lei 5: chave de idempotência com UNIQUE real. Retentativa com a mesma
-- chave não duplica evento.

ALTER TABLE eventos
  ADD COLUMN seq INTEGER,
  ADD COLUMN chave_idempotencia TEXT;

-- Nas migrations o banco nasce do zero: eventos está vazia aqui, o NOT NULL
-- entra sem retrofit.
ALTER TABLE eventos ALTER COLUMN seq SET NOT NULL;

ALTER TABLE eventos
  ADD CONSTRAINT eventos_seq_positiva CHECK (seq >= 1),
  ADD CONSTRAINT eventos_agregado_seq_unico UNIQUE (agregado_tipo, agregado_id, seq),
  ADD CONSTRAINT eventos_chave_idempotencia_unica UNIQUE (chave_idempotencia);

-- O índice de consulta por agregado fica coberto pelo índice do UNIQUE
-- (agregado_tipo, agregado_id, seq).
DROP INDEX eventos_por_agregado;

GRANT INSERT (seq, chave_idempotencia) ON eventos TO corre_app;

-- Projeção do estado atual. Estados: 1 aguardando_pagamento,
-- 2 procurando_motoboy, 3 a_caminho_da_loja, 4 com_a_mercadoria,
-- 5 em_retorno, 6 em_disputa, 7 entregue, 8 expirada, 9 sem_motoboy,
-- 10 cancelada, 11 devolvida.
--
-- Regra 2 da Etapa 1: prazo é dado, não timer. vence_em fica gravado aqui e
-- no payload do evento que abriu o estado; vencer é consulta, não setTimeout.
CREATE TABLE corridas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estado        SMALLINT NOT NULL CHECK (estado BETWEEN 1 AND 11),
  seq           INTEGER NOT NULL CHECK (seq >= 1),
  vence_em      TIMESTAMPTZ,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE corridas IS
  'Projeção do estado atual; a verdade é a tabela eventos. estado/seq/vence_em derivam do log.';

-- Varredura de vencidas: só estados vivos com prazo (1 e 2).
CREATE INDEX corridas_vencidas ON corridas (vence_em)
  WHERE estado IN (1, 2) AND vence_em IS NOT NULL;

REVOKE ALL ON corridas FROM PUBLIC;
GRANT SELECT ON corridas TO corre_app;
GRANT INSERT (estado, seq, vence_em) ON corridas TO corre_app;
GRANT UPDATE (estado, seq, vence_em, atualizado_em) ON corridas TO corre_app;
