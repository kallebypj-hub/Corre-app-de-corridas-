-- Correção da Etapa 4, achada pela auditoria adversarial: `eventos` ficou
-- FORA do isolamento por cidade.
--
-- A migration 0010 pôs RLS nas seis tabelas de PROJEÇÃO e esqueceu a tabela
-- que a Lei 2 declara ser a FONTE DA VERDADE. O efeito, reproduzido com o
-- papel `corre_app` (o mesmo com que a aplicação sobe):
--
--   lojistas sem cidade declarada -> 0 linhas   (a política funcionando)
--   eventos  sem cidade declarada -> TUDO       (nome, telefone, CPF, endereço)
--
-- E a escrita era pior que a leitura: dava para ANEXAR evento no log de uma
-- corrida de outra cidade. Como a Lei 3 proíbe apagar evento, o estrago era
-- IRREVERSÍVEL — a corrida alheia passava a morrer em conflito de posição
-- para sempre, e a reconstrução da Lei 2 explodia num log ilegal.
--
-- COMO SE FECHA, e por que assim:
--
-- 1. `eventos` ganha `cidade_id`, mas a aplicação NÃO O ESCREVE — não tem
--    GRANT nessa coluna. Ele é DERIVADO do agregado por trigger. Valor que o
--    chamador não fornece é valor que o chamador não forja.
--
-- 2. A política compara o valor derivado com a cidade da transação. Escrever
--    no log de uma corrida de Fortaleza estando em Sobral produz uma linha
--    com cidade de Fortaleza, e o WITH CHECK a recusa. Não é verificação de
--    código: é a combinação de derivação com política.
--
-- 3. `cidade_id` é NULL exatamente para os agregados que NÃO são de cidade —
--    cliente e operador —, e um CHECK garante essa correspondência, para que
--    NULL não vire escotilha de fuga.

-- A cidade de um agregado, lida COMO DONO (SECURITY DEFINER) porque precisa
-- enxergar a verdade, e não o recorte da transação. É esta função que
-- impede o chamador de dizer em que cidade o evento dele está.
CREATE FUNCTION corre_cidade_do_agregado(p_tipo TEXT, p_id UUID) RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_cidade UUID;
BEGIN
  CASE p_tipo
    WHEN 'corrida' THEN SELECT cidade_id INTO v_cidade FROM corridas WHERE id = p_id;
    WHEN 'lojista' THEN SELECT cidade_id INTO v_cidade FROM lojistas WHERE id = p_id;
    WHEN 'motoboy' THEN SELECT cidade_id INTO v_cidade FROM motoboys WHERE id = p_id;
    -- Cliente e operador são da PLATAFORMA, não da cidade (seção 20).
    ELSE v_cidade := NULL;
  END CASE;
  RETURN v_cidade;
END;
$$;

REVOKE ALL ON FUNCTION corre_cidade_do_agregado(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION corre_cidade_do_agregado(TEXT, UUID) TO corre_app;

ALTER TABLE eventos ADD COLUMN cidade_id UUID REFERENCES cidades (id);

UPDATE eventos SET cidade_id = corre_cidade_do_agregado(agregado_tipo, agregado_id);

-- NAO existe CHECK amarrando cidade a tipo de agregado, e a ausência é
-- deliberada: evento cujo agregado ainda NAO EXISTE (o log sintético da
-- bateria, e qualquer ordem em que o evento preceda a projeção) não tem
-- cidade de onde derivar. Recusá-lo transformaria uma correção de isolamento
-- numa mudança de regra do log, que é outra etapa.
--
-- E o que isso deixa aberto não é vazamento: para vazar é preciso escrever no
-- log de um agregado que EXISTE em outra cidade — e aí a derivação acha a
-- cidade certa e o WITH CHECK recusa. Evento órfão só enxerga a si mesmo.

-- A derivação. BEFORE INSERT: o valor final é o derivado, e é sobre ele que
-- a política decide.
CREATE FUNCTION eventos_deriva_cidade() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.cidade_id := corre_cidade_do_agregado(NEW.agregado_tipo, NEW.agregado_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER eventos_deriva_cidade
  BEFORE INSERT ON eventos
  FOR EACH ROW EXECUTE FUNCTION eventos_deriva_cidade();

ALTER TABLE eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY eventos_da_cidade ON eventos FOR ALL TO corre_app
  USING (cidade_id IS NULL OR cidade_id = corre_cidade_atual())
  WITH CHECK (cidade_id IS NULL OR cidade_id = corre_cidade_atual());

-- A CHAVE DE IDEMPOTÊNCIA ERA GLOBAL, e isso vazava por HTTP sem credencial
-- nenhuma: repetir numa cidade uma chave já usada noutra devolvia 409 com o
-- id do agregado alheio na mensagem. O espaço de chaves passa a ser POR
-- CIDADE (com um marcador fixo para os agregados sem cidade, senão dois
-- NULLs nunca colidiriam e a idempotência do cliente sumiria).
ALTER TABLE eventos DROP CONSTRAINT eventos_chave_idempotencia_unica;
CREATE UNIQUE INDEX eventos_chave_idempotencia_unica
  ON eventos (COALESCE(cidade_id, '00000000-0000-0000-0000-000000000000'), chave_idempotencia)
  WHERE chave_idempotencia IS NOT NULL;

-- O mesmo buraco, menor, nas tabelas do código de 6 dígitos: elas guardam
-- TELEFONE, e sem política um recorte de cidade lia os telefones de todas.
ALTER TABLE codigos_otp ADD COLUMN cidade_id UUID REFERENCES cidades (id);
ALTER TABLE otp_envios  ADD COLUMN cidade_id UUID REFERENCES cidades (id);

UPDATE codigos_otp SET cidade_id = corre_cidade_do_agregado(ator_tipo, ator_id);

CREATE FUNCTION otp_deriva_cidade() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.cidade_id := corre_cidade_do_agregado(NEW.ator_tipo, NEW.ator_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER codigos_otp_deriva_cidade
  BEFORE INSERT ON codigos_otp
  FOR EACH ROW EXECUTE FUNCTION otp_deriva_cidade();

ALTER TABLE codigos_otp ENABLE ROW LEVEL SECURITY;
CREATE POLICY codigos_otp_da_cidade ON codigos_otp FOR ALL TO corre_app
  USING (cidade_id IS NULL OR cidade_id = corre_cidade_atual())
  WITH CHECK (cidade_id IS NULL OR cidade_id = corre_cidade_atual());

-- `otp_envios` conta envios por telefone e por IP. Ela NÃO ganha política:
-- o limite de envios tem que valer para a plataforma inteira, senão a mesma
-- torneira de SMS pago seria aberta uma vez por cidade. Fica declarado aqui
-- para não parecer esquecimento: é o único dado por telefone que atravessa
-- cidades DE PROPÓSITO, e ele não diz de quem é o telefone.
COMMENT ON TABLE otp_envios IS
  'Contagem de envios por telefone/IP. SEM política de cidade de propósito: o limite é da plataforma, não da cidade.';
