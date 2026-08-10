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
| 12 | **Estorno no painel** | A spec não dizia quando o estorno passa a ter efeito | Autorização (só dono) e registro do ato existem desde a Etapa 2; **efeito financeiro só a partir da Etapa 7** *(era a Etapa 4 antes da renumeração de 2026-08-09 — ver decisão 73)*, com o evento gravado no agregado do operador | O painel precisa da regra de acesso antes de existir dinheiro para estornar |

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

## Etapa 4 — Portão C, o gateway e o dinheiro (decidido antes da obra)

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 23 | **Portão C — quando o split ocorre** | Aberto: a spec exigia reter do estado 2 ao 6 e dividir só na entrega; os gateways brasileiros tipicamente dividem na confirmação do Pix, o que deixaria o estorno sem lastro | **PagBank com "Custódia"** — retenção no gateway do estado 2 ao 6, liberação por comando de API (`POST /splits/{id}/custody/release`) na transição para Entregue | É o único que passa nos dois portões: retenção com liberação por API **e** preço percentual |
| 24 | **Escolha do gateway** | Em aberto desde a versão 1.0 | **PagBank.** O **Efí** foi descartado apesar de mais barato (1,19% e Pix enviado grátis) porque **divide no ato** | *"Preço melhor não compra arquitetura quebrada."* Sem retenção, o estorno de "sem motoboy", cancelamento e disputa não tem de onde sair. O **Asaas**, que tinha o escrow ideal, já havia caído no Portão A (Pix fixo de R$ 1,99) |
| 25 | **Critério permanente: o dinheiro nunca encosta na conta do Corre** | Não existia como critério — os caminhos "recebe 100% e transfere depois" e "BaaS com conta da plataforma" estavam sobre a mesa, e eram os mais baratos | Qualquer desenho em que o frete transite pela conta da plataforma está **descartado por construção** | **Res. BCB 494/2025:** guardar dinheiro de terceiro é ser instituição de pagamento, com autorização e responsabilidade que este negócio não comporta. Não é decisão de taxa |
| 26 | **"1 saque grátis por dia" (seção 9)** | Saldo no app, **1 saque grátis por dia**, extras com taxa | O split cai na **subconta do motoboy no gateway**. O saldo exibido no app é **espelho da subconta, não conta nossa**. O saque é **ato dele** e o **custo da transferência é dele**. O Corre **não intermedeia saque nem promete gratuidade** | A promessa pressupunha o dinheiro passando pela nossa conta — o que a decisão 25 proíbe. Consequência direta da Res. BCB 494/2025 |
| 27 | **Onboarding do motoboy (seção 10)** | Chave Pix igual ao CPF | Chave Pix igual ao CPF **+ subconta aberta e aprovada no gateway** (é para onde o split cai) | Sem subconta aprovada não há para onde mandar o dinheiro dele. **Risco registrado:** se a aprovação for demorada, colide com "cadastra e roda na hora" |
| 28 | **Conta da Lei 7, com número real** | Estimativa: gateway ~1%, líquido ~R$ 0,40 (~4%) | **PagBank a 1,89%: frete R$ 10 → comissão R$ 0,50 → gateway R$ 0,19 → líquido R$ 0,31 (3,1%)**. O teto de 1,89% é **preço de tabela** e será negociado antes da contratação | Lei 7 exige a conta escrita em reais **antes** de integrar |
| 29 | **Etapa 4 gateway-agnóstica** | — | A Etapa 4 é construída atrás de **interface com implementação falsa**, como o SMS. A implementação real do PagBank fica **para depois da Etapa 4**. Nenhuma credencial, nenhuma chamada real | Permite construir e testar o caminho do dinheiro sem depender de contrato assinado |

## Revisão de 2026-08-09 — o pagamento mudou de lugar

**O que disparou tudo:** *o cliente que compra pela primeira vez não tem app nenhum.* Cobrar antes do despacho exigia dele um link, um Pix e uma confiança que ele ainda não tem, com a loja esperando. Isso trava a primeira compra — que é a única que importa para o produto pegar.

A decisão de mover o pagamento para a porta derrubou, em cascata, o Portão C, a Etapa 4 inteira, a máquina de estados da Etapa 1, o PIN, a lista de superfícies e a conta da Lei 7. As decisões 23 a 29 acima **continuam registradas mas não valem mais** — ficam porque explicam por que a arquitetura anterior existia.

### O pagamento

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 30 | **Quando o cliente paga** (seções 3 e 4) | Lojista cria → link no WhatsApp → cliente paga por Pix → **só então** despacha. Corrida nascia em "Aguardando pagamento" e expirava em 15 min | O cliente paga **na porta**, por **QR Pix dinâmico exibido no app do motoboy**. A corrida **nasce procurando motoboy**; nada é cobrado antes | Cliente de primeira compra não tem app e não instala um com o motoboy esperando. Cobrar antes trava a primeira compra |
| 31 | **Entrega consignada ao pagamento** (seção 3) | A entrega era a última etapa de um pedido já pago | A mercadoria **só muda de mão depois** que o backend confirma o Pix. O app do motoboy não mostra o botão de entregar antes disso | Ordem invertida: o risco de não receber virou risco de não entregar, que é recuperável |
| 32 | **O dinheiro na mão do motoboy** (seção 3) | Não se aplicava — ele nunca tocava em dinheiro | Continua não tocando: o QR é da plataforma, o dinheiro vai direto para as três contas. **Pagamento na entrega ≠ dinheiro vivo** | Sem isso, "pagar na porta" viraria maleta de troco, roubo e acerto informal |
| 33 | **Prova de entrega — o PIN** (seções 7, 11, 14) | **PIN de 4 dígitos** informado pelo cliente; "PIN validado = entregue, encerra a discussão" | **O PIN saiu da especificação.** A prova é o **pagamento confirmado pelo banco**, com valor e horário | O PIN é um número que o cliente pode passar por telefone; a confirmação bancária não. E some o atrito de ditar número na porta. **Custo aceito:** o pagamento prova presença e quitação, não prova que a mercadoria mudou de mão — fresta de segundos coberta pela disputa de 24h |
| 34 | **Espera na porta** (seção 7) | 5 min com **1 ligação registrada** no app | 5 min com **1 aviso registrado** — chat para quem tem app, SMS para quem não tem | Sem telefone exposto (decisão 57), a ligação deixou de ser possível |

### O dinheiro

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 35 | **O que a cobrança cobra** (seções 9 e 16) | Só o frete. "Pagamento da mercadoria dentro do app" era **fora de escopo** | **Mercadoria + frete numa cobrança só**, com **três recebedores declarados**: mercadoria integral ao lojista, frete − 5% ao motoboy, 5% do frete ao Corre | Se o cliente já vai pagar na porta, pagar duas vezes (uma para a loja, outra para o frete) é absurdo. Uma cobrança, um QR, um ato |
| 36 | **Comissão sobre mercadoria** (seção 9) | Não existia a questão | **Zero.** Três motivos: (1) nosso serviço é o frete, não o produto; (2) **fiscal** — percentual sobre mercadoria faz do Corre revendedor e joga a mercadoria na base tributária dele (seção 15); (3) **adoção** — o lojista embute no produto, o cliente paga, e ele descobre na primeira conta | Registrado a pedido do dono |
| 37 | **Retenção / custódia** (seção 9) | Valor **retido no gateway** do estado 2 ao 6, liberado por API na transição para Entregue | **Não existe mais.** Ou nada foi pago, ou já foi dividido | A custódia existia para dar lastro ao estorno de "sem motoboy", cancelamento e disputa — três casos que, com pagamento na entrega, acontecem **antes de qualquer pagamento**. Não há o que reter |
| 38 | **Portão C** | Decidido: PagBank com Custódia (decisões 23 e 24) | **Morto.** O problema que ele resolvia deixou de existir | Ver decisão 37 |
| 39 | **Escolha do gateway** (seção 17, item 1) | **PagBank**, escolhido por ser o único com custódia + Pix percentual | **Reaberta.** A custódia deixou de ser requisito e passou a ser peso morto; o Efí, descartado por "dividir no ato", faz **exatamente** o que a spec agora pede | Escolher fornecedor por um requisito que morreu é pagar caro por nada |
| 40 | **Critérios de seleção** (seção 17, item 1) | Dois: **(A)** Pix percentual e **(C)** o dinheiro nunca encosta na conta do Corre | Três — entra **(D) de quem sai a taxa tem que ser declarável** | A taxa incide sobre mercadoria + frete; a receita é 5% do frete. Ver decisão 41 |
| 41 | **A conta da Lei 7** (Lei 7, seções 9 e 18) | Frete R$ 10 → comissão R$ 0,50 → gateway 1,89% sobre R$ 10 = R$ 0,19 → líquido R$ 0,31 | A taxa passou a incidir sobre o **total**. Mercadoria R$ 100 + frete R$ 10 a 1,19% = **R$ 1,31 de taxa contra R$ 0,50 de comissão**. **Se a taxa sair da comissão, cada entrega dá prejuízo, e o prejuízo cresce com o preço da mercadoria** | Consequência direta da decisão 35, encontrada ao refazer a conta. A spec passou a exigir que a taxa da mercadoria seja debitada da parcela da mercadoria; **de quem ela sai é decisão do dono** (seção 17, item 2), e trava a Etapa 7 |
| 42 | **Estorno** (seções 5 e 13) | Estorno integral com lastro na custódia | **Depois do estado Pago não se cancela.** O dinheiro está em três contas que não são nossas; o que existe é disputa resolvida por evento compensatório. O Corre só devolve sozinho a própria comissão | O split liquidado não se desfaz por decisão nossa |
| 43 | **Cartão de garantia do lojista** (seções 5, 9 e 14) | Exceção rara: cancelamento pós-aceite causado pelo lojista e retorno por cliente ausente | Mesma regra, **outro peso**: virou a rede de proteção do modelo — é ele que garante que o motoboy não faz viagem de graça quando o cliente não paga | Com pagamento na porta, "cliente não pagou" deixou de ser caso raro e virou o principal modo de falha (seção 17, item 14) |

