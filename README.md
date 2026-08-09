# Corre

Plataforma de despacho de entregas para o comércio. Cidade piloto: Sobral/CE.

## Por onde começar

| Arquivo | Para que serve | Quando ler |
|---|---|---|
| [`RETOMAR.md`](RETOMAR.md) | Em que etapa o projeto está, o que já está na `main`, o que trava, próximo passo | **Primeiro, sempre** |
| [`CORRE.md`](CORRE.md) | As 9 leis, o método de teste, o regime de trabalho e a especificação vigente | Sempre |
| [`HISTORICO.md`](HISTORICO.md) | Decisões com data e motivo, alterações de spec antes→depois, achados de auditoria, defeitos aceitos | Só quando precisar saber *por quê* |
| [`PORTAO-C.md`](PORTAO-C.md) | Decisão pendente do dono que bloqueia a Etapa 4 | Antes de tocar na Etapa 4 |

Regra de casa: **uma sessão por etapa**, e a verdade do projeto mora no repositório — nunca no histórico de conversa. Se algo importante só existe no chat, é defeito.

## Estrutura

| Diretório | Conteúdo |
|---|---|
| [`corre-api/`](corre-api) | Backend (Node.js + Express), web do lojista, painel, migrations do PostgreSQL |
| [`corre-app/`](corre-app) | App Android do motoboy (Kotlin) — Etapa 6, ainda não construído |

## Rodando

```bash
cd corre-api && npm ci
npm run bateria            # banco nasce do zero das migrations, depois os testes
npm run controle-negativo  # Lei 8: sabota cada regra e exige vermelho no teste que a vigia
```

Pré-requisitos: Node.js ≥ 20 e PostgreSQL 16 em `localhost:5432` com superusuário acessível (padrão `postgres`/`postgres`; sobrescreva por variável de ambiente — ver `corre-api/scripts/setup-db.sh`).

A bateria **sempre derruba e recria** o banco de teste a partir das migrations — nunca a rode apontando para um banco que importa.
