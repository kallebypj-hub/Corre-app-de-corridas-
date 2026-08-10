-- Correção da Etapa 5, achada pela auditoria adversarial: a "segunda camada"
-- da invariante não era uma segunda camada.
--
-- A 0012 disse, com todas as letras: "estado 8 sem `pago_em` é linha
-- impossível, MESMO QUE A TABELA DE ARESTAS SEJA SABOTADA". Era falso.
--
-- O gatilho carimbava `pago_em := now()` quando `NEW.estado = 5`. Só que
-- `estado` é justamente a coluna que o chamador escreve. As duas camadas
-- decidiam pelo MESMO número, controlado pelo MESMO escritor:
--
--   * com a credencial da aplicação, sem tocar em código:
--       UPDATE corridas SET estado = 8;              -> recusado pelo CHECK
--       UPDATE corridas SET estado = 8, pago_em=now(); -> recusado pelo GRANT
--       UPDATE corridas SET estado = 5;  UPDATE corridas SET estado = 8;
--       -> PASSOU. Corrida ENTREGUE e PAGA cujo log inteiro é `criada`.
--
--   * e um único token errado em `transicoes.js` (a aresta 4->6 apontando
--     para 5 em vez de 6) levava a corrida a Pago sem pagamento nenhum — com
--     os TRÊS testes chamados INVARIANTE ficando verdes.
--
-- Isso é a Lei 10 falhando na própria etapa que a escreveu: duas camadas que
-- caem juntas são uma camada com dois nomes.
--
-- O QUE MUDA: `pago_em` passa a ser derivado do FATO, não do número. O fato
-- é o evento `pagamento_confirmado` no log — que é o que a Lei 2 declara ser
-- a verdade, é append-only pela Lei 3, e é auditável. Agora sim as camadas
-- são independentes: uma mora na tabela de arestas (JavaScript), a outra no
-- log de eventos (banco). Errar a aresta não fabrica evento de pagamento.

-- O fato, lido COMO DONO porque precisa enxergar o log e não o recorte do
-- chamador — mesmo padrão de `corre_cidade_do_agregado` (0011).
CREATE FUNCTION corrida_tem_pagamento(p_corrida UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM eventos
    WHERE agregado_tipo = 'corrida'
      AND agregado_id = p_corrida
      AND tipo = 'pagamento_confirmado'
  )
$$;

REVOKE ALL ON FUNCTION corrida_tem_pagamento(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION corrida_tem_pagamento(UUID) TO corre_app;

-- A ordem que faz isto funcionar já é lei: "toda transição grava um evento
-- ANTES de qualquer outra coisa" (Lei 2). Quando o UPDATE da projeção
-- dispara este gatilho, o evento da transição já está na mesma transação.
CREATE OR REPLACE FUNCTION corridas_marca_pago() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- Uma vez pago, sempre pago: o fato não se desfaz por transição nenhuma.
  -- Depois do estado 5 o que existe é disputa e evento compensatório, nunca
  -- "despagar" (seção 5).
  IF TG_OP = 'UPDATE' AND OLD.pago_em IS NOT NULL THEN
    NEW.pago_em := OLD.pago_em;
  ELSIF corrida_tem_pagamento(NEW.id) THEN
    NEW.pago_em := now();
  ELSE
    NEW.pago_em := NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON COLUMN corridas.pago_em IS
  'Derivado do evento pagamento_confirmado no log (0013). A aplicação não escreve nem lê esta coluna. O CHECK corridas_entregue_exige_pago a usa para tornar Entregue-sem-pagamento uma linha impossível.';
