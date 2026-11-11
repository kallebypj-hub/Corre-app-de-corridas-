# Autorizar o YouTube — Windows na sua mesa, sistema na VPS

O código está pronto e testado contra um espelho local. Falta o que só o titular pode fazer: criar a credencial e dar o consentimento. **Este sistema nunca pede sua senha nem um código por chat.**

> **Antes de tudo:** sua conta Google tem quatro canais. O canal oficial da empresa é o **Quiet Resolve (@QuietResolveDaily)**. O canal **Kalleby Prado é pessoal e está na lista de proibidos** — o sistema recusa qualquer escrita nele antes de chamar a API. Na tela de consentimento do Google **você escolhe qual canal autoriza**: escolha Quiet Resolve.

## Passo 1 — criar a credencial (uma vez, ~5 minutos)

No **Google Cloud Console**, com a conta dona do canal:

1. Crie um projeto (ou use um existente).
2. Em **APIs e serviços → Biblioteca**, ative as três:
   - **YouTube Data API v3** (upload)
   - **YouTube Analytics API** (retenção, tráfego, visualizações)
   - **YouTube Reporting API** (impressões e CTR — não existem na Analytics API)
3. Em **Tela de consentimento OAuth**: tipo **Externo**. Enquanto estiver em *Teste*, adicione seu e-mail em **Usuários de teste**, senão o Google recusa o login.
4. Em **Credenciais → Criar credenciais → ID do cliente OAuth**, tipo **Aplicativo da Web**.

> **Um tipo só, e por quê.** Em todo o projeto — código, painel e este documento — a credencial é **Aplicativo da Web**. Não é Aplicativo de desktop. O motivo é concreto: este sistema já é um servidor HTTP e atende num endereço e num caminho **fixos** (`http://127.0.0.1:3777/api/youtube/oauth/callback`). Só o tipo Aplicativo da Web tem o campo onde você cadastra esse endereço exato, e redirect cadastrado é redirect que casa. O tipo Aplicativo de desktop foi feito para sortear uma porta livre na hora e nem tem campo de redirect no console — com caminho fixo, isso dá `redirect_uri_mismatch`. O Google exige HTTPS nos redirects de aplicativo web, com **uma exceção explícita: endereço de loopback** (`localhost` e `127.0.0.1`). O nosso é loopback, então `http` é aceito. O túnel do passo 3 não muda nada disso: do lado do Google o redirect continua sendo `127.0.0.1:3777`.
5. Em **URIs de redirecionamento autorizados**, cole exatamente:

```
http://127.0.0.1:3777/api/youtube/oauth/callback
```

Esse endereço é `127.0.0.1` de propósito. Ele **não** precisa ser o IP da VPS — o passo 3 explica por quê.

6. Copie o **ID do cliente** e o **Segredo do cliente**.

## Passo 2 — colocar no .env da VPS

```bash
cd ~/Corre-app-de-corridas-          # o projeto agora ocupa a raiz do repositório
nano .env                            # o arquivo já está em modo 0600
```

```env
YOUTUBE_CLIENT_ID=...apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REDIRECT_URI=http://127.0.0.1:3777/api/youtube/oauth/callback
```

Opcional e recomendado: `TOKEN_ENCRYPTION_KEY=<64 caracteres hexadecimais>`. Sem ele o sistema gera a chave sozinho em `var/tokens/.key`, com permissão 0600.

## Passo 3 — o túnel (é isto que faz funcionar do Windows)

O servidor roda na VPS e só escuta em `127.0.0.1`. **Não exponha a porta na internet.** Em vez disso, traga a porta até o seu Windows por SSH.

No **PowerShell** do seu Windows:

```powershell
ssh -L 3777:127.0.0.1:3777 usuario@IP_DA_SUA_VPS
```

Deixe essa janela aberta. Enquanto ela estiver aberta, `http://127.0.0.1:3777` **no seu navegador Windows** é o painel que roda na VPS.

Por que assim:
- o `redirect_uri` continua sendo `127.0.0.1:3777`, que é exatamente o endereço cadastrado na credencial **Aplicativo da Web** e o endereço que o Google aceita em `http` por ser loopback;
- o navegador que atende o retorno é o **seu**, no Windows, e o túnel entrega esse retorno ao servidor da VPS — para o Google, tudo aconteceu em loopback;
- o painel nunca fica exposto na internet, então não precisa de HTTPS nem de API_KEY para esse uso;
- o segredo e o token nunca saem da VPS.

Se preferir não usar SSH, a alternativa é expor o painel com HTTPS e `API_KEY` — mas aí o `redirect_uri` muda e você precisa recadastrá-lo no Google. O túnel é mais simples e mais seguro.

## Passo 4 — validar o procedimento antes de autorizar

Na VPS:

```bash
node src/cli.js youtube doctor
```

Confere, numa passada: se o `client_id` e o segredo estão no `.env`, se o `client_id` tem a cara de um `client_id`, se o redirect é loopback com o caminho e a porta certos, quais escopos são pedidos e que nenhum escopo de escrita de canal é pedido. **Não imprime nenhum segredo** — só presença, tamanho e uma impressão digital de 12 caracteres. Se sair alguma linha `FALHA`, corrija antes de abrir a tela do Google.

## Passo 5 — autorizar

Na VPS, em outro terminal:

```bash
cd ~/Corre-app-de-corridas-
node src/server.js          # deixe rodando
```

