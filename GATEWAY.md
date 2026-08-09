# GATEWAY — a escolha reaberta

**Este documento levanta opções e refaz a conta da Lei 7. Não escolhe.** A escolha é do dono, e **ainda não pode ser feita**: duas respostas comerciais por escrito faltam (perguntas **A** e **B** adiante), e são elas que decidem se o candidato melhor colocado passa ou cai.

Substitui o [`PORTAO-C.md`](PORTAO-C.md), que morreu quando o pagamento foi para a porta do cliente.

Levantamento de 2026-08-09 por 9 agentes (4 de pesquisa + 4 verificadores céticos + 1 consolidador), 390 chamadas de ferramenta. Cada afirmação foi reaberta na fonte oficial por um segundo agente antes de ser aceita; o que não se confirmou está marcado como `nao_documentado` — inclusive coisas que o pesquisador havia dado como certas.

---

## 1. O que se está escolhendo agora

Mudou tudo desde o levantamento anterior. O fornecedor precisa de:

**Três critérios eliminatórios:**

| | Critério | Por quê |
|---|---|---|
| **A** | **Pix percentual, nunca fixo** | A comissão é 5% do frete; custo fixo não se ajusta a ela |
| **C** | **O dinheiro nunca encosta na conta do Corre** | Res. BCB 494/2025 — guardar dinheiro de terceiro é ser instituição de pagamento |
| **D** | **De quem sai a taxa tem que ser declarável** | A taxa incide sobre mercadoria + frete; a receita é 5% do frete. Sem este parâmetro, o modelo dá prejuízo |

**E quatro capacidades:** QR Pix dinâmico por API · confirmação por webhook **e** consulta ativa · split de **3 recebedores** na mesma cobrança · subconta para **lojista e motoboy**.

**A custódia deixou de ser requisito.** Era o Portão C inteiro. Hoje é peso morto.

## 2. O mais barato que atende

> ### **PAGAR.ME (Stone), API Core v5**
>
> **Pix 1,19% percentual** e — único do grupo — um parâmetro **nomeado, por recebedor**, que concentra a taxa percentual num participante só: `options.charge_processing_fee` dentro de cada item do array `split`.
>
> Frase oficial, reconferida na fonte: *"Se o intuito for que apenas um dos recebedores arque com a taxa percentual deve-se configurar o parâmetro como `true` para um deles e `false` para o(s) outro(s)."*
>
> **Com `true` só na regra do lojista, a comissão de 5% do frete chega intacta e a margem do Corre fica imune ao valor da mercadoria.**

**Não é a escolha final.** O critério (A) está **formalmente em aberto** para ele: a própria Central de Ajuda diz *"PIX — valor percentual ou de taxa fixa, a depender do seu contrato"*. O 1,19% é preço de tabela, não garantia de modelo. Ver as perguntas A e B da seção 6.

## 3. A conta da Lei 7, em centavos

Split alvo: **mercadoria integral → lojista** · **frete − 5% → motoboy** · **5% do frete → Corre**. Frete de R$ 10,00 nos dois cenários, logo a comissão é sempre **50 c**. Taxa de referência **1,19%** (preço de tabela publicado do Pagar.me e do Efí).

### Cenário 1 — mercadoria R$ 100 + frete R$ 10

Total no QR: **11.000 c**. Split: lojista 10.000 · motoboy 950 · Corre 50 (soma exata). Taxa: 11.000 × 1,19% = **131 c**.

| De quem sai a taxa | Lojista | Motoboy | **Corre** |
|---|---|---|---|
| **Do lojista** (`charge_processing_fee` só nele) | 9.869 | 950 | **+50 c** |
| Proporcional (todos) | 9.881 | 939 | **+49 c** |
| **Do Corre** (Efí `assumir_total`; PagBank sempre) | 10.000 | 950 | **−81 c** |

### Cenário 2 — mercadoria R$ 500 + frete R$ 10

