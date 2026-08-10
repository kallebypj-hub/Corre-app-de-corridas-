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
# (Desde a 0011 a idempotência é ÍNDICE único por cidade, não constraint.)
sabota_sql "sem_unique_de_idempotencia" "
  DROP INDEX eventos_chave_idempotencia_unica;
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
  's|if (registro.expirado) {|if (false) {|' \
  test/otp.test.js "código expirado é recusado"

# Uso único removido: código reusado passa. Uso único é defesa em camadas
# (guard inicial + claim + consumo) — a sabotagem remove as TRÊS.
sabota_codigo "otp_reuso_liberado" src/dominio/otp.js \
  's#registro.usado_em || ##; s#AND usado_em IS NULL AND morto_em IS NULL#AND morto_em IS NULL#; s#SET usado_em = now() WHERE id = $1 AND usado_em IS NULL#SET usado_em = now() WHERE id = $1#' \
  test/otp.test.js "código reusado é recusado"

# Limite de tentativas removido: defesa em camadas (cap no claim + morte do
# código) — a sabotagem remove as duas, senão uma mascara a outra.
sabota_codigo "otp_sem_limite_de_tentativas" src/dominio/otp.js \
  's|AND tentativas < max_tentativas|AND tentativas < 100000000|; s|if (slot.tentativas >= slot.max_tentativas) {|if (false) {|' \
  test/otp.test.js "mata o código"

# Cap de tentativas não-atômico sob concorrência: só o claim (cap) cai, e a
# rajada concorrente fura o teto — o teste de concorrência acusa.
sabota_codigo "otp_cap_nao_atomico" src/dominio/otp.js \
  's|AND tentativas < max_tentativas|AND tentativas < 100000000|' \
  test/otp.test.js "concorrência não fura o teto"

# Limite de envio por telefone removido: vira torneira de SMS.
sabota_codigo "otp_sem_limite_de_envio" src/dominio/otp.js \
  's|if (contaTelefone.n >= config.otpMaxEnviosPorTelefone()) {|if (false) {|' \
  test/otp.test.js "limite de envios por telefone"

# Limite de envio por IP removido.
sabota_codigo "otp_sem_limite_de_envio_ip" src/dominio/otp.js \
  's|if (contaIp.n >= config.otpMaxEnviosPorIp()) {|if (false) {|' \
  test/otp.test.js "limite de envios por IP"

# Código gravado em claro: o hash deixa de proteger.
sabota_codigo "otp_codigo_em_claro" src/dominio/otp.js \
  's|hashDoCodigo(telefone, codigo), config.otpMaxTentativas|codigo, config.otpMaxTentativas|; s|const confere = hashDoCodigo(telefone, codigo) === slot.codigo_hash;|const confere = codigo === slot.codigo_hash;|' \
  test/otp.test.js "código nunca em claro"

# ---------- Etapa 3: zonas e preço ----------

# Versão de preço publicada é imutável / só-leitura para o app: se corre_app
# ganhar INSERT em tabelas_preco, o teste de imutabilidade fica vermelho.
sabota_sql "app_publica_preco" "
  GRANT INSERT ON tabelas_preco, zonas TO corre_app;
  -- Depois da Etapa 4 a proteção tem DUAS camadas: privilégio E política de
  -- cidade. Sabotar só o privilégio deixaria a regra de pé pela política, e
  -- o teste ficaria verde — falso positivo que este script pega. Para provar
  -- a regra é preciso derrubar as duas.
  ALTER TABLE tabelas_preco DISABLE ROW LEVEL SECURITY;
  ALTER TABLE zonas DISABLE ROW LEVEL SECURITY;
" test/migrations.test.js "não publica versão de preço"

# Centavos trocados por ponto flutuante (reais): o frete deixa de ser inteiro
# em centavos — Lei 1. O teste de valor exato fora de zona fica vermelho.
sabota_codigo "preco_em_ponto_flutuante" src/dominio/preco.js \
  's|frete_centavos: paraCentavosNumero(total),|frete_centavos: Number(total) / 100,|' \
  test/preco.test.js "fora de todas as zonas"

# Versão nova reescreve preço antigo: o cálculo ignora a versão pedida e usa
# a vigente. Corrida em versão antiga passa a mudar de preço.
sabota_codigo "versao_reescreve_preco_antigo" src/dominio/preco.js \
  's|const alvo = tabelaId \|\| await tabelaVigente(pool);|const alvo = await tabelaVigente(pool);|' \
  test/preco.test.js "não altera o preço"

