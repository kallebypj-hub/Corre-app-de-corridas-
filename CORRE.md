# CORRE — Projeto Completo

**Plataforma de entregas para o comércio · Cidade piloto: Sobral/CE**
Versão 1.0 · Documento único: instruções de construção + especificação

> **Como usar:** salve este arquivo na raiz do repositório e cole a PARTE 1 no Claude Code.

---
---

# PARTE 1 — PROMPT DE CONSTRUÇÃO

## Seu papel

Você vai construir do zero o **Corre**, uma plataforma de despacho de entregas para o comércio de uma cidade. O produto está inteiramente especificado na PARTE 2 deste documento. Leia a PARTE 2 por completo antes de escrever qualquer linha.

A especificação é **decisão fechada**, não sugestão. Se discordar de uma regra, escreva a objeção e **pare para perguntar** — não implemente sua versão. Se encontrar contradição entre duas regras, pare e aponte; não escolha sozinho.

Se algo não está na especificação, **não está no escopo**. A seção 16 lista o que foi deliberadamente deixado de fora. Não construa nada de lá, nem "só a base pra depois".

## Stack

- **Backend + web do lojista + painel:** Node.js + Express, WebSocket para despacho e rastreio em tempo real
- **App do motoboy:** Kotlin nativo, Android. Foreground service para GPS, FCM para push
- **Banco:** PostgreSQL
- **Pagamento:** gateway com Pix e split por subconta (a definir — ver Lei 7)
- **Infra:** VPS dedicada, separada de qualquer outro sistema
- **Repositórios:** monorepo único com os diretórios `corre-api/` e `corre-app/` *(decisão do dono, 2026-08-09: quando o contrato da API mudar, o app Kotlin muda no mesmo PR — substitui os dois repositórios separados da versão 1.0)*

## As 8 leis inegociáveis

Violação de qualquer uma invalida a etapa, mesmo que tudo funcione.

**Lei 1 — Dinheiro é inteiro em centavos.** Nunca float, nunca decimal em ponto flutuante, em lugar nenhum: banco, código, API, JSON. A conversão para reais acontece só na renderização. Sem exceção.

**Lei 2 — Estado só muda por evento.** Existe uma tabela `eventos` append-only. Toda transição grava um evento antes de qualquer outra coisa. O estado atual da corrida é derivável dos eventos.

**Lei 3 — Evento não se apaga nem se edita.** Sem `UPDATE`, sem `DELETE` na tabela de eventos, em nenhuma circunstância, nem pelo painel de admin. Correção é sempre um evento compensatório novo. Garanta com permissão no banco, não só com disciplina no código.

**Lei 4 — Uma corrida, um motoboy.** A aceitação é uma corrida contra o relógio entre vários aparelhos. Garanta com constraint `UNIQUE` real no banco, nunca com verificação no código. Duplo clique, dois aparelhos e reconexão simultânea têm que resultar em um único aceite.

**Lei 5 — Idempotência com chave real.** Todo endpoint que grava aceita um token de idempotência e tem `UNIQUE` sobre ele. Rede de motoboy cai na rua; a retentativa não pode criar corrida dobrada nem pagar duas vezes.

**Lei 6 — Dinheiro só se move em transição de estado registrada.** Retenção, split, estorno e saque são consequência de evento, nunca de chamada avulsa. Não existe endpoint que "só transfere".

**Lei 7 — Custo de transação é premissa, não detalhe.** A comissão é 5% do frete e o gateway consome parte disso. Antes de integrar qualquer gateway, escreva a conta do custo real por corrida em R$ e mostre. Se o Pix tiver custo **fixo** por transação em vez de percentual, **pare e avise** — a comissão não fecha.

**Lei 8 — Teste que não falha quando deveria não é teste.** Toda regra crítica precisa de controle negativo: sabote a regra no código, rode a bateria e prove que ela fica **vermelha**. Bateria verde com a regra quebrada é falso positivo e precisa ser corrigido antes de seguir.

## Como testar