Total no QR: **51.000 c**. Split: lojista 50.000 · motoboy 950 · Corre 50. Taxa: 51.000 × 1,19% = **607 c**.

| De quem sai a taxa | Lojista | Motoboy | **Corre** |
|---|---|---|---|
| **Do lojista** | 49.393 | 950 | **+50 c** |
| Proporcional | 49.405 | 939 | **+49 c** |
| **Do Corre** | 50.000 | 950 | **−557 c** |

### O número que fecha o argumento

Com a taxa saindo do Corre, o ponto de equilíbrio é `5% × frete ≥ 1,19% × (mercadoria + frete)`, ou seja **mercadoria ≤ 3,2 × frete**. Com frete de R$ 10, o Corre só não tem prejuízo em pedidos de **mercadoria até ~R$ 32**. Acima disso todo pedido dá prejuízo, e **o prejuízo cresce linearmente com o valor da mercadoria enquanto a receita fica travada em R$ 0,50**. Uma entrega de farmácia de R$ 500 custaria R$ 5,57 do bolso do Corre.

É por isso que o critério (D) é eliminatório de fato, e não de forma.

### O limite duro que nenhum parâmetro resolve

*"As taxas fixas de antifraude e gateway só podem ser cobradas do Marketplace… eles foram programados para aceitar regras de split para as taxas percentuais e não para as taxas fixas."*

**Qualquer componente fixo da tarifa cai obrigatoriamente no Corre e não pode ser empurrado para ninguém.** Um fixo de R$ 0,99 por Pix já vira 50 c de receita contra 99 c de custo insplitável — prejuízo em toda entrega, em todo cenário. É o que torna o critério (A) duplamente eliminatório: **preço fixo não é só caro, é insplitável.**

### O caso da mercadoria zero

Quando o lojista cria a corrida com **mercadoria zero** (venda já acertada fora — seção 3 do `CORRE.md`), **não existe parcela de lojista de onde debitar a taxa**. Total 1.000 c, taxa 12 c, split de dois. A taxa passa a sair do Corre: **50 − 12 = 38 c**, ou 3,8% do frete. **Continua positivo sempre**, porque 1,19% do frete é muito menor que 5% do frete. É o único desenho em que a taxa cai no Corre e ainda assim fecha.

## 4. Ranking

