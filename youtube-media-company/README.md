# youtube-media-company

Empresa autônoma de canais do YouTube. **Projeto novo e isolado**: diretório próprio, porta própria (3777), banco próprio (`var/`), segredos próprios (`.env`), processos próprios. Não lê, não escreve e não compartilha nada com o app de corridas que vive no mesmo repositório, nem com qualquer outro projeto.

## O que ele entrega

Um vídeo longo real, narrado, legendado, com miniaturas, três Shorts derivados, dossiê de fontes verificadas, manifesto de direitos e um painel para assistir, revisar, reiniciar etapa, aprovar e acompanhar — com **despesa externa de US$ 0,00**.

## Como subir

```bash
cd youtube-media-company
cp .env.example .env          # já vem com limite de gasto em zero
node src/cli.js doctor        # confere ffmpeg, playwright, TTS local
node src/server.js            # painel em http://127.0.0.1:3777
```

Reiniciar é só matar e subir de novo: o estado vive em `var/channels/<canal>/events.jsonl` (log append-only) e é reconstruído sozinho se `state.json` sumir.

Para expor o painel fora da máquina, defina `HOST=0.0.0.0` **e** `API_KEY=<string longa>` no `.env`. Sem chave, toda escrita é recusada fora de `127.0.0.1`.

## Produzir

```bash
node src/cli.js produce ep_001          # roda a cadeia, pulando o que já está em checkpoint
node src/cli.js produce ep_001 --from=voice   # retoma de um estágio
node src/cli.js stage scenes ep_001     # refaz um estágio só (invalida os que dependem dele)
node src/cli.js status ep_001           # estado real
node src/cli.js verify ep_001           # verificação independente, lendo o disco
node src/test.js                        # testes (decodificam mídia de verdade)
```

## Dependências

**Zero pacote npm.** O projeto usa só a biblioteca padrão do Node, mais três coisas do ambiente:

| Ferramenta | Papel | Licença | Custo |
|---|---|---|---|
| FFmpeg 6.1.1 | render, montagem, sondagem | LGPL/GPL conforme build | US$ 0 |
| Chromium via Playwright | rasteriza os frames-chave | BSD / Apache-2.0 | US$ 0 |
| Kokoro-82M (Python, `/opt/ymc-tts`) | narração local | Apache-2.0 (pesos) | US$ 0 |
| faster-whisper `base.en` | alinhamento de legenda e prova de inteligibilidade | MIT | US$ 0 |

## Regras que o código faz valer, não só promete

- **Despesa externa US$ 0,00.** Nenhum provedor pago é acionado. O gate `despesa_externa_zero` lê o custo somado de todos os estágios e reprova se for diferente de zero.
- **Sem narração real, não há aprovação.** Não existe caminho "simulado": se o TTS local falhar, o estágio falha.
- **Publicação exige três chaves separadas:** gates verdes, aprovação do proprietário **para aquele vídeo**, e OAuth autorizado. Aprovar um vídeo não autoriza os próximos.
- **Primeiro envio é sempre privado.** A fila recusa `public`.
- **Métrica que não existe aparece como `indisponivel`** — nunca como zero, nunca estimada.
- **Afirmação factual sem fonte reprova o episódio.** O verificador varre todas as falas atrás de ano, número, nome próprio e termo de evidência.
- **Ativo sem licença declarada reprova o episódio.**

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
