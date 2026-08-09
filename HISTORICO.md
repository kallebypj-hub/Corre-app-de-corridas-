# HISTÓRICO — registro, não regra viva

Aqui fica o que **não** precisa ser lido para trabalhar: decisões com data e motivo, alterações da especificação em antes→depois, achados de auditoria e defeitos aceitos. A regra viva mora no [`CORRE.md`](CORRE.md); o estado atual, no [`RETOMAR.md`](RETOMAR.md).

Consulte este arquivo quando precisar saber **por que** algo é como é — ou quando o dono pedir.

---

# 1. Decisões e alterações da especificação (antes → depois)

Todas de 2026-08-09, tomadas pelo dono durante a construção das Etapas 0 a 3.

## Etapa 0 — Fundação

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 1 | **Repositórios** (Stack) | "Repositórios: `corre-api` e `corre-app`" (dois repos separados) | Monorepo único com os diretórios `corre-api/` e `corre-app/` | Quando o contrato da API mudar, o app Kotlin muda no mesmo PR |
| 2 | **Critério da Etapa 1** | Não havia exigência sobre o ponto de entrada | Acrescentado: teste que sobe o servidor de verdade com credencial de dono e prova que ele encerra antes de servir a primeira requisição; controle negativo removendo a chamada deixa o teste vermelho | A trava de boot existia e era testada como função, mas nada provava que o servidor a chamava. "Garantia que o projeto faz sobre si mesmo e ninguém testa é a origem de todo falso sentimento de segurança" |
| 3 | **Fonte oficial** | O `CORRE.md` era um documento mantido fora do repositório | O `CORRE.md` do repositório é a fonte única e oficial; toda decisão de sessão entra nele no mesmo PR, e o relatório de cada etapa lista as alterações antes→depois | Decisão que só existe no chat se perde |
| 4 | **Nota de CI** | — | Registrado: a branch protection amarra o status check pelo **nome do job** (`bateria`). Renomear o job desarma a exigência silenciosamente | A `main` voltaria a aceitar merge com bateria vermelha sem ninguém perceber |

## Etapa 1 — Máquina de estados

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 5 | **Estado 6 (Em disputa)** | A seção 4 dizia "alguém contestou" e "até decisão no painel", sem dizer de onde a disputa abre nem para onde resolve. A seção 11 dava 24h para abrir disputa *após a entrega*, mas Entregue é estado final com split disparado | Estado 6 fica **sem transições até a Etapa 10** (painel); a máquina recusa qualquer par envolvendo o 6. Disputa pós-entrega **não reabre corrida** — será fluxo compensatório do painel | Contradição real na spec; definir por conta própria seria inventar regra |
| 6 | **Cancelamento pela operação** | "Do estado 3 em diante, só a operação cancela" — leitura ao pé da letra incluiria 4 e 5, o que somava 13 arestas e não as "11 transições" citadas | Vale para os estados **3, 4 e 5**, sempre com motivo registrado. A máquina fica com **13 arestas** legais além da criação | As "11 transições" da spec eram as 11 *entradas de estado* da seção 4, não 11 arestas |
| 7 | **Estados 3, 4 e 5 sem prazo** | Tabela marcava prazo "—", contra a regra "todo estado vivo tem prazo e destino" | Aceito até a Etapa 7, **com medida provisória**: consulta `corridasParadas` lista toda corrida viva parada há mais de 24h | Esses estados retêm dinheiro de terceiro; corrida esquecida ali é dinheiro preso sem ninguém saber |

