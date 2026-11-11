# Evolution Engine

A empresa não publica vídeo e torce. Ela declara uma hipótese antes de produzir, mede o que aconteceu, e só converte isso em regra quando a evidência sustenta — sob auditoria.

## A regra que organiza tudo

> **Nenhum agente atribui falha a uma etapa sem evidência de que o público chegou até ela.**

Isso não é conselho, é uma função que recusa. Se a retenção inicial derrubou 90% da audiência, a cena 8 não "falhou": ela **não foi avaliada**. `funnel.canAttributeFailure()` devolve `{allowed:false}` com o motivo, e o auditor bloqueia qualquer veredicto que tente passar por cima.

## Os cinco estados de evidência

| Estado | O que significa | Pode culpar? |
|---|---|---|
| `OBSERVED_FAILURE` | medida suficiente mostra desempenho abaixo da referência | **sim** |
| `UNPROVEN_HYPOTHESIS` | há suspeita, a medida não sustenta | não |
| `INCONCLUSIVE_SAMPLE` | há dado, pouco demais para separar do acaso | não |
| `STAGE_NOT_REACHED` | o público não chegou aqui | não |
| `DATA_UNAVAILABLE` | a API, a distribuição ou o limite de medição não entregaram | não |

Métrica ausente **nunca** vira zero. Há teste provando isso.

## O funil

`exposição → clique → retenção inicial → retenção intermediária → retenção final → conversão de Short para longo → receita`

Cada etapa tem a pergunta que ela responde, o alcance medido e o piso de amostra. Quando a etapa anterior não foi atravessada, a seguinte é marcada como não avaliada, por propagação.

## Registro imutável

`var/evolution/<canal>/experiments.jsonl` — append-only, com hash encadeado. Nada é editado, nada é apagado. Mudar de ideia gera **evento novo** que aponta para o anterior; o veredicto antigo continua legível com a data em que valia.

`verifyChain()` detecta evento alterado **e** evento removido. Há gate no pipeline que reprova o episódio se a corrente quebrar.

## O auditor metodológico

Agente que só sabe dizer não. Bloqueia:

- linguagem causal em comparação observacional;
- culpa de etapa sem alcance medido;
- culpa de cena sem curva de retenção mostrando público nela;
- mais de três variáveis diferentes entre episódios comparados;
- veredicto sobre amostra pequena;
- promoção a "prática sustentada" com menos de 3 experimentos independentes;
- qualquer tentativa de generalizar fora das condições testadas.

Quando ele bloqueia, o veredicto é **reescrito** e ambos ficam no registro: o proposto e o final.

## Conhecimento em três camadas

`hipótese promissora` → `prática sustentada por evidência` → `descartada ou inconclusiva`

Toda afirmação é citada **com as condições coladas**: canal, nicho, duração, origem de tráfego, n. Não existe "a técnica X não funciona" — existe "não funcionou neste nicho, nesta duração, com esta origem, em N experimentos". Fora disso, continua **não testada**.

## Miniaturas: medida, não declaração

Para cada miniatura o sistema mede no pixel: cores dominantes, luminância média, razão de contraste entre percentis 5 e 95, fração de massa clara (o texto), caixa delimitadora e lado, mais o sha256 do arquivo. Texto e intenção emocional são **declaração** de quem desenhou, e ficam marcados como tal.

A análise já encontrou um problema real: a miniatura A do ep_001 mede 4,17:1 de contraste, abaixo do piso de 4,5:1.

## Revisão de 48 horas

O prazo autoriza **olhar**, nunca trocar. `review48h()` recusa qualquer recomendação enquanto: não passaram 48h, não há impressões medidas, há menos de 1000 impressões, ou houve troca de miniatura na última semana (trocar de novo embaralha o teste nativo do YouTube).

Quando libera, a recomendação é para **humano**, e diz para usar o teste nativo do YouTube Studio. **Não existe integração de teste A/B pela API — e o sistema não finge que existe.**

## Como usar

```bash
node src/cli.js evolution                  # estado de todos os experimentos
node src/cli.js evolution timeline         # o log imutável, evento a evento
node src/cli.js evolution knowledge        # o que o canal aprendeu até agora
node src/cli.js evolution review ep_002    # revisão de 48h (recomenda, não troca)
node src/cli.js budget                     # tetos e gasto real
```

No painel: **Experimentos**, **Conhecimento**, **Linha do tempo**, **Pauta de 30** e **Orçamento**.

## O que ainda não existe

Nenhum episódio foi publicado, então **não há uma única métrica de audiência**. Tudo que o motor mostra hoje é: hipótese registrada, produção anotada, miniatura medida, e `aguardando dados` em todo veredicto. Isso é o estado honesto — e é por isso que o painel escreve "isso não é zero, é ausência".
