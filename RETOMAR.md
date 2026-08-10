# RETOMAR — leia isto primeiro

Página de retomada do **Corre**. Uma sessão nova lê este arquivo, depois o [`CORRE.md`](CORRE.md), e trabalha a partir da `main`. A conversa anterior **não** faz parte da verdade do projeto. Registro histórico (por que as coisas são como são): [`HISTORICO.md`](HISTORICO.md).

**Regime:** uma sessão por etapa, **uma branch por etapa, um PR por etapa** — abre no prompt da etapa, fecha no merge. Raciocínio máximo em auditoria adversarial e nas três categorias de caminho: **dinheiro** (7, 8b, 9, 11), **isolamento e identidade**, **autenticação e autorização** (`CORRE.md`, regime de trabalho).

**Duas regras que se esquecem com facilidade:** **Lei 11** — id não é autorização: toda função que recebe um identificador confere de quem ele é, inclusive em chave de idempotência e em mensagem de erro. E **Lei 10** — camada de defesa nova cega controle negativo antigo, então ao acrescentar política/trigger/constraint/privilégio, rode a bateria inteira de sabotagens de novo. E **relatório de etapa só sai depois que a auditoria adversarial encerra** — número reportado antes é provisório e não vale como entrega.

---

> ## ⚠️ A especificação mudou em 2026-08-09
>
> **O pagamento saiu do começo do fluxo e foi para a porta do cliente**, por QR Pix dinâmico no app do motoboy, com a **mercadoria dentro da cobrança** e **split triplo**. O motivo: o cliente que compra pela primeira vez não tem app nenhum, e cobrar antes travava a primeira compra.
>
> **Isso invalidou:** a Etapa 4 que estava planejada (não existe mais), o Portão C e a escolha do PagBank, a tabela de estados da Etapa 1, e o PIN.
> **Isso criou:** três apps, chat interno, reputação do cliente, prazo estimado e multi-cidade.
>
> Antes de trabalhar, leia a seção 4 (máquina de estados) e a 9 (dinheiro) do `CORRE.md`. O antes→depois inteiro está no `HISTORICO.md`, decisões 30 a 137.

## Onde o projeto está

