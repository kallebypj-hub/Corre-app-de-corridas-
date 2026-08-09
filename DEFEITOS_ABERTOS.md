# Defeitos abertos e limites aceitos

Registro exigido pelo dono: defeito conhecido e não registrado é defeito que
volta em produção. Cada entrada tem data, descrição, risco e o motivo de não
corrigir. Entrada só sai daqui por decisão registrada — nunca por apagamento.

---

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