# Fronteira não-determinística: a resolução passa a sortear a zona.
sabota_codigo "fronteira_nao_deterministica" src/dominio/preco.js \
  's|  for (const zona of zonas) {|  for (const zona of [...zonas].sort(() => Math.random() - 0.5)) {|' \
  test/preco.test.js "fronteira"

# Parâmetro de tempo no preço: o km (logo, o frete) passa a depender do
# relógio — quebra o determinismo (regra 6).
sabota_codigo "hora_no_preco" src/dominio/preco.js \
  's|const km = kmTeto(dist);|const km = kmTeto(dist) + BigInt(new Date().getMilliseconds());|' \
  test/preco.test.js "mesmo centavo"

# Regra de arredondamento removida: km por piso em vez de teto declarado.
sabota_codigo "arredondamento_removido" src/dominio/preco.js \
  's|return (d + METROS_POR_KM_E6 - 1n) / METROS_POR_KM_E6;|return d / METROS_POR_KM_E6;|' \
  test/preco.test.js "arredonda para CIMA"

# Piso por eixo reintroduzido (arredondamento a MENOS antes do teto): cobra
# menos que a distância real; o teste diagonal de valor exato fica vermelho.
sabota_codigo "piso_por_eixo" src/dominio/preco.js \
  's|const aLat = BigInt(latE6 - centroLatE6) \* BigInt(metrosPorGrauLat);|const aLat = (BigInt(latE6 - centroLatE6) * BigInt(metrosPorGrauLat) / 1000000n) * 1000000n;|' \
  test/preco.test.js "logo acima do múltiplo"

# ---------- Trava de configuração de taxa ----------

# A TRAVA REMOVIDA DO DOMÍNIO: a parcela do Corre pode nascer negativa ou
# zero e a corrida é criada assim mesmo. É o cenário exato que a trava
# existe para impedir — pagar para trabalhar, em silêncio.
sabota_codigo "trava_de_taxa_removida" src/dominio/split.js \
  's|if (corre <= 0n) {|if (false) {|' \
  test/split.test.js "recusaria, com código de CONFIGURAÇÃO"

# A trava existe mas não é CHAMADA na criação da corrida: o pedido fora do
# envelope passa e vira corrida.
sabota_codigo "criacao_nao_confere_a_taxa" src/dominio/corridas.js \
  's|const configuracao = await exigeConfiguracaoQueFecha(pool, dados);|const configuracao = await configuracaoVigente(pool);|' \
  test/split.test.js "não vira corrida"

# O CHECK do banco derrubado: passa a ser possível PUBLICAR uma configuração
# que dá prejuízo. É a camada forte — sem ela sobra só o domínio.
sabota_sql "publicacao_de_prejuizo_liberada" "
  ALTER TABLE configuracoes_taxa DROP CONSTRAINT configuracao_taxa_nunca_opera_no_prejuizo;
" test/split.test.js "acima do equilíbrio"

# Taxa fixa deixa de cair na plataforma: quem paga é o lojista. Mentira
# confortável — nenhum gateway rateia taxa fixa, e ela é o que torna custo
# fixo eliminatório. O CHECK do banco passa a discordar do domínio.
sabota_codigo "taxa_fixa_empurrada_para_o_lojista" src/dominio/split.js \
  's|const taxaDoCorre = taxaFixa + taxaPercentual - taxaDoLojista - taxaDoMotoboy;|const taxaDoCorre = taxaPercentual - taxaDoLojista - taxaDoMotoboy;|' \
  test/split.test.js "mesmo centavo em 2.000 casos"

# Teto por parcela removido: com mercadoria menor que a taxa, a parcela do
# lojista fica NEGATIVA — o caso real da venda já acertada fora.
sabota_codigo "sem_teto_de_taxa_por_parcela" src/dominio/split.js \
  's|const taxaDoLojista = pretendidoLojista > lojistaBruto ? lojistaBruto : pretendidoLojista;|const taxaDoLojista = pretendidoLojista;|' \
  test/split.test.js "não deixa o lojista negativo"

# Comissão arredondada para CIMA: o centavo passa a sair do motoboy e ir
# para a plataforma, o contrário da regra declarada.
sabota_codigo "comissao_arredondada_para_a_plataforma" src/dominio/split.js \
  's|const correBruto = piso(frete \* comissaoBps, BPS);|const correBruto = teto(frete * comissaoBps);|' \
  test/split.test.js "vai para o motoboy"

