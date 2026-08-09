#!/usr/bin/env bash
# Lei 8 — controle negativo: sabota a regra (no banco ou no código), roda o
# teste que a vigia e exige VERMELHO nele. Verde com a regra quebrada é
# falso positivo; vermelho por motivo alheio não conta.
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
TOTAL=0

# Sabotagem de código nunca pode sobrar no repositório, nem com o script
# morrendo no meio.
ARQUIVOS_REMENDADOS=()
restaura_remendos() {
  if [ "${#ARQUIVOS_REMENDADOS[@]}" -gt 0 ]; then
    git checkout -- "${ARQUIVOS_REMENDADOS[@]}"
  fi
  ARQUIVOS_REMENDADOS=()
}
# Sinal restaura E encerra — trap de sinal sem exit engoliria o término e
# a escalação TERM→KILL deixaria sabotagem de código no repositório.
trap restaura_remendos EXIT
trap 'restaura_remendos; trap - EXIT; exit 130' INT
trap 'restaura_remendos; trap - EXIT; exit 143' TERM

psql_super() {
  PGPASSWORD="$PGSUPERPASSWORD" psql -v ON_ERROR_STOP=1 -q \
    -h "$PGHOST" -p "$PGPORT" -U "$PGSUPERUSER" -d "$CORRE_DB" -c "$1"
}

banco_do_zero() {
  scripts/setup-db.sh > /dev/null
  DATABASE_URL="$URL_DONO" node src/db/migrar.js > /dev/null
}

# roda_e_exige_vermelho <nome> <arquivo_de_teste> <marcador_do_teste_vigia>
roda_e_exige_vermelho() {
  local nome="$1" arquivo="$2" esperado="$3"
  local saida="${SAIDAS}/controle_negativo_${nome}.log"
  if DATABASE_URL="$URL_DONO" DATABASE_URL_APP="$URL_APP" DATABASE_URL_SUPER="$URL_SUPER" \
      node --test --test-timeout=120000 "$arquivo" > "$saida" 2>&1; then
    echo "FALSO POSITIVO: '${arquivo}' ficou VERDE com a regra sabotada (${nome})."
    echo "Saída completa em ${saida}"
    exit 1
  fi
  # Vermelho por qualquer motivo não vale: tem que ser o teste que vigia
  # exatamente a regra sabotada.
  if ! grep -Eq "not ok .*${esperado}" "$saida"; then
    echo "ERRO: vermelho, mas não pelo teste esperado ('${esperado}')."
    echo "Saída completa em ${saida}"
    exit 1
  fi
  TOTAL=$((TOTAL + 1))
  echo "ok: vermelho pelo teste esperado com ${nome} (saída em ${saida})"
}

# sabota_sql <nome> <sql> <arquivo_de_teste> <marcador>
sabota_sql() {
  local nome="$1" sql="$2" arquivo="$3" esperado="$4"
  echo "== sabotagem (banco): ${nome} =="
  banco_do_zero
  psql_super "$sql" > /dev/null
  roda_e_exige_vermelho "$nome" "$arquivo" "$esperado"
}

# sabota_codigo <nome> <arquivo_fonte> <expressao_sed> <arquivo_de_teste> <marcador>
sabota_codigo() {
  local nome="$1" fonte="$2" expressao="$3" arquivo="$4" esperado="$5"
  echo "== sabotagem (código): ${nome} =="
  banco_do_zero
  ARQUIVOS_REMENDADOS+=("$fonte")
  sed -i "$expressao" "$fonte"
  if git diff --quiet -- "$fonte"; then
    echo "ERRO: a expressão sed não mudou ${fonte} — sabotagem não aplicada."
    exit 1
  fi
  roda_e_exige_vermelho "$nome" "$arquivo" "$esperado"
  restaura_remendos
}

# ---------- Etapa 0: imutabilidade de eventos e trava de boot ----------

# Camada de privilégio + camada de trigger derrubadas: o papel da aplicação
# passa a conseguir UPDATE/DELETE/TRUNCATE em eventos.
sabota_sql "app_com_escrita_liberada" "
  DROP TRIGGER eventos_bloqueia_update_delete ON eventos;
  DROP TRIGGER eventos_bloqueia_truncate ON eventos;
  GRANT UPDATE, DELETE, TRUNCATE ON eventos TO corre_app;
