#!/usr/bin/env bash
# Lei 8 — controle negativo: sabota a regra no banco, roda a bateria e exige
# que ela fique VERMELHA. Bateria verde com a regra quebrada é falso positivo.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGSUPERUSER:=postgres}"
: "${PGSUPERPASSWORD:=postgres}"
: "${CORRE_DB:=corre_teste}"
: "${CORRE_DONO_SENHA:=corre_dono_dev}"
: "${CORRE_APP_SENHA:=corre_app_dev}"

URL_DONO="postgresql://corre_dono:${CORRE_DONO_SENHA}@${PGHOST}:${PGPORT}/${CORRE_DB}"
URL_APP="postgresql://corre_app:${CORRE_APP_SENHA}@${PGHOST}:${PGPORT}/${CORRE_DB}"
URL_SUPER="postgresql://${PGSUPERUSER}:${PGSUPERPASSWORD}@${PGHOST}:${PGPORT}/${CORRE_DB}"
SAIDAS="${TMPDIR:-/tmp}"

psql_super() {
  PGPASSWORD="$PGSUPERPASSWORD" psql -v ON_ERROR_STOP=1 -q \
    -h "$PGHOST" -p "$PGPORT" -U "$PGSUPERUSER" -d "$CORRE_DB" -c "$1"
}

sabota() {
  local nome="$1" sql="$2" esperado="$3"
  echo "== sabotagem: ${nome} =="

  # Banco novo, migrado, íntegro...
  scripts/setup-db.sh > /dev/null
  DATABASE_URL="$URL_DONO" node src/db/migrar.js > /dev/null

  # ...então a regra é quebrada de propósito, por fora das migrations.
  psql_super "$sql" > /dev/null

  local saida="${SAIDAS}/controle_negativo_${nome}.log"
  if DATABASE_URL="$URL_DONO" DATABASE_URL_APP="$URL_APP" DATABASE_URL_SUPER="$URL_SUPER" node --test > "$saida" 2>&1; then
    echo "FALSO POSITIVO: bateria ficou VERDE com a regra sabotada (${nome})."
    echo "Saída completa em ${saida}"
    exit 1
  fi
  # Vermelho por qualquer motivo não vale: tem que ser o teste que vigia
  # exatamente a regra sabotada.
  if ! grep -Eq "not ok .*${esperado}" "$saida"; then
    echo "ERRO: bateria vermelha, mas não pelo teste esperado ('${esperado}')."
    echo "Saída completa em ${saida}"
    exit 1
  fi
  echo "ok: bateria ficou vermelha pelo teste esperado com ${nome} (saída em ${saida})"
}

# Camada de privilégio + camada de trigger derrubadas: o papel da aplicação
# passa a conseguir UPDATE/DELETE/TRUNCATE em eventos.
sabota "app_com_escrita_liberada" "
  DROP TRIGGER eventos_bloqueia_update_delete ON eventos;
  DROP TRIGGER eventos_bloqueia_truncate ON eventos;
  GRANT UPDATE, DELETE, TRUNCATE ON eventos TO corre_app;
" "UPDATE como corre_app"

# Só a camada de trigger derrubada: o dono da tabela passa a conseguir
# UPDATE/DELETE/TRUNCATE em eventos.
sabota "triggers_removidos" "
  DROP TRIGGER eventos_bloqueia_update_delete ON eventos;
  DROP TRIGGER eventos_bloqueia_truncate ON eventos;
" "UPDATE até como dono"

# Colunas protegidas liberadas: o papel da aplicação passa a poder forjar
# id (via OVERRIDING SYSTEM VALUE) e criado_em.
sabota "colunas_protegidas_liberadas" "
  GRANT INSERT (id, criado_em) ON eventos TO corre_app;
" "OVERRIDING SYSTEM VALUE"

# A credencial da aplicação ganha escrita em eventos: a trava de boot tem
# que passar a recusá-la — o teste que aceita corre_app fica vermelho.
sabota "credencial_do_app_com_escrita" "
  GRANT UPDATE, DELETE, TRUNCATE ON eventos TO corre_app;
" "boot aceita a credencial restrita"

# Restaura um banco íntegro para não deixar sabotagem para trás.
scripts/setup-db.sh > /dev/null
DATABASE_URL="$URL_DONO" node src/db/migrar.js > /dev/null

echo "controle negativo OK: as quatro sabotagens deixaram a bateria vermelha nos testes certos"