### A máquina de estados

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 44 | **Estados e arestas** (seção 4) | 11 estados começando em "Aguardando pagamento"; **13 arestas**; dinheiro retido do 2 ao 6 | 11 estados começando em "Procurando motoboy", com **"Na porta, cobrando"** e **"Pago"** novos; **14 arestas**; **dinheiro em lugar nenhum** até o estado Pago | Consequência da decisão 30. O motor da Etapa 1 continua valendo; **a tabela de transições é reescrita na Etapa 5** |
| 45 | **Invariante nova** (seção 4) | — | **Nenhum caminho chega a Entregue sem passar por Pago** — provado, não prometido | Entregar sem receber tem que ser impossível por construção |
| 46 | **Estado "Expirada"** (seção 4) | Existia: ninguém pagou o link em 15 min | **Extinto.** Sem cobrança no início, corrida sem motoboy morre em "Sem motoboy" | Não sobrou nada para expirar |
| 47 | **Retorno nunca carrega dinheiro pago** (seções 4 e 5) | Retorno acontecia com valor retido | Depois de Pago só existem Entregue e Disputa. O retorno só sai de "Com a mercadoria" ou "Na porta, cobrando" | Mantém o estorno fora do caminho normal — é o que torna o modelo simples |
| 48 | **Cancelamento** (seção 5) | Livre até o estado 2 (Procurando motoboy); da 3 em diante só a operação | Livre no estado **1** (Procurando motoboy); dos estados 2, 3, 4 e 6 só a operação, com motivo; **do 5 em diante não se cancela** | Renumeração + decisão 42 |
| 49 | **Prazos provisórios** (seção 4) | Estados 3, 4 e 5 sem prazo até a Etapa 7 | Estados **2, 3, 5 e 6** sem prazo até a **Etapa 8**. `corridasParadas` continua obrigatória | Renumeração. O risco **encolheu** (não há mais dinheiro de terceiro retido) mas **não sumiu**: há mercadoria de terceiro na mão do motoboy, que é pior de perder de vista |
| 49b | **Fechar Pago por decurso de prazo — proibido** (seção 4) | — | Corrida parada em **Pago** (dinheiro já dividido, entrega não confirmada) **não fecha sozinha em Entregue**. Fica em `corridasParadas` até gente resolver, enquanto a Etapa 8 não define o destino | Fechar por prazo é carimbar como entregue uma corrida que talvez não tenha sido — e é justamente a fresta que o fim do PIN abriu (capítulo 3) |
| 49c | **O estado de disputa nasce sem aresta nenhuma** (seções 5 e 13) | Mesma regra valia para o antigo estado 6, mas o dinheiro estava retido e o estorno tinha lastro | Continua sem arestas até a **Etapa 11** — e agora isso significa que **entre o pagamento e a Etapa 11 não existe recurso dentro do sistema**. O que der errado depois do split se resolve por fora, com gente | Inventar fluxo de disputa antes da etapa que o especifica seria pior. Registrado como o motivo de a Etapa 11 não poder ficar para o fim da fila |

### As superfícies

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 50 | **Quantos apps** (Stack, seção 2) | Um: o do motoboy (Kotlin). Lojista na web, cliente num link | **Três apps sobre um backend só:** motoboy em **Kotlin/Android** (`br.com.corre.motoboy`), lojista em **Flutter** (`br.com.corre.lojista`), cliente em **Flutter** (`br.com.corre.cliente`). Diretórios `corre-app-motoboy/`, `corre-app-lojista/`, `corre-app-cliente/` | O cliente virou pagador e precisa de superfície própria; o lojista virou recebedor e precisa de mais que uma página. **Nome de pacote é definitivo** — pacote publicado não se troca sem perder a base instalada, o que amarra o registro do domínio `corre.com.br` (seção 17, item 8) |
| 51 | **A primeira compra** (seção 2) | O link do WhatsApp servia para pagar e rastrear | **SMS + ponte web mínima**: paga e acompanha, **e nada mais** — sem conta, sem login, sem histórico, sem chat, sem outra loja. Morre com a corrida | A primeira compra não pode depender de instalar app. Quem gosta instala na segunda |
| 52 | **Provedor de SMS** (seção 17, item 9) | Pendência de lançamento: sem ele o re-login não funciona no dia 31 | **Pré-requisito do produto:** sem SMS o cliente novo não recebe o link para pagar, e não existe primeira compra | Escalou de gravidade por consequência da decisão 51 |
| 53 | **O cliente como ator** (seções 1, 2, 10) | "O cliente final não tem conta, não tem login". Era um link anônimo | Tem **conta, app, histórico e chat**. A conta nasce sozinha quando o lojista digita o telefone e passa a ser dele quando ele entra pelo código de 6 dígitos. **Não tem subconta e não recebe dinheiro** | Quem paga precisa de identidade, comprovante e um lugar para reclamar |
| 54 | **Frase de posicionamento** (seção 1) | *"o cliente continua sendo seu — eu nem sei o nome dele"* | **Retirada por ter ficado falsa.** Proposta: *"eu não tenho vitrine; ninguém descobre outra loja aqui"* — a redação final é decisão comercial do dono (seção 17, item 12) | O Corre passou a saber o nome do cliente porque cobra dele. O que continua verdade é que não existe catálogo, busca nem comparação — sem descoberta, não existe iFood |
| 55 | **Onboarding do lojista** (seção 10) | Duas condições: **pode entrar** (nome e telefone, 1 minuto) e **pode pedir** (cartão de garantia) | Três: entra em 1 minuto, mas **pode receber** exige **subconta aprovada no gateway** — sem ela, criar corrida é recusado | Com a mercadoria na cobrança, o lojista virou recebedor, e recebedor precisa de KYC. **É piora real de onboarding**, registrada como risco (seção 17, item 11) |
| 56 | **Valor da mercadoria** (seções 8 e 11) | **Valor declarado** pelo lojista, só para limitar responsabilidade em perda | **Valor cobrado**, digitado pelo lojista e cobrado integral | O teto de R$ 500 passou a incidir sobre número real, não sobre estimativa de parte interessada |

### O que passou a existir

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 57 | **Chat interno** (seção 19, nova) | Nenhuma comunicação na plataforma — o combinado acontecia no WhatsApp | **Três conversas por corrida** (lojista↔cliente, lojista↔motoboy, motoboy↔cliente), **sem telefone de ninguém aparecer em resposta da API**. Mensagem é **evento**: não edita, não apaga, e **serve de prova em disputa**. Texto e nada mais. **Nenhuma API de WhatsApp**. Não existe chat fora de corrida | Com o pagamento na porta, o combinado ("deixa com o vizinho", ponto de referência) decide se a entrega acontece — e precisa estar registrado onde a disputa possa ler. Telefone exposto é o que faz a plataforma ser contornada |
| 58 | **Nota do cliente** (seção 12) | Duas notas: loja e motoboy | **Três.** A do cliente se forma de **dois fatos objetivos** — pagou na porta, estava presente — mais a nota das duas pontas. Acima do teto de faltas, **é recusado como destino em toda a plataforma** até a operação liberar. Não pagamento conta **contra o cliente e contra mais ninguém** | Quem pode transformar a viagem inteira em prejuízo tem que ficar visível antes do próximo motoboy sair da loja. O teto ainda não tem número (seção 17, item 13) |
| 59 | **Prazo estimado** (seção 8) | Não existia | `prazo = tempo base de coleta + tempo do anel de destino`. Os minutos por anel são **coluna da tabela de preço versionada**; gravado na criação; **sem API de mapa**. É **estimativa** e o texto na tela diz isso: não é SLA, não gera multa nem desconto, **e não entra na reputação de ninguém** | O cliente que vai pagar na porta precisa saber a que horas ficar em casa. Virar promessa criaria uma obrigação que nem o trânsito nem a spec aceitam |
| 60 | **Multi-cidade** (seção 20, nova) | Sobral implícita em tudo; nenhuma noção de cidade no modelo | **Cidade é entidade de primeira classe desde a migration.** Pertencem a uma cidade: lojista, motoboy, corrida, tabela de preço, zona. **O cliente não** — é da plataforma. Corrida acontece dentro de uma cidade só, **imposto por constraint**, não por código | Retrofit de escopo geográfico em base com dinheiro dentro é o tipo de mudança que ninguém faz com segurança depois. Constrói-se o **lugar** da segunda cidade, não a operação dela |

### Plano e processo

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 61 | **Ordem das etapas** | 13 etapas (0–12); Etapa 4 = "Pedido + link + Pix + split" | **18 etapas (0–17).** A Etapa 4 planejada foi **invalidada e não existe mais**. Nova ordem: 4 multi-cidade e cliente · 5 máquina de estados nova e prazo · 6 despacho · 7 cobrança na porta · 8 entrega e retorno · 9 saldo e saque · 10 chat · 11 painel e disputa · 12 reputação · 13 app motoboy · 14 ponte web e app cliente · 15 app lojista · 16 antifraude · 17 blindagem | **O despacho virou a primeira coisa que acontece** e por isso subiu na fila, antes do dinheiro. Três apps e dois assuntos novos (chat, multi-cidade) não cabiam nas 13 antigas |
| 62 | **O que a revisão invalidou na `main`** | — | **Etapa 0:** vale inteira. **Etapa 1:** o motor vale, **a tabela de estados não** (reescrita na Etapa 5). **Etapa 2:** vale, falta o cliente como ator. **Etapa 3:** vale, com a correção 6×6 ainda pendente | Registrado para que nenhuma sessão futura confie numa tabela de transições que a spec já derrubou |
| 63 | **Regime de esforço** | Raciocínio máximo em auditoria e nas etapas de dinheiro **4, 7 e 8** | Etapas de dinheiro passaram a ser **7 e 9**; auditoria adversarial obrigatória em **7, 9, 11** e qualquer etapa de autenticação ou autorização | Renumeração |
| 64 | **Numeração da seção 17** | 11 itens | 15 itens, renumerados. Referências antigas a "item 8" (SMS) e "item 3" (tabela de Sobral) apontam agora para os itens **9** e **4** | Entraram itens novos e caíram os do Portão C |

### A reabertura do gateway — o que a pesquisa trouxe de volta

