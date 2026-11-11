# Ligar o YouTube — a única parte que depende de você

O código do lado de cá está pronto e testado contra um espelho local do Google (21 testes, `node src/test-youtube.js`). O que falta é o que **só o titular da conta pode fazer**: criar a credencial e dar o consentimento no navegador. Nenhum sistema pode fazer isso por você, e este aqui nunca vai pedir sua senha nem um código por chat.

## Passo 1 — criar a credencial (uma vez, ~5 minutos)

1. Abra o **Google Cloud Console** e crie um projeto (ou use um existente).
2. Em **APIs e serviços → Biblioteca**, ative:
   - **YouTube Data API v3**
   - **YouTube Analytics API**
3. Em **APIs e serviços → Tela de consentimento OAuth**: tipo **Externo**, preencha nome do app e e-mail de contato. Enquanto estiver em **Teste**, adicione o seu próprio e-mail em *Usuários de teste* — senão o Google recusa o login.
4. Em **Credenciais → Criar credenciais → ID do cliente OAuth**, tipo **Aplicativo da Web**.
5. Em **URIs de redirecionamento autorizados**, cole exatamente:

```
http://127.0.0.1:3777/api/youtube/oauth/callback
```

6. Copie o **ID do cliente** e o **Segredo do cliente**.

## Passo 2 — colocar no .env

```bash
cd youtube-media-company
# o arquivo já está com permissão 0600
YOUTUBE_CLIENT_ID=...apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REDIRECT_URI=http://127.0.0.1:3777/api/youtube/oauth/callback
```

Opcional, mas recomendado: `TOKEN_ENCRYPTION_KEY=<64 caracteres hexadecimais>`. Sem ele o sistema gera uma chave sozinho e guarda em `var/tokens/.key` com permissão 0600.

## Passo 3 — autorizar

```bash
node src/server.js        # em um terminal
node src/cli.js youtube authorize   # em outro: imprime a URL
```

Abra a URL no **seu** navegador, logado na conta do canal. Ao voltar, o sistema:

- confere o `state` (32 bytes aleatórios, uso único, validade de 10 minutos);
- troca o código por token e guarda **cifrado** (AES-256-GCM, arquivo 0600);
- **chama a API** para descobrir qual canal o token alcança — só depois disso o estado vira `AUTORIZADO`.

Confira a qualquer momento:

```bash
node src/cli.js youtube          # estado real, verificado contra a API
node src/cli.js youtube verify   # força a checagem viva
node src/cli.js youtube revoke   # revoga no Google e só então apaga o token local
```

## Passo 4 — envio privado

O envio exige **três chaves independentes**, e o sistema recusa se faltar qualquer uma:

1. gates verdes **e** auditoria não desatualizada;
2. sua aprovação **daquele vídeo**, com a caixa de envio programado marcada;
3. OAuth verificado.

```bash
node src/cli.js upload ep_002
```

O que acontece: sessão retomável, pedaços de 8 MB, `privacyStatus=private` **forçado no cliente** (um pedido com `public` é recusado antes de qualquer rede), `video_id` registrado, e o estado real conferido de volta na API. Se a conexão cair, rodar de novo retoma do byte que o Google confirmou. Se o mesmo arquivo já subiu, o envio é recusado por duplicidade.

Publicar em **público** é uma quarta decisão, separada, e não está automatizada.

## O que ainda não foi provado

Os 21 testes exercitam o nosso cliente contra um espelho local: aperto de mão, `state` de uso único, refresh, 308, retomada após queda, trava de duplicidade, privacidade forçada e revogação. **Eles não provam que o Google aceitou nada.** Isso só acontece no primeiro envio real, com as suas credenciais. Até lá, o painel mostra `BLOQUEADO`, e é a verdade.
