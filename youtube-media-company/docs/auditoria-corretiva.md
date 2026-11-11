# Auditoria corretiva — o que estava errado e o que foi feito

Rodada de 2026-11-11, sobre o piloto entregue na sessão anterior. Registro honesto: tudo aqui são defeitos do próprio sistema, encontrados e corrigidos nesta rodada.

## 1. Conteúdo embutido no código (generalização)

| Era assim | Agora |
|---|---|
| 12 pautas escritas dentro de `stages/editorial.js` | `content/channels/<canal>/ideas.json` |
| `selection` escolhia `idea_01` por literal | lê `brief.idea_id` do episódio |
| título, descrição, capítulos e tags dentro de `stages/finishing.js` | `brief.metadata` e `brief.chapters` |
| trechos dos Shorts dentro de `stages/shorts.js` | `brief.shorts` |
| textos das miniaturas dentro de `stages/finishing.js` | `brief.thumbnails` |
| `episode_id: 'ep_001'` em `storyboard` e `provenance` | `epId` vindo do pipeline |
| dossiê de fontes no nível do canal | `sources.json` dentro do episódio; o do canal virou biblioteca |
| verificação de fatos por tabela de regex com os nomes do ep_001 | matriz `claims.json` por episódio |
| `tem_limite_admitido` procurava frases literais do ep_001 | lê a matriz: alguma afirmação marcada como `limitation` ou com ressalva presente |
| `convite_pertinente` procurava palavras do ep_001 | exige pedido concreto usando vocabulário próprio do episódio |
| detector de marcadores com a lista de números do ep_001 | detector genérico: quantidade com unidade, ano, estatística, atribuição, verbo de citação |
| `ep_001` como padrão em CLI, relatório e CEO | lista vinda do disco |

**Prova:** `node src/test.js ep_002` inclui um teste que varre o código dos estágios procurando `ep_00\d` e o título do episódio. Falha se algum voltar.

## 2. Verificação de fatos: de regex para matriz rastreável

O regex era a autoridade — se o padrão batesse, a afirmação passava. Agora o detector é só o **gatilho**; a autoridade é `claims.json`, onde cada afirmação carrega fonte, evidência, contra o quê foi conferida, quem conferiu e quando.

Bloqueia o episódio: fala com marcador e sem entrada; entrada sem evidência, verificador ou data; entrada apontando para fonte fora do dossiê; **entrada órfã** (texto que não existe mais no roteiro, para a matriz não envelhecer calada); ressalva exigida pelo dossiê e ausente da matriz.

Número usado como ilustração ("uma caminhada de trinta minutos") não afrouxa o detector: exige **isenção assinada** em `claims.json → exemptions`, com justificativa, autor e data. Silêncio não é auditável; isenção é.

## 3. Autonomia declarada em vez de fingida

Cada estágio declara seu nível em `src/autonomy.js`, e isso aparece no painel, no `provenance.json`, no relatório e no CEO. Hoje `ideation`, `research` e `script` são **assistidos** — foram trabalho intelectual desta sessão, e o episódio 3 vai exigir o mesmo, por uma pessoa ou por um agente com LLM configurada. Há um teste que reprova se nenhum estágio for declarado assim.

## 4. Buracos de estado encontrados nesta rodada

- **Editar `script_en.json` no disco não invalidava nada.** O pipeline agora guarda a impressão digital de `brief.json`, `script_en.json`, `sources.json` e `claims.json`, e marca os estágios como desatualizados quando elas mudam.
- **Mudar a arte de um motivo visual não invalidava as cenas.** A assinatura da cena passou a incluir o hash de `src/render/compose.js`.
- **`pvAuto` era usado antes de ser declarado** no estágio de auditoria (erro em tempo de execução). Corrigido antes de rodar.

## 5. YouTube: de recusa educada para cliente real

Antes: um módulo que só respondia "BLOQUEADO" e tratava a existência de arquivo como token.

Agora: OAuth 2.0 completo (state de 32 bytes com validade e uso único, troca de código, refresh com folga, revogação que chama o Google antes de apagar o token local), tokens cifrados com AES-256-GCM em arquivo 0600, upload retomável `videos.insert` com pedaços de 8 MB e tratamento de 308, `privacyStatus=private` forçado no cliente, trava de duplicidade por sha256 do arquivo, e coleta de métricas que mantém `indisponivel` o que não veio.

**O estado `AUTORIZADO` nunca é declarado por existência de arquivo** — só depois de uma chamada real que confirme o canal.

21 testes exercitam esse cliente contra um espelho local do Google, incluindo queda de conexão no meio do envio. Eles **não** provam que o Google aceitou: isso exige as credenciais do dono.

## 6. Segurança

- Travessia de caminho: nove ataques testados (`..`, `%2e%2e`, absoluto, pastas internas de trabalho), todos recusados.
- Com `API_KEY` definida, **leitura também** exige chave — artefato é o produto da empresa. Comparação em tempo constante.
- Sessão por cookie HttpOnly/SameSite=Strict para o navegador conseguir tocar vídeo e imagem.
- O servidor **recusa subir** fora de 127.0.0.1 sem chave de 32+ caracteres, e recusa HTTP puro exposto sem reconhecimento explícito de TLS.
- Nenhuma rota devolve token; toda mensagem de erro passa por uma função de limpeza que remove `access_token`, `refresh_token`, `Bearer` e `code=`.
- `.env` e chave de token em 0600, pasta de tokens em 0700, `var/` inteiro fora do Git.

## 7. Defeito encontrado na rodada anterior que continua coberto

Os Shorts saíam **sem legenda** e o metadata declarava `captions_burned: true` por afirmação, não por medição. Hoje a legenda é medida no quadro (fração de pixels claros na faixa, contra o mesmo recorte do fundo) e há gate para isso.