Levantamento de 2026-08-09, 9 agentes, 390 chamadas, cada afirmação reaberta na fonte por um verificador cético. Dossiê em [`GATEWAY.md`](GATEWAY.md). **Nenhum fornecedor foi escolhido** — o que segue é o que virou regra.

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 65 | **O alarme da Lei 7 tinha remédio** | Ao escrever a decisão 41 o quadro era: taxa de R$ 1,31 contra comissão de R$ 0,50, prejuízo por entrega | **Existe parâmetro, por recebedor, que concentra a taxa percentual num participante só** (Pagar.me, `options.charge_processing_fee`). Com ele no lojista, a comissão chega intacta e **a margem do Corre fica imune ao valor da mercadoria** — R$ 0,50 em um pedido de R$ 100 ou de R$ 500 | O alarme era real; a conclusão de inviabilidade teria sido precipitada. É a diferença entre "o modelo não fecha" e "o modelo depende de um parâmetro que precisa estar no contrato" |
| 66 | **Custo fixo — o motivo mudou** (Lei 7) | Fixo era descartado por ser **caro** em frete baixo | Fixo é descartado por ser **insplitável**: os gateways só aceitam regra de split para a taxa percentual, e qualquer componente fixo cai obrigatoriamente na plataforma, sem parâmetro que o mova. Um fixo de R$ 0,99 vira 50 c de receita contra 99 c de custo | Achado da pesquisa. Torna o critério (A) duplamente eliminatório e explica por que ele não é negociável nem com desconto |
| 67 | **"Comissão zero sobre a mercadoria" precisou de nota de rodapé** (seções 9 e 10) | Enunciado seco: zero | Continua zero **do lado do Corre** — mas a taxa do gateway sai da parcela da mercadoria, e o lojista recebe **R$ 98,69 num pedido de R$ 100** (1,31%; 1,79% num de R$ 20, porque ele paga a taxa sobre o frete também). **Tem que estar no contrato de adesão e ser dito antes de assinar** | A taxa não some, muda de bolso. Vender "zero" e entregar 1,31% é o tipo de coisa que o lojista descobre na primeira conta e não perdoa. Argumento comercial a favor: é menos que qualquer maquininha |
| 68 | **Estorno não toca o frete** (seções 9 e 13) | Não estava especificado | Se o cliente recusa a mercadoria **depois de pagar**, a entrega foi prestada: **o estorno sai 100% da parcela do lojista**; frete e comissão ficam. E o split precisa ser **reenviado explicitamente** no cancelamento — se não for, o gateway reaplica a proporção original e **tira dinheiro do motoboy e do Corre**. Virou controle negativo obrigatório da Etapa 11 | Achado da pesquisa (aviso oficial do Pagar.me). É o tipo de defeito que a bateria comum não pega: o estorno "funciona" e some dinheiro de quem não devia |
| 69 | **O webhook não libera a mercadoria** (seções 3 e etapa 7) | "Confirmação por webhook e consulta ativa", sem hierarquia | **Consulta ativa é o caminho primário**; webhook é aceleração e reconciliação. Critério de aceite novo: **com o webhook desligado, a corrida ainda fecha** | As políticas de retentativa publicadas chegam a mais de duas horas, e o webhook cai no nosso servidor, não no aparelho do motoboy — que é quem está na porta esperando |
| 70 | **O motoboy roda antes de poder sacar** (seção 10) | "Aprovação automática — roda na hora; primeiro saque travado até conferência" | Mesma regra, com o mecanismo do gateway explicitado: a subconta nasce apta a **receber** antes de apta a **movimentar** (KYC em até 24h). **O app mostra o estado do KYC e não promete saque antes disso.** E a configuração padrão é **saque agregado**, não por corrida | Prometer saque que não sai é o jeito mais rápido de perder um motoboy. E a tarifa de saque é fixa: sacar a cada corrida come o ganho de R$ 9,50 |
| 71 | **Loja com CNPJ: quem cadastra é o sócio** (seção 10) | Não estava especificado | O responsável pela subconta precisa ser **sócio qualificado no QSA** — administrador e procurador não são aceitos (Circular BCB 3.978/20). Em Sobral: **o dono da loja em pessoa** | Esforço de campo a planejar no lançamento, não surpresa a descobrir no cadastro |
| 72 | **Mercadoria zero tem regra própria** (seções 3 e 9) | A exceção existia; a conta dela, não | Sem parcela de lojista não há de onde debitar a taxa: ela **sai do Corre**, e a comissão vira R$ 0,38 num frete de R$ 10. **Fecha sempre**, porque 1,19% do frete é muito menor que 5% do frete | Buraco encontrado ao aplicar a conta ao caso da exceção. Virou critério de aceite da Etapa 7 |

### A trava de configuração de taxa, e a venda

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 73 | **O ponto de equilíbrio virou regra de sistema** (seção 9, migration `0009`) | `mercadoria ≤ 3,2 × frete` era uma **nota na especificação**. Nada no código impedia a plataforma de operar fora dele | **A parcela do Corre nunca pode resultar negativa nem zero.** A configuração de taxa virou **dado versionado e imutável** (`configuracoes_taxa`), e o **banco recusa publicar** configuração que possa dar prejuízo dentro do envelope que ela declara. **Sem configuração publicada não há corrida.** Não é erro do usuário: responde **503** e é registrado como falha nossa | Bastaria o parâmetro de concentração de taxa não estar ativo — contrato diferente, gateway trocado, configuração errada — para a plataforma pagar para trabalhar **em silêncio** em todo pedido acima de ~R$ 32 de mercadoria. Nota em documento não impede nada |
| 74 | **A aritmética do split** (seção 9) | "mercadoria integral, frete − 5%, 5% do frete" — sem regra de arredondamento | Três arredondamentos declarados: **comissão por PISO** (o centavo vai para o motoboy, nunca para a plataforma), **taxa por TETO** (nunca subestimar custo), e **ninguém paga taxa maior que a própria parcela, com toda sobra caindo na plataforma** | 5% de frete ímpar não é centavo inteiro e a soma tinha que fechar. E o arredondamento não pode cair em quem não escolheu o gateway |
| 75 | **A frase da venda** (seção 21, nova) | A decisão 67 mandava pôr a taxa **no contrato de adesão** e dizê-la antes de assinar | **Errado, e corrigido pelo dono:** o 1,19% **não é custo novo — é a maquininha dele sendo substituída**, e ele paga mais que isso hoje em débito, crédito e aluguel de máquina. Isso vai na **primeira frase da venda**, não escondido no contrato. E o argumento maior nem é taxa: **o QR no celular do motoboy é a maquininha da loja parando de atravessar a cidade** | Enterrar no contrato é vender escondendo — o lojista descobre na primeira conta e aí o problema não é mais a taxa. Dito de frente, é vantagem, não concessão |

### Subconta de pessoa física — a pergunta que podia derrubar a seção 10

Levantamento de 2026-08-09, 8 agentes, 307 chamadas, cada afirmação reaberta na fonte por um verificador cético. Ordem do dono: *"se nenhum gateway aceitar pessoa física, pare e avise — isso derruba a seção 10."*

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 88 | **MEI não é exigido do motoboy** (seções 10 e 15) | Regra escrita, **nunca verificada contra fornecedor nenhum** | **Confirmada.** Os quatro candidatos abrem subconta de recebedor para **pessoa física com CPF**. A seção 10 fica de pé | Era eliminatória: se só houvesse CNPJ, o mais barato do mercado não serviria e a decisão de exigir MEI voltaria ao dono. Não voltou |
| 89 | **"Cadastra e roda na hora" virou critério de escolha** (seção 17, item 1) | Risco registrado: "se a aprovação for demorada, colide com cadastra e roda na hora" | **O melhor colocado é o único que não colide:** o recebedor nasce apto a **transacionar** antes da prova de vida, e só o **saque** espera o KYC (24h). Em dois candidatos a conta só transaciona depois de aprovada — e aí a regra morre; num terceiro, a subconta não verificada devolve **401** em produção e a fila é de **até 2 dias úteis** | O risco que estava registrado como incerto virou **critério que separa fornecedor**. Quem se cadastra na sexta e só roda na terça não é motoboy de plataforma |
| 90 | **O cadastro do motoboy ficou mais pesado** (seção 10) | CNH, CRLV, selfie e chave Pix | Mais: **data de nascimento, ocupação profissional, renda mensal declarada, endereço completo com ponto de referência**, e os **dados bancários no mesmo ato** — não existe recebedor sem conta. E a conta de saque tem que ser **do CPF dele** | É o contrato de criação de recebedor, não escolha nossa. A exigência da conta no mesmo CPF **casa** com a regra "chave Pix = CPF" que a spec já tinha — a trava contra conta laranja ficou mais forte, não mais fraca |
| 91 | **Saldo global e KYC reprovado** (seção 17, itens 18 e 19) | Não existiam | Dois riscos operacionais novos: o **teto de saque de qualquer recebedor é o saldo global do marketplace** (um recebedor negativo trava o saque dos outros), e **KYC reprovado depois de o motoboy já ter recebido deixa o dinheiro travado, com a ação sendo nossa** | Nenhum dos dois é código: são fluxo de painel e vigilância. Descobrir isso depois de 66 motoboys cadastrados seria caro |
| 92 | **A facilidade da Woovi confirmou a eliminação dela** | Ela caíra no critério (C) por a subconta ser saldo virtual dentro da conta do Corre | A pesquisa achou o sintoma: **a subconta se cria com nome e chave Pix, e nada mais — zero KYC do titular.** Registrado como leitura geral: **quem não pede documento de ninguém não está abrindo conta de terceiro, está guardando o dinheiro dele mesmo** | Vale como regra de triagem para qualquer fornecedor futuro: KYC leve demais é indício de que o dinheiro não é de quem parece |

### Aprovações e correções do dono sobre a revisão

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 93 | **O princípio do centavo, e não só a regra** (seção 9) | Três arredondamentos declarados, cada um com uma justificativa própria | Os três passaram a sair de **um princípio enunciado**: *"o centavo do arredondamento é sempre do parceiro, nunca da plataforma"*, com o corolário de que **dúvida não prevista se arredonda contra a plataforma**. E ficou escrito que isso é **cláusula de contrato e argumento de venda**, não detalhe de implementação | Correção do dono. Regra sem princípio se perde na primeira exceção; e num volume de 34 mil corridas/mês, "só um centavo" é a diferença entre ser sócio e ser cobrador |
| 94 | **Nota de processo: controle negativo e git** (Como testar) | — | **Nunca rodar o controle negativo com código não commitado.** Ele sabota o arquivo e restaura com `git checkout`, que não devolve arquivo desconhecido do git — arquivo novo fica com a sabotagem dentro, e arquivo alterado volta ao HEAD e perde o trabalho da sessão | Aconteceu: a trava de configuração de taxa foi apagada pelo próprio controle negativo que ia prová-la. Defeito de processo que só se paga uma vez se for escrito |
| 95 | **Regra de triagem: KYC fraco** (seção 17, item 1) | A eliminação da Woovi era um caso isolado no dossiê | Virou **regra permanente de triagem**: fornecedor que abre subconta pedindo pouco ou nada do titular **não está sendo prático — está dizendo que o risco ficou com a plataforma**. Reprova no critério (C) por construção. **Antes de olhar o preço, pergunte o que ele exige de quem vai receber** | Vale para qualquer fornecedor futuro. O menor percentual do mercado (0,80%) veio junto com subconta que se cria com nome e chave Pix e nada mais — a facilidade era o sintoma |
| 96 | **Exceção registrada: código junto com documentação num PR só** | A regra é "correção de etapa já mesclada vai em PR próprio, sempre", e a prática do projeto separa código de documentação | **Exceção aprovada pelo dono para este PR e só para ele:** a trava de configuração de taxa viajou no mesmo PR da revisão da spec. **Não é abertura da regra.** O motivo, que é a condição da exceção: **sem a spec nova a trava não tem o que travar** — ela vigia o split triplo e o ponto de equilíbrio que só existem na revisão. Se o PR fosse rejeitado, a trava sozinha não faria sentido na `main` | Fates acopladas justificam PR acoplado; fates independentes, não. Registrado aqui para que uma sessão futura não leia este PR como precedente de misturar código com documentação por conveniência |

