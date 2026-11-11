# Entrega do piloto — youtube-media-company

Gerado automaticamente a partir do store e do disco em 2026-11-11T15:53:54.733Z.

## Máquina

| Item | Valor |
|---|---|
| Sistema | linux 6.18.44-fc-v378 |
| CPU | Intel(R) Xeon(R) Processor @ 2.30GHz · 4 vCPU |
| Memória | 15.7 GB |
| Node | v22.23.4 |

## Pipeline executado

| Estágio | Agente | Modo | Tempo | Artefatos | Custo |
|---|---|---|---|---|---|
| Nicho e tese editorial `strategy` | editorial_director | real | 0.0s | 1 | US$ 0.00 |
| Ideias com evidencia `ideation` | demand_researcher | assisted | 0.0s | 1 | US$ 0.00 |
| Selecao editorial `selection` | editorial_director | assisted | — | 1 | US$ 0.00 |
| Dossie de pesquisa `research` | source_researcher | real | — | 2 | US$ 0.00 |
| Roteiro EN-US `script` | scriptwriter | assisted | 0.0s | 1 | US$ 0.00 |
| Auditoria de fatos `factcheck` | fact_checker | real | 0.0s | 2 | US$ 0.00 |
| Revisao de narrativa `narrative_review` | narrative_editor | real | 0.0s | 1 | US$ 0.00 |
| Storyboard `storyboard` | art_director | real | 0.0s | 1 | US$ 0.00 |
| Licenciamento de midia `media_rights` | media_rights_curator | real | 0.0s | 1 | US$ 0.00 |
| Narracao (TTS local) `voice` | voice_producer | real | 120.8s | 2 | US$ 0.00 |
| Alinhamento por reconhecimento de fala `align` | voice_producer | real | 39.1s | 2 | US$ 0.00 |
| Render de cenas 1080p `scenes` | editor_renderer | real | 48.8s | 11 | US$ 0.00 |
| Montagem final MP4 `edit` | editor_renderer | real | 11.3s | 1 | US$ 0.00 |
| Legendas SRT `captions` | voice_producer | real | 0.1s | 2 | US$ 0.00 |
| Miniaturas A/B `thumbnail` | thumbnail_designer | real | 0.8s | 3 | US$ 0.00 |
| Titulo, descricao, capitulos `seo` | discovery_seo | real | 0.1s | 1 | US$ 0.00 |
| Tres Shorts 9:16 `shorts` | shorts_producer | real | 64.8s | 7 | US$ 0.00 |
| Manifesto de origem e direitos `provenance` | media_rights_curator | real | 0.2s | 1 | US$ 0.00 |
| Auditoria tecnica e gates `qa` | compliance_auditor | real | 52.2s | 1 | US$ 0.00 |

**Tempo somado de execução:** 5.6 min · **Despesa externa total: US$ 0.00**

## Vídeo longo

| Medida | Valor (medido por ffprobe) |
|---|---|
| Arquivo | `content/channels/ch_practical_discipline/episodes/ep_001/video_long_1080p.mp4` |
| Duração | 7min 50s (469.50s) |
| Resolução | 1920x1080 @ 30 fps |
| Vídeo | h264 High, yuv420p, 14085 frames |
| Áudio | aac, 48000 Hz, 2 canais |
| Tamanho | 74.21 MB |
| Decodificação completa | OK em 21.2s |
| Volume médio / pico | -26.8 dBFS / -5.8 dBFS |
| Tela preta | 0s (0.00%) |

## Narração e legendas

| Medida | Valor |
|---|---|
| Motor | kokoro 0.9.4 — Apache-2.0 (pesos hexgrad/Kokoro-82M) |
| Voz | `am_michael` · 24000 Hz |
| Falas sintetizadas | 71, todas com duração medida em amostras |
| Velocidade de síntese | 4.21x tempo real |
| Inteligibilidade (WER por reconhecimento de fala) | **6.45%** (limite 15%) · modelo undefined |
| Legendas | 104 cues · 95% alinhados por timestamp de palavra · última em 467.7s |

## Shorts

