# RETOMAR — leia isto primeiro

Página de retomada do **Corre**. Uma sessão nova lê este arquivo, depois o [`CORRE.md`](CORRE.md), e trabalha a partir da `main`. A conversa anterior **não** faz parte da verdade do projeto. Registro histórico (por que as coisas são como são): [`HISTORICO.md`](HISTORICO.md).

**Regime:** uma sessão por etapa — abre no prompt da etapa, fecha no merge. Raciocínio máximo só em auditoria adversarial e nas etapas de dinheiro (4, 7, 8).

---

## Onde o projeto está

| | |
|---|---|
| **Etapas na `main`** | 0 (fundação), 1 (máquina de estados), 2 (cadastro e sessão + re-login OTP), 3 (zonas e preço) |
| **Etapa atual** | **4 — Pedido, link do cliente, Pix e split** |
| **Situação da Etapa 4** | **BLOQUEADA no Portão C.** Não construir. Aguarda decisão do dono — ver [`PORTAO-C.md`](PORTAO-C.md) |
| **Última bateria verde** | 152 testes, 0 falhas · controle negativo: 34 sabotagens, todas vermelhas no teste certo |
| **PRs mesclados** | #1 Etapa 0 · #2 Etapa 1 · #3 Etapa 2 · #5 correção de segurança do OTP · #4 Etapa 3 |

## O que já está na `main`

**Migrations** (`corre-api/migrations/`): `0001` domínio centavos · `0002` eventos append-only · `0003` corridas + sequência + idempotência · `0004` log sem buraco · `0005` cadastro e sessão · `0006` travas no banco · `0007` re-login OTP · `0008` zonas e preço.

**Domínio** (`corre-api/src/dominio/`): `transicoes.js` (tabela declarativa, 13 arestas) · `corridas.js` (motor de estados, prazos, `corridasParadas`) · `contas.js` (motoboy, lojista, operador, painel) · `otp.js` (re-login) · `preco.js` (motor de preço) · `nucleo.js` (transação, replay, disputa de posição) · `estados.js`, `cpf.js`, `erros.js`.

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
| **C** | **Portão C — quando o split ocorre.** Investigação **concluída**; 8 caminhos levantados com fonte em [`PORTAO-C.md`](PORTAO-C.md). Falta a **escolha do dono**. Achados que mudam a decisão: split postergado existe mas é raro (PagBank "Custódia", Zoop/Barte "a posteriori"); **o Asaas está descartado** (Pix fixo R$ 1,99); e a promessa "1 saque grátis/dia" da seção 9 **não é nossa para prometer** na maioria dos caminhos | **Etapa 4 inteira** |
| 1 | Escolha do gateway (Pix percentual é requisito; fixo por transação é descartado) | Integração real (pós-Etapa 4) |
| 2 | Valor do adicional por km fora de zona | Preço real; hoje roda com valor de exemplo |
| 3 | Transcrição da tabela de zonas de Sobral | Preço real; hoje roda com tabela de exemplo |
| 4 | Taxa zero nos primeiros 90 dias | Lançamento |
| 5 | Teto de R$ 500 de valor declarado | Etapa 11 (antifraude) |
| 6 | Revisão jurídica das três cláusulas de controle | Lançamento |
| 7 | Registro da marca e domínio | Lançamento |
| 8 | Provedor real de SMS (mecanismo já implementado) | Lançamento |

**Limites aceitos que ainda constrangem obra** (detalhe no `HISTORICO.md`, capítulo 3): estados 3, 4 e 5 sem prazo até a **Etapa 7** (mitigado por `corridasParadas`); nenhum provedor real de SMS nem de pagamento no MVP.

## Próximo passo exato

1. O dono decide o **Portão C** lendo `PORTAO-C.md`.
2. Com a decisão registrada no `CORRE.md` (seção 9 e seção 17, item 9), abre-se **sessão nova** para a Etapa 4 com o prompt da etapa.
3. A Etapa 4 constrói: pedido do lojista → link do cliente → confirmação de Pix idempotente e assíncrona (com conciliação ativa) → retenção → split na transição para Entregue → estornos. **Sem provedor real de pagamento**: tudo atrás de interface, com implementação falsa nos testes, como foi feito com o SMS.
4. Exigências da etapa: 6 controles negativos (confirmação não-idempotente, recálculo de preço pós-pagamento, split fora da transição para Entregue, estorno virando apagamento, par estorno/split não atômico, confirmação fora de ordem aceita em silêncio); teste de 10.000 corridas fechando ao centavo; Lei 9 nos três pontos onde dinheiro nasce ou some duas vezes (confirmação, split, estorno×split).
5. Auditoria adversarial é **obrigatória** nesta etapa (caminho de dinheiro), depois da obra e nunca em paralelo.