### As três perguntas de 2026-08-09 (levantamento, nenhuma decisão)

8 agentes, 322 chamadas, com verificação cética que **derrubou o número de título de uma frente** e corrigiu 15 outros. Dossiê em [`GATEWAY.md`](GATEWAY.md), seção 9.

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 97 | **Quem perde no chargeback** (seção 17, item 17) | Registrado como "risco aberto, sem trava no MVP" | **Não é risco difuso, é cláusula:** o contrato do candidato diz que chargeback é *"de responsabilidade exclusiva do Cliente"* — o **Corre** —, debitado da nossa conta **mesmo com documentos apresentados e recusados pelo emissor**. Multa de **R$ 99** por índice alto, **10 dias** para defender, e contestar custa ~R$ 55 num valor de R$ 10. As duas saídas estão levantadas com número; **nenhuma escolhida** | O dono mandou reportar as duas com número, não escolher. E o número que mais importa não veio da bandeira: veio do contrato |
| 98 | **O "540 dias" caiu** | Circulava como prazo de contestação | **`nao_documentado` como regra geral.** A frase existe num boletim Visa de 2021 mas está escopada a *"merchant insolvency or bankruptcy"*, e o próprio documento a estava **reduzindo**. O único teto não escopado é **120 dias** da data de processamento | Foi o verificador cético que pegou, relendo o PDF. Era o número mais fácil de um vendedor de gateway derrubar numa reunião |
| 99 | **Saldo global: a reserva é o único remédio** (seção 17, item 20) | Registrado como risco operacional a vigiar | **Confirmado literal** que um recebedor negativo trava o saque de **qualquer** outro, inclusive antecipação. E **`POST /recipients` não tem nenhum campo** de reserva, retenção, hold ou limite: **não existe isolamento**. A reserva **se financia com um mês de comissão** (≈ R$ 17.100) deixando `transfer_enabled: false` na conta do próprio Corre | O dono estava certo em chamar de arquitetura e não de risco. E a resposta é barata: o colchão sai da nossa própria comissão, sem tirar de ninguém |
| 100 | **Detectar negativo sem webhook de saldo** | A pesquisa disse que não há webhook de saldo, e a arquitetura de monitoramento proposta pelo pesquisador **era falsa** (o verificador derrubou) | **A arquitetura do projeto já resolve.** Os webhooks das **causas** existem (`charge.refunded`, `chargeback.received`, `charge.chargedback`), e como o Corre declara o split de toda cobrança, **o saldo de cada recebedor é derivável do nosso próprio log de eventos** — sabe-se do negativo no instante da causa, não quando alguém tenta sacar. `GET .../balance` vira conciliação, não detecção | É o event sourcing que já está na `main` fazendo o que o gateway não faz. O gateway não ter o recurso deixou de ser bloqueio |
| 101 | **Lojista MEI: nenhum fornecedor documenta caminho** (seção 17, item 22) | Pendência genérica de "exigências da subconta" | **Contradição documental frontal:** o `gov.br` diz *"O MEI não tem contrato social e não pode ter sócio"*, e o candidato exige **sócio qualificado no QSA**, recusando administradores e procuradores por escrito. O menos ruim é o **PagBank**, cujo campo se descreve como *"dono da conta ou sócio"* e que é o único a nomear "PJ MEI" — mas é **redação permissiva de um campo, não caminho documentado** | Em Sobral MEI é a maioria dos lojistas. Por ordem do dono, **esta pergunta pesa mais que preço na escolha do fornecedor** |
| 102 | **Um documento = um recebedor** (seção 17, item 23) | Não existia | O candidato está fechando a criação de novos recebedores com o **mesmo documento**, com ajuste retroativo da base legada anunciado. **Motoboy que também é lojista não teria as duas contas**, e "cadastrar o MEI como pessoa física" deixa de ser plano B convivente | Achado que nenhuma das frentes tinha pedido — apareceu no FAQ da mesma página que já fora lida. Em cidade do porte de Sobral, motoboy que também tem loja não é hipótese |
| 103 | **O ticket médio de mercadoria nunca foi medido** (seção 18) | A tabela de números de referência tinha frete médio, corridas/mês e comissão | Acrescentado como **segunda premissa frágil a medir no piloto**, do mesmo tamanho de "entregas por dia": é ele que dimensiona a reserva, a exposição por entrega e o teto de R$ 500 | Descoberto ao tentar dimensionar a reserva: **toda conta de risco desta especificação estava rodando com esse número suposto** |

### Decisões do dono sobre os três levantamentos

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 104 | **O retorno: dívida primeiro, cartão em último caso** (seção 9) | O retorno era **cobrado do cartão de garantia**, direto | **Dois caminhos, nesta ordem.** Normal: o retorno vira **saldo devedor do lojista**, quitado no split da próxima corrida, debitado da **parcela dele**, com o **motoboy credor como recebedor adicional** — sem tocar cartão. Último recurso: aos **30 dias** de dívida aberta, o cartão é cobrado pelo saldo inteiro, com aviso aos 15 | Escolha do dono a partir do furo que a própria análise achou: a saída "só dívida" **não elimina o cartão, adia** — e adiar piora a contestação. As duas coexistem porque cada uma cobre o que a outra não cobre |
| 105 | **Por que a ordem é essa: o índice, não o valor** (seções 9 e 14) | O chargeback estava registrado como "risco aberto" | Registrado o motivo com número: **o chargeback é debitado da conta do Corre mesmo com documentos apresentados** e recusados pelo emissor; **contestar custa ~R$ 55 numa cobrança de R$ 10** — perda garantida; e **passar do índice custa R$ 99 por ocorrência** e pode disparar **Reserva de Segurança de 90 dias**, que travaria o dinheiro de todos. **A defesa não é ganhar a disputa: é nunca chegar ao cartão** | A exposição nunca foi o valor de um retorno. É o índice, e o índice é o que dispara punição no gateway |
| 106 | **O relógio conta da dívida, não da última corrida** (seção 9) | — | **30 dias corridos a partir do lançamento do débito.** Não da última corrida | Um lojista que continuasse pedindo **só corridas de mercadoria zero** nunca teria de onde descontar, e a dívida ficaria aberta para sempre com o motoboy esperando. Contando da dívida, o buraco fecha sozinho. E **30 e não 90** porque cartão envelhece: vencido, cancelado ou trocado, e a cobrança velha **aumenta** a contestação |
| 107 | **As três pedras do caminho normal ganharam regra** (seção 9) | Levantadas como problemas, sem resposta | (a) o **motoboy credor** entra no split como recebedor adicional e **seu vínculo é com a dívida, não com a entrega**; (b) **mercadoria zero não quita e a dívida rola**, com o relógio correndo; (c) **abater dívida pretérita em split futuro não está documentado em gateway nenhum** — é a **pergunta comercial 3**, e se ninguém suportar **a arquitetura do retorno cai**, o que é **bloqueio a reportar**, não item a contornar em obra | Problema levantado sem regra escrita volta como improviso na hora da obra |
| 108 | **A reserva virou regra permanente** (seção 9) | A ideia era formar um colchão no primeiro mês com `transfer_enabled: false` | Continua nascendo assim (≈ R$ 17.100, **sem tirar de ninguém**), mas ficou escrito que **a conta do Corre nunca saca abaixo do colchão** e que **o saldo de reserva é passivo operacional, não lucro disponível** | Manobra de largada some no segundo mês; regra fica. O colchão existe para que o estorno de um lojista não impeça 66 motoboys de sacar no mesmo dia — **sacá-lo é gastar dinheiro que já tem dono** |
| 109 | **Detecção de negativo virou critério de aceite** (seção 9 e Etapa 9) | Desenho proposto no relatório | **Recebedor negativo é detectado no instante da causa, nunca na tentativa de saque** — e prova-se **desligando a consulta ao gateway** e exigindo que o log de eventos sozinho acuse o negativo. A consulta ao gateway vira conciliação | O gateway não tem webhook de saldo, mas tem os das **causas**; e o Corre declara o split de toda cobrança. É o event sourcing que já está na `main` fazendo o que o fornecedor não faz |
| 110 | **As duas premissas do piloto, juntas e com dependências marcadas** (seções 17 e 18) | "Entregas por dia" era a premissa frágil; o ticket médio nem aparecia | As duas ficam **lado a lado como a primeira medição do piloto**, com **a lista explícita do que depende de cada uma** — e a advertência de que **nenhum número derivado delas pode ser tratado como número medido**, inclusive a própria reserva de R$ 17.100 | Descoberto ao dimensionar a reserva: a conta rodava sobre um ticket suposto. Número derivado que passa por medido é como defeito conhecido e não registrado — volta em produção |
| 111 | **MEI é o maior risco aberto do projeto, acima de qualquer etapa** (seção 17) | Pendência comercial na lista | **Aviso no topo da seção 17**, com a consequência vinculante: **enquanto não houver resposta por escrito, nenhuma etapa toca fornecedor real** — obra exclusivamente contra interface falsa, sem credencial, sem chamada, sem depender de particularidade de gateway | A resposta do MEI **pode trocar o fornecedor inteiro**, e o código não pode ter que ser reescrito por isso. É a maioria do mercado de Sobral |
| 112 | **A mesa comercial tem ordem de peso** (seção 17) | Duas perguntas de preço | **Quatro perguntas, e preço é a última.** MEI, um-documento-um-recebedor e abatimento de dívida **decidem se o fornecedor serve**; o preço só importa depois que as três passarem | Escolher por preço um fornecedor que não cadastra a maioria dos lojistas é escolher errado barato |

### Etapa 4 — as cinco lacunas que a leitura de orientação achou