- **Teste executando, não lendo.** Leitura de código não prova nada.
- **Teste contra o que o sistema encontra**, não contra o ambiente conveniente. Se o front manda um número, teste com o número que o front manda.
- **Teste no banco que nasce das migrations**, nunca no banco que você foi ajustando à mão.
- **Concorrência precisa de concorrência real** — processos ou threads contra o servidor rodando, não cliente de teste single-thread.
- **Volume, não amostra.** Milhares de corridas sintéticas, não dez.
- **Nunca escreva em banco de produção.**

## Ordem de construção

Uma etapa por vez. **PR separado por etapa.** Nunca comece a próxima com a anterior vermelha. Obra e auditoria nunca em paralelo.

Ao terminar cada etapa: pare, mostre o que fez, mostre a bateria verde, mostre o controle negativo funcionando, e **espere aprovação**.

| # | Etapa | Critério de aceite (executável) |
|---|---|---|
| 0 | Fundação: repos, migrations, tabela de eventos, CI | CI roda a bateria em banco criado do zero. `UPDATE`/`DELETE` em `eventos` falha por permissão |
| 1 | Máquina de estados + log de eventos | As 11 transições cobertas. Transição inválida recusada. Estado reconstruído dos eventos bate com o gravado, em 5.000 corridas sintéticas. Teste que sobe o servidor de verdade com credencial de dono e prova que ele encerra antes de servir a primeira requisição; controle negativo: remover a chamada da verificação do ponto de entrada deixa esse teste vermelho *(condição da aprovação da Etapa 0, 2026-08-09)* |
| 2 | Cadastro e sessão (lojista, motoboy, painel) | Chave Pix de CPF diferente é recusada. Segundo aparelho na mesma conta é recusado. Primeiro saque nasce travado |
| 3 | Zonas e preço | Tabela carregada. Mesmo endereço dá sempre o mesmo preço. Fora de zona calcula por linha reta sem API externa |
| 4 | Pedido + link do cliente + Pix + split | Pix confirmado leva ao estado 2 e retém o valor. Link expira em 15 min. Mudança de pino recalcula antes do pagamento e nunca depois |
| 5 | Despacho: cascata, timer de 30s, regras de recusa | 50 aparelhos disputando a mesma corrida resultam em exatamente 1 aceite. Cascata de 5 min sem aceite gera estorno automático integral |
| 6 | App Kotlin do motoboy | GPS reporta com tela apagada e app em background por 30 min contínuos. Push chega em menos de 5s. Perda de rede não duplica aceite |
| 7 | Entrega: PIN, espera, retorno | PIN errado não fecha corrida. 5 min + 1 ligação registrada habilita retorno. Retorno cobra o cartão do lojista e credita o motoboy |
| 8 | Saldo e saque | Soma dos saldos + retido + sacado = soma dos splits, ao centavo, em 10.000 corridas. 1 saque grátis/dia, extras com taxa |
| 9 | Reputação | Nota só desempata dentro da janela de 2 min. Falha por endereço errado conta contra a loja, nunca contra o motoboy |
| 10 | Painel + níveis de acesso | Atendimento recebe 403 em estorno e bloqueio. Toda ação do painel gera evento com autor |
| 11 | Antifraude | Localização simulada é detectada e bloqueia. Par lojista+motoboy repetido em cancelamento é sinalizado. Corrida sem lojista real é impossível por construção |
| 12 | Blindagem final | Caos: queda no meio de cada transição, duplo clique em tudo, relógio errado, rede oscilando. Caixa fecha ao centavo em todos os cenários |

> **CI e proteção da `main` (registrado em 2026-08-09):** a branch protection exige o status check pelo **nome do job** (`bateria`, em `.github/workflows/ci.yml`). Se o job for renomeado, a proteção deixa de exigir o check **silenciosamente** e a `main` volta a aceitar merge com bateria vermelha. Renomear job de CI exige reajustar a regra de proteção no mesmo ato.

## Além do funcionamento

