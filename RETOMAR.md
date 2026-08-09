# RETOMAR — leia isto primeiro

Página de retomada do **Corre**. Uma sessão nova lê este arquivo, depois o [`CORRE.md`](CORRE.md), e trabalha a partir da `main`. A conversa anterior **não** faz parte da verdade do projeto. Registro histórico (por que as coisas são como são): [`HISTORICO.md`](HISTORICO.md).

**Regime:** uma sessão por etapa — abre no prompt da etapa, fecha no merge. Raciocínio máximo só em auditoria adversarial e nas etapas de dinheiro (7 e 9).

---

> ## ⚠️ A especificação mudou em 2026-08-09
>
> **O pagamento saiu do começo do fluxo e foi para a porta do cliente**, por QR Pix dinâmico no app do motoboy, com a **mercadoria dentro da cobrança** e **split triplo**. O motivo: o cliente que compra pela primeira vez não tem app nenhum, e cobrar antes travava a primeira compra.
>
> **Isso invalidou:** a Etapa 4 que estava planejada (não existe mais), o Portão C e a escolha do PagBank, a tabela de estados da Etapa 1, e o PIN.
> **Isso criou:** três apps, chat interno, reputação do cliente, prazo estimado e multi-cidade.
>
> Antes de trabalhar, leia a seção 4 (máquina de estados) e a 9 (dinheiro) do `CORRE.md`. O antes→depois inteiro está no `HISTORICO.md`, decisões 30 a 64.

## Onde o projeto está

| | |
|---|---|
| **Etapas na `main`** | 0 (fundação), 1 (máquina de estados), 2 (cadastro e sessão + re-login OTP), 3 (zonas e preço) |
| **O que a revisão invalidou** | **Etapa 1:** o motor vale, **a tabela de estados não** — é reescrita na Etapa 5. **Etapa 2:** vale, falta o cliente como ator. **Etapas 0 e 3:** valem |
| **Próxima etapa** | **4 — Multi-cidade e o cliente como ator** |
| **Situação da Etapa 4** | **liberada** — não depende de gateway nem da tabela real |
| **Primeira etapa travada** | **7 — Cobrança na porta.** Trava na escolha do gateway e em *quem paga a taxa*. A pesquisa está feita ([`GATEWAY.md`](GATEWAY.md)); faltam **duas respostas comerciais por escrito** |
| **Pendência paralela** | **Correção da Etapa 3** — preço é par origem-destino (matriz 6×6 de anéis). **PR próprio, travado:** falta a tabela real de Sobral |
| **Última bateria verde** | 152 testes, 0 falhas · controle negativo: 34 sabotagens, todas vermelhas no teste certo |
| **PRs mesclados** | #1 Etapa 0 · #2 Etapa 1 · #3 Etapa 2 · #5 correção de segurança do OTP · #4 Etapa 3 |

## O que já está na `main`

**Migrations** (`corre-api/migrations/`): `0001` domínio centavos · `0002` eventos append-only · `0003` corridas + sequência + idempotência · `0004` log sem buraco · `0005` cadastro e sessão · `0006` travas no banco · `0007` re-login OTP · `0008` zonas e preço.

**Domínio** (`corre-api/src/dominio/`): `transicoes.js` (tabela declarativa — **será reescrita na Etapa 5**) · `corridas.js` (motor de estados, prazos, `corridasParadas`) · `contas.js` (motoboy, lojista, operador, painel) · `otp.js` (re-login) · `preco.js` (motor de preço) · `nucleo.js` (transação, replay, disputa de posição) · `estados.js`, `cpf.js`, `erros.js`.

**HTTP** (`corre-api/src/http/`): `api.js` (cadastro, sessão, painel) · `sessoes.js` (token, revalidação contra conta viva) · `sms.js` (interface, sem provedor real). Ponto de entrada: `src/servidor.js` (recusa subir com credencial de dono/superusuário).

**Garantias que o banco impõe** (não o código): `UNIQUE (agregado, seq)` arbitra concorrência · `UNIQUE (chave_idempotencia)` · trigger anti-buraco no log · `eventos` sem `UPDATE`/`DELETE` nem para o dono · CPF válido e chave Pix = CPF · primeiro saque nasce travado por `DEFAULT` · corrida exige lojista ativo com cartão · operador exige evento de cadastro · gênese única.

