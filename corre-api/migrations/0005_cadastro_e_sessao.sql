-- Etapa 2 — cadastro e sessão: motoboys, lojistas, operadores, sessões.
--
-- Princípio da etapa: trava o dinheiro, não a porta. Cadastro fácil e
-- rápido; o que nasce travado é o primeiro saque do motoboy.
-- Como nas corridas: eventos são a verdade (agregados 'motoboy',
-- 'lojista', 'operador' na MESMA tabela eventos, com o MESMO UNIQUE de
-- sequência e o mesmo trigger anti-buraco); as tabelas abaixo são projeção.

CREATE TABLE motoboys (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq            INTEGER NOT NULL CHECK (seq >= 1),
  nome           TEXT NOT NULL CHECK (nome <> ''),
  telefone       TEXT NOT NULL CHECK (telefone <> ''),
  cpf            TEXT NOT NULL CHECK (cpf ~ '^[0-9]{11}$'),
  -- Trava anti-laranja do MVP (seções 10 e 14): a chave Pix é o PRÓPRIO
  -- CPF do cadastro. Sem consulta DICT no MVP, chave de outro tipo não é
  -- verificável — recusada por construção. Gateway (Etapa 4) pode ampliar.
  chave_pix      TEXT NOT NULL,
  cnh_ref        TEXT NOT NULL CHECK (cnh_ref <> ''),
  crlv_ref       TEXT NOT NULL CHECK (crlv_ref <> ''),
  selfie_ref     TEXT NOT NULL CHECK (selfie_ref <> ''),
  aparelho_id    TEXT NOT NULL CHECK (aparelho_id <> ''),
  situacao       TEXT NOT NULL CHECK (situacao IN ('ativa', 'bloqueada')),
  -- Estado do cadastro, gravado e derivado de evento — não flag solta.
  primeiro_saque TEXT NOT NULL CHECK (primeiro_saque IN ('travado', 'liberado')),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT motoboys_cpf_unico UNIQUE (cpf),
  CONSTRAINT motoboys_chave_pix_igual_cpf CHECK (chave_pix = cpf)
);

CREATE TABLE lojistas (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                  INTEGER NOT NULL CHECK (seq >= 1),
  nome                 TEXT NOT NULL CHECK (nome <> ''),
  telefone             TEXT NOT NULL CHECK (telefone <> ''),
  situacao             TEXT NOT NULL CHECK (situacao IN ('ativa', 'bloqueada')),
  -- Duas condições separadas (seção 10): pode ENTRAR = cadastro ativo;
  -- pode PEDIR = cartão de garantia registrado (nunca cobrado aqui).
  cartao_registrado_em TIMESTAMPTZ,
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lojistas_telefone_unico UNIQUE (telefone)
);

CREATE TABLE operadores (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq           INTEGER NOT NULL CHECK (seq >= 1),
  nome          TEXT NOT NULL CHECK (nome <> ''),
  papel         TEXT NOT NULL CHECK (papel IN ('dono', 'atendimento')),
  situacao      TEXT NOT NULL CHECK (situacao IN ('ativa', 'bloqueada')),
  -- O primeiro operador (gênese) nasce sem autor humano; só pode existir UM,
  -- garantido por constraint, nunca por verificação em código.
  genese        BOOLEAN NOT NULL DEFAULT false,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX operadores_genese_unica ON operadores ((true)) WHERE genese;

-- Sessão não confia no cliente: o token (só o hash fica no banco) resolve
-- papel e identidade SEMPRE no servidor. Motoboy: sessão amarrada ao
-- aparelho único da conta.
CREATE TABLE sessoes (
  token_hash  TEXT PRIMARY KEY,
  ator_tipo   TEXT NOT NULL CHECK (ator_tipo IN ('motoboy', 'lojista', 'operador')),
  ator_id     UUID NOT NULL,
  aparelho_id TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_em   TIMESTAMPTZ NOT NULL,
  CONSTRAINT sessoes_motoboy_com_aparelho
    CHECK (ator_tipo <> 'motoboy' OR aparelho_id IS NOT NULL)
);

-- Corrida sem lojista real é impossível por construção (seção 14): a
-- criação passa a exigir um lojista existente.
ALTER TABLE corridas
  ADD COLUMN lojista_id UUID NOT NULL REFERENCES lojistas (id);

CREATE INDEX corridas_por_lojista ON corridas (lojista_id);

-- Privilégios: projeções seguem o padrão de corridas — o app lê, insere e
-- atualiza SÓ as colunas de projeção; id e criado_em são do banco.
REVOKE ALL ON motoboys, lojistas, operadores, sessoes FROM PUBLIC;

GRANT SELECT ON motoboys TO corre_app;
GRANT INSERT (seq, nome, telefone, cpf, chave_pix, cnh_ref, crlv_ref, selfie_ref, aparelho_id, situacao, primeiro_saque)
  ON motoboys TO corre_app;
GRANT UPDATE (seq, aparelho_id, situacao, primeiro_saque, atualizado_em)
  ON motoboys TO corre_app;

GRANT SELECT ON lojistas TO corre_app;
GRANT INSERT (seq, nome, telefone, situacao) ON lojistas TO corre_app;
GRANT UPDATE (seq, situacao, cartao_registrado_em, atualizado_em) ON lojistas TO corre_app;

GRANT SELECT ON operadores TO corre_app;
GRANT INSERT (seq, nome, papel, situacao, genese) ON operadores TO corre_app;
GRANT UPDATE (seq, situacao, atualizado_em) ON operadores TO corre_app;

GRANT SELECT ON sessoes TO corre_app;
GRANT INSERT (token_hash, ator_tipo, ator_id, aparelho_id, expira_em) ON sessoes TO corre_app;

GRANT INSERT (lojista_id) ON corridas TO corre_app;