# Taxa estimada para BAIXO: subestima custo, e o split deixa de fechar
# contra a conta publicada.
sabota_codigo "taxa_estimada_para_baixo" src/dominio/split.js \
  's|const taxaPercentual = teto(total \* taxaPctBps);|const taxaPercentual = piso(total * taxaPctBps, BPS);|' \
  test/split.test.js "para CIMA"

# A aplicação ganha poder de publicar configuração de taxa: some a garantia
# de que versão publicada é imutável e a leitura passa a ter janela (Lei 9).
sabota_sql "app_publica_configuracao_de_taxa" "
  GRANT INSERT, UPDATE, DELETE ON configuracoes_taxa TO corre_app;
" test/split.test.js "não altera, não apaga e não publica"

# Falha de configuração volta a ser tratada como erro do usuário: 4xx, sem
# registro nosso, e com a mensagem interna (centavos, rótulo) vazando.
sabota_codigo "falha_de_configuracao_vira_erro_do_usuario" src/http/api.js \
  's|if (ehFalhaDeConfiguracao(erro)) {|if (false) {|' \
  test/split.test.js "responde 503"

# ---------- Etapa 4: multi-cidade (RLS) e cliente ----------

# A ARMADILHA DO POOL, que é o motivo de esta etapa existir: a cidade
# declarada por CONEXÃO em vez de por TRANSAÇÃO. `false` no terceiro
# argumento de set_config torna a variável de SESSÃO — ela sobrevive ao
# COMMIT e vaza para a próxima requisição que pegar a mesma conexão.
sabota_codigo "cidade_presa_a_conexao" src/dominio/nucleo.js \
  "s|await conexao.query('SELECT set_config(\$1, \$2, true)', \['corre.cidade_id', cidadeId\]);|await conexao.query('SELECT set_config(\$1, \$2, false)', ['corre.cidade_id', cidadeId]);|" \
  test/cidades.test.js "não a carrega"

# RLS desligado nas tabelas por cidade: a política existe, mas não é
# aplicada. É o falso verde clássico — tudo funciona, e tudo vaza.
sabota_sql "rls_desligado" "
  ALTER TABLE lojistas DISABLE ROW LEVEL SECURITY;
  ALTER TABLE motoboys DISABLE ROW LEVEL SECURITY;
  ALTER TABLE corridas DISABLE ROW LEVEL SECURITY;
  ALTER TABLE tabelas_preco DISABLE ROW LEVEL SECURITY;
  ALTER TABLE zonas DISABLE ROW LEVEL SECURITY;
  ALTER TABLE configuracoes_taxa DISABLE ROW LEVEL SECURITY;
" test/cidades.test.js "CEGA"

# A política deixa de FECHAR POR PADRÃO: sem cidade declarada passa a ver
# tudo, em vez de nada. Esquecer a cidade voltaria a vazar.
sabota_sql "politica_abre_por_padrao" "
  DROP POLICY lojistas_da_cidade ON lojistas;
  CREATE POLICY lojistas_da_cidade ON lojistas FOR ALL TO corre_app
    USING (corre_cidade_atual() IS NULL OR cidade_id = corre_cidade_atual())
    WITH CHECK (corre_cidade_atual() IS NULL OR cidade_id = corre_cidade_atual());
" test/cidades.test.js "CEGA"

# WITH CHECK removido: lê certo, mas GRAVA em qualquer cidade. É a metade
# da política que costuma ser esquecida, e é a que dá dente.
sabota_sql "politica_sem_with_check" "
  DROP POLICY lojistas_da_cidade ON lojistas;
  CREATE POLICY lojistas_da_cidade ON lojistas FOR ALL TO corre_app
    USING (cidade_id = corre_cidade_atual()) WITH CHECK (true);
" test/cidades.test.js "não lê nem escreve na cidade B"

# A chave composta que casa a cidade entre corrida e lojista, removida: o
# banco deixa de impedir a corrida de misturar cidades.
sabota_sql "corrida_pode_misturar_cidades" "
  ALTER TABLE corridas DROP CONSTRAINT corridas_lojista_da_mesma_cidade;
" test/cidades.test.js "impossível por construção"

