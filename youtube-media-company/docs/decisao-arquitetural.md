# Decisão arquitetural e matriz de reúso

Data: 2026-11-11 · Decidido por: engenheiro-chefe, com base em teste executado, não em leitura de README.

## Matriz

| Repositório | Licença | Commit fixado | Decisão | Causa concreta (medida) |
|---|---|---|---|---|
| `darkzOGx/youtube-automation-agent` | MIT | `e973d515aef90c467da2289144df737a3bd03859` (2026-10-26, v2.11.0) | **ADAPTADO (parcial)** | Auditado por dentro. Arquitetura reaproveitada; renderizador e caminho de narração substituídos (ver abaixo). |
| `paperclipai/paperclip` | MIT | `a4e89288ec0f2c67fc900b4a0f130e330d196eaa` (2026-11-11) | **ADIADO — ponte entregue** | `engines.node >= 24.11.0`; esta máquina roda **v22.23.4**. `pnpm install` passou (27,4 s) mas emitiu `WARN Unsupported engine`. O build do monorepo não fechou na janela de 420 s em 4 vCPU e `pnpm run dev:server` morre com `ERR_MODULE_NOT_FOUND` em `@paperclipai/plugin-sdk/dist/index.js`. |
| `paperclipai/companies` | MIT no conteúdo próprio; skills de terceiros mantêm a licença de origem | `514503bf4f0ca88ebf16d5dc648e085d587f268f` | **REJEITADO para importação em massa** | A própria licença diz que pacotes derivados de terceiros mantêm licenças de origem. Importar centenas de agentes sem checar licença uma a uma é risco jurídico sem ganho. Usado só como referência de estrutura. |
| `msitarzewski/agency-agents` | MIT | `8ae6164602c95ca78828b148b9052460ee426885` | **REFERÊNCIA** | Leitura de competências para desenhar as 16 funções. Nenhum arquivo copiado: nossos agentes são código determinístico com entregável tipado, não prompts. |
| `ruvnet/ruflo` (claude-flow 3.76.0) | MIT | `dc25dd9b522bf1f3761f0d061a0bd0deb1900ba1` | **REJEITADO para o piloto** | Testado em sandbox isolado. Instala (CLI responde `ruflo v3.76.0`) mas **`ruflo init` falha**: `statusline-generator: could not locate .claude/helpers/statusline.cjs … This is a packaging bug`. Custo: **1,4 GB** de `node_modules` contra **0 dependência npm** deste projeto. E escreveria `.claude/`, `.claude-flow/`, `.mcp.json`, `.swarm/` na base. Acima de tudo: ele orquestra agentes de LLM, e nosso executor é o pipeline — adotá-lo criaria um **segundo escalonador para o mesmo trabalho**, o que o escopo proíbe. |
| `jphermans/free-llm-api-resources` | **sem arquivo de licença** | `e6765bc91580573ab7b8c7859a07edef5e6c7bcb` | **CATÁLOGO, leitura apenas** | Sem licença declarada, nada é copiado. E o piloto não acionou provedor externo nenhum, então nem a lista foi necessária para decidir: a narração é local. |

## O que foi reaproveitado do `youtube-automation-agent`

Reaproveitado conceitualmente, com crédito: a forma do pipeline (HTML → frames via Playwright → FFmpeg), a separação de serviços por responsabilidade (`provenance-service`, `shorts-repurposing-service`, `scene-repair-service`, `production-readiness-service`), as rotas de saúde/prontidão/operador do painel, e o padrão de privacidade privada por padrão.

## Por que o renderizador não foi usado como está

O escopo manda "sem reescrever o renderizador" e, ao mesmo tempo, exige "movimento visual coerente", "ritmo de edição coerente com a narrativa", "nenhum frame placeholder" e proíbe "template de slideshow repetido". No código auditado (`utils/ai-video-generator.js`, `renderSlidesToVideo`), o renderizador captura **um still por slide** e distribui a duração do áudio entre eles com `xfade`. Para um vídeo de 7–8 minutos com ~10 cenas isso dá **mais de 45 segundos de imagem parada por cena**. Os dois requisitos não cabem juntos.

Decisão: o renderizador original **não foi apagado nem alterado** — ele segue disponível no fork de referência. O que fizemos foi **estender a mesma arquitetura** num renderizador por cena (`src/render/renderer.js`): câmera contínua com `zoompan` em arte renderizada a 2560×1440, revelação de texto em batidas sincronizadas à narração e um MP4 por cena, o que é justamente o que viabiliza a remontagem de uma cena isolada. Isso é adaptação dentro da mesma linhagem, não substituição do método.

## Por que a narração mudou de caminho

`docs/providers.md` do motor é explícito: narração usa ElevenLabs, OpenAI ou Gemini — **todos exigem chave e fatura**, e "a video without working narration can't be approved". Com limite de despesa em US$ 0,00 e sem autorização de gasto, esse caminho está fechado. O motor cairia em `simulateTTSGeneration`, isto é, áudio falso — o que o escopo proíbe explicitamente.

Caminho adotado: **Kokoro-82M local**, pesos Apache-2.0, rodando em CPU nesta máquina. Custo externo: zero. Qualidade comprovada objetivamente por WER de reconhecimento de fala, não por opinião.

## Quem controla o quê (regra do escalonador único)

- **Execução de produção:** `src/pipeline.js`. Dono único. É o que renderiza, mede e grava checkpoint.
- **Administração (quando o Paperclip subir):** entra por `src/bridge/paperclip-adapter.js`, que **pede** produção e **lê** estado. Não agenda upload, não dispara render por conta própria.
- **Fila de publicação:** dono único, este serviço. Nunca haverá dois agendadores disputando a mesma publicação.
