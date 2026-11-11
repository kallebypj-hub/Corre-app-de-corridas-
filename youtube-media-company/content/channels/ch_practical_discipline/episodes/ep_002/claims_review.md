# Claims review — ep_002

**Veredicto:** APROVADO

Falas varridas: **63** · com marcador factual: **22** · verificadas: **21** · bloqueando: **0**

Matriz: **21** afirmações, **0** órfãs, **1** isenções ilustrativas declaradas. Dossiê: **4** fontes.

Verificador declarado: Claude Code — sessao 2026-11-11 (busca web contra registro do artigo, resumo em repositorio aberto ou texto primario)

> O detector de marcadores é apenas o gatilho. A autoridade é a matriz `claims.json`: cada afirmação diz contra o quê foi conferida, por quem e quando. Fala com marcador e sem entrada bloqueia; entrada sem evidência bloqueia; entrada órfã bloqueia.

## Afirmação a afirmação

| Cena | Afirmação | Tipo | Fonte | Conferida contra | Por / quando | Status |
|---|---|---|---|---|---|---|
| s01 | Twenty one days. | number_inventory | src_maltz_1960 | Psycho-Cybernetics (1960) | claude-code-2026-11-11 / 2026-11-11 | verificada |
| s01 | Sixty six days. Fifty nine days. | number_inventory | src_lally_2010_ep2, src_singh_2024 | as duas fontes do dossie deste episodio | claude-code-2026-11-11 / 2026-11-11 | verificada |
| s02 | Start with twenty one, because it's the oldest and the most wrong. | framing | src_maltz_1960 | Psycho-Cybernetics (1960) | claude-code-2026-11-11 / 2026-11-11 | verificada |
| s02 | It comes from a book published in nineteen sixty. Psycho-Cybernetics, by Maxwell Maltz. | attribution | src_maltz_1960 | registro bibliografico do livro | claude-code-2026-11-11 / 2026-11-11 | verificada |
| s02 | What he wrote was that it requires a minimum of about twenty one days for an old mental image to dissolve and a new one  | paraphrase_of_original_wording | src_maltz_1960 | texto do livro conforme relatado nas fontes consultadas | claude-code-2026-11-11 / 2026-11-11 | verificada |
| s03 | In two thousand ten, Phillippa Lally's team at University College London followed ninety six people for eighty four days | study_design | src_lally_2010_ep2 | release da UCL e registro do artigo (doi 10.1002/ejsp.674) | claude-code-2026-11-11 / 2026-11-11 | verificada |
| s03 | Sixty six days is roughly where the average curve got close to its own ceiling. It describes a shape. It is not a deadli | interpretation_of_measure | src_lally_2010_ep2 | descricao do metodo do estudo | claude-code-2026-11-11 / 2026-11-11 | verificada |
| s04 | Then two thousand twenty four, and the biggest look at this so far. | framing | src_singh_2024 | registro do artigo | claude-code-2026-11-11 / 2026-11-11 | verificada |
| s04 | Singh, Murphy, Maher and Smith pulled together twenty studies covering two thousand six hundred and one adults. | study_design | src_singh_2024 | resumo do artigo e repositorio da Universidade de Adelaide | claude-code-2026-11-11 / 2026-11-11 | verificada |
| s04 | Here's the first uncomfortable detail. Of those twenty studies, only four actually reported how long habit formation too | evidence_base_size | src_singh_2024 | resumo do artigo | claude-code-2026-11-11 / 2026-11-11 | verificada |
| s04 | Among the people who did form a habit, the median was about fifty nine days. | statistic | src_singh_2024 | resumo do artigo | claude-code-2026-11-11 / 2026-11-11 | verificada |
| s04 | And the range ran from four days to three hundred and thirty five. | statistic_range | src_singh_2024 | resumo do artigo | claude-code-2026-11-11 / 2026-11-11 | verificada |
| s05 | Four days to three hundred and thirty five days. | statistic_range | src_singh_2024 | resumo do artigo | claude-code-2026-11-11 / 2026-11-11 | verificada |
| s06 | Only twenty three percent of participants reached the threshold the researchers had set for a habit. | statistic | src_singh_2024 | resumo do artigo | claude-code-2026-11-11 / 2026-11-11 | verificada |
| s06 | Twenty three percent. | statistic | src_singh_2024 | resumo do artigo | claude-code-2026-11-11 / 2026-11-11 | verificada |
| s06 | So the median isn't the midpoint of everyone who tried. It's the midpoint of the people who got there. | interpretation | src_singh_2024 | deducao explicita a partir dos dois numeros reportados no mesmo artigo | claude-code-2026-11-11 / 2026-11-11 | verificada |
| s07 | Pick sixty six. Day sixty seven arrives, and it still takes effort. | illustrative_use_of_cited_number | src_lally_2010_ep2 | o proprio numero ja verificado em b06 | claude-code-2026-11-11 / 2026-11-11 | verificada |
| s07 | The honest reading says you're sitting comfortably inside a range that runs to three hundred and thirty five days. | statistic_range | src_singh_2024 | resumo do artigo | claude-code-2026-11-11 / 2026-11-11 | verificada |
| s07 | The number in your head says you failed six weeks ago. | isencao_ilustrativa | — | nao se aplica — uso ilustrativo | claude-code-2026-11-11 / 2026-11-11 | ISENTA |
| s09 | In two thousand twelve, Gardner, Lally and Wardle published guidance in the British Journal of General Practice. | attribution | src_gardner_2012 | texto completo aberto no PMC3505409 | claude-code-2026-11-11 / 2026-11-11 | verificada |
| s09 | And here's the limit I owe you. Four studies is thin. That twenty twenty four review used narrative synthesis rather tha | limitation | src_singh_2024 | resumo e descricao de metodo do artigo | claude-code-2026-11-11 / 2026-11-11 | verificada |
| s10 | You're inside a range that runs to three hundred and thirty five days, and you're still in it. | statistic_range | src_singh_2024 | resumo do artigo | claude-code-2026-11-11 / 2026-11-11 | verificada |

## Retiradas antes de entrar na narração

- **NAO USADO** — medias de 106 a 154 dias para formacao de habito
  - aparece em cobertura secundaria da revisao de 2024; nao confirmado no texto primario na verificacao de 2026-11-11.

- **REFORMULADO** — Maltz teria escrito que habitos levam 21 dias
  - Maltz falava de adaptacao de autoimagem apos cirurgia, com os qualificadores 'um minimo de cerca de'. Atribuir a ele uma regra sobre habitos seria citacao falsa. A narracao corrige isso explicitamente.

- **REFORMULADO** — a regra dos 21 dias foi 'refutada'
  - A revisao de 2024 argumenta contra a ideia de 21 dias, mas a narracao evita a palavra refutacao e descreve o que o corpo de evidencia de fato mostra e o quanto ele e fino.