A sessão da Etapa 4 abriu lendo **apenas** `RETOMAR.md` e `CORRE.md`, sem conversa anterior, e reportou o que faltava **antes de escrever código**. Cinco lacunas, todas respondidas pelo dono e viradas regra.

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 113 | **Isolamento por cidade: qual mecanismo** (seção 20) | *"Consulta sem cidade não vaza dado de cidade alheia"*, sem dizer como | **Row Level Security no banco, contra o papel `corre_app`**, e **fecha por padrão**: variável não definida ⇒ nenhuma linha | Disciplina de parâmetro em consulta **não se prova por efeito** e depende de ninguém esquecer — o oposto do que o projeto decidiu na imutabilidade dos eventos e na trava de taxa. Esquecer tem que **cegar**, não vazar |
| 114 | **A armadilha do pool** (seção 20) | — | A cidade é definida **por transação** (`SET LOCAL`), nunca no `connect` nem por sessão. **Critério de aceite:** milhares de requisições concorrentes de cidades diferentes num pool e nenhuma devolve dado errado; e a conexão devolvida ao pool **não carrega** a cidade. **Controle negativo:** mover a definição para o nível da conexão fica vermelho | RLS com variável de sessão e conexão reaproveitada vaza **em silêncio e só sob carga**, que é quando ninguém está olhando. É o defeito que a bateria comum nunca acha |
| 115 | **De onde vem a cidade da requisição** (seções 10 e 20) | — | **Da sessão, nunca do corpo.** A sessão guarda a cidade do ator quando nasce; a requisição abre transação, declara a cidade e só então lê | Consequência de "sessão não confia no cliente". Também resolve o ovo-e-galinha: ler o ator para descobrir a cidade exigiria a cidade |
| 116 | **`corridas` ganha `cliente_id` na Etapa 4** | Não decidido — podia ficar para a Etapa 5 | **Agora.** A Etapa 4 é a etapa de modelo de dados | Acrescentar coluna depois, com eventos já apontando para a tabela, é caro sem motivo |
| 117 | **Telefone: espaços separados por papel** (seção 20) | A `main` já recusava telefone repetido de lojista; nada dizia sobre papéis cruzados | Telefone é único **dentro de cada papel**. O mesmo número pode ser de lojista, motoboy e cliente ao mesmo tempo. **Decisão deliberada, não omissão** — unificar depois continua sobre a mesa | **Em Sobral a mesma pessoa é lojista, motoboy e cliente**, e isso é o caso comum. O gateway força a mesma leitura pelo outro lado, com "um documento, um recebedor" |
| 118 | **Configuração de taxa é por cidade** (seções 9 e 20) | Global (migration `0009`) | **Por cidade** | A seção 20 manda não assumir cidade única — e há motivo concreto: **a carta de taxa zero nos primeiros 90 dias é inerentemente por cidade**. Replicar configuração igual é barato; transformar global em por-cidade depois é migração em tabela com dinheiro apontando |
| 119 | **O critério de aceite cobre só o que existe** (Etapas 4 e 6) | O critério da Etapa 4 citava "lojista, **motoboy** ou zona de outra cidade" — e `corridas` não tem coluna de motoboy | A Etapa 4 cobre **lojista, cliente, zona e tabela de preço**. A parte de motoboy vira **critério herdado da Etapa 6**, escrito lá com essa marca | Um terço do critério não era construível. Critério inexecutável é critério que se cumpre no papel |
| 120 | **Terceira categoria no regime de esforço** (Regime de trabalho) | Raciocínio máximo só em auditoria e caminho de **dinheiro** | Entrou **isolamento e identidade** como categoria própria, com a Etapa 4 dentro — em vez de forçar a Etapa 4 para dentro de "dinheiro" | **Vazamento entre cidades é tão grave quanto erro de centavo, e mais silencioso: ninguém reclama de ver dado que não devia.** Forçar a etapa para uma categoria errada estraga a categoria |
| 121 | **Corte da Etapa 8 em 8a e 8b** (tabela de etapas) | Uma etapa só: entrega, retorno e dívida do lojista | **8a** entrega e retorno (fluxo físico e dinheiro da corrida); **8b** dívida do lojista (saldo devedor, relógio de 30 dias com aviso aos 15, recebedor adicional no split, mercadoria zero, cartão em último caso). **8b nasce com auditoria obrigatória e esforço máximo** | A 8b é caminho de dinheiro com **concorrência real**: dívida quitando enquanto outra corrida nasce, **dois splits disputando a mesma parcela do lojista**. É a Lei 9 em estado puro. **Etapa grande esconde falso verde** — separada, ela nasce sabendo que é o risco |
| 122 | **Etapas marcadas por dependência comercial** (tabela de etapas) | — | 🔒 nas etapas que **tocam fornecedor real** e não podem sair da interface falsa: 7, 8b, 9, 11 e 14 | Sem a marca, uma sessão futura abre uma etapa travada sem perceber e descobre no meio da obra |

### Etapa 4 — o que a obra decidiu

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 123 | **A cidade em cadastro e login vem do corpo** (seção 20) | "A cidade vem da sessão, nunca do corpo" | Continua valendo em **toda requisição autenticada**. Em **cadastro e login** ela vem do corpo, porque **ainda não existe sessão** — e declarar a cidade errada ali **não vaza nada**: a política não acha a conta e o pedido falha como "não existe" | Descoberto ao construir: ler a conta para descobrir a cidade exigiria a cidade. A exceção só cega quem erra, então não é brecha |
| 124 | **Sobral tem id fixo** (migration `0010`) | — | `00000001-2312-4908-8000-000000000001`, com o IBGE nos dígitos do meio | Descobrir a cidade por consulta seria, ela mesma, **uma consulta sem cidade**. O id fixo quebra o ovo-e-galinha sem abrir exceção na política |
| 125 | **O varredor de prazos varre cidade por cidade** (seção 20) | Um processo só, varrendo tudo | Percorre as cidades e roda **dentro do contexto de cada uma**. **Não ganha atalho de "ver tudo"** | Processo de fundo com bypass viraria a porta dos fundos do isolamento. Se a política vale, vale para ele também |
| 126 | **A sessão do operador enxerga uma cidade só** (seção 20) | Não especificado | Limite declarado **até a Etapa 11**: operação em duas cidades exige duas sessões; escolher e trocar cidade no painel é da Etapa 11 | O operador não é *de* uma cidade, mas a sessão dele precisa declarar em qual está operando. Inventar o seletor antes da etapa que o especifica seria pior |
| 127 | **O autor do evento de criação do cliente** (`clientes.js`) | Seria o lojista que digitou o telefone | **Lojista quando identificado; sistema quando não.** Nunca "lojista anônimo" | O `CHECK` de autor identificado do log recusa lojista sem id — e com razão: autor sem identidade não é autor |
| 128 | **O RLS virou segunda camada e quebrou uma sabotagem antiga** (Lei 8) | A sabotagem `app_publica_preco` derrubava só o privilégio | Passou a derrubar **privilégio e política** | Com duas camadas, sabotar uma deixava a regra de pé e o teste **verde** — falso positivo. Foi o próprio script que pegou, que é exatamente para o que ele existe |

### A correção do vazamento (auditoria da Etapa 4)

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 129 | **`eventos` entrou no isolamento** (migration `0011`) | Política nas seis tabelas de projeção; **o log, que é a fonte da verdade, sem nenhuma** | `eventos` ganhou `cidade_id` **derivado do agregado por trigger** — a aplicação **não tem GRANT** para escrevê-lo — e política comparando o derivado com a cidade da transação | Valor que o chamador não fornece é valor que o chamador não forja. Escrever no log de corrida de outra cidade produz linha com a cidade dela, e o `WITH CHECK` recusa: não é verificação de código, é derivação mais política |
| 130 | **A chave de idempotência era global entre cidades** | `UNIQUE (chave_idempotencia)` | Índice único **por cidade** | Vazava **por HTTP, sem credencial nenhuma**: repetir numa cidade uma chave usada noutra devolvia 409 com o **id do agregado alheio** na mensagem |
| 131 | **`codigos_otp` também guardava telefone sem política** | Sem cidade | Mesma derivação e mesma política. **`otp_envios` fica fora DE PROPÓSITO**: o limite de SMS é da plataforma, senão a torneira de SMS pago abriria uma vez por cidade | Achado ao varrer o resto do catálogo depois do primeiro furo — quem erra numa tabela erra nas vizinhas |
| 132 | **O teste da lista de tabelas deixou de ser escrito à mão** | O teste enumerava seis tabelas, e `eventos` não estava entre elas | A lista é **descoberta no catálogo**; as que ficam fora do isolamento estão **declaradas uma a uma com motivo**. **Tabela nova sem política reprova sozinha** | Foi exatamente uma lista escrita à mão que deixou passar o furo. Um teste que enumera o que ele mesmo deveria vigiar não vigia nada |
| 133 | **Sem CHECK amarrando cidade a tipo de agregado** | — | Deliberado: evento cujo agregado **ainda não existe** não tem cidade de onde derivar, e recusá-lo viraria mudança de regra do log. **Não é buraco:** para vazar é preciso escrever no log de agregado que EXISTE em outra cidade, e aí a derivação acha a cidade certa e a política recusa | Evento órfão só enxerga a si mesmo |

### O que a Etapa 4 ensinou e virou regra (2026-08-10, na aprovação)

Quatro registros pedidos pelo dono ao aprovar a etapa. Nenhum deles é sobre cidade: são sobre **como o projeto trabalha**, tirados de três coisas que deram errado dentro de uma etapa que terminou verde.

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 134 | **Lei 10 — camada de defesa nova cega controle negativo antigo** | Nove leis. A Lei 8 exigia controle negativo por regra crítica, e presumia que uma sabotagem escrita uma vez continua valendo | **Lei 10:** ao acrescentar qualquer camada (política, trigger, constraint, privilégio), rode a **bateria inteira** de sabotagens e prove que **cada uma** continua vermelha no teste certo. As que ficarem verdes são reescritas para derrubar **todas** as camadas que protegem aquela regra | O caso está na decisão 128: o RLS da Etapa 4 virou segunda camada sobre a publicação de preço e a sabotagem da Etapa 3 parou de acusar. **A Lei 8 continuava obedecida no papel e o controle negativo estava cego** — e o modo de descobrir foi sorte, não método. Camada nova é justamente quando o dono do projeto está confiante, e confiança é quando o falso verde passa |
| 135 | **Relatório de etapa só depois da auditoria** | O método dizia quando reportar (ao fim da etapa) e não dizia **depois de quê** | Relatório sai **depois que a auditoria adversarial encerra** e os achados são confirmados por reprodução. Número reportado antes é **provisório e não vale como entrega** | Aconteceu nesta etapa: reportei 186 testes e a frase "nenhuma consulta devolve dado de outra cidade" **enquanto a auditoria ainda rodava**. Ela achou o vazamento de `eventos` em seguida. O dano não é o número desatualizado — é a **promessa central da etapa ter sido dada como verdadeira sendo falsa** |
| 136 | **Uma branch por etapa** | "Uma etapa por vez, PR separado por etapa" — na prática a branch de trabalho era fixa e os PRs se empilhavam nela | **A branch nasce com a etapa e morre no merge.** Etapa nova nunca continua a branch da anterior; se a anterior ainda não foi mesclada, a nova sai do topo dela e o PR fica em fila, mas **é PR próprio** | O PR #6 acumulou revisão de spec, trava de configuração de taxa, Etapa 4 e correção de vazamento: **39 arquivos**. Revisão humana num PR desse tamanho é teatro — o revisor aprova o conjunto porque não consegue reprovar uma parte |
| 137 | **O princípio: impossibilidade estrutural acima de disciplina** | Estava implícito em várias leis e explícito em nenhum lugar | Registrado como princípio do projeto: **não se confia em alguém lembrar.** Onde couber, a regra vira impossibilidade estrutural — configuração ruim não publica, tabela sem política nasce vermelha, evento não se apaga, coluna sem `GRANT` não se forja. Toda vez que uma proteção depender de disciplina, **procure a versão que depende do banco**; se não existir, diga em voz alta | Apareceu duas vezes seguidas na mesma etapa, das duas pontas: a trava de configuração de taxa (a regra boa, que impede a configuração ruim de existir) e a lista de tabelas escrita à mão (a regra ruim, que dependia de eu lembrar de incluir `eventos` — e eu não lembrei) |