No seu Windows, com o túnel aberto, abra no navegador:

```
http://127.0.0.1:3777
```

Vá em **Publicação → Autorizar no Google**. **Na tela do Google, escolha o canal Quiet Resolve.**

Ao voltar, o sistema:
- confere o `state` (32 bytes aleatórios, uso único, validade de 10 minutos);
- troca o código por token e guarda **cifrado** (AES-256-GCM, arquivo 0600);
- **chama a API** para descobrir qual canal o token alcança — só então o estado vira `AUTORIZADO`.

## Passo 6 — confirmar que é o canal certo e vincular (obrigatório)

```bash
node src/cli.js channel          # mostra qual canal o token alcança
node src/cli.js channel bind     # grava o ID real como canal oficial
```

O `bind` **recusa** se o canal autorizado não for o Quiet Resolve, e recusa se for o Kalleby Prado — aí nem `--force` passa.

**Este passo não é opcional.** Enquanto o canal não estiver vinculado por ID (`bound: true`), o sistema recusa **toda** escrita: envio, agendamento, publicação, qualquer uma. Depois de vinculado, a autorização de cada operação é por **ID do YouTube, string idêntica**, conferido na API na hora. Título e handle servem para vincular e para auditar, nunca para liberar uma escrita — título se renomeia, ID não.

## Passo 7 — auditar o canal (só leitura)

```bash
node src/cli.js channel audit
```

Lê identidade, descrição, palavras-chave, playlists, seções e o inventário de vídeos, e grava um relatório em `reports/`. **Não altera nada.** As recomendações saem marcadas com o escopo que exigiriam e com `requires_human_approval: true`.

Boa parte da otimização de canal (descrição, palavras-chave, banner, playlists, seções) exige um escopo de **escrita** que este projeto deliberadamente **não pede** hoje: `https://www.googleapis.com/auth/youtube`. Conceder esse escopo é decisão sua, e só vale a pena quando você quiser que o sistema aplique as mudanças em vez de só propor.

## Passo 8 — primeiro envio privado

```bash
node src/cli.js publish state ep_001      # mostra em que ponto está
node src/cli.js publish private ep_001    # envia como PRIVADO
```

Exige, nesta ordem: gates verdes, auditoria atual, aprovação do episódio **com a caixa de envio marcada**, OAuth verificado e o canal **vinculado por ID**. O arquivo sobe como `private`, com privacidade forçada no cliente.

### Quatro decisões, quatro caixas, nenhuma implícita

| operação | caixa que ela lê | o que ela **não** concede |
|---|---|---|
| enviar como privado | `scheduled_upload_authorized` | agendar, publicar, coletar |
| agendar publicação | `publication_schedule_authorized` | publicar agora, coletar |
| **tornar público** | `public_release_authorized` **+ frase exata** `PUBLICAR ep_001 EM PUBLICO` | autorização para o próximo vídeo |
| iniciar coleta | `audience_collection_authorized` | mudar privacidade |

Marcar uma caixa nunca marca outra. Autorizar o envio privado não autoriza agendar, e agendar não é publicar.

### As duas datas

O envio privado grava `uploaded_privately_at`. A publicação pública grava `published_publicly_at`, e **só** depois de a API confirmar que a privacidade virou `public`. Os marcos de 24h, 72h, 7 e 28 dias contam da segunda data. Vídeo privado ou agendado **não é analisado**: não há audiência para medir, e medir zero como se fosse resultado seria inventar fracasso.

## Passo 9 — ligar a medição

```bash
node src/cli.js publish collect ep_001    # o agendador passa a medir este vídeo
node src/cli.js scheduler tick            # uma passagem; use cron ou systemd timer
node src/cli.js scheduler status          # marcos abertos, remedições e falhas
```

`publish collect` só aceita vídeo **público confirmado na API** e exige a caixa `audience_collection_authorized`. Em vídeo privado ele recusa, dizendo por quê.

Impressões e CTR vêm da **Reporting API**, que é em lote: o primeiro arquivo pode levar **até 48h** depois de criar o job. Enquanto isso, se quiser antecipar, exporte do YouTube Studio e importe:

```bash
node src/cli.js import-studio ep_001 ~/export.csv d7
```

O dado importado fica marcado com origem `youtube_studio_csv_manual` — nunca se mistura com dado de API.

**Unidade do CTR, uma só no projeto inteiro:** fração de 0 a 1 (cliques ÷ impressões). `0.062` é 6,2%. O campo `impressions_ctr` é sempre a fração; `impressions_ctr_percent` é o mesmo valor em porcentagem, para leitura. A coluna do Studio vem em porcentagem e é dividida por 100 na importação.

**Marco aberto não é marco medido.** Se o relatório de impressões ainda não existe, ou a curva de retenção ainda não populou, a medida entra como **provisória**: o marco fica aberto, o agendador volta a cada 3 horas por até 48 horas, e a medida é **substituída** quando o dado real aparecer. O histórico das tentativas fica gravado. Só falta **estrutural** (receita, porque o escopo monetário não foi pedido) fecha o marco, porque retentar não traria esse dado.

## O que ainda não foi provado

Os 21 testes do cliente exercitam o aperto de mão, o `state` de uso único, refresh, 308, retomada após queda, trava de duplicidade, privacidade forçada e revogação — tudo contra um espelho local. **Eles não provam que o Google aceitou nada.** Isso só acontece no primeiro envio real, com as suas credenciais.