| # | Fornecedor | Veredito |
|---|---|---|
| **1º** | **Pagar.me** (Stone) | **Passa em A, C e D.** 1,19%; `options.charge_processing_fee` por recebedor; recipient com CPF/CNPJ, conta própria e prova de vida; split em `flat`; QR dinâmico com `qr_code`; consulta ativa `GET /charges/{id}`; webhook `charge.paid`; **e — único do grupo — estorno PARCIAL de Pix com split reenviável**, prazo de 90 dias. **Pendências:** contrato pode ser fixo em vez de percentual; taxa fixa não é splitável; exige contrato **PSP/afiliação**; taxa de saque e custo de criar recebedor `nao_documentado` |
| **2º** | **Efí** | **Cai só no critério D — e é o que decide.** Empata em 1,19% sem tarifa fixa no produto `cob`/`cobv`, tem a melhor documentação de QR dinâmico do grupo, conta e saque via Pix **grátis** para o titular (o melhor custo de saque de todos), e split de até 20 contas. Mas o **único** valor de `divisaoTarifa` na doc oficial é `assumir_total` — a palavra "proporcional" **não aparece** em página oficial nenhuma, só em fórum. Com a doc na mão: quem emite paga a taxa inteira. **Agravante independente:** *"A devolução de Split Pix debita apenas da conta integradora"* — um estorno de R$ 110 sairia inteiro da conta do Corre enquanto lojista e motoboy ficam com o dinheiro. **Volta ao 1º lugar** se um teste de 10 minutos em homologação provar que `proporcional` existe — e ainda assim "proporcional" não é "taxa toda no lojista" |
| **3º** | **PagBank** | **Cai no critério D.** Passa em A (percentual, teto 1,89%) e em C (split de até 15 recebedores com liquidação direta; **custódia é opcional** — basta não enviar `configurations.custody.apply`). Tem a melhor ferramenta operacional do grupo: cria conta por API e simula a taxa antes de cobrar. Mas: *"O responsável pelas taxas e tarifas sobre o valor total da transação… é o recebedor primário"*, **sem parâmetro alternativo**. Com o Corre como primário: −R$ 1,58 e −R$ 9,14 nos dois cenários, no teto. E é o mais caro dos que passam |
| **4º** | **iugu** | **Preço do Pix não é público** — impossível fechar a conta da Lei 7. E **no Pix só existe estorno integral** (*"não são permitidos reembolsos parciais"*), o que é fatal para recusa na porta. Quem paga a taxa também não é parâmetro, é comportamento: paga quem criou a transação |
| **5º** | **Mercado Pago** | **Eliminado pelo critério C.** O produto público é split **1:1**; o 1:N *"está disponível apenas para vendedores de carteira assessorada"*. Com 1:1, pagar lojista + motoboy + Corre na mesma cobrança é impossível sem o frete parar na conta da plataforma. **Ironia a registrar:** o desenho de taxa dele é o melhor de todos (a comissão já sai do vendedor). Se o 1:N for liberado comercialmente, ele volta a ser o candidato mais forte |
| **6º** | **Woovi / OpenPix** | **Eliminado pelo critério C, com frase literal na doc:** *"O valor do split não será debitado da conta de origem pois transações de split para sub contas são transações virtuais"* — o valor cheio cai e **permanece** na conta do Corre, e o débito só ocorre quando a subconta saca. É exatamente o desenho proibido. Sintoma que confirma: criar subconta exige **só nome e chave Pix**, zero KYC. Isso não é conta de terceiro, é carteira virtual. **Dói eliminar:** tem o menor percentual do mercado (0,80%) |
| **7º** | **Asaas** | **Eliminado pelo critério A**, reconfirmado: **R$ 1,99 fixo** por Pix recebido. Quase 4× a comissão, e por ser fixo piora quanto menor o pedido |

## 5. A consequência de negócio que o dono precisa engolir

**"Comissão zero sobre a mercadoria" deixa de ser literal.** A taxa não some — **muda de bolso**. Com a taxa no lojista:

| Pedido | O lojista recebe | Em % da mercadoria |
|---|---|---|
| Mercadoria R$ 20 + frete R$ 10 | R$ 19,64 | 1,79% |
| Mercadoria R$ 100 + frete R$ 10 | R$ 98,69 | 1,31% |
| Mercadoria R$ 500 + frete R$ 10 | R$ 493,93 | 1,21% |

O percentual efetivo **piora em pedido pequeno**, porque o lojista paga a taxa sobre o total, frete incluído. Isso precisa ser dito ao lojista **antes** de assinar e estar no contrato de adesão. O argumento comercial a favor: **é menos do que qualquer maquininha que ele já usa**, e o Corre continua sem tirar comissão nenhuma da mercadoria.

**Alternativa não investigada, que é escolha do dono e não do fornecedor:** embutir a taxa no total cobrado do cliente final, elevando o valor do QR. Muda o preço na ponta.

## 6. O que falta para poder escolher

**Confirmações comerciais, por escrito. Nada disto pode ser assumido.**

| | Pergunta | O que ela decide |
|---|---|---|
| **A** | *"O Pix do nosso contrato será cobrado em percentual ou em taxa fixa?"* | **O critério A.** Se vier fixo, o Pagar.me está desclassificado |
| **B** | *"A linha 'Taxa por transação' incide sobre Pix? É valor fixo? Quanto?"* | **A viabilidade econômica.** Taxa fixa não é splitável; um fixo de R$ 0,99 derruba a operação inteira |
| C | *"Qual o valor da taxa por saque?"* | A periodicidade de saque do motoboy — com frete líquido de R$ 9,50, saque por corrida come o ganho |
| D | *"Existe custo para criar um recebedor?"* | O CAC, com centenas de motoboys e lojistas. Ausência de documentação não é gratuidade |
| E | *"Confirmam o contrato PSP / afiliação, e em quanto tempo?"* | Condição de entrada — sem PSP o split não existe |
| F | *"Qual o limite de recebedores por split na v5?"* | `nao_documentado` na referência. Três é o caso canônico, mas peça o número |