## Etapa 2 — Cadastro e sessão

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 8 | **Chave Pix** | "Chave Pix obrigatoriamente do mesmo CPF do cadastro", sem dizer como verificar | No MVP a chave **é** o próprio CPF, verificada no ato (dígitos + `CHECK` no banco) | Sem consulta DICT, chave de outro tipo não é verificável quanto ao dono — seria brecha de conta laranja. Ampliar é decisão nova quando o gateway trouxer titularidade |
| 9 | **Onboarding do motoboy** | — | Nota de operação: o motoboy precisa cadastrar antes, no banco dele, a chave Pix igual ao CPF. Atrito conhecido e aceito | Consequência direta da decisão 8 |
| 10 | **Sessão** | A spec definia cadastro, mas nenhum mecanismo de sessão ou login | Sessão nasce no cadastro: token opaco, só hash no banco, 30 dias. Motoboy re-entra por CPF + aparelho | Lacuna da spec |
| 11 | **Re-login (item 8 da seção 17)** | Aberto: sessão de 30 dias sem forma de voltar deixava o lojista fora no dia 31 | **Resolvido:** código de 6 dígitos por SMS para lojista e operador — 10 min, uso único, 5 tentativas, limite de envio por telefone e IP, só hash no banco, SMS atrás de interface sem provedor real. Restou aberto só o **provedor** | Sem re-login o produto para de funcionar no dia 31 |
| 12 | **Estorno no painel** | A spec não dizia quando o estorno passa a ter efeito | Autorização (só dono) e registro do ato existem desde a Etapa 2; **efeito financeiro só a partir da Etapa 4**, com o evento gravado no agregado do operador (`efeito: nenhum_ate_a_etapa_4`) | O painel precisa da regra de acesso antes de existir dinheiro para estornar |

## Etapa 3 — Zonas e preço

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 13 | **Versionamento da tabela** | "Tabela por zona, transcrita da tabela que já opera na cidade" | Dado **versionado** no banco; alterar preço cria versão nova, nunca sobrescreve; versão publicada é imutável (app só lê); corrida guarda a versão usada | Auditar um preço cobrado seis meses atrás |
| 14 | **Geometria e fronteira** | Não especificado | Retângulo lat/lng × 1e6; vence a zona de **menor `ordem`** que contém o ponto; bordas inclusivas | Fronteira precisa ser determinística e documentada, nunca aleatória |
| 15 | **Arredondamento** | Não especificado | Um único arredondamento no caminho: metros → km **para cima (teto)**, sem piso por eixo antes | Piso antes do teto cobrava **a menos** que a distância real (achado da auditoria) |
| 16 | **Centro para fora de zona** | A spec diz "a partir do centro da última zona"; a primeira implementação usou um centro configurado na tabela | Derivado do retângulo da zona de **maior ordem** — conforme a spec; colunas `centro_*` removidas | Desvio de spec introduzido na obra, corrigido na auditoria |
| 17 | **Tabela de exemplo** | — | `dados/tabela-preco-exemplo.json`, marcada `exemplo=true`; valores fictícios, inclusive R$ 1,50/km | A tabela real de Sobral ainda não existe (ponto em aberto 3) |

## Processo (Etapas 2 e 3)

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 18 | **Lei 9** | Havia 8 leis | **Lei 9 — toda escrita nasce com teste de concorrência.** Leitura-e-depois-escrita é suspeita de lost update; a garantia mora no banco, nunca na ordem de execução | Dois lost updates reais passaram pela bateria comum no OTP |
| 19 | **PR de correção** | Correção de etapa mesclada viajava junto com a obra da etapa nova | Correção de etapa já mesclada vai em **PR próprio**; correção de **segurança fura a fila** | Se o PR da obra for rejeitado ou revertido, a correção de segurança ia junto — e a `main` fica quebrada |
| 20 | **Portão A (Etapa 4)** | "Precisa ter Pix com preço percentual (não fixo)" | **Requisito de seleção:** gateway que cobra fixo por transação é descartado — a comissão de 5% não se ajusta ao fornecedor. Interface do código fee-agnostic | Em frete baixo o custo fixo come a comissão inteira |
| 21 | **Uma sessão por etapa** | Sessão única atravessando várias etapas (custo passou de 94 milhões de tokens de cache lido) | A sessão abre no prompt da etapa e fecha no merge; a próxima começa em sessão nova lendo `RETOMAR.md`, `CORRE.md` e a `main` | Custo. E força a disciplina: o que importa tem que estar no repositório |
| 22 | **Regime de esforço** | Esforço máximo em tudo | Raciocínio máximo **só** em auditoria adversarial e caminho de dinheiro (Etapas 4, 7, 8); demais, esforço normal | Custo. Corta-se conversa longa, nunca auditoria |

---

# 2. Achados de auditoria adversarial

A auditoria adversarial roda agentes independentes que **atacam** o código executando (banco e API reais), e cada achado passa por um verificador cético que tenta refutá-lo antes de aceitar. Registro aqui o que ela encontrou — **nenhum destes apareceu na bateria comum**, e é por isso que ela continua obrigatória nas etapas de dinheiro e segurança.

