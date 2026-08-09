-- Etapa 1 — reforço do log (achado da revisão adversarial): sem buraco na
-- sequência.
--
-- O UNIQUE (agregado_tipo, agregado_id, seq) continua sendo o árbitro da
-- posição (Lei 4). Este trigger só recusa INSERT que PULE posição: um
-- buraco no log envenenaria a reconstrução do agregado sem reparo
-- possível, já que eventos não se apagam nem se editam (Lei 3).
--
-- O SELECT enxerga apenas linhas commitadas, então o trigger NÃO antecipa
-- a arbitragem do UNIQUE em disputa concorrente pela mesma posição — dois
-- disputantes na posição certa passam aqui e o UNIQUE decide um vencedor.
-- Quem chega com posição já vencida e commitada recebe SQLSTATE CR001, que
-- o motor trata como disputa de posição (replay pela chave ou derrota).

CREATE FUNCTION eventos_sem_buraco() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE proxima INTEGER;
BEGIN
  SELECT coalesce(max(seq), 0) + 1 INTO proxima
  FROM eventos
  WHERE agregado_tipo = NEW.agregado_tipo AND agregado_id = NEW.agregado_id;
  IF NEW.seq <> proxima THEN
    RAISE EXCEPTION 'log sem buraco: a próxima posição de % % é %, não %',
      NEW.agregado_tipo, NEW.agregado_id, proxima, NEW.seq
      USING ERRCODE = 'CR001';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER eventos_bloqueia_buraco
  BEFORE INSERT ON eventos
  FOR EACH ROW EXECUTE FUNCTION eventos_sem_buraco();