**Usabilidade para leigo.** O motoboy usa de capacete, na chuva, com uma mão. Botão grande, uma ação por tela, nada escondido. Teste: pessoa ruim de celular bate o olho e sabe onde tocar sem ler nada.

**O sistema se levanta sozinho.** Queda de servidor, banco ou gateway — ao voltar, o estado está coerente sem conserto manual. Nenhuma corrida fica presa em estado vivo para sempre: todo estado vivo tem prazo e destino.

**Nada de `catch` vazio.** Erro engolido é a origem de todo mistério. Se não sabe o que fazer com o erro, ele sobe.

## O que NÃO fazer

- Não construa nada da seção 16
- Não invente recurso "porque seria útil"
- Não crie bônus, meta ou gamificação para motoboy
- Não integre API de mapa paga sem perguntar
- Não aceite cartão de crédito do cliente final no MVP
- Não suba nada para produção — deploy é decisão do dono

## Como reportar

Ao fim de cada etapa, nesta ordem, curto:

1. O que foi construído
2. Resultado da bateria (números, não adjetivos)
3. Resultado do controle negativo
4. O que encontrou de errado na especificação, se encontrou
5. O que trava a próxima etapa

Sem relatório longo. Sem adjetivo. Número e fato.

**Comece pela Etapa 0. Não passe da Etapa 0 sem aprovação.**

---
---

# PARTE 2 — ESPECIFICAÇÃO DO MVP

## 1. O que é o Corre

Plataforma de despacho de entregas para o comércio de uma cidade. Substitui os grupos de WhatsApp de motoboy por um app.

**Modelo:** Uber copiado e colado, aplicado a varejo e comércio (não a restaurante).

**O que NÃO é:** não é marketplace. O cliente final não tem conta, não tem login, não vê catálogo, não compara lojas. Ele só vê a entrega que já contratou. Sem descoberta, não existe iFood.

**Frase de posicionamento para o lojista:** *"o cliente continua sendo seu — eu nem sei o nome dele."*

**Vocabulário da marca:** o lojista *manda um corre*; o motoboy *pega um corre*; os entregadores são *os corres*.

## 2. Atores e superfícies

| Ator | Onde usa | Instala app? |
|---|---|---|
| Lojista | Web (navegador) | Não |
| Motoboy | App Android | Sim — GPS em background e push |
| Cliente final | Link no navegador | Não |
| Operação (dono/atendimento) | Painel web | Não |

O app do motoboy é o único app da operação.

## 3. Fluxo principal

1. Lojista abre a web, digita endereço do cliente + telefone + valor declarado da mercadoria. Endereço de coleta é fixo (a loja).
2. Sistema identifica a zona e crava o preço pela tabela.
3. Sistema gera um link. Lojista manda no WhatsApp, onde já está falando com o cliente.
4. Cliente abre o link, confere a loja e o valor, confirma o pino do endereço e paga por Pix. Se o pino mudar de zona, o preço recalcula **antes** do pagamento.
5. Pix confirmado → despacho.
6. Motoboy aceita, coleta, entrega, valida PIN.
7. Split: motoboy recebe sua parte, o Corre retém 5%.

O mesmo link vira tela de rastreio e, no fim, mostra o PIN ao cliente.

**Exceção prevista:** o link pode ser pago pelo próprio lojista (cliente idoso, sem celular na hora). Ele embute no preço do produto.

## 4. Máquina de estados da corrida

**Lei do projeto:** estado só muda por evento registrado. Evento nunca é apagado nem editado — só compensado por outro evento.

### Estados vivos

| # | Estado | Como entra | Dinheiro | Prazo |
|---|---|---|---|---|
| 1 | Aguardando pagamento | Lojista cria | Nenhum | Expira em 15 min |
| 2 | Procurando motoboy | Pix confirmado | **Retido**, sem split | Cascata roda 5 min |
| 3 | A caminho da loja | Motoboy aceitou | Retido | — |
| 4 | Com a mercadoria | Coleta confirmada | Retido | — |
| 5 | Em retorno | Entrega falhou | Retido | — |
| 6 | Em disputa | Alguém contestou | **Congelado** | Até decisão no painel |