| Etapa | Agentes | Reportados | Confirmados | Achados que a bateria comum não pegou |
|---|---|---|---|---|
| 0 | 16 | 12 | 8 | `OVERRIDING SYSTEM VALUE` permitia ao app forjar `id` e `criado_em` do evento (ordem do log reescrita); controle negativo aceitava vermelho por motivo alheio; teste de integridade tautológico (`count(DISTINCT id)` em coluna IDENTITY) |
| 1 | 16 | 12 | 11 | **Replay idempotente sequencial quebrado** — a retentativa que chega depois do commit recebia `transicao_ilegal` em vez do resultado original (Lei 5 no caso canônico "a rede caiu"); matriz exaustiva não vigiava o **conjunto** de transições (aresta-backdoor passava 100% verde); asserção fraca na trava de boot (qualquer falha passava por "recusa"); log podia nascer com buraco na sequência |
| 2 | 25 | 21 | 19 | **Sessão sobrevivia ao bloqueio e à troca de aparelho** por até 30 dias (celular perdido continuava logado; motoboy bloqueado por fraude seguia operando); invariantes de dinheiro só no código (primeiro saque e cartão de garantia burláveis por INSERT direto); stack trace e caminho de arquivo vazando ao cliente; chave de idempotência reusada com dados de outra pessoa devolvia **a conta alheia** |
| 3 + re-auditoria do OTP | 19 | 16 | 13 | **Piso por eixo antes do teto** cobrava a menos que a distância real (R$ 1,50 a menos num caso reproduzido); desvio da spec no centro de referência; **cap de 5 tentativas do OTP furado sob concorrência** (lost update: 50 palpites simultâneos, todos avaliados — força bruta viável); **limite de envio de SMS furado** (check-then-insert) |
| Varredura da Lei 9 (retroativa) | 4 | — | — | Varreu todos os caminhos de escrita da `main`: **os dois do OTP eram os únicos vulneráveis**; todo o resto protegido pelo banco (UNIQUE de seq, UNIQUE de chave, trigger anti-buraco, índice da gênese, PK do token) |

## Falha de processo registrada

Na Etapa 3 a auditoria do OTP foi deixada rodando **em paralelo** com a obra, violando "obra e auditoria nunca em paralelo". Agentes de auditoria sabotam arquivos e banco para provar o controle negativo, e isso contaminou uma rodada de testes (uma sabotagem vazou na árvore de trabalho e apareceu como falha inexplicada). Corrigido isolando a etapa, mesclando a correção em árvore limpa e refazendo tudo single-threaded. A regra está no `CORRE.md`.

---

# 3. Defeitos abertos e limites aceitos

Registro exigido pelo dono: defeito conhecido e não registrado é defeito que volta em produção. Cada entrada tem data, descrição, risco e o motivo de não corrigir. **Entrada só sai daqui por decisão registrada — nunca por apagamento.**

*(Este capítulo era o arquivo `DEFEITOS_ABERTOS.md`, incorporado aqui na reorganização de 2026-08-09. Nenhuma entrada foi alterada.)*

## 2026-08-09 — O dono da tabela consegue desligar as travas de imutabilidade

- **Descrição:** os triggers que bloqueiam `UPDATE`/`DELETE`/`TRUNCATE` em
  `eventos` valem para comandos diretos, inclusive do dono — mas o dono
  (`corre_dono`) consegue, em sessão comum e sem migration, desabilitar o
  trigger (`ALTER TABLE ... DISABLE TRIGGER`), trocar a função do trigger ou
  criar uma `RULE`, e então escrever no log. Comprovado empiricamente na
  revisão adversarial da Etapa 0.
- **Risco:** quem obtiver a credencial de `corre_dono` reescreve o log de
  eventos sem deixar rastro no git. O risco não existe pela via da
  aplicação, que conecta como `corre_app` (sem escrita, sem propriedade,
  travas invioláveis por permissão).
- **Motivo de não corrigir:** limite inerente do PostgreSQL — toda tabela
  tem um dono e o dono controla os próprios triggers. Não há como fechar
  por completo sem superusuário dedicado, o que só desloca o problema.
- **Mitigação ativa:** trava de boot (`corre-api/src/db/boot.js`): a
  aplicação se recusa a iniciar se a credencial da conexão for superusuário,
  dono de `eventos` ou tiver qualquer escrita em `eventos`. Coberta na
  bateria por 3 testes e por controle negativo próprio
  (`credencial_do_app_com_escrita`). `corre_dono` fica restrito a
  migrations; em produção, senha própria e fora do ambiente da aplicação.
