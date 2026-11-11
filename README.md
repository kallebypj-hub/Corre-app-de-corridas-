# youtube-media-company

Empresa autônoma de canais do YouTube que **produz, mede e aprende**. Ocupa a raiz deste repositório desde 2026-11-11, quando o aplicativo de corridas foi descontinuado e removido (preservado na branch `claude/corre-delivery-platform-gbe2s0` e na tag `backup/corre-app-descontinuado-2026-11-11`).

Porta 3777, estado em `var/`, segredos em `.env`, zero dependência npm.

## A ideia

Não é uma máquina de publicar vídeo. É uma empresa que trata cada episódio como **experimento**: declara uma hipótese antes de produzir, mede o que aconteceu, e só converte isso em regra quando a evidência sustenta. O que ela aprende fica num registro imutável que todos os agentes leem antes de decidir.

## O que ele entrega

Um vídeo longo real, narrado, legendado, com miniaturas, três Shorts derivados, dossiê de fontes verificadas, manifesto de direitos e um painel para assistir, revisar, reiniciar etapa, aprovar e acompanhar — com **despesa externa de US$ 0,00**.

## Como subir

```bash
cp .env.example .env          # já vem com limite de gasto em zero
node src/cli.js doctor        # confere ffmpeg, playwright, TTS local
node src/server.js            # painel em http://127.0.0.1:3777
```

Reiniciar é só matar e subir de novo: o estado vive em `var/channels/<canal>/events.jsonl` (log append-only) e é reconstruído sozinho se `state.json` sumir.

Para expor o painel fora da máquina, defina `HOST=0.0.0.0` **e** `API_KEY=<string longa>` no `.env`. Sem chave, toda escrita é recusada fora de `127.0.0.1`.

## Produzir

Nenhum episódio está embutido no código. O conteúdo vive na pasta do episódio; o pipeline lê.

```bash
node src/cli.js episodes                 # o que existe no disco
node src/cli.js produce ep_002           # roda a cadeia, pulando o que já está em checkpoint
node src/cli.js produce ep_002 --from=voice
node src/cli.js stage scenes ep_002      # refaz um estágio só (invalida os que dependem dele)
node src/cli.js status ep_002
node src/cli.js verify ep_002            # verificação independente, lendo o disco
```

Para criar um episódio novo, veja [docs/novo-episodio.md](docs/novo-episodio.md). São quatro arquivos de configuração e zero linha de código.

## YouTube

```bash
node src/cli.js youtube            # estado REAL, verificado contra a API
node src/cli.js youtube authorize  # imprime a URL para você autorizar no navegador
node src/cli.js youtube verify
node src/cli.js youtube revoke     # revoga no Google e só então apaga o token local
node src/cli.js upload ep_002      # envio PRIVADO real
```

O passo humano inevitável está em [docs/youtube-oauth.md](docs/youtube-oauth.md).

## Testes

```bash
npm run test:all     # tudo
node src/test.js ep_002           # artefatos reais do episódio (decodifica mídia)
node src/test-gates.js            # negativos: prova que o sistema bloqueia
node src/test-youtube.js          # cliente YouTube contra espelho local do Google
node src/test-security.js         # travessia de caminho, chave, segredos, exposição
node src/test-independence.js ep_001 ep_002   # prova que os episódios não se repetem
```

## Dependências

**Zero pacote npm.** O projeto usa só a biblioteca padrão do Node, mais três coisas do ambiente:

| Ferramenta | Papel | Licença | Custo |
|---|---|---|---|
| FFmpeg 6.1.1 | render, montagem, sondagem | LGPL/GPL conforme build | US$ 0 |
| Chromium via Playwright | rasteriza os frames-chave | BSD / Apache-2.0 | US$ 0 |
| Kokoro-82M (Python, `/opt/ymc-tts`) | narração local | Apache-2.0 (pesos) | US$ 0 |
| faster-whisper `base.en` | alinhamento de legenda e prova de inteligibilidade | MIT | US$ 0 |

## Honestidade de autonomia

Cada estágio declara de quem depende, e isso aparece no painel, no `provenance.json` e no relatório:

| Nível | O que significa |
|---|---|
| **automático** | código determinístico desta máquina; roda de novo igual |
| **modelo local** | modelo que roda aqui (narração, reconhecimento de fala); sem rede, sem fatura |
| **assistido** | conteúdo escrito por trabalho intelectual nesta sessão. O próximo episódio exige o mesmo trabalho, por uma pessoa ou por um agente com LLM configurada |

Hoje são **assistidos**: `ideation`, `research` e `script`. O sistema não finge que se vira sozinho nessas três — e há um teste que reprova se nenhum estágio for declarado assim.

## Regras que o código faz valer, não só promete

- **Despesa externa US$ 0,00.** Nenhum provedor pago é acionado. O gate `despesa_externa_zero` lê o custo somado de todos os estágios e reprova se for diferente de zero.
- **Sem narração real, não há aprovação.** Não existe caminho "simulado": se o TTS local falhar, o estágio falha.
- **Publicação exige três chaves separadas:** gates verdes, aprovação do proprietário **para aquele vídeo**, e OAuth autorizado. Aprovar um vídeo não autoriza os próximos.
- **Primeiro envio é sempre privado.** A fila recusa `public`.
- **Métrica que não existe aparece como `indisponivel`** — nunca como zero, nunca estimada.
- **Afirmação factual sem fonte reprova o episódio.** O detector varre as falas atrás de quantidade com unidade, ano, estatística, atribuição e verbo de citação — mas ele é só o gatilho. A autoridade é `claims.json`: cada afirmação diz contra o quê foi conferida, por quem e quando. Entrada sem evidência bloqueia; entrada órfã bloqueia; número usado como ilustração exige isenção assinada.
- **Ativo sem licença declarada reprova o episódio.**
- **Editar roteiro, brief, fontes ou matriz no disco** invalida os estágios já concluídos, por impressão digital das entradas.
- **Token guardado não é prova de autorização.** O estado só vira `AUTORIZADO` depois de uma chamada real à API que confirme o canal.
- **O painel exposto recusa subir** sem `API_KEY` de 32+ caracteres e sem HTTPS reconhecido.

## Estrutura

```
config/            identidade do canal e organograma das 16 funções
src/pipeline.js    motor de 19 estágios com checkpoint e invalidação em cascata
src/stages/        implementação de cada estágio
src/render/        composição por código, renderizador com câmera, legendas, miniatura, vertical
src/tts/           narração local (Kokoro) e alinhamento (faster-whisper)
src/bridge/        contrato para o Paperclip entrar depois como camada de administração
dashboard/         painel do presidente (10 áreas)
content/channels/  artefatos entregues, por canal e episódio
var/               estado, logs e tokens — fora do Git
```