" test/eventos.test.js "UPDATE como corre_app"

# Só a camada de trigger derrubada: o dono da tabela passa a escrever.
sabota_sql "triggers_removidos" "
  DROP TRIGGER eventos_bloqueia_update_delete ON eventos;
  DROP TRIGGER eventos_bloqueia_truncate ON eventos;
" test/eventos.test.js "UPDATE até como dono"

# Colunas protegidas liberadas: o app passa a poder forjar id e criado_em.
sabota_sql "colunas_protegidas_liberadas" "
  GRANT INSERT (id, criado_em) ON eventos TO corre_app;
" test/eventos.test.js "OVERRIDING SYSTEM VALUE"

# A credencial da aplicação ganha escrita: a trava de boot tem que recusá-la.
sabota_sql "credencial_do_app_com_escrita" "
  GRANT UPDATE, DELETE, TRUNCATE ON eventos TO corre_app;
" test/boot.test.js "boot aceita a credencial restrita"

# Trigger anti-buraco removido: o app passa a poder pular posição no log.
sabota_sql "log_com_buraco_liberado" "
  DROP TRIGGER eventos_bloqueia_buraco ON eventos;
" test/eventos.test.js "não abre buraco no log"

# ---------- Etapa 1: máquina de estados ----------

# Trava de boot removida do ponto de entrada: o servidor sobe com credencial
# de dono e serve — o teste que exige o encerramento fica vermelho.
sabota_codigo "boot_sem_trava" src/servidor.js \
  's|await exigePapelDeAplicacao(conexao);|/* sabotagem: trava de boot removida */|' \
  test/servidor.test.js "encerra antes de servir"

# Aresta ilegal enfiada na tabela declarativa: corrida já entregue volta a
# aceitar transições de estado vivo.
sabota_codigo "aresta_ilegal_na_tabela" src/dominio/transicoes.js \
  's|de: \[E.PROCURANDO_MOTOBOY\],$|de: [E.PROCURANDO_MOTOBOY, E.ENTREGUE],|' \
  test/maquina.test.js "matriz exaustiva"

# UNIQUE da sequência removido: o banco deixa de arbitrar a corrida pelo
# aceite — mais de um vencedor passa a ser possível.
sabota_sql "sem_unique_de_sequencia" "
  ALTER TABLE eventos DROP CONSTRAINT eventos_agregado_seq_unico;
" test/concorrencia.test.js "exatamente uma vencedora"

# UNIQUE da chave de idempotência removido: retentativa duplica evento.
sabota_sql "sem_unique_de_idempotencia" "
  ALTER TABLE eventos DROP CONSTRAINT eventos_chave_idempotencia_unica;
" test/idempotencia.test.js "um único evento"

# Guarda de tempo removida: o payload do cliente passa a poder trazer
# instante — o teste 'tempo é do servidor' fica vermelho.
sabota_codigo "tempo_do_cliente" src/dominio/corridas.js \
  's|if (chave in dado) {|if (false) {|' \
  test/prazos.test.js "tempo é do servidor"

# ---------- Etapa 2: cadastro e sessão ----------

# Chave Pix de CPF diferente aceita pelo código: o domínio deixa de recusar
# no ato (o CHECK do banco vira a última linha, com erro cru — o teste que
# exige a recusa de domínio fica vermelho).
sabota_codigo "chave_pix_de_outro_cpf_aceita" src/dominio/contas.js \
  's|if (chavePixLimpa !== cpfLimpo) {|if (false) {|' \
  test/contas.test.js "chave Pix de CPF diferente"

# Segundo aparelho aceito: a comparação com o aparelho vinculado some.
sabota_codigo "segundo_aparelho_aceito" src/http/sessoes.js \
  's|if (motoboy.aparelho_id !== aparelhoId) {|if (false) {|' \
  test/api.test.js "segundo aparelho"

# Primeiro saque nasce liberado: agora é DEFAULT do banco (migration 0006),
# então a sabotagem é no banco — muda o padrão da coluna.
sabota_sql "primeiro_saque_nasce_liberado" "
  ALTER TABLE motoboys ALTER COLUMN primeiro_saque SET DEFAULT 'liberado';