## Etapa 5 — a máquina de estados nova e o prazo (2026-08-10)

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 138 | **Prazo é par origem-destino** | `tempo base + tempo do anel de DESTINO` | `tempo base da cidade + tempo do anel max(anel_origem, anel_destino)` | Distância é simétrica. Do Anel 2 para o Centro a viagem é a travessia inteira, e o anel de destino prometeria metade dela. **Prometer a menos é o erro caro:** o cliente espera 10 minutos, chega em 25, e o prazo criou a reclamação que existia para evitar |
| 139 | **Prazo fora de zona** | Não existia — a fórmula não cobria o caso que a própria seção 8 diz existir | `base + anel mais externo + minutos por km`, com **a mesma distância em linha reta** já calculada para o preço | Reaproveitar a distância, em vez de recalculá-la, é o que garante que preço e prazo nunca discordem sobre quão longe fica o mesmo ponto |
| 140 | **Prazo se mostra em FAIXA, nunca em ponto** | O número calculado iria para a tela | "20 a 30 minutos". Teto = menor múltiplo de 5 **estritamente maior** que o calculado; piso = teto − 10; piso abaixo de 5 ⇒ faixa 5 a 15 | Número exato vira promessa na cabeça de quem lê, e erro de três minutos vira reclamação. O "estritamente" garante teto > calculado: **a faixa nunca promete menos do que a conta disse** |
| 141 | **Tempo base sai de `cidades`** | `cidades.tempo_base_coleta_min` (Etapa 4) **e** a coluna nova na versão da tabela | Só a **versionada** | Dois lugares para o mesmo número é o começo de um dar 10 e o outro 12. Ninguém calculava com a de `cidades`. Entre um dado mutável e um versionado, ganha o que se reconstitui daqui a dois anos |
| 142 | **Override de tempo base por LOJA: não se constrói** | Parêntese solto na seção 8, sem etapa dona | Item 24 da seção 17, **sem etapa dona**. Quando a operação quiser, é uma versão nova da tabela | Construir hoje o campo que ninguém preenche é "deixar preparado", que é proibido. O versionamento existe exatamente para isso |
| 143 | **A saída da porta exige o caso declarado** | A spec dizia "o motoboy declara qual dos dois casos foi", sem forma | Lista fechada: `cliente_ausente` ou `presente_e_nao_pagou`; payload sem um dos dois é recusado | A declaração é de parte interessada e vai virar reputação do cliente (seção 12). Texto livre viraria acusação sem forma |
| 144 | **O estado 4 tem prazo e o varredor não o aplica** | — | Limite declarado: a saída do 4 exige a declaração do motoboy. Quem aplica é a **Etapa 8a**; até lá o 4 vencido aparece em `corridasParadas` | Preencher a declaração no lugar do motoboy seria fabricar prova de parte |
| 145 | **Substituição de estados sem migração, com trava** | A renumeração aconteceria em silêncio num banco com dado real | A migration **recusa rodar** se `corridas` tiver uma linha sequer | A regra "a partir do primeiro cliente real, exige caminho de migração declarado" não fica na cabeça de ninguém: vira bloco que levanta exceção |
| 146 | **Defeito real da Lei 5, achado durante a obra** | A retentativa que consultava a chave **antes** do commit da original e lia o estado **depois** recebia `transicao_ilegal` | Falhando a validação por `TRANSICAO_ILEGAL` com chave presente, o código **consulta a chave de novo** | É o caso canônico da Lei 5 — repetir a mesma operação com a mesma chave — recebendo erro por ter feito o certo. Janela estreita, e por isso traiçoeira: aparece sob carga, na rua |

### As correções da auditoria adversarial da Etapa 5

Quatro achados, todos reproduzidos por mim antes de aceitar. Os dois primeiros são o tipo de coisa que a bateria comum não pega porque **os testes ficavam verdes**.

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 147 | 🔴 **A chave de idempotência da criação era CHAVE-MESTRA** | Repetida por outro lojista, `criaCorrida` devolvia **a corrida dele** — e devolvia **antes da validação de autor**, então motoboy, cliente, painel e `sistema` recebiam o pedido alheio. O segundo pedido nunca era criado: sumia | O replay confere o **dono** (`lojista_id` no payload do evento) e devolve `chave_reutilizada` a quem não for | `contas.js` e `clientes.js` já conferiam; **só a criação de corrida estava aberta**. Era vazamento e desvio de autorização ao mesmo tempo |
| 148 | **A mensagem de reuso entregava o id alheio** | `chave já usada em outra operação (criada em corrida <id>)` | A mensagem diz o tipo e **não diz qual agregado** | Mesma classe de vazamento que a auditoria da Etapa 4 achou no 409 entre cidades: quem só acertou uma chave não pode sair com o id do pedido de outra pessoa |
| 149 | 🔴 **A "segunda camada" da invariante não era camada** | O gatilho derivava `pago_em` de `NEW.estado = 5` — e `estado` é a coluna que o **chamador escreve**. Dois `UPDATE`s com a credencial da aplicação levavam qualquer corrida a **Entregue** com o log inteiro sendo `criada`; e **um único token errado** em `transicoes.js` (a aresta 4→6 apontando para 5) derrubava as duas camadas com os **três testes INVARIANTE verdes** | `pago_em` passa a ser derivado do **FATO**: o evento `pagamento_confirmado` no log, lido por função `SECURITY DEFINER` (migration `0013`) | Duas camadas que decidem pelo mesmo número, com o mesmo dono, **caem juntas** — é a Lei 10 falhando na etapa que a escreveu. Agora uma mora na tabela de arestas e a outra no log: errar a aresta não fabrica evento de pagamento |
| 150 | **A versão da tabela vinha do payload** | `dados.tabela_preco_id \|\| tabelaVigente()` | Sempre a **vigente**; `tabela_preco_id` no payload é recusado como dado do servidor | Quem pede escolhia a promessa que a corrida ia carregar: uma versão antiga com minutos menores mostra ao cliente uma faixa que a operação já abandonou, e ainda troca a âncora de auditoria do preço |
| 151 | **"O pontual é impossível de obter" era exagero** | A spec e a migration diziam que o privilégio de coluna tornava o valor pontual do prazo inalcançável | Corrigido para o que a trava realmente faz: impede vazamento **por descuido** (`SELECT *` falha, coluna nova nasce invisível). **Recalcular o número a partir das coordenadas do log continua possível**, e isso é limite declarado | Guardar as coordenadas é o que torna o prazo auditável. Trocar auditoria por sigilo de um número que é só estimativa seria mau negócio — mas afirmar impossibilidade que não existe é pior que não ter a trava |
| 152 | **Uma corrida envenenada parava a varredura da cidade** | Qualquer erro fora dos dois esperados abortava o laço de `expiraVencidas` | O erro é **registrado** e a varredura segue; se a lista **inteira** falhar, aí sim sobe — porque não é uma corrida ruim, é o varredor quebrado | A chave determinística do varredor pode ser queimada por um chamador (defeito aberto, capítulo 3). Enquanto isso não se resolve, uma corrida não pode parar o vencimento de todas as outras |
| 153 | **Guarda de estouro do prazo no número errado** | `Number.MAX_SAFE_INTEGER`, enquanto a coluna é `INTEGER` | Teto de sanidade de **um ano de minutos**, com `ErroDeDominio` | Daqui para cima não é corrida longa, é coordenada errada — e o certo é dizer isso, não estourar cru no `INSERT` |

## Lei 11 — id não é autorização (2026-08-10)

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 157 | **Lei 11** | Dez leis. Nenhuma dizia que receber um id não é receber permissão | **Toda função de domínio que recebe um identificador confere de quem ele é antes de operar.** Tipo de ator não é ator. Vale para chave de idempotência, resposta repetida e mensagem de erro. **Função exportada sem chamador segue a mesma regra** | Quatro furos da varredura, todos executados: a chave de criação devolvia a corrida de outro lojista **antes** da validação de autor; `transiciona` conferia o tipo e nunca o autor; a chave de transição dava replay a autor diferente; e `reivindica` tomava conta de cliente por id, **sem chamador nenhum** |
| 158 | **O padrão, registrado** | — | A Etapa 2 passou não por cuidado, mas porque ali **a identidade estava no dado conferido** (CPF, telefone). Onde o id sozinho pareceu bastar, não bastou em lugar nenhum | **Id é endereço, não credencial.** Sem isso escrito, cada etapa nova redescobre o mesmo buraco |
| 159 | **Enumeração no cadastro fechada** | `cpf_ja_cadastrado` e `telefone_ja_cadastrado` respondiam **409** — qualquer um descobria se um CPF é motoboy do Corre | Cadastro responde **sempre 202**, como o OTP. Colisão só se revela a quem **prova ser dono**, pelo código de 6 dígitos que já existe | Erro que revela existência é vazamento. Custa uma tela a mais no cadastro duplicado, que é raro, e fecha a enumeração. *Decisão do dono, 2026-08-10* |

## A rodada da Lei 11 — o que foi corrigido, e uma decisão revertida (2026-08-10)

### As chaves de replay: o que cada uma passou a conferir

A chave de idempotência dizia "mesma operação" e conferia só **tipo + agregado**. Faltava conferir os **dados** — e sem isso a segunda operação era engolida em silêncio, com o chamador achando que ela aconteceu. Todas reproduzidas executando antes de corrigir.

