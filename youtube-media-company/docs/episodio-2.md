# Como gerar o EPISÓDIO 2

O pipeline é repetível. O que muda entre episódios é **o roteiro e as fontes** — o resto é o mesmo comando.

## Caminho curto (modo piloto assistido, como o ep_001)

1. Escolha a pauta. As 12 estão em `content/channels/ch_practical_discipline/episodes/ep_001/ideas.json`. A fila do calendário sugere `idea_04` ("The 66-Day Habit Myth, Corrected") — ela já tem fonte primária confirmada.

2. Monte a pasta do episódio:
```bash
cd youtube-media-company
mkdir -p content/channels/ch_practical_discipline/episodes/ep_002
```

3. Escreva `ep_002/script_en.json` no mesmo formato do ep_001: `scenes[]`, cada cena com `id`, `role`, `motif`, `accent`, `purpose`, `on_screen` e `beats[]`. Cada beat tem `text` (a fala) e `screen` (`title`, `sub`, `cite`, `item:N`, `beat:<tarja>` ou `hold`).
   - Use **motivos visuais diferentes** dos usados na cena vizinha: os disponíveis são `single_statement`, `rule_box`, `evidence_list`, `citation`, `inflation_chart`, `if_then`, `correction`, `quote_pair`, `closing_statement`.
   - Alvo: 850–1500 palavras. O ep_001 tem 1022 e deu 7min50.

4. Atualize `content/channels/ch_practical_discipline/sources.json` com as fontes do novo episódio, **verificadas antes**, e registre em `rejected_or_withheld` tudo que você não conseguiu confirmar na fonte primária.

5. Ensine o verificador a mapear as novas afirmações: em `src/stages/audit.js`, acrescente entradas no array `MAP` ligando o padrão do texto ao `id` da fonte. Se você esquecer, o estágio `factcheck` **reprova** — é esse o ponto.

6. Rode:
```bash
node src/cli.js produce ep_002
```

7. Revise no painel, em Estúdio de Revisão. Aprovar vale só para esse vídeo.

## Quando houver chave de LLM e autorização de gasto

O estágio `script` passa a poder gerar o roteiro sozinho. Nesse caso: mude `mode` para `real`, registre o modelo e o custo no retorno do estágio, e **mantenha o `factcheck` como está** — roteiro gerado por modelo é exatamente o que mais precisa do verificador de fontes.

## Tempos medidos no ep_001 (4 vCPU, 15 GB)

Estão em `content/channels/ch_practical_discipline/episodes/ep_001/quality_report.json` e no `status` do episódio. Use-os para estimar: o render de cena domina o tempo e cresce com a duração da cena.

## Atalho para corrigir uma cena só

```bash
node src/cli.js stage scenes ep_002     # cenas inalteradas são reaproveitadas pelo fingerprint
node src/cli.js produce ep_002          # segue daí para montagem, legendas, shorts e gates
```