" test/contas.test.js "primeiro saque nasce travado"

# Lojista pede sem cartão: a exigência da seção 10 some do domínio.
sabota_codigo "pedido_sem_cartao_aceito" src/dominio/corridas.js \
  's|if (!lojista.cartao_registrado_em) {|if (false) {|' \
  test/contas.test.js "sem cartão de garantia"

# Atendimento com poder de dono: estorno (e criação de operador) deixam de
# ser exclusivos do dono.
sabota_codigo "atendimento_com_poder_de_dono" src/dominio/contas.js \
  "s|exigePapelDoOperador(autor, \['dono'\]);|exigePapelDoOperador(autor, ['dono', 'atendimento']);|" \
  test/api.test.js "403 em estorno"

# Papel lido do corpo da requisição: a identidade deixa de sair do servidor.
sabota_codigo "papel_lido_do_corpo" src/http/api.js \
  's|return operador;|return { ...operador, ...req.body };|' \
  test/api.test.js "forjando papel"

# Sessão não revalidada contra a conta viva: bloqueio deixa de cortar o
# acesso do token já emitido (a revalidação em resolveSessao é a trava).
sabota_codigo "sessao_nao_revalida_conta" src/http/sessoes.js \
  "s|if (!conta \|\| conta.situacao !== 'ativa') return null;|if (false) return null;|" \
  test/api.test.js "revalida a conta viva"

# CPF sem verificação de dígito no banco: a trava por construção some.
sabota_sql "cpf_sem_digito_no_banco" "
  ALTER TABLE motoboys DROP CONSTRAINT motoboys_cpf_digitos_validos;
" test/migrations.test.js "recusa CPF de dígito inválido"

# Corrida para lojista sem cartão criável no banco: trigger removido.
sabota_sql "corrida_sem_lojista_apto_no_banco" "
  DROP TRIGGER corridas_exige_lojista_apto ON corridas;
" test/migrations.test.js "lojista sem cartão"

# Operador forjado por INSERT direto: trigger de exigência de evento fora.
sabota_sql "operador_sem_evento_no_banco" "
  DROP TRIGGER operadores_exige_evento ON operadores;
" test/migrations.test.js "operador forjado"

# ---------- Etapa 2 (fechamento): re-login OTP ----------

# Expiração removida: código vencido passa a ser aceito.
sabota_codigo "otp_sem_expiracao" src/dominio/otp.js \
  's|if (new Date(registro.expira_em).getTime() <= Date.now()) {|if (false) {|' \
  test/otp.test.js "código expirado é recusado"

# Uso único removido: código reusado passa (o UPDATE atômico é o alvo).
sabota_codigo "otp_reuso_liberado" src/dominio/otp.js \
  's|WHERE id = \$1 AND usado_em IS NULL|WHERE id = \$1|' \
  test/otp.test.js "código reusado é recusado"

# Limite de tentativas removido: o código nunca morre.
sabota_codigo "otp_sem_limite_de_tentativas" src/dominio/otp.js \
  's|const morre = novasTentativas >= registro.max_tentativas;|const morre = false;|' \
  test/otp.test.js "mata o código"

# Limite de envio por telefone removido: vira torneira de SMS.
sabota_codigo "otp_sem_limite_de_envio" src/dominio/otp.js \
  's|if (porTelefone.n >= config.otpMaxEnviosPorTelefone()) {|if (false) {|' \
  test/otp.test.js "limite de envios por telefone"

# Código gravado em claro: o hash deixa de proteger.
sabota_codigo "otp_codigo_em_claro" src/dominio/otp.js \
  's|hashDoCodigo(telefone, codigo), config.otpMaxTentativas|codigo, config.otpMaxTentativas|; s|const confere = hashDoCodigo(telefone, codigo) === registro.codigo_hash;|const confere = codigo === registro.codigo_hash;|' \
  test/otp.test.js "código nunca em claro"

# Restaura um banco íntegro para não deixar sabotagem para trás.
banco_do_zero

echo "controle negativo OK: ${TOTAL} sabotagens, todas vermelhas nos testes certos"