| Função | O que a chave NÃO conferia | O que passou a conferir | O que acontecia |
|---|---|---|---|
| `criaCorrida` | o **dono** | `lojista_id` no payload | A chave repetida por outro lojista devolvia **a corrida dele**, antes da validação de autor |
| `transiciona` | o **autor** | `autor_id` no payload | Dois aparelhos com a mesma chave recebiam ambos "venceu": um motoboy cria que aceitou a corrida de outro |
| `autorizaEstornoSemEfeito` | a **corrida** | `corrida_id` no payload | Mesmo operador, mesma chave, outra corrida → replay; **o segundo estorno nunca foi registrado** |
| `registraCartao` | o **cartão** | `cartao_ref` | Cartão novo com chave reaproveitada → replay; o cartão B nunca entrou |
| `trocaAparelho` | o **aparelho** | as mudanças pedidas | Aparelho novo com chave reaproveitada → replay; o motoboy ficava preso ao aparelho antigo |
| `criaOperador` | o **telefone** | `telefone` | Telefone e papel diferentes → devolvia **o primeiro operador**; o segundo nunca foi criado |

*As três últimas não estavam na varredura original: apareceram quando o dono mandou "aplique a Lei 11 e verifique se existe uma terceira". Não havia uma terceira — havia três.*

### Decisão revertida: cadastro sempre 202

| # | Tema | Aprovado em | Revertido em | Motivo |
|---|---|---|---|---|
| 160 | **Cadastro respondendo sempre 202 para fechar a enumeração** | 2026-08-10, com a estimativa de que custaria "uma tela a mais no cadastro duplicado" | 2026-08-10, no mesmo dia, pelo dono | **O custo real é outro.** Se o cadastro novo devolve token e o repetido não, **a diferença entre as duas respostas É a enumeração** — meia fechadura não fecha nada. Fechar de verdade exige que o cadastro **pare de emitir sessão para todo mundo**, tornando o login passo obrigatório sempre. Isso é **atrito no cadastro do motoboy**, a peça que menos pode ter atrito na largada. A tentativa foi implementada e abriu 20 falhas na bateria — não por defeito, mas porque o desenho mudava de verdade. Revertida antes de virar entrega |

*Registro do processo, porque é o mais útil aqui:* o dono aprovou um meio-termo com uma estimativa de custo, a implementação mostrou que a estimativa estava errada, e a decisão voltou à mesa **antes** de ser mesclada. É o que a exigência de "prove executando" serve para produzir.

### Correções da varredura adversarial da própria revisão

Cinco lentes independentes sobre os documentos reescritos, cada achado passando por um verificador cético. **23 defeitos sobreviveram** — todos corrigidos no mesmo PR. O que eles pegaram:

| # | Tema | Antes | Depois | Motivo |
|---|---|---|---|---|
| 76 | **Lei 6** | "Dinheiro só se move em **transição de estado** registrada" | "...em **evento registrado**: transição de estado **ou evento compensatório do painel com autor identificado**" | Com o split liquidado na porta, o estorno acontece **depois do estado final**, e estado final é final. Pela redação antiga, todo estorno violava a Lei 6 por construção |
| 77 | **Valor do estorno** (seção 9) | "o estorno sai 100% da parcela do lojista" | **Ao cliente volta a mercadoria integral; o frete não é tocado; a diferença é de quem deu causa**, decidida no painel com motivo | A parcela do lojista já veio **menos a taxa** — devolver "100% da parcela" devolveria ao cliente menos do que ele pagou, e a diferença ficava sem dono |
| 78 | **Valor do retorno** (seção 9) | Não existia em lugar nenhum, e era critério de aceite da Etapa 8 | **O retorno vale o frete da corrida**, sem comissão de 5% | A viagem foi feita e é o frete que a paga. Cobrar comissão de uma entrega que não aconteceu seria ganhar com o fracasso |
| 79 | **Meio de cobrança do cartão** (seções 9, 14, 17) | O cartão de garantia virou a rede de proteção do modelo, mas os requisitos de gateway só cobriam Pix — e a seção 14 dizia "só Pix no MVP" | Entrou na lista de capacidades exigidas: **cobrança de cartão do lojista com repasse direto à subconta do motoboy**, sem passar pela conta do Corre. E a linha de antifraude foi corrigida: **o cartão do lojista tem chargeback**, e isso é risco aberto (item 17) | "Só Pix" era falso desde que o retorno passou a ser cobrado de cartão |
| 80 | **Prazo do QR e saída do estado 4** (seção 4) | O QR não tinha validade, e nada dizia o que acontece se o pagamento confirma **depois** de a corrida virar retorno | QR vale **5 minutos** (o mesmo relógio da espera na porta, não é número novo), pode ser regerado sem estender a espera; e **toda saída do estado 4 sem pagamento cancela a cobrança ANTES de gravar a transição** — par cancelamento × confirmação é caso de Lei 9 na Etapa 7 | Sem isso existe uma corrida real: o cliente paga no segundo em que a corrida morre, e o dinheiro cai num pedido que não existe mais |
| 81 | **Gatilhos das arestas 3→6 e 4→6** (seção 4) | A aresta 3→6 era legal e nada dizia o que a dispara | 3→6 é **endereço não localizado ou cliente inalcançável antes da chegada**, com motivo registrado; 4→6 é a espera vencida, com o motoboy declarando **ausente × presente e não pagou** | Aresta legal sem gatilho é aresta que ninguém sabe construir |
| 82 | **"Estava presente" saiu dos fatos objetivos** (seção 12) | A nota do cliente tinha "**dois fatos objetivos** — pagou na porta, estava presente" | Um fato **observado** (pagou/não pagou, que o backend sabe) e um motivo **declarado pelo motoboy**, marcado como declaração de **parte interessada** | O sistema não observa presença. Chamar de fato objetivo o que é palavra de uma das partes é o começo de uma injustiça automatizada |
| 83 | **Quais estados ocupam vaga** (seção 6) | "Teto: 2 ativas", sem dizer o que conta como ativa | Ocupam vaga os estados **2, 3, 4 e 6**; **não ocupam 5 e 7** | O 5 dura segundos e travaria o motoboy por uma entrega já paga; o 7 é decisão de painel e pode demorar dias |
| 84 | **Telefone digitado errado** (seção 10) | Nada | Número **mascarado** na confirmação; corrigir antes do aceite é grátis; e **falta de pagamento só entra na reputação de conta já reivindicada** pelo dono do número | É o erro mais provável do fluxo, e criava conta e nota má no nome de um estranho |
| 85 | **A ponte web e a janela de disputa** (seção 2) | A ponte "morre com a corrida", mas o prazo de disputa é de 24h | Sobrevive **24h em só leitura, com o comprovante**. Abrir disputa sem app continua impossível — **buraco declarado**, e ampliar a ponte é decisão do dono (item 16) | A única prova do cliente sem app sumia no instante em que a corrida acabava |
| 86 | **Dependências para trás nos critérios** (seções 7, 17 e tabela de etapas) | O critério da Etapa 8 exigia aviso por chat (Etapa 10) e o da Etapa 9 ignorava a taxa | O aviso da Etapa 8 é o **evento gravado**, não o canal; o fechamento da Etapa 9 passou a incluir **a taxa retida pelo gateway**; o "par confirmação/expiração" da Etapa 7 virou **cancelamento × confirmação**, que é o par que existe de verdade | Critério que depende de etapa futura é critério inexecutável |
| 87 | **Referências quebradas pela renumeração** | RETOMAR dizia que a primeira etapa travada é a 7 e travava a 5 na própria tabela; omitia o estado 5 da lista sem prazo; dispensava auditoria na Etapa 4; decisão 34 citava a 41; decisão 12 apontava para a Etapa 4 | Tudo corrigido. A **Etapa 5 roda com a tabela de exemplo**, como a Etapa 3 fez, e as pendências T e 5 travam só o **valor real**. A **auditoria da Etapa 4 é obrigatória** — ela estende o login por código ao cliente | Renumerar 13 etapas para 18 quebra referência em silêncio. Foi a varredura que pegou, não a leitura |

---

# 2. Achados de auditoria adversarial

A auditoria adversarial roda agentes independentes que **atacam** o código executando (banco e API reais), e cada achado passa por um verificador cético que tenta refutá-lo antes de aceitar. Registro aqui o que ela encontrou — **nenhum destes apareceu na bateria comum**, e é por isso que ela continua obrigatória nas etapas de dinheiro e segurança.

| Etapa | Agentes | Reportados | Confirmados | Achados que a bateria comum não pegou |
|---|---|---|---|---|
| 0 | 16 | 12 | 8 | `OVERRIDING SYSTEM VALUE` permitia ao app forjar `id` e `criado_em` do evento (ordem do log reescrita); controle negativo aceitava vermelho por motivo alheio; teste de integridade tautológico (`count(DISTINCT id)` em coluna IDENTITY) |
| 1 | 16 | 12 | 11 | **Replay idempotente sequencial quebrado** — a retentativa que chega depois do commit recebia `transicao_ilegal` em vez do resultado original (Lei 5 no caso canônico "a rede caiu"); matriz exaustiva não vigiava o **conjunto** de transições (aresta-backdoor passava 100% verde); asserção fraca na trava de boot (qualquer falha passava por "recusa"); log podia nascer com buraco na sequência |
| 2 | 25 | 21 | 19 | **Sessão sobrevivia ao bloqueio e à troca de aparelho** por até 30 dias (celular perdido continuava logado; motoboy bloqueado por fraude seguia operando); invariantes de dinheiro só no código (primeiro saque e cartão de garantia burláveis por INSERT direto); stack trace e caminho de arquivo vazando ao cliente; chave de idempotência reusada com dados de outra pessoa devolvia **a conta alheia** |
| 3 + re-auditoria do OTP | 19 | 16 | 13 | **Piso por eixo antes do teto** cobrava a menos que a distância real (R$ 1,50 a menos num caso reproduzido); desvio da spec no centro de referência; **cap de 5 tentativas do OTP furado sob concorrência** (lost update: 50 palpites simultâneos, todos avaliados — força bruta viável); **limite de envio de SMS furado** (check-then-insert) |
| 4 — multi-cidade e cliente | 6 | 14 | 1 vazamento + achados menores | **`eventos` ficou FORA do isolamento.** A migration pôs política nas seis tabelas de PROJEÇÃO e esqueceu a tabela que a Lei 2 declara ser a FONTE DA VERDADE: sem cidade declarada, `lojistas` devolvia 0 linhas e `eventos` devolvia tudo — nome, telefone, CPF, endereço. E a ESCRITA era pior: dava para anexar evento no log de corrida de outra cidade, e como a Lei 3 proíbe apagar, o estrago era **irreversível** — a corrida alheia passava a morrer em conflito de posição para sempre. Vazava também por HTTP sem credencial: a chave de idempotência era global, e o 409 entregava o id do agregado da outra cidade |
| 5 — máquina de estados e prazo | 6 | 11 | 4 | **A chave de idempotência da criação era chave-mestra:** repetida por outro lojista devolvia a corrida DELE, antes da validação de autor — motoboy, cliente, painel e `sistema` recebiam o pedido alheio, e o segundo pedido sumia. **A "segunda camada" da invariante não era camada:** `pago_em` derivava de `NEW.estado = 5`, coluna que o chamador escreve — dois `UPDATE`s levavam qualquer corrida a Entregue com log só de `criada`, e um token errado em `transicoes.js` derrubava as duas camadas **com os três testes INVARIANTE verdes**. Mais: a versão da tabela de preço/prazo vinha do payload (quem pede escolhia a promessa), e a afirmação de que o valor pontual do prazo era inalcançável estava exagerada |
| Varredura da Lei 9 (retroativa) | 4 | — | — | Varreu todos os caminhos de escrita da `main`: **os dois do OTP eram os únicos vulneráveis**; todo o resto protegido pelo banco (UNIQUE de seq, UNIQUE de chave, trigger anti-buraco, índice da gênese, PK do token) |
| Revisão de 2026-08-09 (a própria spec) | 10 | 63 | 23 | Primeira vez que a auditoria adversarial rodou sobre **documento**, não sobre código, com cinco lentes: máquina de estados, dinheiro (refazendo as contas na calculadora), referências cruzadas, restos da versão antiga e buracos de produto. Achou: **Lei 6 violada por construção** pelo próprio estorno que a revisão criou; **estorno de "100% da parcela do lojista" que devolve ao cliente menos do que ele pagou**; **5% de frete ímpar sem regra de arredondamento**; **QR sem prazo e pagamento que confirma depois de a corrida morrer**; **"só Pix no MVP" falso** desde que o retorno virou cobrança de cartão; **valor do retorno inexistente** sendo critério de aceite; e uma dúzia de referências quebradas pela renumeração de 13 para 18 etapas. Decisões 76 a 87 |