### Estados finais

| # | Estado | Destino do dinheiro |
|---|---|---|
| 7 | Entregue | PIN validado → **split dispara** |
| 8 | Expirada | Ninguém pagou. Nada aconteceu |
| 9 | Sem motoboy | **Estorno automático integral**, sem o cliente pedir |
| 10 | Cancelada | Conforme seção 5 |
| 11 | Devolvida | Frete da ida fica com o motoboy; retorno cobrado do lojista |

## 5. Cancelamento

- **Livre e sem custo** até o estado 2, para qualquer parte.
- **Do estado 3 em diante**, só a operação cancela, sempre com motivo registrado.
- **Cancelamento pós-aceite causado pelo lojista:** cobrado do **cartão de garantia do lojista** e repassado ao motoboy.

> Princípio: **quem causa paga.** Não existe custo sem dono. O Corre nunca banca do próprio bolso.

## 6. Despacho

- Oferta para o **motoboy mais próximo, um de cada vez**.
- **30 segundos** para aceitar antes de passar ao próximo.
- **Nota desempata apenas em empate técnico** (chegada com até ~2 min de diferença). Fora disso, distância manda.
- Recusar é **livre e sem punição**. 4 recusas seguidas → offline por 15 min.
- Cascata roda **5 minutos**. Ninguém aceitou → estado 9.
- Motoboy pode aceitar uma segunda corrida estando ocupado. **Teto: 2 ativas.** Cada corrida permanece independente (PIN próprio, preço próprio, estado próprio) — o app não roteiriza nem rateia.
- O rastreio mostra ao lojista quando o motoboy tem outra parada antes.

## 7. Entrega

- **Prova: PIN de 4 dígitos** informado pelo cliente. Sem foto no MVP.
- **Espera na porta:** 5 minutos, com 1 ligação registrada no app. Depois vira retorno (estado 5).
- **Espera na loja:** grátis, sem taxa. Controlada por reputação, não por cobrança.

## 8. Preço

- Tabela por zona, transcrita da tabela que já opera na cidade. **Não alterar valores no lançamento** — o motoboy tem que ver o preço que já sabe de cor.
- **Fora de zona:** zona mais cara + adicional por km, com distância em **linha reta** a partir do centro da última zona (evita custo de API de mapa).
- **Sem preço dinâmico.** Sem adicional de chuva, sem adicional de pico.

*Consequência conhecida e aceita: em chuva forte a oferta cai e corridas morrem em "sem motoboy".*

## 9. Dinheiro

**Comissão: 5% do frete.** Num frete de R$ 10, R$ 0,50. Gateway consome ~1%, sobrando ~4% líquidos.

- Split com conta-pai (Corre) e subcontas (motoboys). O valor **nasce dividido** — o Corre nunca recebe o frete inteiro.
- Motoboy acumula **saldo no app** e saca quando quiser.
- **1 saque grátis por dia.** Extras com taxa.
- **Primeiro saque travado** até conferência dos documentos.

**Cartão de garantia do lojista:** fica no cadastro, **nunca é cobrado no fluxo normal**. Cobre apenas cancelamento pós-aceite causado pelo lojista e custo de retorno por cliente ausente (repassado integral ao motoboy).

## 10. Cadastro

### Motoboy
- CNH + CRLV da moto + selfie
- **Chave Pix obrigatoriamente do mesmo CPF do cadastro**
- Um aparelho por conta
- Aprovação automática — roda na hora. O **primeiro saque** fica travado até conferência

> Princípio: trava o dinheiro, não a porta. Fraude só compensa se o dinheiro sai.

### Lojista
- Cadastro em 1 minuto: nome e telefone. Entra, olha, mexe
- **Cartão de garantia exigido antes do primeiro pedido**, não no cadastro

## 11. Disputa

