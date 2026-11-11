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
- o `redirect_uri` continua sendo `127.0.0.1`, que é exatamente o que o Google espera e o que o próprio Google recomenda para app instalado;
- o painel nunca fica exposto na internet, então não precisa de HTTPS nem de API_KEY para esse uso;
- o segredo e o token nunca saem da VPS.

Se preferir não usar SSH, a alternativa é expor o painel com HTTPS e `API_KEY` — mas aí o `redirect_uri` muda e você precisa recadastrá-lo no Google. O túnel é mais simples e mais seguro.

## Passo 4 — autorizar

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

## Passo 5 — confirmar que é o canal certo e vincular

```bash
node src/cli.js channel          # mostra qual canal o token alcança
node src/cli.js channel bind     # grava o ID real como canal oficial
```

O `bind` **recusa** se o canal autorizado não for o Quiet Resolve, e recusa se for o Kalleby Prado. Depois de vinculado, qualquer token que aponte para outro ID é rejeitado antes de qualquer envio.

## Passo 6 — auditar o canal (só leitura)

```bash
node src/cli.js channel audit
```

Lê identidade, descrição, palavras-chave, playlists, seções e o inventário de vídeos, e grava um relatório em `reports/`. **Não altera nada.** As recomendações saem marcadas com o escopo que exigiriam e com `requires_human_approval: true`.

Boa parte da otimização de canal (descrição, palavras-chave, banner, playlists, seções) exige um escopo de **escrita** que este projeto deliberadamente **não pede** hoje: `https://www.googleapis.com/auth/youtube`. Conceder esse escopo é decisão sua, e só vale a pena quando você quiser que o sistema aplique as mudanças em vez de só propor.

## Passo 7 — primeiro envio privado

```bash
node src/cli.js publish state ep_001      # mostra em que ponto está
node src/cli.js publish private ep_001    # envia como PRIVADO
```

Exige, nesta ordem: gates verdes, auditoria atual, aprovação do episódio **com a caixa de envio marcada**, OAuth verificado e o canal certo. O arquivo sobe como `private`, com privacidade forçada no cliente.

**Tornar público é outra decisão**, separada, com frase de confirmação exata, e exige que a aprovação daquele episódio tenha marcado `public_release_authorized`.

## Passo 8 — ligar a medição

```bash
node src/cli.js publish collect ep_001    # o agendador passa a medir este vídeo
node src/cli.js scheduler tick            # uma passagem; use cron ou systemd timer
```

Impressões e CTR vêm da **Reporting API**, que é em lote: o primeiro arquivo pode levar **até 48h** depois de criar o job. Enquanto isso, se quiser antecipar, exporte do YouTube Studio e importe:

```bash
node src/cli.js import-studio ep_001 ~/export.csv d7
```

O dado importado fica marcado com origem `youtube_studio_csv_manual` — nunca se mistura com dado de API.

## O que ainda não foi provado

Os 21 testes do cliente exercitam o aperto de mão, o `state` de uso único, refresh, 308, retomada após queda, trava de duplicidade, privacidade forçada e revogação — tudo contra um espelho local. **Eles não provam que o Google aceitou nada.** Isso só acontece no primeiro envio real, com as suas credenciais.
