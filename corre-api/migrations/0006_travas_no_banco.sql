-- Etapa 2 — reforços da revisão adversarial: mover para o banco invariantes
-- que estavam só no código (Lei 4: a constraint é a garantia). Defesa em
-- profundidade — qualquer caminho que escape do domínio esbarra aqui.

-- (#4) Dígito verificador do CPF no banco, não só no código. O regex
-- ^[0-9]{11}$ aceitava 111.111.111-11; a função recusa dígito repetido e
-- confere os dois verificadores.
CREATE FUNCTION cpf_valido(cpf TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  d INTEGER; soma INTEGER; resto INTEGER; verifica INTEGER;
BEGIN
  IF cpf !~ '^[0-9]{11}$' THEN RETURN false; END IF;
  IF cpf ~ '^(.)\1{10}$' THEN RETURN false; END IF;
  FOR d IN 9..10 LOOP
    soma := 0;
    FOR i IN 1..d LOOP
      soma := soma + (substr(cpf, i, 1))::int * (d + 2 - i);
    END LOOP;
    resto := (soma * 10) % 11;
    IF resto = 10 THEN resto := 0; END IF;
    verifica := (substr(cpf, d + 1, 1))::int;
    IF resto <> verifica THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END
$$;

ALTER TABLE motoboys ADD CONSTRAINT motoboys_cpf_digitos_validos CHECK (cpf_valido(cpf));

-- (#3) O primeiro saque nasce travado POR CONSTRUÇÃO: valor padrão do banco
-- e corre_app perde o INSERT nessa coluna — não pode mais escolher o valor
-- no nascimento. A liberação continua sendo UPDATE (ação da operação).
ALTER TABLE motoboys ALTER COLUMN primeiro_saque SET DEFAULT 'travado';
REVOKE INSERT (primeiro_saque) ON motoboys FROM corre_app;

-- (#2) Corrida só nasce para lojista real, ATIVO e com cartão de garantia.
-- Antes isso vivia só em exigeLojistaApto (código); agora é trava de banco
-- — "corrida sem lojista apto é impossível por construção" (seção 14).
CREATE FUNCTION corrida_exige_lojista_apto() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE loja RECORD;
BEGIN
  SELECT situacao, cartao_registrado_em INTO loja FROM lojistas WHERE id = NEW.lojista_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'corrida exige lojista existente' USING ERRCODE = 'CR002';
  END IF;
  IF loja.situacao <> 'ativa' THEN
    RAISE EXCEPTION 'corrida exige lojista ativo' USING ERRCODE = 'CR002';
  END IF;
  IF loja.cartao_registrado_em IS NULL THEN
    RAISE EXCEPTION 'corrida exige cartão de garantia registrado' USING ERRCODE = 'CR002';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER corridas_exige_lojista_apto
  BEFORE INSERT ON corridas
  FOR EACH ROW EXECUTE FUNCTION corrida_exige_lojista_apto();

-- (#16) Operador forjado por INSERT direto (escalação a 'dono') é impossível
-- por construção: todo operador tem que ter seu evento de cadastro. Trigger
-- de constraint DEFERIDO — roda no commit, quando criaOperador já gravou o
-- evento na mesma transação; INSERT avulso sem evento falha no commit.
CREATE FUNCTION operador_exige_evento() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM eventos
   WHERE agregado_tipo = 'operador' AND agregado_id = NEW.id AND tipo = 'operador_cadastrado';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operador % sem evento de cadastro (Lei 2)', NEW.id USING ERRCODE = 'CR003';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER operadores_exige_evento
  AFTER INSERT ON operadores
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION operador_exige_evento();

-- (#1) Revogação de sessão: bloqueio e troca de aparelho precisam invalidar
-- as sessões vivas da conta na hora. corre_app ganha DELETE em sessoes
-- (estado efêmero, não é log de eventos).
GRANT DELETE ON sessoes TO corre_app;
