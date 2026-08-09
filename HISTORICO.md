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
| 34 | **Espera na porta** (seção 7) | 5 min com **1 ligação registrada** no app | 5 min com **1 aviso registrado** — chat para quem tem app, SMS para quem não tem | Sem telefone exposto (decisão 41), a ligação deixou de ser possível |

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
| 49 | **Prazos provisórios** (seção 4) | Estados 3, 4 e 5 sem prazo até a Etapa 7 | Estados **2, 3 e 6** sem prazo até a **Etapa 8**. `corridasParadas` continua obrigatória | Renumeração. O risco **encolheu** (não há mais dinheiro de terceiro retido) mas **não sumiu**: há mercadoria de terceiro na mão do motoboy, que é pior de perder de vista |

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
  da loja), **3** (com a mercadoria) e **6** (em retorno). Uma corrida
  nesses estados só sai dali por ação do motoboy ou cancelamento da
  operação — se o motoboy sumir, ela fica viva indefinidamente.
  *(Antes da revisão do pagamento eram os estados 3, 4 e 5, e o prazo era
  a Etapa 7.)*
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