# Telefone de cliente deixa de ser único: dois lojistas digitando o mesmo
# número passam a criar duas contas — e o cliente vira duas pessoas.
sabota_sql "telefone_de_cliente_repetido" "
  ALTER TABLE clientes DROP CONSTRAINT clientes_telefone_unico;
" test/cidades.test.js "UMA conta"

# Reivindicação deixa de ser condicional: o UPDATE passa a valer sempre, e
# duas confirmações simultâneas geram dois eventos (lost update clássico).
sabota_codigo "reivindicacao_nao_condicional" src/dominio/clientes.js \
  's|WHERE id = \$1 AND reivindicado_em IS NULL|WHERE id = $1|' \
  test/cidades.test.js "UM evento só"

# O LOG fora do isolamento: foi o furo que a auditoria adversarial achou na
# primeira versão da Etapa 4. `eventos` é a fonte da verdade da Lei 2, e sem
# política nela o recorte por cidade era enfeite.
sabota_sql "log_fora_do_isolamento" "
  ALTER TABLE eventos DISABLE ROW LEVEL SECURITY;
" test/cidades.test.js "CEGA"

# A cidade do evento deixa de ser DERIVADA do agregado: o gatilho some e a
# coluna fica no que o chamador (não) mandou. Sem derivação, escrever no log
# de outra cidade volta a passar pela política.
sabota_sql "cidade_do_evento_nao_derivada" "
  DROP TRIGGER eventos_deriva_cidade ON eventos;
" test/cidades.test.js "não se lê nem se escreve"

# A chave de idempotência volta a ser global entre cidades: repetir numa
# cidade uma chave usada noutra volta a colidir — e a mensagem do conflito
# entregava o id do agregado alheio.
sabota_sql "chave_de_idempotencia_global" "
  DROP INDEX eventos_chave_idempotencia_unica;
  CREATE UNIQUE INDEX eventos_chave_idempotencia_unica
    ON eventos (chave_idempotencia) WHERE chave_idempotencia IS NOT NULL;
" test/cidades.test.js "por cidade e não vaza"

# ---------- Etapa 5: máquina de estados nova e prazo estimado ----------

# A INVARIANTE DA ETAPA, camada de cima: aresta ilegal entrando em Entregue
# direto do estado "com a mercadoria". Existe caminho até Entregue sem passar
# por Pago — entregar sem receber volta a ser possível.
sabota_codigo "entregue_sem_passar_por_pago" src/dominio/transicoes.js \
  's|    de: \[E.PAGO\],|    de: [E.PAGO, E.COM_A_MERCADORIA],|' \
  test/maquina.test.js "nenhum caminho chega a Entregue sem passar por Pago"

# A MESMA invariante, camada de baixo: o CHECK do banco removido. Mesmo com a
# tabela declarativa correta, uma linha entregue sem pagamento passa a caber.
sabota_sql "banco_aceita_entregue_sem_pago" "
  ALTER TABLE corridas DROP CONSTRAINT corridas_entregue_exige_pago;
" test/maquina.test.js "o BANCO recusa Entregue sem pagamento"

# O fato do pagamento deixa de ser IMUTÁVEL: o gatilho para de preservar o
# valor antigo e "despagar" volta a ser possível.
sabota_sql "pago_se_desfaz" "
  CREATE OR REPLACE FUNCTION corridas_marca_pago() RETURNS TRIGGER
  LANGUAGE plpgsql AS \$\$
  BEGIN
    IF TG_OP = 'UPDATE' AND NEW.estado = 5 AND OLD.pago_em IS NULL THEN
      NEW.pago_em := now();
    ELSIF NEW.estado <> 5 THEN
      NEW.pago_em := NULL;
    END IF;
    RETURN NEW;
  END;
  \$\$;
" test/maquina.test.js "pago não se desfaz"

# A aplicação ganha o privilégio de escrever o fato do pagamento: o que era
# derivado passa a ser forjável pelo chamador.
sabota_sql "app_escreve_pago_em" "
  GRANT UPDATE (pago_em) ON corridas TO corre_app;
" test/maquina.test.js "não tem privilégio para escrever pago_em"

# Cancelamento depois do Pago liberado: o dinheiro já foi dividido em três
# contas que não são nossas, e a corrida volta a aceitar cancelamento.
sabota_codigo "cancela_depois_de_pago" src/dominio/transicoes.js \
  's|^      E.EM_RETORNO,$|      E.EM_RETORNO,\n      E.PAGO,|' \
  test/maquina.test.js "não se cancela"

