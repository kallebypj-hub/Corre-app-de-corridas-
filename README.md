# Corre

Plataforma de despacho de entregas para o comércio. Cidade piloto: Sobral/CE.
A especificação completa e as 8 leis inegociáveis estão em [`CORRE.md`](CORRE.md).

## Estrutura

A especificação pede dois repositórios (`corre-api` e `corre-app`); este
repositório único os abriga como diretórios de um monorepo:

| Diretório | Conteúdo |
|---|---|
| [`corre-api/`](corre-api) | Backend (Node.js + Express), web do lojista, painel, migrations do PostgreSQL |
| [`corre-app/`](corre-app) | App Android do motoboy (Kotlin) — Etapa 6, ainda não construído |

## Estado da obra

| Etapa | Situação |
|---|---|
| 0 — Fundação: migrations, tabela de eventos, CI | **Concluída, aguardando aprovação** |
| 1 em diante | Não iniciadas — uma etapa por vez, com aprovação entre elas |

## Rodando a bateria da Etapa 0

Pré-requisitos: Node.js ≥ 20, PostgreSQL 16 com um superusuário acessível
(padrões: `postgres`/`postgres` em `localhost:5432` — sobrescreva por
variável de ambiente, ver `corre-api/scripts/setup-db.sh`).

```bash
cd corre-api
npm ci
npm run bateria            # banco nasce do zero das migrations + testes
npm run controle-negativo  # Lei 8: sabota a regra e exige bateria vermelha
```

A bateria **sempre** derruba e recria o banco de teste a partir das
migrations — nunca rode apontando para um banco que importa.

## Garantias da fundação (Etapa 0)

- `eventos` é append-only em duas camadas independentes, no banco:
  o papel da aplicação (`corre_app`) só tem `SELECT` e `INSERT`, e triggers
  fazem `UPDATE`/`DELETE`/`TRUNCATE` falharem **até para o dono da tabela**.
  Remover as travas exige migration nova, auditada no git. A aplicação
  nunca conecta como dono nem como superusuário.
- Dinheiro é inteiro em centavos (Lei 1): domínio `centavos` (`BIGINT`).
- Migration aplicada não se edita: o runner registra o checksum SHA-256 e
  recusa divergência.