**Testes de homologação que valem mais que este relatório inteiro — faça antes de assinar:**

- **Pagar.me:** criar um pedido Pix em sandbox com os três splits em `flat` (10000 / 950 / 50), `charge_processing_fee` e `liable` **`true` só no lojista**, pagar, e **conferir no extrato se o Corre recebeu exatamente 50 c**. Atenção à regra oficial: *"Pelo menos um dos recebedores deve ter `liable` como `true`, o mesmo vale para `charge_processing_fee`"* — não deixe os três `false`.
- **Efí:** `POST /v2/gn/split/config` com `divisaoTarifa: "proporcional"` e ver se retorna o erro oficial *"O tipo especificado para a divisão de tarifa é invalido."* Dez minutos que decidem entre margem e prejuízo, caso ela volte à mesa.

## 7. Coisas que a pesquisa achou e que viraram regra de produto

Não são sobre o fornecedor — são sobre como o Corre tem que se comportar, com qualquer um deles.

1. **O webhook não pode ser a fonte que libera a mercadoria na porta.** A política de retentativa publicada do Efí chega a **160 minutos**, e o webhook chega no servidor do Corre, não no aparelho do motoboy. **O caminho primário é consulta ativa** (`GET` da cobrança, de 2 em 2 ou 3 em 3 segundos enquanto o QR está na tela); o webhook é aceleração e reconciliação de retaguarda. Isso está na spec, seção 3.
2. **Estorno de mercadoria não pode tocar o frete.** Se o cliente recusa a mercadoria depois de pagar, a entrega **foi prestada** — o frete é do motoboy e a comissão é do Corre. O estorno tem que sair **100% da parcela do lojista**, e o split precisa ser **reenviado explicitamente** no cancelamento: *"do contrário, as regras definidas na autorização serão aplicadas de forma automática ao cancelamento"* — ou seja, esquecer de reenviar **tira dinheiro do motoboy e do Corre**. Virou regra da seção 9 do `CORRE.md`.
3. **O motoboy roda antes de poder sacar.** No Pagar.me o recebedor nasce em `registration` e *"estará apto a transacionar mesmo antes de enviar a prova de vida"*, mas só movimenta saldo em `active`. **O app tem que mostrar o estado do KYC e não prometer saque antes disso** — senão ele trabalha, vê saldo e não consegue tirar. Análise em até 24h; o link de KYC expira em 20 minutos.
4. **Saque agregado é obrigatório, não opcional.** A tarifa de saque é fixa e sai do titular; com R$ 9,50 líquidos por corrida, sacar a cada corrida come o ganho. Armadilha a monitorar: recebedor sem movimento por 60 dias **tem a transferência automática desabilitada sem aviso**.
5. **Lojista PJ precisa do sócio do QSA, não do gerente.** O `managing_partner` *"deve ser um sócio registrado no Quadro de Sócios e devidamente qualificado no QSA"*; administradores e procuradores não são aceitos (Circular BCB 3.978/20). Em Sobral isso significa **o dono da loja em pessoa** — planeje o esforço de campo.

## 8. Pendência jurídica

Validar com advogado se o desenho escolhido mantém o Corre fora do papel de instituição de pagamento sob a **Res. BCB 494/2025**. No desenho Pagar.me o Corre é **um dos três recebedores** e recebe só os 5% do frete — o valor cheio nunca fica com ele, que é exatamente o que o critério (C) exige. Nos desenhos alternativos (Efí ou iugu com o **lojista** emitindo a cobrança), o Corre passa a **orquestrar emissão com credencial de terceiro**, o que é figura diferente e precisa de parecer próprio.
