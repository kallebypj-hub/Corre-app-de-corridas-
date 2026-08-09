-- Etapa 2 (fechamento) — re-login por código de 6 dígitos via SMS, para
-- lojista e operador. Fecha o item 8 da seção 17: sessão de 30 dias sem
-- forma de voltar deixava o lojista fora no dia 31.
--
-- Motoboy continua entrando por CPF + aparelho (não usa OTP).

-- Operador passa a ter telefone (login por telefone, como o lojista). Na
-- migração o banco nasce do zero, então o NOT NULL entra sem retrofit.
ALTER TABLE operadores ADD COLUMN telefone TEXT;
ALTER TABLE operadores ALTER COLUMN telefone SET NOT NULL;
ALTER TABLE operadores ADD CONSTRAINT operadores_telefone_unico UNIQUE (telefone);
GRANT INSERT (telefone) ON operadores TO corre_app;

-- Código OTP: nunca em claro, só o hash (mesmo tratamento do token de
-- sessão). Uso único (usado_em), expira em 10 min (expira_em), morre ao
-- estourar as tentativas (morto_em).
CREATE TABLE codigos_otp (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ator_tipo      TEXT NOT NULL CHECK (ator_tipo IN ('lojista', 'operador')),
  ator_id        UUID NOT NULL,
  telefone       TEXT NOT NULL CHECK (telefone <> ''),
  codigo_hash    TEXT NOT NULL CHECK (codigo_hash <> ''),
  tentativas     INTEGER NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  max_tentativas INTEGER NOT NULL CHECK (max_tentativas >= 1),
  expira_em      TIMESTAMPTZ NOT NULL,
  usado_em       TIMESTAMPTZ,
  morto_em       TIMESTAMPTZ,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX codigos_otp_ativos ON codigos_otp (ator_tipo, telefone, criado_em);

-- Registro de envios, para o limite por telefone e por IP — o endpoint não
-- pode virar torneira de SMS pago.
CREATE TABLE otp_envios (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone  TEXT NOT NULL,
  ip        TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX otp_envios_por_telefone ON otp_envios (telefone, criado_em);
CREATE INDEX otp_envios_por_ip ON otp_envios (ip, criado_em);

REVOKE ALL ON codigos_otp, otp_envios FROM PUBLIC;

GRANT SELECT ON codigos_otp TO corre_app;
GRANT INSERT (ator_tipo, ator_id, telefone, codigo_hash, max_tentativas, expira_em) ON codigos_otp TO corre_app;
-- codigo_hash e expira_em nunca mudam; só o andamento da validação muda.
GRANT UPDATE (tentativas, usado_em, morto_em) ON codigos_otp TO corre_app;

GRANT SELECT ON otp_envios TO corre_app;
GRANT INSERT (telefone, ip) ON otp_envios TO corre_app;