# A declaração do motoboy na saída da porta deixa de ser exigida: "cliente
# ausente" e "presente e não pagou" viram a mesma coisa, e a reputação do
# cliente passa a nascer de declaração vazia.
sabota_codigo "espera_vencida_sem_caso" src/dominio/transicoes.js \
  's|    exigeCasoDeclarado: CASOS_DE_ESPERA_VENCIDA,||' \
  test/maquina.test.js "exige o caso declarado"

# O varredor aprende a fechar o Pago por decurso de prazo — exatamente o
# atalho que a seção 4 proíbe: carimbar como entregue o que talvez não tenha
# sido.
sabota_codigo "varredor_fecha_pago_por_prazo" src/dominio/transicoes.js \
  "s|    autorizados: { \[E.PAGO\]: \['motoboy'\] },|    autorizados: { [E.PAGO]: ['motoboy'] },\n    porPrazo: true,|" \
  test/prazos.test.js "PROIBIDO"

# A espera na porta perde o prazo gravado: o relógio de 5 minutos vira
# nenhum relógio, e o vencimento deixa de existir como dado.
sabota_codigo "espera_na_porta_sem_prazo" src/dominio/transicoes.js \
  's|    prazoDoDestinoMs: config.prazoEsperaNaPortaMs,||' \
  test/prazos.test.js "abre a espera de 5 min"

# O prazo volta a valer o anel de DESTINO em vez do maior das duas pontas —
# o defeito que a regra do par origem-destino existe para evitar.
sabota_codigo "prazo_do_destino_e_nao_do_maior" src/dominio/prazo.js \
  's|  return a > b ? a : b;|  return b;|' \
  test/prazo.test.js "anel MAIOR das duas pontas"

# Fora de zona deixa de somar os km: a ponta distante passa a valer o mesmo
# que a ponta na borda.
sabota_codigo "fora_de_zona_sem_km" src/dominio/prazo.js \
  's|    km: kmTeto(distancia),|    km: 0n,|' \
  test/prazo.test.js "fora de zona"

# A faixa vira ponto: o teto deixa de ser o múltiplo de 5 estritamente maior
# e passa a ser o próprio calculado — o número exato volta para a tela.
sabota_codigo "faixa_vira_ponto" src/dominio/prazo.js \
  's|  let teto = (calculado / PASSO_DA_FAIXA + 1n) . PASSO_DA_FAIXA;|  let teto = calculado;|' \
  test/prazo.test.js "teto é o menor múltiplo de 5"

# A aplicação ganha o privilégio de LER o valor pontual do prazo: o que era
# impossibilidade volta a ser disciplina de quem escreve tela.
sabota_sql "app_le_prazo_pontual" "
  GRANT SELECT (prazo_minutos) ON corridas TO corre_app;
" test/prazo.test.js "NÃO CONSEGUE LER o valor pontual"

# O valor pontual volta para o payload do evento — que a aplicação lê. O
# privilégio de coluna tiraria pela porta o que o log devolveria pela janela.
sabota_codigo "prazo_pontual_no_log" src/dominio/corridas.js \
  's|              tabela_preco_id: prazo.tabela_preco_id,|              tabela_preco_id: prazo.tabela_preco_id,\n              prazo_minutos: prazo.prazo_minutos,|' \
  test/prazo.test.js "NÃO CONSEGUE LER o valor pontual"

# Prazo sem a versão da tabela passa a caber: o prazo mostrado hoje deixa de
# ser reconstituível depois, e a auditoria da seção 8 morre em silêncio.
sabota_sql "prazo_sem_versao_da_tabela" "
  ALTER TABLE corridas DROP CONSTRAINT corridas_prazo_exige_versao_da_tabela;
" test/prazo.test.js "nasce sem prazo"

# A trava da renumeração de estados removida da migration: substituir a
# máquina de estados com dado real passa a acontecer em silêncio.
sabota_codigo "renumeracao_sem_trava" migrations/0012_maquina_de_estados_e_prazo.sql \
  's|    RAISE EXCEPTION|    RAISE NOTICE|' \
  test/migrations.test.js "a trava da renumeração de estados morde"

# -------- Etapa 5, correções da auditoria adversarial --------

