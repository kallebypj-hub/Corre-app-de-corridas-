# PORTÃO C — quando o split ocorre

**Status: ABERTO. Decisão do dono. Bloqueia a Etapa 4 inteira.**

Levantamento feito em 2026-08-09 por 11 agentes de pesquisa (5 de busca + 5 verificadores céticos + 1 consolidador), 518 consultas, com verificação em documentação oficial de 24 fornecedores. Cada afirmação abaixo foi aberta na fonte por um segundo agente antes de ser aceita; o que não se confirmou está marcado.

**Este documento levanta opções. Não escolhe.**

---

## 1. O conflito

A especificação exige (seção 4): o dinheiro fica **retido** do estado 2 ao 6 e o **split só dispara na transição para Entregue** (PIN validado). No meio existem três saídas em que o dinheiro precisa voltar **integral** ao cliente: "sem motoboy" (estorno automático), cancelamento e disputa.

Nos gateways brasileiros, o padrão é o **split ocorrer na confirmação do pagamento**. Se o dinheiro já foi dividido e já caiu na subconta do motoboy, o estorno fica sem lastro.

## 2. Resposta curta

1. **Split postergado existe, mas é raro** e tem nome diferente em cada casa. Quem tem retenção nomeada com liberação por comando: **PagBank ("Custódia")** e **Asaas ("Conta Escrow")**. Quem permite criar o split **depois** do pagamento: **Zoop** ("a posteriori") e **Barte** ("Split Pós-Transação"). Quem agenda por data/dias: **Transfeera**.
2. **Dividem no ato e não oferecem nada equivalente:** Pagar.me, Mercado Pago, Iugu, Efí, Woovi, Celcoin, Malga, Bankly.
3. **O Asaas — o único que casava perfeitamente com a spec — está desclassificado pelo Portão A** (ver adiante).

## 3. Achado que muda a Etapa 4: o Asaas está fora

O Asaas tem exatamente o recurso que a spec pede (Conta Escrow: retém na subconta e libera por `POST /v3/escrow/{id}/finish`). Mas o **Pix dele é cobrado por transação, valor fixo**:

> **R$ 1,99 por transação recebida** (R$ 0,99 promocional por 3 meses) — página oficial de preços, verificada em 09/08/2026.

Num frete de R$ 10, isso é **19,9% do ticket e ~4× a comissão inteira do Corre (R$ 0,50)**. Pela regra do Portão A ("gateway que cobra fixo por transação é descartado"), o Asaas sai. Agrava: em estorno, **a tarifa não é devolvida** — cada corrida que morre em "sem motoboy" custaria R$ 1,99 do bolso do Corre.

*(A alegação de "100 transações mensais gratuitas", que circula em blog, **não consta** da página oficial de preços — foi rebaixada pelo verificador. Não usar em cálculo.)*

## 4. Gateways — split postergado × preço do Pix recebido

| Fornecedor | Split postergado | Recurso / limite | Pix recebido | Portão A |
|---|---|---|---|---|
| **PagBank/PagSeguro** | **sim** | "Custódia" (`HELD`→`RELEASED`, `POST /splits/{id}/custody/release`); **90 dias** padrão, **365** com `scheduled` | percentual **com teto de 1,89%** (FAQ oficial) | **passa** |
| **Asaas** | sim (escrow) | "Conta Escrow" (`daysToExpire` + `POST /v3/escrow/{id}/finish`); granularidade em **dias** | **FIXO R$ 1,99/transação** | **DESCLASSIFICADO** |
| **Zoop** | parcial | split "a posteriori", janela até a 1ª liquidação (Pix em D+1 útil) | não publica preço | indefinido |
| **Barte** | sim | "Split Pós-Transação" | não publica preço | indefinido |
| **Transfeera** | sim | agendado por data/dias (`split_days_after_settled`) — granularidade em **dias** | não publica preço | indefinido |
| **Efí** | **não** | "lançamentos só podem ser feitos de forma imediata" | **1,19% percentual**, e **Pix enviado grátis** | **passa** |
| **Pagar.me** | não (split na criação da transação) | — | 1,19% numa página de ofertas; um verificador não conseguiu reconfirmar → **a confirmar** | provável |
| Mercado Pago, Iugu, Woovi, Malga | não | — | não confirmado publicamente | indefinido |
| Celcoin, Bankly, Dock, Swap (BaaS) | escrow por data/teto, não por evento | — | **nenhum publica preço**; Celcoin ainda tem mensalidade SaaS | **Lei 7 impede integrar** sem a conta escrita |

