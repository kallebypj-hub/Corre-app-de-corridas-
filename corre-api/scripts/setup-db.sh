#!/usr/bin/env bash
# Cria papéis e banco DO ZERO, para desenvolvimento e CI.
# As senhas padrão abaixo são de desenvolvimento; produção define as suas
# por variável de ambiente e este script nunca roda lá sem revisão.
set -euo pipefail

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGSUPERUSER:=postgres}"
: "${PGSUPERPASSWORD:=postgres}"
: "${CORRE_DB:=corre_teste}"
: "${CORRE_DONO_SENHA:=corre_dono_dev}"
: "${CORRE_APP_SENHA:=corre_app_dev}"

psql_super() {
  PGPASSWORD="$PGSUPERPASSWORD" psql -v ON_ERROR_STOP=1 -q \
    -h "$PGHOST" -p "$PGPORT" -U "$PGSUPERUSER" -d postgres "$@"
}

# corre_dono: dono do banco, roda migrations. corre_app: papel restrito da
# aplicação — as migrations dão a ele só o que a aplicação pode fazer.
psql_super <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'corre_dono') THEN
    CREATE ROLE corre_dono LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'corre_app') THEN
    CREATE ROLE corre_app NOLOGIN;
  END IF;
END
\$\$;
ALTER ROLE corre_dono LOGIN PASSWORD '${CORRE_DONO_SENHA}';
ALTER ROLE corre_app LOGIN PASSWORD '${CORRE_APP_SENHA}';
SQL

# A bateria sempre roda em banco recém-criado das migrations, nunca em banco
# ajustado à mão (lei de teste do projeto).
psql_super -c "DROP DATABASE IF EXISTS ${CORRE_DB};"
psql_super -c "CREATE DATABASE ${CORRE_DB} OWNER corre_dono;"

echo "banco ${CORRE_DB} criado do zero (dono: corre_dono; app: corre_app)"
