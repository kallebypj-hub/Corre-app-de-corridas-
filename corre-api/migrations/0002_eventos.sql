-- Etapa 0 — tabela de eventos, fonte da verdade do sistema.
--
-- Lei 2 — Estado só muda por evento: toda transição grava aqui antes de
-- qualquer outra coisa. O estado atual é derivável destes registros.
--
-- Lei 3 — Evento não se apaga nem se edita, em nenhuma circunstância.
-- Garantido no banco, em duas camadas independentes:
--   (a) privilégio: o papel da aplicação (corre_app) tem SELECT na tabela e
--       INSERT só nas colunas de negócio — UPDATE/DELETE/TRUNCATE falham com
--       erro de permissão, e id/criado_em são sempre atribuídos pelo banco
--       (nem OVERRIDING SYSTEM VALUE passa: falta privilégio na coluna id);
--   (b) trigger: UPDATE/DELETE/TRUNCATE diretos falham até para o dono da
--       tabela. Limite inerente do PostgreSQL: o dono (corre_dono) consegue
--       desabilitar trigger ou trocar a função em sessão comum. Por isso a
--       garantia forte de runtime é a camada (a): a aplicação conecta SEMPRE
--       como corre_app — corre_dono é reservado a migrations e nunca vira
--       credencial de aplicação ou de painel.
-- Remoção sancionada das travas só por migration versionada no git.
-- Correção é sempre um novo evento compensatório.

-- Papel da aplicação. Criado sem LOGIN; credencial de acesso é dada fora
-- das migrations (scripts/setup-db.sh), nunca versionada aqui.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'corre_app') THEN
    CREATE ROLE corre_app NOLOGIN;
  END IF;
END
$$;

CREATE TABLE eventos (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo          TEXT NOT NULL CHECK (tipo <> ''),
  agregado_tipo TEXT NOT NULL CHECK (agregado_tipo <> ''),
  agregado_id   UUID NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  autor_tipo    TEXT NOT NULL
                CHECK (autor_tipo IN ('lojista', 'motoboy', 'cliente', 'painel', 'sistema')),
  autor_id      UUID,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Toda ação de lojista, motoboy ou painel tem autor identificado (seção 13).
  -- Cliente final não tem conta; eventos do sistema não têm ator humano.
  CONSTRAINT eventos_autor_identificado
    CHECK (autor_tipo IN ('sistema', 'cliente') OR autor_id IS NOT NULL)
);

COMMENT ON TABLE eventos IS
  'Append-only (Leis 2 e 3). Sem UPDATE nem DELETE, nem pelo admin. Correção só por evento compensatório.';

CREATE INDEX eventos_por_agregado ON eventos (agregado_tipo, agregado_id, id);

-- Camada (b): imutabilidade vale até para o dono da tabela.
CREATE FUNCTION eventos_imutaveis() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'eventos é append-only: % proibido (Lei 3). Corrija com evento compensatório.', TG_OP;
END
$$;

CREATE TRIGGER eventos_bloqueia_update_delete
  BEFORE UPDATE OR DELETE ON eventos
  FOR EACH ROW EXECUTE FUNCTION eventos_imutaveis();

CREATE TRIGGER eventos_bloqueia_truncate
  BEFORE TRUNCATE ON eventos
  FOR EACH STATEMENT EXECUTE FUNCTION eventos_imutaveis();

-- Camada (a): a aplicação só anexa e lê. O INSERT é por coluna: id e
-- criado_em ficam de fora, então a ordem do log e o carimbo de tempo são
-- sempre atribuídos pelo banco — não são forjáveis pela aplicação.
REVOKE ALL ON eventos FROM PUBLIC;
GRANT SELECT ON eventos TO corre_app;
GRANT INSERT (tipo, agregado_tipo, agregado_id, payload, autor_tipo, autor_id)
  ON eventos TO corre_app;
