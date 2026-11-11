# Entrega do piloto — youtube-media-company

Gerado automaticamente a partir do store e do disco em 2026-11-11T17:35:10.408Z.

## Máquina

| Item | Valor |
|---|---|
| Sistema | linux 6.18.44-fc-v378 |
| CPU | Intel(R) Xeon(R) Processor @ 2.30GHz · 4 vCPU |
| Memória | 15.7 GB |
| Node | v22.23.4 |

## Pipeline executado

| Estágio | Agente | Autonomia | Tempo | Artefatos | Custo |
|---|---|---|---|---|---|
| Nicho e tese editorial `strategy` | editorial_director | automatico | 0.0s | 1 | US$ 0.00 |
| Ideias com evidencia `ideation` | demand_researcher | assistido | 0.0s | 1 | US$ 0.00 |
| Selecao editorial `selection` | editorial_director | automatico | 0.0s | 1 | US$ 0.00 |
| Dossie de pesquisa `research` | source_researcher | assistido | 0.0s | 2 | US$ 0.00 |
| Roteiro EN-US `script` | scriptwriter | assistido | 0.0s | 1 | US$ 0.00 |
| Auditoria de fatos `factcheck` | fact_checker | automatico | 0.0s | 2 | US$ 0.00 |
| Revisao de narrativa `narrative_review` | narrative_editor | automatico | 0.0s | 1 | US$ 0.00 |
| Storyboard `storyboard` | art_director | automatico | 0.0s | 1 | US$ 0.00 |
| Licenciamento de midia `media_rights` | media_rights_curator | automatico | 0.0s | 1 | US$ 0.00 |
| Narracao (TTS local) `voice` | voice_producer | modelo local | 10.4s | 2 | US$ 0.00 |
| Alinhamento por reconhecimento de fala `align` | voice_producer | modelo local | 33.0s | 2 | US$ 0.00 |
| Render de cenas 1080p `scenes` | editor_renderer | automatico | 425.9s | 11 | US$ 0.00 |
| Montagem final MP4 `edit` | editor_renderer | automatico | 9.8s | 1 | US$ 0.00 |
| Legendas SRT `captions` | voice_producer | automatico | 0.1s | 2 | US$ 0.00 |
| Miniaturas A/B `thumbnail` | thumbnail_designer | automatico | 0.7s | 3 | US$ 0.00 |
| Titulo, descricao, capitulos `seo` | discovery_seo | automatico | 0.1s | 1 | US$ 0.00 |
| Tres Shorts 9:16 `shorts` | shorts_producer | automatico | 59.5s | 7 | US$ 0.00 |
| Manifesto de origem e direitos `provenance` | media_rights_curator | automatico | 0.1s | 1 | US$ 0.00 |
| Auditoria tecnica e gates `qa` | compliance_auditor | automatico | 45.2s | 1 | US$ 0.00 |

### O que NÃO é autônomo hoje

Isto fica escrito de propósito. O pipeline produz, valida e bloqueia sozinho; a parte intelectual não.

| Estágio | Nível | O que falta para rodar sozinho |
|---|---|---|
| `ideation` | assistido | Gerar pauta com evidencia sozinho exigiria LLM configurada + fonte de sinal de busca autenticada. Hoje a lista vem de config/ e foi escrita nesta sessao. |
| `research` | assistido | Encontrar e ler fontes primarias exige agente com acesso a web ou pessoa. O pipeline apenas VALIDA o dossie que recebe. |
| `script` | assistido | Roteiro original exige LLM configurada ou pessoa. O pipeline le o roteiro do episodio e o transforma em markdown. |

**Tempo somado de execução:** 9.7 min · **Despesa externa total: US$ 0.00**

## Vídeo longo

| Medida | Valor (medido por ffprobe) |
|---|---|
| Arquivo | `content/channels/ch_practical_discipline/episodes/ep_002/video_long_1080p.mp4` |
| Duração | 6min 48s (408.07s) |
| Resolução | 1920x1080 @ 30 fps |
| Vídeo | h264 High, yuv420p, 12242 frames |
| Áudio | aac, 48000 Hz, 2 canais |
| Tamanho | 62.29 MB |
| Decodificação completa | OK em 18.1s |
| Volume médio / pico | -26.8 dBFS / -5.7 dBFS |
| Tela preta | 0s (0.00%) |

## Narração e legendas

| Medida | Valor |
|---|---|
| Motor | kokoro 0.9.4 — Apache-2.0 (pesos hexgrad/Kokoro-82M) |
| Voz | `am_michael` · 24000 Hz |
| Falas sintetizadas | 63, todas com duração medida em amostras |
| Afirmações factuais | 22 detectadas · 21 verificadas na matriz · 1 isentas por uso ilustrativo · 0 órfãs |
| Velocidade de síntese | reaproveitada do cache |
| Inteligibilidade (WER por reconhecimento de fala) | **10.18%** (limite 15%) · modelo undefined |
| Legendas | 92 cues · 94% alinhados por timestamp de palavra · última em 406.3s |

## Shorts

| Arquivo | Duração | Resolução | Janela no vídeo longo | Autossuficiência |
|---|---|---|---|---|
| `shorts/short_01.mp4` | 16.77s | 1080x1920 | 0.25s–17.02s | Abre com os três números e fecha dizendo que nenhum deles é sobre o espectador. A tensão se resolve dentro do próprio trecho. |
| `shorts/short_02.mp4` | 50.18s | 1080x1920 | 22.39s–72.58s | Correção de origem completa: de onde veio o número, o que ele descrevia e qual qualificador se perdeu. Não depende do resto. |
| `shorts/short_03.mp4` | 39.58s | 1080x1920 | 189.83s–229.4s | Argumento de sobrevivência inteiro: o dado, a leitura errada e a leitura certa, no mesmo trecho. |