| | |
|---|---|
| **Etapas na `main`** | 0, 1, 2, 3 e **4 (multi-cidade e cliente, PR #6 mesclado em 2026-08-10)** |
| **O que a revisão invalidou** | **Etapa 1:** o motor vale, **a tabela de estados não** — é reescrita na Etapa 5. **Etapa 2:** vale, falta o cliente como ator. **Etapas 0 e 3:** valem |
| **Fila de PRs, nesta ordem** | **#9 (Lei 11) → #8 (matriz de preço) → Etapa 6.** Decidida em 2026-08-10 e não é sugestão: o #9 fecha um buraco de autorização, e a Etapa 6 depende do #8 para o sistema parar de prometer tempo de travessia e cobrar preço de destino |
| **Situação do PR #9 — Lei 11** | **aberto, obra completa, em auditoria.** A aplicação em `transiciona` fechou: vínculo do cliente, existência do autor nos quatro papéis, `'sistema'` só por caminho interno e o autor conferido **antes** do replay. A bateria deixou de ser cega — gerava autor inexistente em todos os eventos. Os cinco achados e a prova estão no `HISTORICO.md`, capítulo 3 |
| **Situação do PR #8 — matriz de preço** | **próximo da fila, NÃO travado.** Roda com a tabela de exemplo, como a Etapa 3 fez; a tabela real de Sobral entra depois, sem mudar código. Leva junto o teto de km sobre o piso da raiz e a chave do varredor |
| **Próxima etapa** | **6 — Despacho**, e ela **abre pelo vínculo do motoboy com a corrida** (`CORRE.md`, tabela de etapas): pré-requisito, não sugestão de ordem |
| **Situação da Etapa 5** | **aprovada, no PR #7 apontado para a `main`, CI verde.** 11 estados novos, 14 arestas, prazo par origem-destino em faixa. A auditoria achou 4 defeitos, dois deles com os testes verdes — o pior era a chave de idempotência da criação funcionar como chave-mestra entre lojistas. Todos corrigidos (migration `0013`) |
| **Situação da Etapa 4** | **mesclada.** RLS por cidade no banco, cliente como quarto ator, cidade na sessão. Auditoria adversarial feita — ela achou um vazamento (o log de eventos ficou fora do isolamento) e ele foi corrigido na migration `0011` |
| **Primeira etapa travada** | **7 — Cobrança na porta.** Trava na escolha do gateway e em *quem paga a taxa*. A pesquisa está feita ([`GATEWAY.md`](GATEWAY.md)); faltam **duas respostas comerciais por escrito**. As Etapas 4, 5 e 6 rodam sem nada disso — a 5 usa a tabela de exemplo, como a Etapa 3 fez |
| **Última bateria verde** | **237 testes**, 0 falhas · controle negativo: **82 sabotagens**, todas vermelhas no teste certo |
| **PRs mesclados** | #1 Etapa 0 · #2 Etapa 1 · #3 Etapa 2 · #5 correção de segurança do OTP · #4 Etapa 3 · **#6 revisão da spec + Etapa 4** |

## O que já está na `main`

**Migrations** (`corre-api/migrations/`): `0001` domínio centavos · `0002` eventos append-only · `0003` corridas + sequência + idempotência · `0004` log sem buraco · `0005` cadastro e sessão · `0006` travas no banco · `0007` re-login OTP · `0008` zonas e preço · `0009` trava de configuração de taxa · `0010` multi-cidade, RLS e cliente · `0011` o log dentro do isolamento · `0012` máquina de estados nova e prazo · `0013` o pagamento vem do log.

**Domínio** (`corre-api/src/dominio/`): `transicoes.js` (tabela declarativa, 14 arestas) · `corridas.js` (motor de estados, prazos, `corridasParadas`) · `contas.js` (motoboy, lojista, operador, painel) · `otp.js` (re-login) · `preco.js` (motor de preço) · `prazo.js` (motor de prazo e a faixa) · `split.js` (split triplo e trava de taxa) · `cidades.js` (pool por cidade, RLS) · `clientes.js` (o quarto ator) · `nucleo.js` (transação, replay, disputa de posição) · `estados.js`, `cpf.js`, `erros.js`.

**HTTP** (`corre-api/src/http/`): `api.js` (cadastro, sessão, painel) · `sessoes.js` (token, revalidação contra conta viva) · `sms.js` (interface, sem provedor real). Ponto de entrada: `src/servidor.js` (recusa subir com credencial de dono/superusuário).

**Garantias que o banco impõe** (não o código): `UNIQUE (agregado, seq)` arbitra concorrência · `UNIQUE (chave_idempotencia)` · trigger anti-buraco no log · `eventos` sem `UPDATE`/`DELETE` nem para o dono · CPF válido e chave Pix = CPF · primeiro saque nasce travado por `DEFAULT` · corrida exige lojista ativo com cartão · operador exige evento de cadastro · gênese única.

## Como rodar

```bash
cd corre-api && npm ci
npm run bateria            # banco nasce do zero das migrations + 237 testes
npm run controle-negativo  # 82 sabotagens; cada uma tem que ficar vermelha no teste certo
```
Precisa de PostgreSQL 16 em `localhost:5432` com superusuário `postgres`/`postgres`. A bateria **derruba e recria** o banco `corre_teste` — nunca aponte para um banco que importa.

## Pendências de decisão do dono

| # | Pendência | Trava o quê |
|---|---|---|
| **1** | **Escolha do gateway — pesquisada, falta decidir.** O mais barato que atende é o **Pagar.me**; falta a resposta por escrito de duas perguntas comerciais (Pix percentual ou fixo no contrato? existe "taxa por transação" sobre Pix?). Enquanto não vierem, o critério (A) está formalmente em aberto. Ver [`GATEWAY.md`](GATEWAY.md) | **Etapa 7** |
| **2** | **Quem paga a taxa do gateway.** Recomendação: debitar da parcela de mercadoria — o lojista recebe R$ 98,69 num pedido de R$ 100 e **precisa saber antes de assinar**. Alternativa: embutir no total cobrado do cliente | **Etapa 7** — e a viabilidade do modelo |
| **T** | **Tabela real de Sobral não está no repositório** — agora com duas colunas: preço por anel **e minutos por anel** | **Correção da Etapa 3** e os **valores reais** do prazo. **Não trava a Etapa 5**: ela roda com a tabela de exemplo, como a Etapa 3 |
| 5 | Tempo base de coleta (o outro número do prazo estimado) | Valor real; a Etapa 5 roda com valor de exemplo |
| 13 | Teto de faltas de pagamento que bloqueia um cliente | Etapa 12 |
| 14 | Confirmar que o retorno por cliente que não pagou sai do cartão do lojista | Etapa 8 |
| 9 | Provedor real de SMS — **virou pré-requisito do produto**: sem ele o cliente novo não recebe o link para pagar | Etapa 14 e lançamento |
| 8 | Registro da marca e do domínio `corre.com.br` — **pré-requisito de publicação**, porque `br.com.corre.*` é definitivo | Publicação nas lojas |
| 12 | Redação da frase de posicionamento (a antiga ficou falsa) | Lançamento |
| 3 | Valor do adicional por km fora de zona | Preço real |
| 6 | Taxa zero nos primeiros 90 dias | Lançamento |
| 7 | Teto de R$ 500 de valor de mercadoria | Etapa 16 |
| 10, 11 | Custo do saque; e **como cadastrar lojista MEI**, que não tem quadro de sócios e a doc não explica. *(A parte que travava — subconta de pessoa física — foi verificada: **todos os candidatos aceitam PF**, e o melhor colocado deixa o motoboy receber antes do KYC)* | Lançamento |
| 15 | Revisão jurídica das cláusulas de controle + risco novo da seção 15 | Lançamento |
| **22** | 🔴 **LOJISTA MEI — o maior risco aberto do projeto.** MEI não pode ter sócio por lei, o candidato exige sócio no QSA, e **nenhum fornecedor documenta caminho**. Em Sobral MEI é a maioria | **Trava fornecedor real em TODAS as etapas.** Até responder, tudo é construído contra interface falsa |
| **23** | **Um documento = um recebedor:** quem é motoboy **e** lojista não teria as duas contas | Escolha do gateway |
| **3'** | **Abatimento de dívida pretérita em split futuro é suportado?** Não está documentado em gateway nenhum | **A arquitetura do retorno.** Se ninguém suportar, o caminho normal cai |
| 1, 2 | Pix percentual ou fixo no contrato; e se existe "taxa por transação" sobre Pix | Etapa 7 — **preço é a última pergunta da mesa** |
| **P** | **As duas premissas do piloto:** entregas/dia por motoboy **e ticket médio de mercadoria** (nunca medido). Sustentam toda conta da spec, inclusive a reserva | Primeira medição do piloto |
| 18, 19 | KYC reprovado depois de receber; e o tamanho definitivo do colchão de reserva | Etapa 11 e operação |

**Limites aceitos que ainda constrangem obra** (detalhe no `HISTORICO.md`, capítulo 3): estados **2, 3, 5 e 6** sem prazo até a **Etapa 8** (mitigado por `corridasParadas`) — o **5 (Pago) é o pior**, porque o dinheiro já foi dividido, e fechar em Entregue por decurso de prazo está **proibido**; a confirmação de pagamento não prova a entrega física; o motoboy pode exibir um QR próprio; nenhum provedor real de SMS nem de pagamento.

## Próximo passo exato

**Etapa 6 — Despacho: cascata, timer de 30s, regras de recusa**, em sessão nova, **branch nova e PR próprio**.

1. Critério da etapa: 50 aparelhos disputando a mesma corrida resultam em **exatamente 1 aceite**; cascata de 5 min sem aceite leva a Sem motoboy **sem nenhum movimento de dinheiro**; 4 recusas seguidas → offline por 15 min; teto de 2 corridas ativas (ocupam vaga os estados **2, 3, 4 e 6**; não ocupam 5 e 7).
2. **Critério herdado da Etapa 4:** corrida cujo **motoboy** seja de outra cidade é recusada **pelo banco** — é aqui que `corridas` ganha coluna de motoboy, e a chave composta tem que vir junto.
3. Lei 9 em todo caminho novo de escrita; **Lei 10 ao final**; controles negativos por regra crítica, com **commit antes de rodar**; auditoria adversarial **antes** do relatório.
4. Nada de fornecedor real, nada da seção 16, nada de "deixar preparado".

Depois dela: **Etapa 7** (cobrança na porta), que **não começa** antes das respostas da mesa comercial — MEI à frente de tudo.

## Correções em PR próprio, pendentes

| O quê | Onde está | Por que não entrou na etapa |
|---|---|---|
| **Preço é par origem-destino** (matriz 6×6 de anéis) | Etapa 3, `preco.js` | Travada na tabela real de Sobral. **O prazo já é par origem-destino; o preço ainda não** — a assimetria está declarada |
| **Teto de km sobre o piso da raiz** | Etapa 3, `preco.js` | Código já na `main`; viaja junto com a correção acima (`HISTORICO.md`, capítulo 3) |
| **Chave determinística do varredor pode ser queimada** | Etapa 1, `corridas.js` | Mexe no núcleo da Lei 5. O efeito pior — parar a varredura da cidade inteira — já foi contido, e o PR #9 fechou a outra metade: a chave derivável não **entrega** mais o evento do sistema a quem a acertar. Sobra poder **queimá-la** |