- **PIN validado = entregue. Encerra a discussão.**
- Mercadoria quebrada ou sumida: **responsabilidade do motoboy**, limitada ao **valor declarado**
- **Teto de valor declarado no MVP: R$ 500.** Acima disso o app recusa a corrida
- **Prazo para abrir disputa: 24h** após a entrega

> A regra do PIN é política operacional, não escudo jurídico. Não afasta CDC.

## 12. Reputação

- **Nota da loja é visível.** Loja lenta é despachada por último — é a alavanca que substitui a taxa de espera
- **Nota do motoboy** só desempata dentro da janela de ~2 min. Nunca fura a distância
- Entrega falhada por endereço errado conta **contra a loja**, nunca contra o motoboy
- **Desempenho:** 3 avisos antes de qualquer bloqueio
- **Fraude:** bloqueio imediato, sem aviso

## 13. Painel da operação

- Permite: ver tudo, forçar cancelamento, estornar e bloquear
- **Acesso por níveis:** atendimento resolve o dia a dia; **só o dono estorna e bloqueia**
- **Nada se apaga nem se edita.** Correção só por evento compensatório

## 14. Antifraude

| Golpe | Trava no MVP | Custo |
|---|---|---|
| Corrida fantasma com GPS falso | Corrida só existe se um lojista real criou e confirmou coleta. Flag de localização simulada do Android | Zero |
| Bônus fraudado | **Não existe bônus por número de entregas no MVP** | Zero |
| Conta laranja | Chave Pix do mesmo CPF + selfie + 1 aparelho por conta | Zero |
| Estorno de cartão | **Só Pix no MVP.** Pix não tem chargeback | Zero |
| Conluio lojista+motoboy | Contador do par em cancelamentos pós-aceite | Zero |
| "Entreguei" vs "não recebi" | PIN de 4 dígitos | Zero |

## 15. Jurídico

- O Corre se posiciona como **intermediação de tecnologia**. Motoboy é autônomo
- **NFS-e emitida somente sobre a comissão de 5%**, nunca sobre o frete cheio. O split garante que o valor cheio não passa pela conta da empresa
- **MEI não é exigido** do motoboy

> **Risco a monitorar:** três regras apontam para controle e aparecem em ação de vínculo — offline por 4 recusas, nota influenciando despacho, e bloqueio por desempenho. Todas existem em iFood e Uber. Revisar com advogado antes do lançamento.

## 16. Fora de escopo do MVP

- Pagamento da mercadoria dentro do app (só o frete entra)
- Carteira do lojista / lojista pagando frete
- Cartão de crédito como meio de pagamento do cliente
- Roteirização e rateio de entregas agrupadas
- Pedido agendado
- Foto como prova de entrega
- Preço dinâmico / surge
- Bônus e metas para motoboy
- App para o cliente final
- Catálogo, vitrine ou qualquer descoberta de loja

## 17. Pontos ainda em aberto

1. **Escolha do gateway.** Precisa ter Pix com preço percentual (não fixo por transação) e split por subconta
2. **Valor do adicional por km** fora de zona
3. **Transcrição da tabela de zonas** de Sobral
4. **Taxa zero nos primeiros 90 dias** — carta de lançamento não decidida
5. **Teto de R$ 500** de valor declarado — sugerido, não confirmado
6. **Revisão jurídica** das três cláusulas de controle
7. **Registro da marca** CORRE (mista) nas classes 39 e 42, e domínio

## 18. Números de referência

Estimativa a partir do grupo de 66 motoboys que já opera em Sobral:

| Métrica | Valor |
|---|---|
| Corridas/mês (66 × 20/dia × 26 dias) | ~34.300 |
| Frete médio | R$ 10 |
| Comissão bruta (5%) | ~R$ 17.100/mês |
| Líquido após gateway (~1%) | ~R$ 13.700/mês |
| Projeção com os 3 grupos da cidade | ~R$ 40.000/mês |
| Custo para o motoboy (20 corridas/dia) | R$ 260/mês |

**Premissa mais frágil de todo o modelo:** entregas por dia por motoboy. A 8/dia o negócio é outro. Medir isso é a prioridade número 1 do piloto.