- **Estado:** aberto, aceito.

## 2026-08-09 — Provedor real de SMS não decidido (até o lançamento)

- **Descrição:** o re-login por OTP (fechamento da Etapa 2) manda o código
  por uma interface de SMS (`corre-api/src/http/sms.js`). No MVP não há
  provedor real: a implementação padrão (`smsNaoConfigurado`) recusa envio,
  e os testes usam a falsa (`smsFake`).
- **Risco:** sem provedor, o re-login por SMS não funciona em produção — mas
  produção é decisão do dono e não há deploy. Não bloqueia nenhuma etapa.
- **Motivo de não corrigir agora:** escolher e integrar provedor de SMS
  (custo, cobertura, contrato) é decisão de negócio fora do escopo técnico
  das etapas atuais.
- **Estado:** aberto, aceito até o lançamento (ponto em aberto 8 da seção 17).

## 2026-08-09 — Estados 3, 4 e 5 ainda não têm prazo (até a Etapa 7)

- **Descrição:** a regra do projeto diz que "nenhuma corrida fica presa em
  estado vivo para sempre: todo estado vivo tem prazo e destino", mas a
  tabela da seção 4 marca prazo "—" para os estados 3 (a caminho da loja),
  4 (com a mercadoria) e 5 (em retorno). Na Etapa 1, uma corrida nesses
  estados só sai dali por ação do motoboy ou cancelamento da operação — se
  o motoboy sumir, ela fica viva indefinidamente.
- **Risco:** corrida órfã em estado vivo com dinheiro retido, dependendo de
  intervenção manual do painel para fechar.
- **Motivo de não corrigir agora:** os prazos operacionais desses estados
  (espera na porta de 5 min + 1 ligação, retorno) são regra da Etapa 7 —
  defini-los na Etapa 1 seria inventar valor sem especificação.
- **Mitigação ativa:** cancelamento pela operação (3, 4, 5 → 10) já existe
  e exige motivo registrado; e a consulta `corridasParadas`
  (`corre-api/src/dominio/corridas.js`, coberta por teste) lista toda
  corrida em estado vivo há mais de 24 horas — dinheiro preso nunca fica
  invisível (medida provisória exigida pelo dono em 2026-08-09).
- **Estado:** aberto, aceito até a Etapa 7.

## 2026-08-09 — sessoes.ator_id sem chave estrangeira (menor, mitigado)

- **Descrição:** `sessoes.ator_id` referencia motoboy/lojista/operador em
  três tabelas distintas, então não há uma FK única possível. Uma linha de
  sessão forjada apontando ator inexistente é aceita pelo banco.
- **Risco:** baixo. `resolveSessao` faz JOIN com a tabela do ator e devolve
  `null` se a conta não existir ou não estiver ativa — uma sessão órfã é
  inútil na prática. Forjar linha em `sessoes` exige a credencial
  `corre_app` (a própria aplicação).
- **Motivo de não corrigir agora:** a correção fiel (três colunas anuláveis
  com FK + `CHECK` de exatamente uma preenchida) mexe no schema e no código
  de sessão sem ganho de segurança observável além do que a revalidação já
  dá. Fica para quando a tabela de sessões for revista.
- **Estado:** aberto, aceito (menor).

## 2026-08-09 — Monorepo em vez de dois repositórios (8º achado da revisão da Etapa 0)

- **Descrição:** a especificação (seção Stack) pedia os repositórios
  `corre-api` e `corre-app` separados; a Etapa 0 entregou um repositório
  único com os dois como diretórios.
- **Risco:** nenhum técnico — nenhuma das 8 leis nem o critério de aceite
  da Etapa 0 depende da estrutura de repositórios. O risco era só de
  desalinhamento com a especificação sem decisão registrada.
- **Motivo de não corrigir:** a mudança era decisão reservada ao dono
  (a especificação manda parar e perguntar, não implementar versão própria).
- **Estado:** encerrado por decisão do dono em 2026-08-09 — monorepo
  aprovado, com o motivo: quando o contrato da API mudar, o app Kotlin muda
  no mesmo PR. Refletido na seção Stack do `CORRE.md`.