**Consequência da Lei 7:** para a maioria (BaaS e white-label) **não é possível escrever a conta de custo por corrida** antes de negociação comercial. Só **Efí** e **PagBank** têm preço público e percentual verificável hoje.

## 5. Os 8 caminhos possíveis

| | Caminho | Quem tem o dinheiro no meio | O que muda na máquina de estados | Risco no estorno |
|---|---|---|---|---|
| **A** | **Escrow/custódia no gateway** (retém e libera por comando) | **O gateway** — creditado à subconta do motoboy mas bloqueado | Estados 2–6 mantêm "Retido" ao pé da letra, mas a retenção vira **objeto externo com id** que nasce em 1→2 e precisa ser reconciliado | **O menor entre os que têm split.** Residual: PagBank exige que todos os recebedores tenham saldo para reverter |
| **B** | **Recebe 100% na conta do Corre, transfere na entrega** | **O CORRE** — dinheiro de terceiro na conta da plataforma (~R$ 340 mil/mês em regime) | "Retido" muda de significado: retido **na nossa conta**, não no gateway. Estado 7 vira ordem de transferência com retentativa e conciliação | **O menor de todos** — nunca houve divisão; estorno é só devolução do Pix, com lastro garantido |
| **C** | **Split no ato + estorno posterior** (débito na subconta) | **O MOTOBOY**, desde a confirmação do Pix, e sacável | Menos código novo e **o que mais quebra a spec**: a coluna "Retido" dos estados 2–5 vira ficção | **É o furo do Portão C, e não é teoria:** 7 fornecedores documentam falha por saldo insuficiente. Se o motoboy sacou, o estorno não roda |
| **D** | **Split a posteriori** (criar o split depois do pagamento, dentro da janela do recebível) | **O gateway**, em recebível ainda não dividido | **O encaixe mais literal com a spec escrita** — melhor até que o escrow: estados 2–5 ficam genuinamente "retido, sem split"; estado 6 genuinamente congelado | **O segundo menor**: na maioria dos estornos o split simplesmente nunca existiu. Janela é curta (Zoop: até a liquidação, D+1 útil) |
| **E** | **Split agendado por data/dias** (Transfeera) | A Transfeera | **Não serve:** adiamento é por **dias**, o ciclo de uma corrida é de **minutos**, e não há endpoint "liberar agora" | O pior depois de executar: o split **é um Pix enviado** para outra instituição — não existe débito compulsório de volta |
| **F** | **Pré-autorização de cartão** (autoriza sem split, captura com split no PIN) | **NINGUÉM** — só limite bloqueado no cartão do cliente | Conceitualmente perfeito: nos estados 2–6 não há dinheiro de terceiro em lugar nenhum | O mais baixo (cancelar autorização não devolve nada) |
| **G** | **Mover o Pix para depois do aceite** (não cobrar enquanto não houver motoboy) | Depende do caminho com que for combinado | Inverte a aresta 1→2 da spec: passa a existir "procurando motoboy **sem pagamento**" | **Elimina a maior fonte de estorno** (2→9, a única que roda sozinha) |
| **H** | **BaaS com conta individualizada por motoboy + transferência interna no PIN** | **O CORRE**, na conta da plataforma dentro do BaaS | Igual ao B nos estados 2–6; estado 7 vira transferência interna (a mais barata e rápida) | Baixo enquanto o dinheiro não sai (devolução de Pix em até 90 dias) |

### Impedimentos duros já identificados

- **E (Transfeera)** e **F (cartão)** estão praticamente eliminados por fatos, não por gosto: E por granularidade (dias × minutos); F porque **cartão de crédito do cliente final está fora do escopo** (seção 16) e o custo reprova a Lei 7 (crédito à vista 4,39%–5,59% = **88% a 112% da comissão**).
- **C** é o único que quebra a spec escrita frontalmente.
- **G** não é um caminho sozinho — é um **modificador** que se combina com A, B, C, D ou H, e o risco dele é de produto: o cliente pode ficar com a mercadoria coletada e o pagamento pendente.