## Como rodar

```bash
cd corre-api && npm ci
npm run bateria            # banco nasce do zero das migrations + 152 testes
npm run controle-negativo  # 34 sabotagens; cada uma tem que ficar vermelha no teste certo
```
Precisa de PostgreSQL 16 em `localhost:5432` com superusuário `postgres`/`postgres`. A bateria **derruba e recria** o banco `corre_teste` — nunca aponte para um banco que importa.

## Pendências de decisão do dono

| # | Pendência | Trava o quê |
|---|---|---|
| **1** | **Escolha do gateway — pesquisada, falta decidir.** O mais barato que atende é o **Pagar.me**; falta a resposta por escrito de duas perguntas comerciais (Pix percentual ou fixo no contrato? existe "taxa por transação" sobre Pix?). Enquanto não vierem, o critério (A) está formalmente em aberto. Ver [`GATEWAY.md`](GATEWAY.md) | **Etapa 7** |
| **2** | **Quem paga a taxa do gateway.** Recomendação: debitar da parcela de mercadoria — o lojista recebe R$ 98,69 num pedido de R$ 100 e **precisa saber antes de assinar**. Alternativa: embutir no total cobrado do cliente | **Etapa 7** — e a viabilidade do modelo |
| **T** | **Tabela real de Sobral não está no repositório** — agora com duas colunas: preço por anel **e minutos por anel** | **Correção da Etapa 3** e o prazo estimado da Etapa 5 |
| 5 | Tempo base de coleta (o outro número do prazo estimado) | Etapa 5 |
| 13 | Teto de faltas de pagamento que bloqueia um cliente | Etapa 12 |
| 14 | Confirmar que o retorno por cliente que não pagou sai do cartão do lojista | Etapa 8 |
| 9 | Provedor real de SMS — **virou pré-requisito do produto**: sem ele o cliente novo não recebe o link para pagar | Etapa 14 e lançamento |
| 8 | Registro da marca e do domínio `corre.com.br` — **pré-requisito de publicação**, porque `br.com.corre.*` é definitivo | Publicação nas lojas |
| 12 | Redação da frase de posicionamento (a antiga ficou falsa) | Lançamento |
| 3 | Valor do adicional por km fora de zona | Preço real |
| 6 | Taxa zero nos primeiros 90 dias | Lançamento |
| 7 | Teto de R$ 500 de valor de mercadoria | Etapa 16 |
| 10, 11 | Custo do saque e prazo de aprovação da subconta — agora para **motoboy e lojista** | Lançamento |
| 15 | Revisão jurídica das cláusulas de controle + risco novo da seção 15 | Lançamento |

**Limites aceitos que ainda constrangem obra** (detalhe no `HISTORICO.md`, capítulo 3): estados 2, 3 e 6 sem prazo até a **Etapa 8** (mitigado por `corridasParadas`); a confirmação de pagamento não prova a entrega física; o motoboy pode exibir um QR próprio; nenhum provedor real de SMS nem de pagamento.

## Próximo passo exato

**Etapa 4 — Multi-cidade e o cliente como ator**, em sessão nova, com o prompt da etapa.

1. `cidades` como entidade de primeira classe; `cidade_id` em lojista, motoboy, corrida, tabela de preço e zona. **O cliente não tem cidade** — é da plataforma.
2. `clientes`: nasce pelo telefone que o lojista digita, vira dele pelo código de 6 dígitos por SMS. Sem subconta, não recebe dinheiro.
3. **A trava mora no banco:** corrida cujo lojista, motoboy ou zona sejam de outra cidade é recusada por constraint — provada pelo efeito, não pelo nome.
4. Lei 9 em todo caminho novo de escrita; controles negativos próprios; sem auditoria adversarial obrigatória nesta etapa (não é dinheiro nem autenticação — mas ela mexe em cadastro, então vale a recomendada).

Depois dela: **Etapa 5** (máquina de estados nova + prazo estimado) e **Etapa 6** (despacho). A **Etapa 7** (cobrança na porta) não começa antes das decisões 1 e 2 acima.
