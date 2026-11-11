# Como produzir um episódio novo

**Sem tocar em código.** O pipeline lê configuração; o conteúdo vive na pasta do episódio.

## Os quatro arquivos

Crie `content/channels/<canal>/episodes/<ep>/` com:

| Arquivo | O que é | Quem faz |
|---|---|---|
| `brief.json` | título, tese, capítulos, metadados, Shorts e miniaturas | pessoa ou agente |
| `script_en.json` | cenas, motivo visual, propósito e falas | pessoa ou agente |
| `sources.json` | dossiê de fontes, com DOI ou URL e data de verificação | pessoa ou agente |
| `claims.json` | matriz de afirmações: fonte, evidência, contra o quê foi conferida, por quem, quando | pessoa ou agente |

Isso não é modéstia: **o pipeline não escreve nenhum desses quatro.** Ele valida, bloqueia, narra, renderiza, legenda, corta, audita e publica. A parte intelectual é assistida, e cada estágio declara isso no painel e no `provenance.json`.

## Rodar

```bash
node src/cli.js episodes          # lista o que existe no disco
node src/cli.js produce ep_003    # retoma do checkpoint
node src/cli.js status ep_003
```

## O que o sistema vai cobrar de você

- **Fonte sem DOI nem URL** → recusa no carregamento.
- **Fonte sem data de verificação** → `research` reprova.
- **Fala com marcador factual e sem entrada na matriz** → `factcheck` reprova e diz qual fala.
- **Entrada na matriz sem evidência, sem verificador ou sem data** → reprova.
- **Entrada órfã** (texto que não existe mais no roteiro) → reprova, para a matriz não envelhecer calada.
- **Número usado como ilustração** → declare em `claims.json → exemptions`, com justificativa assinada. Silêncio não passa.
- **Episódio sem limite admitido** → `narrative_review` reprova. Marque ao menos uma afirmação como `limitation` ou com `caveat_present`.
- **Editar qualquer um dos quatro arquivos depois de produzir** → o pipeline detecta pela impressão digital e marca os estágios como desatualizados.

## Motivos visuais disponíveis

`single_statement`, `rule_box`, `evidence_list`, `citation`, `inflation_chart`, `if_then`, `correction`, `quote_pair`, `closing_statement`, `number_trio`, `origin_timeline`, `survivorship_funnel`, `distribution_spread`, `asymptote_curve`, `deadline_calendar`, `cue_repetition`, `evidence_gap`.

Use motivos que o episódio vizinho não usou: há teste medindo isso (`node src/test-independence.js ep_001 ep_002`).

## Quando houver LLM configurada

O estágio `script` pode passar a gerar sozinho. Nesse caso: mude `autonomy` em `src/autonomy.js` para `automated`, registre modelo e custo no retorno do estágio, e **mantenha o `factcheck` como está** — roteiro gerado por modelo é justamente o que mais precisa da matriz.
