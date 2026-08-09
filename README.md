# Corre

Plataforma de despacho de entregas para o comércio. Cidade piloto: Sobral/CE.

## Por onde começar

| Arquivo | Para que serve | Quando ler |
|---|---|---|
| [`RETOMAR.md`](RETOMAR.md) | Em que etapa o projeto está, o que já está na `main`, o que trava, próximo passo | **Primeiro, sempre** |
| [`CORRE.md`](CORRE.md) | As 9 leis, o método de teste, o regime de trabalho e a especificação vigente | Sempre |
| [`HISTORICO.md`](HISTORICO.md) | Decisões com data e motivo, alterações de spec antes→depois, achados de auditoria, defeitos aceitos | Só quando precisar saber *por quê* |
| [`GATEWAY.md`](GATEWAY.md) | A escolha de gateway reaberta: critérios, ranking, a conta da Lei 7 e o que falta perguntar | Antes da Etapa 7 |
| [`PORTAO-C.md`](PORTAO-C.md) | Pergunta **morta** em 2026-08-09 (o pagamento saiu de antes da entrega). Fica como levantamento de mercado | Quase nunca |

Regra de casa: **uma sessão por etapa**, e a verdade do projeto mora no repositório — nunca no histórico de conversa. Se algo importante só existe no chat, é defeito.

> **Revisão de 2026-08-09:** o pagamento passou para a **porta do cliente** (QR Pix dinâmico no app do motoboy), com a **mercadoria dentro da cobrança** e **split triplo**. Isso invalidou a Etapa 4 planejada, o Portão C e a tabela de estados. Leia o aviso no topo do `RETOMAR.md` antes de qualquer coisa.

## Estrutura

| Diretório | Conteúdo |
|---|---|
| [`corre-api/`](corre-api) | Backend (Node.js + Express), painel, migrations do PostgreSQL — serve os três apps e a ponte web |
| `corre-app-motoboy/` | App Android do motoboy (Kotlin, `br.com.corre.motoboy`) — Etapa 13, ainda não construído |
| `corre-app-lojista/` | App do lojista (Flutter, `br.com.corre.lojista`) — Etapa 15, ainda não construído |
| `corre-app-cliente/` | App do cliente (Flutter, `br.com.corre.cliente`) — Etapa 14, ainda não construído |

## Rodando

```bash
cd corre-api && npm ci
npm run bateria            # banco nasce do zero das migrations, depois os testes
npm run controle-negativo  # Lei 8: sabota cada regra e exige vermelho no teste que a vigia
```

Pré-requisitos: Node.js ≥ 20 e PostgreSQL 16 em `localhost:5432` com superusuário acessível (padrão `postgres`/`postgres`; sobrescreva por variável de ambiente — ver `corre-api/scripts/setup-db.sh`).

A bateria **sempre derruba e recria** o banco de teste a partir das migrations — nunca a rode apontando para um banco que importa.