| Arquivo | Duração | Resolução | Janela no vídeo longo | Autossuficiência |
|---|---|---|---|---|
| `shorts/short_01.mp4` | 25.27s | 1080x1920 | 0.25s–25.52s | Abre nomeando o problema e fecha na frase que o espectador reconhece como propria. Nao depende de nada dito antes. |
| `shorts/short_02.mp4` | 40.83s | 1080x1920 | 124.98s–165.81s | Argumento circular completo: premissa, mecanismo e conclusao dentro do proprio trecho. |
| `shorts/short_03.mp4` | 42.05s | 1080x1920 | 309.16s–351.21s | Correcao factual autossuficiente, com o numero, a fonte e a ressalva no mesmo trecho. |

## Gates

**APROVADO_PARA_REVISAO_HUMANA** — 27/27 testes.

| Teste | Resultado | Evidência |
|---|---|---|
| `mp4_decodifica_inteiro` | OK | ffmpeg -xerror decodificou todo o arquivo em 21.2s |
| `tem_faixa_de_video` | OK | h264 1920x1080 |
| `tem_faixa_de_audio` | OK | aac 48000Hz 2ch |
| `resolucao_1080p` | OK | 1920x1080 |
| `codec_h264_aac` | OK | h264/aac |
| `duracao_suficiente` | OK | 7.83 min (alvo 6-9 min) |
| `audio_nao_mudo` | OK | media -26.8 dBFS |
| `audio_sem_clipping` | OK | pico -5.8 dBFS |
| `sem_tela_preta_prolongada` | OK | 0s de tela preta (0.00%) |
| `legendas_coerentes` | OK | 104 cues, 95% alinhados por ASR, ultima em 467.7s |
| `narracao_inteligivel` | OK | WER 6.45% (limite 15%) |
| `miniatura_A` | OK | 1280x720 |
| `miniatura_B` | OK | 1280x720 |
| `miniaturas_distintas_e_nao_enganosas` | OK | Waiting is the trap / The task got heavier. The work did not. |
| `tres_shorts_verticais_reais` | OK | short_01 1080x1920 25.27s audio:true decod:true · short_02 1080x1920 40.83s audio:true decod:true · short_03 1080x1920 42.05s audio:true decod:true |
| `shorts_com_legenda_queimada_medida` | OK | short_01: 3.856% de pixels de texto na faixa (fundo 0%) · short_02: 5.005% de pixels de texto na faixa (fundo 0%) · short_03: 1.039% de pixels de texto na faixa (fundo 0%) |
| `shorts_sem_sobreposicao` | OK | 0.25-25.52s · 124.98-165.81s · 309.16-351.21s |
| `fontes_revisadas` | OK | 11 afirmacoes, 0 sem fonte, 0 atribuicoes sem fonte |
| `direitos_dos_ativos_revisados` | OK | 10 cenas com licenca declarada, 0 midia de terceiro |
| `nenhum_ativo_simulado` | OK | nenhum artefato marcado como simulado; visuais gerados por codigo proprio |
| `publico_configurado` | OK | made_for_kids=false (declarado explicitamente) |
| `privacidade_explicita` | OK | privacyStatus=private |
| `midia_sintetica_avaliada` | OK | A narração é sintética e isso é declarado na descrição. A política de divulgação de mídia sintética alcança conteúdo REA... |
| `sem_promessa_de_monetizacao` | OK | descricao e metadata sem promessa de receita, views ou algoritmo |
| `despesa_externa_zero` | OK | US$ 0.00 em todos os 19 estagios |
| `revisao_de_narrativa_aprovada` | OK | 9 checagens |
| `risco_conteudo_repetitivo_baixo` | OK | 9 motivos visuais e 10 movimentos de camera distintos em 10 cenas |

## Direitos e originalidade

- Cenas com licença declarada: **10/10**, nenhuma com licença desconhecida.
- Mídia de terceiro: **nenhuma** · banco de imagens: **nenhum** · imagem generativa: **nenhuma**.
- Voz clonada de pessoa real: **não**. Trilha musical: **ausente por decisão**.
- Fontes verificadas: **9** · afirmações retiradas por não confirmação: **3**.
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

- OAuth: **NÃO CONFIGURADO**
- Publicação: **BLOQUEADA**. Nenhum upload foi feito, nenhum ID de vídeo existe.
- Analytics: **BLOQUEADO**. Todas as métricas respondem `indisponivel`, nunca zero.
- Privacidade padrão configurada: `private`. Público infantil declarado: `false`.

## Aprovação

- Estado: **pending**
- Aprovar no painel vale **somente para este vídeo** e não autoriza envios futuros.