## Falha de processo registrada

Na Etapa 3 a auditoria do OTP foi deixada rodando **em paralelo** com a obra, violando "obra e auditoria nunca em paralelo". Agentes de auditoria sabotam arquivos e banco para provar o controle negativo, e isso contaminou uma rodada de testes (uma sabotagem vazou na árvore de trabalho e apareceu como falha inexplicada). Corrigido isolando a etapa, mesclando a correção em árvore limpa e refazendo tudo single-threaded. A regra está no `CORRE.md`.

---

# 3. Defeitos abertos e limites aceitos

Registro exigido pelo dono: defeito conhecido e não registrado é defeito que volta em produção. Cada entrada tem data, descrição, risco e o motivo de não corrigir. **Entrada só sai daqui por decisão registrada — nunca por apagamento.**

*(Este capítulo era o arquivo `DEFEITOS_ABERTOS.md`, incorporado aqui na reorganização de 2026-08-09. Nenhuma entrada foi alterada.)*

## 2026-08-10 — A chave determinística do varredor pode ser queimada por um chamador (Etapa 5, aberto)

`expiraVencidas` usa a chave `vencimento:<corrida_id>:<seq>` para ser idempotente entre varredores concorrentes. Ela é **derivável**: quem souber o id e o seq de uma corrida pode gravar um evento com essa chave antes do varredor e, a partir daí, aquele vencimento nunca mais se aplica àquela corrida — a chave está queimada para sempre, porque é determinística.

**O que já foi feito:** o varredor deixou de **abortar a cidade inteira** por causa de uma corrida assim (decisão 152). Antes, uma única corrida envenenada parava o vencimento de todas as outras.

**O que continua aberto:** a corrida envenenada não vence. Ela aparece em `corridasParadas` e vira trabalho de gente. Corrigir de verdade exige repensar a chave (por exemplo derivá-la de algo que o chamador não escreve, ou marcar o evento do varredor com um autor que só ele usa e conferir isso no replay) — e isso é mexer no núcleo da Lei 5, que é código da Etapa 1 já na `main`. Vai em **PR próprio**, pela regra do regime de trabalho.

## 2026-08-10 — O teto de km é aplicado sobre o PISO da raiz inteira (Etapa 3, aberto)

`distanciaEscalada` termina numa raiz inteira **por piso** (`isqrt`), e só depois `kmTeto` arredonda para cima. Num ponto que caia **exatamente** na fronteira de um quilômetro, o piso da raiz pode empurrar o valor para baixo da fronteira e o teto devolver **1 km a menos** — cobrando por menos distância e prometendo menos tempo do que a regra declarada manda.

O erro é de um km no pior caso e só na fronteira exata, mas ele **desobedece a regra escrita** ("o único arredondamento do caminho é o teto de km"), e agora contamina **preço e prazo** ao mesmo tempo.

**Não se corrige aqui:** é código do motor de preço, da Etapa 3, já na `main`, e já existe uma correção da Etapa 3 pendente (matriz 6×6, travada na tabela real de Sobral). As duas viajam juntas, em PR próprio.

## 2026-08-10 — O valor pontual do prazo é recalculável (Etapa 5, limite declarado)

A aplicação **não tem privilégio de ler** `corridas.prazo_minutos`, e isso torna impossível vazá-lo por descuido: `SELECT *` falha e coluna nova nasce invisível. Mas as **coordenadas e a versão da tabela estão no log**, que a aplicação lê — então quem chamar o motor de prazo de novo chega ao mesmo minuto.

É deliberado, e a auditoria fez bem em derrubar a redação anterior, que afirmava impossibilidade. Guardar as coordenadas é o que torna o prazo auditável anos depois; trocar isso por sigilo de um número que é **estimativa** seria mau negócio. Fica registrado para que ninguém confunda "não vaza por descuido" com "ninguém consegue saber".

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
- **Agravado em 2026-08-09 (revisão do pagamento):** o SMS deixou de servir
  só ao re-login. É por ele que o **cliente novo recebe o link para pagar**
  (ponte web, seção 2). **Sem provedor não existe primeira compra** — o
  defeito saiu de "falta para o lançamento" e virou "falta para o produto
  funcionar". Continua não bloqueando etapa de backend, mas bloqueia a
  Etapa 14.
- **Estado:** aberto, aceito até o lançamento (ponto em aberto **9** da
  seção 17 — era o item 8 antes da renumeração).

## 2026-08-09 — Estados vivos intermediários ainda não têm prazo

- **Descrição:** a regra do projeto diz que "nenhuma corrida fica presa em
  estado vivo para sempre: todo estado vivo tem prazo e destino", mas a
  tabela da seção 4 marca prazo "Etapa 8" para os estados **2** (a caminho
  da loja), **3** (com a mercadoria), **5** (pago — com a proibição de fechar
  por decurso de prazo escrita na própria célula) e **6** (em retorno).
  Uma corrida nesses estados só sai dali por ação do motoboy ou
  cancelamento da operação — se o motoboy sumir, ela fica viva
  indefinidamente. *(Antes da revisão do pagamento eram os estados 3, 4 e
  5, e o prazo era a Etapa 7.)*
- **O estado 5 é o pior dos quatro:** o dinheiro **já foi dividido** e o
  único fato em aberto é se a mercadoria mudou de mão. Fechar em Entregue
  por decurso de prazo está **proibido** (decisão 49b) — seria carimbar
  como entregue uma corrida que talvez não tenha sido.
- **Risco:** **mudou de natureza com a revisão de 2026-08-09.** Encolheu de
  um lado — nesses estados **não há mais dinheiro de terceiro retido**,
  porque nada foi pago ainda. Cresceu do outro: há **mercadoria de
  terceiro na mão do motoboy**, que é pior de perder de vista do que um
  valor congelado num gateway, porque não tem quem devolva sozinho.
- **Motivo de não corrigir agora:** os prazos operacionais desses estados
  (espera na porta de 5 min + 1 aviso, retorno) são regra da **Etapa 8** —
  defini-los antes seria inventar valor sem especificação.
- **Mitigação ativa:** cancelamento pela operação (2, 3, 4, 6 → 10) já
  existe e exige motivo registrado; e a consulta `corridasParadas`
  (`corre-api/src/dominio/corridas.js`, coberta por teste) lista toda
  corrida em estado vivo há mais de 24 horas — corrida esquecida nunca
  fica invisível (medida provisória exigida pelo dono em 2026-08-09).
- **Estado:** aberto, aceito até a Etapa 8.

## 2026-08-09 — A confirmação de pagamento não prova a entrega física

- **Descrição:** com o fim do PIN (decisão 33), a prova de entrega passou a
  ser o pagamento confirmado pelo banco. Ele prova que o cliente estava na
  porta e que a cobrança foi quitada, com valor e horário — **não prova que
  a mercadoria mudou de mão.** Entre a transição para Pago e o motoboy
  confirmar a entrega existe uma fresta de segundos em que o dinheiro já
  foi dividido e a mercadoria ainda está com ele.
- **Risco:** motoboy recebe a confirmação, marca entregue e sai com a
  mercadoria. O cliente pagou e não recebeu.
- **Motivo de não corrigir:** a alternativa é reintroduzir uma prova do
  lado do cliente (PIN, foto, assinatura), e cada uma delas devolve o
  atrito que a revisão tirou — com o motoboy parado na porta. Foto está
  fora de escopo (seção 16).
- **Mitigação ativa:** disputa de 24h (seção 11) com o chat imutável como
  prova (seção 19); reputação do motoboy nas duas pontas (seção 12);
  bloqueio imediato por fraude, sem aviso. O padrão aparece rápido porque
  a fresta só rende se for repetida.
- **Estado:** aberto, aceito — foi o preço declarado de tirar o PIN.

## 2026-08-09 — O motoboy pode exibir um QR de cobrança próprio

- **Descrição:** o QR é exibido na tela do app do motoboy. Nada impede que
  ele mostre, em vez disso, um QR Pix pessoal — de outro app, ou impresso —
  e receba o valor da mercadoria direto do cliente.
- **Risco:** o cliente paga, a loja não recebe, e a mercadoria já está com
  o motoboy. É o vetor de fraude **novo** que o pagamento na porta criou, e
  o maior deles.
- **Motivo de não corrigir por completo:** não há como impedir alguém de
  mostrar uma imagem na tela de um aparelho que é dele.
- **Mitigação ativa:** (a) a corrida **só anda com a confirmação que o
  backend recebe** — cobrança por fora não fecha corrida nenhuma, ela vira
  retorno; (b) o cliente com app ou com o link do SMS vê a cobrança **vinda
  do backend**, com valor e recebedor, e é essa a via recomendada na tela;
  (c) o retorno cai no cartão do lojista e o padrão aparece na operação;
  (d) reincidência é fraude, e fraude é bloqueio imediato (seção 12).
- **Estado:** aberto, aceito com mitigação. É critério de aceite da Etapa
  16: *cobrança que não nasceu no backend não fecha corrida.*

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