# A CHAVE DE IDEMPOTÊNCIA VOLTA A SER CHAVE-MESTRA: a criação para de conferir
# o dono e a chave repetida devolve a corrida DE OUTRO lojista — antes mesmo
# da validação de autor.
sabota_codigo "chave_sem_dono_na_criacao" src/dominio/corridas.js \
  's|  const doMesmoDono = (payloadDoEvento) => payloadDoEvento.lojista_id === autorId;|  const doMesmoDono = () => true;|' \
  test/idempotencia.test.js "NÃO é chave-mestra"

# A mensagem de reuso volta a entregar o id do agregado alheio — o mesmo
# vazamento por HTTP que a auditoria da Etapa 4 achou entre cidades.
sabota_codigo "mensagem_de_reuso_vaza_id" src/dominio/nucleo.js \
  's|em ${evento.agregado_tipo})`,|em ${evento.agregado_tipo} ${evento.agregado_id})`,|' \
  test/idempotencia.test.js "NÃO é chave-mestra"

# A SEGUNDA CAMADA VOLTA A DECIDIR PELO NÚMERO DO ESTADO em vez do fato no
# log: dois UPDATEs com a credencial da aplicação levam a corrida a Entregue.
sabota_sql "pago_derivado_do_estado" "
  CREATE OR REPLACE FUNCTION corridas_marca_pago() RETURNS TRIGGER
  LANGUAGE plpgsql AS \$\$
  BEGIN
    IF TG_OP = 'UPDATE' AND OLD.pago_em IS NOT NULL THEN NEW.pago_em := OLD.pago_em;
    ELSIF NEW.estado = 5 THEN NEW.pago_em := now();
    ELSE NEW.pago_em := NULL;
    END IF;
    RETURN NEW;
  END;
  \$\$;
" test/maquina.test.js "vem do FATO no log"

# A versão da tabela volta a vir do payload: quem pede escolhe a promessa que
# a corrida vai carregar, e a âncora de auditoria do preço.
sabota_codigo "versao_da_tabela_do_payload" src/dominio/corridas.js \
  "s|  'tabela_preco_id',||" \
  test/prazo.test.js "NÃO escolhe a versão da tabela"

# ---------- Lei 11: id não é autorização ----------

# O AUTOR DO EVENTO DEIXA DE SER CONFERIDO: um lojista inventado volta a ser
# gravado como autor no log append-only, que a Lei 3 torna irreversível.
sabota_codigo "autor_de_evento_nao_conferido" src/dominio/clientes.js \
  's|  const autorReal = await exigeAutorReal(pool, lojistaId);|  const autorReal = lojistaId \|\| null;|' \
  test/cidades.test.js "autor de evento"

# O VÍNCULO DO LOJISTA COM A CORRIDA cai: qualquer lojista da cidade volta a
# mover o pedido do vizinho.
sabota_codigo "lojista_alheio_move_corrida" src/dominio/corridas.js \
  "s|  if (autorTipo === 'lojista' \&\& corridaAtual.lojista_id !== autorId) {|  if (false) {|" \
  test/maquina.test.js "lojista alheio não move"

# A CHAVE DE TRANSIÇÃO DEIXA DE SER DO AUTOR: dois aparelhos com a mesma
# chave recebem ambos "venceu", e um motoboy crê que aceitou corrida alheia.
sabota_codigo "chave_de_transicao_sem_autor" src/dominio/corridas.js \
  's|  const doMesmoAutor = (payloadDoEvento) => payloadDoEvento.autor_id === (autorId \|\| null);|  const doMesmoAutor = () => true;|' \
  test/maquina.test.js "chave de idempotência de transição é do AUTOR"

# A CHAVE DO ESTORNO DEIXA DE CONFERIR A CORRIDA: o segundo estorno some.
sabota_codigo "chave_de_estorno_sem_corrida" src/dominio/contas.js \
  's|      confereDados: (p) => p.corrida_id === corridaId,||' \
  test/contas.test.js "estorno"

# AS TRÊS IRMÃS: a chave volta a ignorar os dados pedidos.
sabota_codigo "chave_de_cartao_sem_dados" src/dominio/contas.js \
  's|      confereDados: (p) => p.cartao_ref === cartaoRef,||' \
  test/contas.test.js "cartão"

# Restaura um banco íntegro para não deixar sabotagem para trás.
banco_do_zero

echo "controle negativo OK: ${TOTAL} sabotagens, todas vermelhas nos testes certos"