## 6. Quem paga a transferência ao motoboy — e o "1 saque grátis por dia"

Esta é a consequência que o dono pediu explícita. **A promessa da seção 9 ("1 saque grátis por dia, extras com taxa") não é nossa para prometer na maioria dos caminhos:**

| Caminho | Quem paga o saque | "1 saque grátis/dia" é nosso? |
|---|---|---|
| **A** (escrow no gateway) | O motoboy, pela tabela do gateway. No PagBank o saque roda **fora da nossa API** — não conseguimos nem **contar** quantos saques ele fez | **Não.** Tarifa, contagem e período são do gateway |
| **B** (conta do Corre) | **O Corre, sempre** — é a conta PJ da plataforma que ordena o Pix | **Sim** — é o único em que a promessa volta a ser 100% nossa |
| **C** (split no ato) | O motoboy. Pagar.me, literal: *"As taxas de saque sempre são cobradas da conta do recebedor que realiza a transferência bancária"*. Woovi cobra R$ 1,00 abaixo de R$ 500 — e o repasse de R$ 9,50 está **sempre** abaixo | **Não.** E as contagens não são diárias: Asaas dá 30/mês para PJ |
| **D** (a posteriori) | Não documentado, mas Zoop e Barte deixam **escolher para quem jogar a taxa** (`charge_processing_fee`) | Não |
| **H** (BaaS) | **O Corre** — a tarifa de Pix out é contratada por nós | **Sim** — vantagem específica deste caminho |

**Ponto que precisa de confirmação contratual, não de pesquisa:** no Asaas o Pix de saída é *"Grátis"* para **pessoa física** e *"30 grátis/mês, depois R$ 2,00"* para **pessoa jurídica**. Se a subconta de um MEI é tratada como PF ou PJ decide entre R$ 0,00 e R$ 2,00 por saque — a 34.000 corridas/mês, é a diferença entre viável e proibitivo. **Não documentado.**

## 7. Risco regulatório (eixo Banco Central)

- **Caminhos A, D** (dinheiro fica no PSP): risco **mais baixo**. O Corre não custodia recursos de terceiros, o frete cheio não passa pelo caixa, e a tese de "intermediação de tecnologia" com **NFS-e só sobre a comissão** (seção 15) se sustenta.
- **Caminhos B e H** (dinheiro na conta da plataforma): risco **mais alto**. Manter recursos de terceiros em conta própria é a descrição da atividade de **instituição de pagamento**. A pesquisa levantou a **Res. BCB 494/2025, art. 9º**, que passou a exigir autorização do BCB para iniciar a prestação de serviço de pagamento. **Isto precisa de advogado, não de mais pesquisa.**
- **Caminho C**: mais baixo no eixo BCB, mais alto no eixo do consumidor (cliente sem estorno com lastro).

## 8. O que preciso que o dono decida

1. **Qual caminho** (A, B, C, D, H, ou uma combinação com G).
2. **Se a promessa "1 saque grátis por dia" (seção 9) se mantém.** Nos caminhos A, C e D ela **não é nossa para prometer** — ou se muda a spec, ou se escolhe B/H e se aceita o risco regulatório.
3. **Se a Etapa 4 pode ser construída "gateway-agnóstica"** enquanto o fornecedor não é escolhido. *(Recomendação técnica: a interface fake já prevista comporta A, B, C e D sem reescrita, desde que a máquina de estados trate a retenção como objeto com id externo — o desenho do caminho A, que é o superconjunto.)*

## 9. Limites desta pesquisa

- Preço público existe em **poucos** fornecedores. Onde não existe, a Lei 7 **impede integrar** antes de negociar e escrever a conta.
- Duas passagens independentes divergiram sobre o preço do Pix da **Pagar.me** (1,19% × não reconfirmado) e do **Mercado Pago** — tratados como **a confirmar**.
- Prazo-limite de estorno de Pix no Asaas: os "90 dias" que circulam **não foram confirmados** em fonte oficial.
- Nada aqui substitui proposta comercial assinada nem parecer jurídico sobre a Res. BCB 494/2025.
