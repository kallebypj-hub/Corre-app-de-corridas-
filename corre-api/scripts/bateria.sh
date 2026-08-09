#!/usr/bin/env bash
# Bateria da Etapa 0: banco nasce do zero -> migrations -> testes.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGSUPERUSER:=postgres}"
: "${PGSUPERPASSWORD:=postgres}"
: "${CORRE_DB:=corre_teste}"
: "${CORRE_DONO_SENHA:=corre_dono_dev}"
: "${CORRE_APP_SENHA:=corre_app_dev}"

scripts/setup-db.sh

export DATABASE_URL="postgresql://corre_dono:${CORRE_DONO_SENHA}@${PGHOST}:${PGPORT}/${CORRE_DB}"
export DATABASE_URL_APP="postgresql://corre_app:${CORRE_APP_SENHA}@${PGHOST}:${PGPORT}/${CORRE_DB}"
export DATABASE_URL_SUPER="postgresql://${PGSUPERUSER}:${PGSUPERPASSWORD}@${PGHOST}:${PGPORT}/${CORRE_DB}"

node src/db/migrar.js
node --test