## Gates

**APROVADO_PARA_REVISAO_HUMANA** — 28/28 testes.

| Teste | Resultado | Evidência |
|---|---|---|
| `mp4_decodifica_inteiro` | OK | ffmpeg -xerror decodificou todo o arquivo em 18.1s |
| `tem_faixa_de_video` | OK | h264 1920x1080 |
| `tem_faixa_de_audio` | OK | aac 48000Hz 2ch |
| `resolucao_1080p` | OK | 1920x1080 |
| `codec_h264_aac` | OK | h264/aac |
| `duracao_suficiente` | OK | 6.80 min (alvo 6-9 min) |
| `audio_nao_mudo` | OK | media -26.8 dBFS |
| `audio_sem_clipping` | OK | pico -5.7 dBFS |
| `sem_tela_preta_prolongada` | OK | 0s de tela preta (0.00%) |
| `legendas_coerentes` | OK | 92 cues, 94% alinhados por ASR, ultima em 406.3s |
| `narracao_inteligivel` | OK | WER 10.18% (limite 15%) |
| `miniatura_A` | OK | 1280x720 |
| `miniatura_B` | OK | 1280x720 |
| `miniaturas_distintas_e_nao_enganosas` | OK | 21. 66. 59. / Only 23% ever got there |
| `tres_shorts_verticais_reais` | OK | short_01 1080x1920 16.77s audio:true decod:true · short_02 1080x1920 50.18s audio:true decod:true · short_03 1080x1920 39.58s audio:true decod:true |
| `shorts_com_legenda_queimada_medida` | OK | short_01: 4.99% de pixels de texto na faixa (fundo 0%) · short_02: 5.177% de pixels de texto na faixa (fundo 0%) · short_03: 4.875% de pixels de texto na faixa (fundo 0%) |
| `shorts_sem_sobreposicao` | OK | 0.25-17.02s · 22.39-72.58s · 189.83-229.4s |
| `fontes_revisadas_por_matriz` | OK | 22 falas factuais, 21 com entrada verificada, 0 bloqueios, 0 entradas orfas, verificador: Claude Code — sessao 2026-11-11 (busca web contra registro do artigo, resumo em repositorio aberto ou texto primario) |
| `autonomia_declarada_honestamente` | OK | 3 estagio(s) declarados como NAO autonomos: ideation, research, script |
| `direitos_dos_ativos_revisados` | OK | 10 cenas com licenca declarada, 0 midia de terceiro |
| `nenhum_ativo_simulado` | OK | nenhum artefato marcado como simulado; visuais gerados por codigo proprio |
| `publico_configurado` | OK | made_for_kids=false (declarado explicitamente) |
| `privacidade_explicita` | OK | privacyStatus=private |
| `midia_sintetica_avaliada` | OK | A narração é sintética e isso é declarado na descrição. A política de divulgação de mídia sintética alcança conteúdo REA... |
| `sem_promessa_de_monetizacao` | OK | descricao e metadata sem promessa de receita, views ou algoritmo |
| `despesa_externa_zero` | OK | US$ 0.00 em todos os 19 estagios |
| `revisao_de_narrativa_aprovada` | OK | 9 checagens |
| `risco_conteudo_repetitivo_baixo` | OK | 10 motivos visuais e 10 movimentos de camera distintos em 10 cenas |

## Direitos e originalidade

- Cenas com licença declarada: **10/10**, nenhuma com licença desconhecida.
- Mídia de terceiro: **nenhuma** · banco de imagens: **nenhum** · imagem generativa: **nenhuma**.
- Voz clonada de pessoa real: **não**. Trilha musical: **ausente por decisão**.
- Fontes verificadas: **4** · afirmações retiradas por não confirmação: **3**.
- Arquivos entregues com sha256 no manifesto: **8**.

## Agentes que realmente executaram

| Função | Estágios |
|---|---|
| Diretor Editorial | `strategy`, `selection` |
| Pesquisador de Demanda | `ideation` |
| Pesquisador de Fontes | `research` |
| Roteirista | `script` |
| Verificador de Fatos | `factcheck` |
| Editor de Narrativa | `narrative_review` |
| Diretor de Arte | `storyboard` |
| Curador de Midia e Direitos | `media_rights`, `provenance` |
| Produtor de Voz | `voice`, `align`, `captions` |
| Editor e Renderizador | `scenes`, `edit` |
| Designer de Miniaturas | `thumbnail` |
| Especialista de Descoberta/SEO | `seo` |
| Produtor de Shorts | `shorts` |
| Auditor Tecnico e de Conformidade | `qa` |

Funções configuradas mas **sem execução neste piloto**: CEO Virtual / Diretor-Geral (ceo), Editor de Publicacao e Analytics (publishing_analytics) — o CEO virtual opera por chat/API e o editor de publicação está bloqueado por falta de OAuth.

## YouTube

- Estado real: **BLOQUEADO** — YOUTUBE_CLIENT_ID/YOUTUBE_CLIENT_SECRET ausentes no .env
- Upload possível: **não** · Analytics possível: **não**
- Vídeos enviados por este sistema: **0**
- Token guardado não é prova: o estado `AUTORIZADO` só é declarado depois de uma chamada real à API que confirme o canal.
- Privacidade padrão configurada: `private`. Público infantil declarado: `false`.

## Aprovação

- Estado: **pending**
- Aprovar no painel vale **somente para este vídeo** e não autoriza envios futuros.