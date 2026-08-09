# Corre

Plataforma de despacho de entregas para o comércio. Cidade piloto: Sobral/CE.
A especificação completa e as 8 leis inegociáveis estão em [`CORRE.md`](CORRE.md).

## Estrutura

Monorepo aprovado pelo dono (2026-08-09): quando o contrato da API mudar,
o app Kotlin muda no mesmo PR. O tronco é `main`; toda etapa entra por PR
com a bateria e o controle negativo verdes no CI. Limites conhecidos e
aceitos ficam registrados em [`DEFEITOS_ABERTOS.md`](DEFEITOS_ABERTOS.md).

| Diretório | Conteúdo |
|---|---|
| [`corre-api/`](corre-api) | Backend (Node.js + Express), web do lojista, painel, migrations do PostgreSQL |
| [`corre-app/`](corre-app) | App Android do motoboy (Kotlin) — Etapa 6, ainda não construído |

## Estado da obra

| Etapa | Situação |
|---|---|
| 0 — Fundação: migrations, tabela de eventos, CI | **Aprovada pelo dono em 2026-08-09** — entregue à `main` pelo PR #1; condição registrada no critério de aceite da Etapa 1 |
| 1 — Máquina de estados + log de eventos | **Concluída — em PR contra `main`, aguardando aprovação** |
| 2 em diante | Não iniciadas — uma etapa por vez, com aprovação entre elas |

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
  o papel da aplicação (`corre_app`) tem `SELECT` na tabela e `INSERT` só
  nas colunas de negócio — `id` e `criado_em` são sempre atribuídos pelo
  banco (nem `OVERRIDING SYSTEM VALUE` passa), e triggers fazem
  `UPDATE`/`DELETE`/`TRUNCATE` diretos falharem **até para o dono da
  tabela**. Limite inerente do PostgreSQL: o dono ainda consegue desligar
  as travas em sessão comum — por isso `corre_dono` é reservado a
  migrations e a aplicação conecta **sempre** como `corre_app`, nunca como
  dono nem superusuário. Remoção sancionada das travas só por migration
  versionada no git.
- Dinheiro é inteiro em centavos (Lei 1): domínio `centavos` (`BIGINT`).
- Migration aplicada não se edita: o runner registra o checksum SHA-256 e
  recusa divergência.
- Trava de boot: a aplicação se recusa a iniciar se a credencial da conexão
  for superusuário, dono de `eventos` ou tiver qualquer escrita em
  `eventos` (`corre-api/src/db/boot.js`) — a regra "app conecta só como
  `corre_app`" é verificada em execução, não prometida em texto. O ponto de
  entrada (`corre-api/src/servidor.js`) chama a trava antes do `listen`.

## Garantias da máquina de estados (Etapa 1)

- Transições legais num lugar só: `corre-api/src/dominio/transicoes.js`
  (tabela declarativa; 13 arestas + criação). O motor não tem `if` de
  legalidade fora dela, e a reconstrução usa a mesma tabela.
- Ordem do log por `UNIQUE (agregado_tipo, agregado_id, seq)` — vencedor
  único em disputa concorrente decidido pelo banco, não por código.
- Idempotência por `UNIQUE (chave_idempotencia)` — retentativa com a mesma
  chave é operação nula que devolve o resultado original.
- Prazo é dado, não timer: `vence_em` gravado no evento e na projeção;
  vencer é consulta (`src/bin/expira-vencidas.js`), reinício não perde nada.
- Tempo é do servidor: payload com `vence_em`/`criado_em` do cliente é
  recusado.
