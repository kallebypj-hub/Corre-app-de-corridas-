# CORRE — especificação vigente

**Plataforma de entregas para o comércio · Cidade piloto: Sobral/CE**

Este arquivo é a **fonte única e oficial** do projeto: as leis, o método de teste, a especificação vigente e o estado das etapas. É o que se lê **sempre**.

- **Começando uma sessão?** Leia [`RETOMAR.md`](RETOMAR.md) primeiro — ele diz em uma tela onde o projeto está e qual é o próximo passo.
- **Registro histórico** (decisões com data e motivo, alterações de spec antes→depois, achados de auditoria, defeitos aceitos): [`HISTORICO.md`](HISTORICO.md). Só se consulta quando pedido.

> **Revisão de 2026-08-09 — o pagamento mudou de lugar.** O cliente que compra pela primeira vez não tem app nenhum, e cobrar antes da entrega travava a primeira compra. O pagamento passou para **a porta do cliente**, por QR Pix dinâmico exibido no app do motoboy, e a **mercadoria entrou na cobrança**. Isso reescreveu as seções **1 a 18**, criou as seções **19 (chat interno)** e **20 (multi-cidade)**, matou o Portão C e invalidou a Etapa 4 que estava planejada. O antes→depois inteiro está no `HISTORICO.md`, capítulo 1, decisões 30 a 137.

---

## Regime de trabalho

**Uma sessão por etapa.** A sessão abre no prompt da etapa e fecha no merge. A etapa seguinte começa em **sessão nova**, lendo `RETOMAR.md`, este arquivo e a `main` — nunca a conversa anterior. A verdade do projeto mora no repositório. Se algo importante só existe na conversa, é porque falhou de ir para o `CORRE.md`, e isso é defeito.

**Toda decisão tomada em sessão entra neste arquivo no mesmo PR**, com data e motivo (o motivo e o texto antes→depois vão para o `HISTORICO.md`). O relatório de cada etapa lista, em seção própria, toda alteração feita na especificação naquela etapa.

**Reescrita de estado sem caminho de migração vale ENQUANTO não houver cliente real.** A Etapa 5 substituiu a máquina de estados inteira sem migrar linha nenhuma — legítimo, porque nada está em produção e a bateria nasce do zero das migrations. **A partir do primeiro cliente real isso acaba:** mudar a numeração, o significado ou o conjunto dos estados exige **caminho de migração declarado na própria migration**, dizendo o que acontece com cada linha que está no estado antigo. Registrado aqui para não virar precedente por esquecimento.

**Correção de etapa já mesclada vai em PR próprio, sempre.** Um defeito em código que já está na `main` nunca viaja junto com a obra de uma etapa nova. E **correção de segurança fura a fila**: entra e é mesclada antes de qualquer obra em andamento, porque enquanto não entra a `main` está quebrada.

**O critério por trás dessa regra é o destino compartilhado, não o tipo de arquivo.** Coisas que podem ser rejeitadas separadamente vão em PRs separados. Quando um código **só faz sentido se a outra metade for aprovada**, separá-lo cria um PR que não pode ser mesclado sozinho — e aí o acoplamento é honesto. Isso é **exceção que se pede e se registra**, com o motivo, nunca conveniência: houve uma em 2026-08-09 (`HISTORICO.md`, decisão 96) e ela não abre a regra.

**Uma etapa por vez, uma branch por etapa, um PR por etapa.** Nunca comece a próxima com a anterior vermelha. **Obra e auditoria nunca em paralelo** — auditoria sabota arquivos e banco para provar o controle negativo; obra rodando junto contamina o resultado.

**A branch nasce com a etapa e morre no merge.** Etapa nova nunca continua a branch da anterior, mesmo que a anterior ainda não tenha sido mesclada — nesse caso a nova sai do topo da anterior e o PR fica em fila, mas **é PR próprio**. *(Regra de 2026-08-10, e o motivo é um caso concreto: o PR #6 acumulou revisão de spec, trava de configuração de taxa, Etapa 4 e correção de vazamento — 39 arquivos. Revisão humana num PR desse tamanho é teatro: o revisor aprova o conjunto porque não consegue reprovar uma parte.)*

**Regime de esforço:** raciocínio máximo em auditoria adversarial e em **três categorias de caminho**:

| Categoria | Etapas | Por quê |
|---|---|---|
| **Dinheiro** | 7, 8b, 9, 11 | Erro de centavo não se descobre olhando, e some com dinheiro de terceiro |
| **Isolamento e identidade** | 4 | **Vazamento entre cidades é tão grave quanto erro de centavo** — e mais silencioso: ninguém reclama de ver dado que não devia. Vale para qualquer etapa que mexa em RLS, sessão ou identidade |
| **Autenticação e autorização** | 4, 11 | Já era exigência da auditoria; agora também do esforço |

Nas demais, esforço normal.

**Nenhuma etapa toca fornecedor real enquanto a mesa comercial não responder** (seção 17): sem credencial, sem chamada, sem depender de particularidade de gateway. Tudo atrás de interface, com implementação falsa nos testes, como foi feito com o SMS.

**Auditoria adversarial é obrigatória** nas etapas de **dinheiro, de isolamento e de segurança** (4, 7, 8b, 9, 11 e qualquer etapa que mexa em RLS, autenticação ou autorização), e recomendada nas demais. Ela custa caro e continua obrigatória porque encontra o que a bateria comum não encontra — o registro do que ela pegou está no `HISTORICO.md`. O que se corta para economizar é conversa longa, nunca auditoria.

---

## As 10 leis inegociáveis

Violação de qualquer uma invalida a etapa, mesmo que tudo funcione.

**Lei 1 — Dinheiro é inteiro em centavos.** Nunca float, nunca decimal em ponto flutuante, em lugar nenhum: banco, código, API, JSON. A conversão para reais acontece só na renderização. Sem exceção.

**Lei 2 — Estado só muda por evento.** Existe uma tabela `eventos` append-only. Toda transição grava um evento antes de qualquer outra coisa. O estado atual da corrida é derivável dos eventos.

**Lei 3 — Evento não se apaga nem se edita.** Sem `UPDATE`, sem `DELETE` na tabela de eventos, em nenhuma circunstância, nem pelo painel de admin. Correção é sempre um evento compensatório novo. Garanta com permissão no banco, não só com disciplina no código.

**Lei 4 — Uma corrida, um motoboy.** A aceitação é uma corrida contra o relógio entre vários aparelhos. Garanta com constraint `UNIQUE` real no banco, nunca com verificação no código. Duplo clique, dois aparelhos e reconexão simultânea têm que resultar em um único aceite.

**Lei 5 — Idempotência com chave real.** Todo endpoint que grava aceita um token de idempotência e tem `UNIQUE` sobre ele. Rede de motoboy cai na rua; a retentativa não pode criar corrida dobrada nem pagar duas vezes.

**Lei 6 — Dinheiro só se move em evento registrado.** Cobrança, split e estorno são consequência de **transição de estado** ou de **evento compensatório do painel com autor identificado** — nunca de chamada avulsa. Não existe endpoint que "só transfere". *(A segunda metade entrou em 2026-08-09: com o split liquidado na porta, o estorno acontece depois do estado final, e estado final é final — o que o move é evento compensatório, não transição.)*

**Lei 7 — Custo de transação é premissa, não detalhe.** A comissão é 5% do frete e o gateway consome parte disso. Antes de integrar qualquer gateway, escreva a conta do custo real por corrida em R$ e mostre. Se o Pix tiver custo **fixo** por transação em vez de percentual, **pare e avise** — a comissão não fecha. **Desde a revisão de 2026-08-09 a conta mudou de forma:** a taxa incide sobre **mercadoria + frete**, e a receita do Corre é só 5% do frete. A conta só fecha se ficar declarado **de quem sai a taxa** — ver seção 9. E o custo fixo virou pior do que caro: **taxa fixa não é splitável em nenhum gateway** e cai obrigatoriamente na plataforma.

**Lei 8 — Teste que não falha quando deveria não é teste.** Toda regra crítica precisa de controle negativo: sabote a regra, rode a bateria e prove que ela fica **vermelha** — e vermelha **no teste que vigia aquela regra**, não por motivo alheio. Bateria verde com a regra quebrada é falso positivo e precisa ser corrigido antes de seguir.

**Lei 9 — Toda escrita nasce com teste de concorrência.** Todo caminho que grava tem teste de concorrência real, sem precisar ser pedido. Leitura-e-depois-escrita é sempre suspeita de lost update: contador, limite, cap de tentativas, reserva de vaga, saldo. Prove com processos concorrentes de verdade contra o servidor rodando, nunca com cliente de teste single-thread. Se a garantia depende de ordem de execução, ela não existe — a garantia mora no banco (`UNIQUE`, constraint, `UPDATE` condicional atômico, advisory lock).

**Lei 10 — Camada de defesa nova exige re-verificação de todos os controles negativos existentes.** Quando uma segunda camada passa a proteger a mesma regra, a sabotagem antiga deixa de deixar o teste vermelho — e o verde parece correto. Ao adicionar qualquer camada (política, trigger, constraint, privilégio), rode a bateria inteira de sabotagens e prove que **cada uma** continua vermelha no teste certo. As que ficarem verdes precisam ser reescritas para derrubar **todas** as camadas que protegem aquela regra.

*Origem, 2026-08-09 (Etapa 4):* a sabotagem `app_publica_preco` provava, desde a Etapa 3, que a aplicação não publica tabela de preço. O RLS da Etapa 4 virou **segunda camada** sobre a mesma regra: removido o `GRANT`, a política ainda barrava, o teste ficava verde e a sabotagem parou de acusar. **Lei 8 continuava obedecida no papel e o controle negativo estava cego.** A correção foi derrubar as duas camadas na mesma sabotagem (`HISTORICO.md`, decisão 128).

---

**O princípio por trás das dez.** Não se confia em alguém lembrar. Onde couber, a regra vira **impossibilidade estrutural**: configuração ruim não publica, tabela sem política nasce vermelha, evento não se apaga, coluna sem `GRANT` não se forja. Toda vez que uma proteção depender de disciplina — de revisar com atenção, de lembrar de incluir, de não esquecer —, **procure a versão que depende do banco**. Se ela não existir, diga isso em voz alta em vez de fingir que a disciplina basta.

## Como testar

- **Teste executando, não lendo.** Leitura de código não prova nada.
- **Teste contra o que o sistema encontra**, não contra o ambiente conveniente. Se o front manda um número, teste com o número que o front manda.
- **Teste no banco que nasce das migrations**, nunca no banco que você foi ajustando à mão.
- **Concorrência precisa de concorrência real** — processos ou threads contra o servidor rodando, não cliente de teste single-thread.
- **Volume, não amostra.** Milhares de corridas sintéticas, não dez.
- **Prove a trava pelo EFEITO, não pelo nome.** Conferir que a constraint existe não prova nada: tente a operação proibida e exija o erro.
- **Nunca escreva em banco de produção.**
- **Relatório de etapa só sai depois que a auditoria adversarial encerra** e os achados são confirmados por reprodução. Número reportado antes disso é **provisório e não vale como entrega** — e o risco não é o número estar desatualizado, é a **promessa da etapa estar falsa**. *(Aconteceu em 2026-08-09: a Etapa 4 foi reportada com 186 testes e "nenhuma consulta devolve dado de outra cidade" enquanto a auditoria ainda rodava. Ela achou o vazamento de `eventos` logo depois: a frase central do relatório era mentira, e os números certos eram 188 e 53.)*
- **NUNCA rode o controle negativo com código não commitado.** Ele sabota o arquivo e restaura com `git checkout` — e `git checkout` **não devolve arquivo que o git não conhece**. Arquivo novo fica com a sabotagem dentro; arquivo alterado e não commitado **volta para o HEAD e perde o trabalho da sessão**. Commite antes, sempre. *(Aconteceu em 2026-08-09: a trava de configuração de taxa foi apagada pelo próprio controle negativo que ia prová-la.)*

## Além do funcionamento

**Usabilidade para leigo.** O motoboy usa de capacete, na chuva, com uma mão. Botão grande, uma ação por tela, nada escondido. Teste: pessoa ruim de celular bate o olho e sabe onde tocar sem ler nada. O mesmo vale, agora, para o cliente que nunca usou o app e vai pagar na porta com o motoboy esperando.

**O sistema se levanta sozinho.** Queda de servidor, banco ou gateway — ao voltar, o estado está coerente sem conserto manual. Nenhuma corrida fica presa em estado vivo para sempre: todo estado vivo tem prazo e destino.

**Nada de `catch` vazio.** Erro engolido é a origem de todo mistério. Se não sabe o que fazer com o erro, ele sobe.

## O que NÃO fazer

- Não construa nada da seção 16
- Não invente recurso "porque seria útil"
- Não crie bônus, meta ou gamificação para motoboy
- Não integre API de mapa paga sem perguntar
- Não aceite cartão de crédito do cliente final no MVP
- Não exponha telefone de ninguém para ninguém (seção 19)
- Não suba nada para produção — deploy é decisão do dono

## Como reportar

Ao fim de cada etapa, nesta ordem, curto:

1. O que foi construído
2. Resultado da bateria (números, não adjetivos)
3. Resultado do controle negativo
4. Alterações na especificação (antes→depois), se houve
5. O que trava a próxima etapa

Sem relatório longo. Sem adjetivo. Número e fato.

**E depois da auditoria, nunca antes** — ver "Como testar". Etapa com auditoria obrigatória não tem relatório parcial: enquanto a auditoria roda, o que existe é obra em andamento.

---

## Stack

- **Backend:** Node.js + Express, WebSocket para despacho, rastreio e chat em tempo real. **Um backend só** serve os três apps, a ponte web e o painel
- **App do motoboy:** Kotlin nativo, Android. Foreground service para GPS, FCM para push. Pacote **`br.com.corre.motoboy`**
- **App do lojista:** Flutter (Android e iOS). Pacote **`br.com.corre.lojista`**
- **App do cliente:** Flutter (Android e iOS). Pacote **`br.com.corre.cliente`**
- **Ponte web:** página mínima servida pelo backend, sem app, para a primeira compra (seção 2)
- **Painel da operação:** web
- **Banco:** PostgreSQL
- **Pagamento:** gateway com Pix, QR dinâmico por API e split de 3 recebedores (**escolha reaberta** — ver Lei 7 e seção 17, item 1)
- **Infra:** VPS dedicada, separada de qualquer outro sistema
- **Repositório:** monorepo único com os diretórios `corre-api/`, `corre-app-motoboy/`, `corre-app-lojista/` e `corre-app-cliente/`

**Nome de pacote é definitivo.** Pacote de app publicado em loja **não se troca** — trocar é publicar outro app e perder a base instalada. Os três acima ficam fixos. Eles pressupõem o domínio `corre.com.br` registrado (seção 17, item 8): **registrar o domínio e a marca é pré-requisito da primeira publicação**, não do primeiro código.

**Credenciais de banco:** a aplicação conecta **sempre** como `corre_app` (papel restrito). `corre_dono` é reservado a migrations e nunca vira credencial de aplicação ou de painel. O ponto de entrada recusa subir com credencial de dono ou de superusuário.

**CI e proteção da `main`:** a branch protection exige o status check pelo **nome do job** (`bateria`, em `.github/workflows/ci.yml`). Se o job for renomeado, a proteção deixa de exigir o check **silenciosamente** e a `main` volta a aceitar merge com bateria vermelha. Renomear job de CI exige reajustar a regra de proteção no mesmo ato.

## Ordem de construção e estado das etapas

As etapas 0 a 3 estão na `main`. A revisão de 2026-08-09 **invalidou parte do que elas entregaram** — a coluna "Estado" diz o quê.

| # | Etapa | Critério de aceite (executável) | Estado |
|---|---|---|---|
| 0 | Fundação: repos, migrations, tabela de eventos, CI | CI roda a bateria em banco criado do zero. `UPDATE`/`DELETE` em `eventos` falha por permissão | **na `main`** (PR #1) — vale inteira |
| 1 | Máquina de estados + log de eventos | As transições cobertas. Transição inválida recusada. Estado reconstruído dos eventos bate com o gravado, em 5.000 corridas sintéticas. O servidor sobe de verdade com credencial de dono e encerra antes de servir a primeira requisição | **na `main`** (PR #2) — o **motor** vale; a **tabela de estados foi invalidada** e é reescrita na Etapa 5 |
| 2 | Cadastro e sessão (lojista, motoboy, painel) | Chave Pix de CPF diferente é recusada. Segundo aparelho na mesma conta é recusado. Primeiro saque nasce travado. Atendimento recebe 403 em estorno e bloqueio | **na `main`** (PR #3 + correção #5) — vale; falta o **cliente** como ator (Etapa 4) |
| 3 | Zonas e preço | Tabela carregada. Mesmo endereço dá sempre o mesmo preço. Fora de zona calcula por linha reta sem API externa | **na `main`** (PR #4) — vale; tem **correção pendente** (matriz 6×6, PR próprio, travada na tabela real) |
| 4 | Multi-cidade e o cliente como ator | Corrida com **lojista** da cidade A e **zona/tabela de preço** da cidade B é recusada **pelo banco**. Duas cidades com tabelas de preço e **configurações de taxa** diferentes coexistem sem se misturar. Cliente nasce por telefone, é da plataforma e não da cidade. **Nenhuma consulta devolve dado de outra cidade — por RLS, provado com pool de conexões e requisições concorrentes de cidades diferentes, em milhares intercaladas** | **entregue, aguardando merge** — RLS no banco, cliente como ator, cidade na sessão |
| 5 | Máquina de estados nova (entrega consignada ao pagamento) + prazo estimado | As **14 arestas** cobertas; par fora da tabela é recusado. **Nenhum caminho chega a Entregue sem passar por Pago.** Estado reconstruído dos eventos bate com o gravado, em 5.000 corridas sintéticas. Prazo estimado é gravado na criação com a versão da tabela; mesma corrida, mesmo prazo | não iniciada |
| 6 | Despacho: cascata, timer de 30s, regras de recusa | 50 aparelhos disputando a mesma corrida resultam em exatamente 1 aceite. Cascata de 5 min sem aceite leva a Sem motoboy **sem nenhum movimento de dinheiro**. 4 recusas seguidas → offline por 15 min. Teto de 2 corridas ativas. **⬅ Critério herdado da Etapa 4:** corrida cujo **motoboy** seja de outra cidade é recusada **pelo banco** — não coube na Etapa 4 porque `corridas` só ganha coluna de motoboy aqui | não iniciada |
| 7 | **Cobrança na porta: QR dinâmico, confirmação e split triplo** | A cobrança nasce com os **três recebedores declarados** e a soma bate com o total ao centavo. Webhook duplicado + consulta ativa simultânea produzem **um único** Pago. **Com o webhook desligado, a corrida ainda fecha** (a consulta ativa é o caminho primário). Entrega é impossível antes da confirmação. **Frete ímpar fecha ao centavo** e o centavo vai para o motoboy. **Mercadoria zero** e **mercadoria menor que a taxa** caem na regra da seção 9 e ninguém fica negativo. 10.000 corridas: mercadoria + frete = soma das três parcelas + taxa, ao centavo. Lei 9 em três pares: geração×geração, confirmação×confirmação, e **cancelamento da cobrança × confirmação** (a saída do estado 4) | não iniciada — **dinheiro; auditoria obrigatória; 🔒 depende de resposta comercial** |
| **8a** | Entrega, espera na porta e retorno | Sem pagamento confirmado não existe transição para Entregue. 5 min de espera + **1 aviso registrado como evento** habilita o retorno (o canal é das Etapas 10 e 14). **Retorno lança a dívida do lojista no valor do frete, sem comissão — e não toca cartão nenhum.** **Corrida em retorno nunca carrega dinheiro pago.** Sair do estado 4 sem pagamento cancela a cobrança **antes** de gravar a transição | não iniciada |
| **8b** | **Dívida do lojista** | A dívida quita no split da próxima corrida com mercadoria, **debitada da parcela do lojista**, com o **motoboy credor como recebedor adicional**. **Mercadoria zero não quita e o relógio não para.** Aos **15 dias** o lojista é avisado; aos **30** o cartão é cobrado pelo saldo inteiro. **Lei 9 no par que define a etapa: duas corridas do mesmo lojista nascendo ao mesmo tempo não podem quitar a mesma dívida duas vezes**, nem deixar a parcela dele negativa | não iniciada — **dinheiro; auditoria obrigatória; 🔒 depende de resposta comercial** |
| 9 | Saldo, saque e reserva | Soma dos saldos das subcontas (lojista e motoboy) + sacado + comissão recebida pelo Corre + **taxa retida pelo gateway** = soma dos totais cobrados, ao centavo, em 10.000 corridas. Primeiro saque nasce travado. O Corre não move saldo de ninguém — o app espelha. **Recebedor negativo é detectado no instante da causa, nunca na tentativa de saque** — prova-se desligando a consulta ao gateway e exigindo que o log de eventos sozinho acuse o negativo. **A conta do Corre não saca abaixo do colchão**, e a tentativa é recusada | não iniciada — **dinheiro; auditoria obrigatória; 🔒 depende de resposta comercial** |
| 10 | Chat interno nas três pontas | **Nenhuma resposta da API contém telefone de ninguém.** Mensagem é evento: não edita, não apaga. Cada ponta só lê as conversas das corridas de que participa. Chat de corrida encerrada continua legível e imutável | não iniciada |
| 11 | Painel, níveis de acesso e disputa | Atendimento recebe 403 em estorno e bloqueio. Toda ação gera evento com autor. Disputa abre e resolve por evento compensatório, **sem reabrir estado final**. **Estorno sai 100% da parcela do lojista e não toca o frete** — controle negativo: estorno sem split explícito fica vermelho | não iniciada — **dinheiro e autorização; auditoria obrigatória; 🔒 depende de resposta comercial** |
| 12 | Reputação nas três pontas | Nota do motoboy só desempata dentro da janela de 2 min. Falha por endereço errado conta contra a loja. **Não pagamento conta contra o cliente e contra mais ninguém.** Cliente acima do teto de faltas é recusado como destino até a operação liberar | não iniciada |
| 13 | App do motoboy (Kotlin) | GPS reporta com tela apagada e app em background por 30 min contínuos. Push chega em menos de 5s. Perda de rede não duplica aceite. O QR aparece na tela e some sozinho quando a confirmação chega | não iniciada |
| 14 | Ponte web mínima + app do cliente (Flutter) | O SMS chega e o link abre **sem instalar nada**; paga e rastreia, e nada além disso. O link morre com a corrida. O app do cliente mostra a **mesma** cobrança que o motoboy exibe, buscada no backend | não iniciada — **🔒 depende de provedor real de SMS** (seção 17, item 9) |
| 15 | App do lojista (Flutter) | Cria corrida, acompanha, conversa. Sem cartão de garantia **e** sem subconta aprovada, a criação é recusada com a razão certa | não iniciada |
| 16 | Antifraude | Localização simulada é detectada e bloqueia. Par lojista+motoboy repetido em cancelamento é sinalizado. Corrida sem lojista real é impossível por construção. **Cobrança que não nasceu no backend não fecha corrida nenhuma** | não iniciada |
| 17 | Blindagem final | Caos: queda no meio de cada transição, duplo clique em tudo, relógio errado, rede oscilando, webhook fora de ordem e repetido. Caixa fecha ao centavo em todos os cenários | não iniciada |

**🔒 = a etapa toca fornecedor real e não pode sair da interface falsa** enquanto a mesa comercial não responder (seção 17). Todas as outras se constroem inteiras hoje.

**Fora da fila, em PR próprio:** correção da Etapa 3 — o preço é **par origem-destino** (matriz 6×6 de anéis), não propriedade do destino. Travada até a tabela real de Sobral entrar no repositório (seção 17, item 4).

Ao terminar cada etapa: pare, mostre o que fez, mostre a bateria verde, mostre o controle negativo funcionando, e **espere aprovação**.

---
---

# ESPECIFICAÇÃO DO MVP

## 1. O que é o Corre

Plataforma de despacho de entregas para o comércio de uma cidade. Substitui os grupos de WhatsApp de motoboy por um app.

**Modelo:** Uber copiado e colado, aplicado a varejo e comércio (não a restaurante).

**O que NÃO é:** não é marketplace. **Não existe catálogo, vitrine, busca de loja nem comparação de preço.** O cliente entra por uma compra que já fez com uma loja que já escolheu, fora daqui. Sem descoberta, não existe iFood.

**O que mudou em 2026-08-09:** o cliente **passou a ter conta, app, histórico e chat**, porque é ele quem paga, e paga na porta. Antes ele era um link anônimo. A frase antiga de posicionamento — *"o cliente continua sendo seu — eu nem sei o nome dele"* — **ficou falsa e foi retirada**. A verdadeira é mais estreita e continua valendo comercialmente:

> **"Eu não tenho vitrine. Ninguém descobre outra loja aqui."**

O Corre sabe o nome do cliente porque cobra dele. O que ele nunca faz é mostrar a esse cliente uma segunda loja. *(A redação comercial dessa frase é decisão do dono — seção 17, item 12.)*

**Vocabulário da marca:** o lojista *manda um corre*; o motoboy *pega um corre*; os entregadores são *os corres*.

## 2. Atores e superfícies

| Ator | Onde usa | Instala app? |
|---|---|---|
| Lojista | App Flutter (`br.com.corre.lojista`) | Sim |
| Motoboy | App Kotlin Android (`br.com.corre.motoboy`) | Sim — GPS em background e push |
| Cliente final | App Flutter (`br.com.corre.cliente`) **ou** a ponte web, na primeira compra | Não é obrigatório |
| Operação (dono/atendimento) | Painel web | Não |

**Três apps, um backend só.** Regra de contrato, regra de preço e máquina de estados vivem no backend; app é tela. Nenhuma das três interfaces decide preço, prazo, transição ou split.

### A ponte para a primeira compra

O cliente que compra pela primeira vez **não tem app nenhum e não vai instalar um com o motoboy na porta**. Para ele existe a ponte:

1. O sistema manda um **SMS** com um link, no telefone que o lojista digitou.
2. O link abre uma página no navegador que faz **duas coisas e só duas**: **pagar** e **acompanhar**.
3. A ponte **não tem** conta, não tem login, não tem histórico, não tem chat, não tem nenhuma outra loja.
4. **Ela sobrevive ao fim da corrida por 24 horas, só leitura, mostrando o comprovante do que foi pago** — não pode ser que o prazo de disputa seja de 24h (seção 11) e a única prova do cliente sem app suma no instante em que a corrida acaba. Depois disso o link morre.
5. A página convida a instalar o app do cliente, mas nunca exige.

**Buraco declarado:** o cliente **sem app** vê o comprovante, mas **não tem como abrir disputa sozinho** — abrir disputa exige o chat, que a ponte não tem por decisão do dono. Até isso mudar, ele abre pela loja ou pelo atendimento. Ampliar a ponte é decisão do dono (seção 17, item 16).

**Motivo:** a primeira compra não pode depender de instalação. Quem gosta instala na segunda.

**Consequência registrada:** o provedor real de SMS deixou de ser detalhe de re-login e virou **pré-requisito da primeira compra de todo cliente novo** (seção 17, item 9).

## 3. Fluxo principal

1. **Lojista** abre o app, digita endereço do cliente + telefone + **valor da mercadoria**. O endereço de coleta é fixo (a loja).
2. O sistema identifica a zona, crava o **frete** pela tabela e o **prazo estimado** (seção 8).
3. A corrida **nasce procurando motoboy**. Não existe espera por pagamento: nada foi cobrado ainda.
4. O sistema manda **SMS** ao cliente com o link de acompanhamento (ou notifica o app dele, se tiver).
5. **Motoboy** aceita, vai à loja, confirma a coleta, sai com a mercadoria.
6. Motoboy chega na porta e declara a chegada. **O backend gera um QR Pix dinâmico do total (mercadoria + frete)** e o app do motoboy o exibe.
7. **Cliente paga** — pelo app dele, pelo link do SMS, ou lendo o QR na tela do motoboy com o banco que ele já usa.
8. **A confirmação chega ao backend.** O caminho **primário é consulta ativa** — o backend pergunta ao gateway, de poucos em poucos segundos, enquanto o QR está na tela. O **webhook é aceleração e reconciliação de retaguarda, nunca a fonte que libera a mercadoria**: as políticas de retentativa publicadas chegam a mais de duas horas, e o webhook cai no nosso servidor, não no aparelho do motoboy, que é quem está na porta esperando. Só então o app libera a entrega.
9. Motoboy entrega e confirma. Corrida → **Entregue**.

**A entrega é consignada ao pagamento.** A mercadoria só troca de mão depois que o backend disse que o Pix caiu. **O dinheiro nunca passa pela mão do motoboy** — ele carrega a mercadoria, não o caixa.

**Split, já na confirmação:** mercadoria integral ao lojista, frete menos 5% ao motoboy, 5% do frete ao Corre (seção 9).

**Exceção prevista — mercadoria já acertada fora do Corre** (cliente idoso, venda paga antes, fiado da loja): o lojista cria a corrida com **valor de mercadoria zero**. O QR cobra só o frete e o split vira de dois recebedores. É o mesmo caminho, com uma parcela a menos — não existe um segundo caminho de dinheiro.

**O cliente não paga na porta.** Não vira desconto, não vira crédito, não vira depois: a mercadoria volta com o motoboy (estado 6 → 11) e o retorno é cobrado do **cartão de garantia do lojista** e repassado integral ao motoboy, exatamente como já valia para cliente ausente (seções 5 e 9). Do lado do cliente, a falta entra na reputação dele (seção 12).

## 4. Máquina de estados da corrida

Estado só muda por evento registrado. Evento nunca é apagado nem editado — só compensado por outro evento.

> **Esta tabela substitui integralmente a de antes.** A tabela antiga começava em "Aguardando pagamento" e retinha dinheiro do estado 2 ao 6. Com o pagamento na porta, **não existe dinheiro retido em lugar nenhum** — ou nada foi pago, ou já foi dividido. A reescrita é a Etapa 5.

### Estados vivos

| # | Estado | Como entra | Dinheiro | Prazo |
|---|---|---|---|---|
| 1 | Procurando motoboy | Lojista cria | Nenhum | Cascata roda 5 min |
| 2 | A caminho da loja | Motoboy aceitou | Nenhum | Etapa 8 |
| 3 | Com a mercadoria | Coleta confirmada | Nenhum | Etapa 8 |
| 4 | Na porta, cobrando | Motoboy declarou chegada; o QR nasce na entrada | Cobrança viva; **nada moveu** | Espera na porta: 5 min (seção 7) |
| 5 | Pago | Confirmação do gateway | **Split liquidado** | **Etapa 8 — sem prazo; fechar por decurso de prazo é PROIBIDO** (ver abaixo). Destino: motoboy confirma a entrega |
| 6 | Em retorno | Cliente ausente, cliente não pagou, ou endereço não localizado | Nenhum — **nunca carrega dinheiro pago** | Etapa 8 |
| 7 | Em disputa | Alguém contestou | Congelado | Até decisão no painel |

### Estados finais

| # | Estado | Destino do dinheiro |
|---|---|---|
| 8 | Entregue | O split já ocorreu no estado 5. Nada mais se move |
| 9 | Sem motoboy | Nada aconteceu. **Ninguém pagou nada — não há o que estornar** |
| 10 | Cancelada | Conforme seção 5 |
| 11 | Devolvida | Mercadoria volta à loja. O retorno é cobrado do cartão do lojista e repassado ao motoboy |

**Sumiu o estado "Expirada".** Ele existia para a corrida que ninguém pagava em 15 minutos. Sem cobrança no início, corrida sem motoboy morre em "Sem motoboy" e ponto.

### Arestas legais

**14 arestas** além da criação (∅→1):

`1→2` · `1→9` · `1→10` · `2→3` · `2→10` · `3→4` · `3→6` · `3→10` · `4→5` · `4→6` · `4→10` · `5→8` · `6→11` · `6→10`

A tabela de transições é **declarativa e vive num lugar só** (`corre-api/src/dominio/transicoes.js`). Nunca `if` de legalidade espalhado pelo código.

**Invariante que a Etapa 5 tem que provar:** **não existe caminho até 8 (Entregue) que não passe por 5 (Pago).** Entregar sem receber é impossível por construção, não por disciplina.

**Gatilhos das arestas que não são óbvias:**

- **3→6** (com a mercadoria → em retorno): endereço **não localizado** ou cliente **inalcançável antes da chegada**. Exige **motivo registrado**, como o cancelamento pela operação. É o caminho de quem nem chegou a mostrar o QR.
- **4→6** (na porta → em retorno): venceu a espera de 5 minutos sem pagamento. O motoboy declara **qual dos dois casos** foi — *cliente ausente* ou *presente e não pagou* —, e essa declaração é **de parte interessada**, não fato observado pelo sistema (seção 12).
- **5→8**: o motoboy confirma que entregou. **É a única saída do estado 5.** Depois de pago, o que der errado é disputa (seção 11), resolvida por evento compensatório do painel — não por transição.

**A cobrança viva morre antes da transição.** Toda saída do estado 4 **sem pagamento** (4→6 e 4→10) **cancela a cobrança no gateway ANTES de gravar a transição**. Sem isso existe uma corrida real: o cliente paga no segundo em que a corrida vira retorno, e o dinheiro cai num pedido que já morreu. Cancelamento × confirmação é **caso de Lei 9** na Etapa 7, junto com o par confirmação/expiração. Se mesmo assim um pagamento cair numa cobrança cancelada, ele é **devolvido integralmente** e registrado como evento compensatório — nunca vira entrega.

### Estado 7 (Em disputa)

Fica **sem transições até a Etapa 11** (painel), que definirá abertura e resolução por migration própria; até lá a máquina recusa qualquer par envolvendo o estado 7. A disputa pós-entrega (prazo de 24h da seção 11) **não reabre corrida** — estado final é final; será fluxo compensatório do painel.

### Prazos

Prazo é **dado gravado**, nunca timer em memória: o instante de vencimento vai no evento e na projeção, e vencer é consulta ao banco. Reinício de processo não perde vencimento. Tempo é **sempre do servidor** — instante vindo do cliente é recusado.

**Medida provisória até a Etapa 8:** os estados **2, 3, 5 e 6** ainda não têm prazo. A consulta `corridasParadas` (`corre-api/src/dominio/corridas.js`, coberta por teste) lista toda corrida em estado vivo há mais de 24 horas. O risco encolheu com a revisão — nesses estados **não há mais dinheiro de terceiro retido** —, mas continua havendo **mercadoria de terceiro** na mão do motoboy, que é pior de perder de vista. A consulta continua obrigatória.

**O estado 5 (Pago) merece atenção própria.** Ele é o único estado vivo em que o dinheiro **já foi dividido** e o único fato ainda em aberto é se a mercadoria mudou de mão. **A saída fácil seria fechar em Entregue sozinho depois de N minutos, e ela está proibida:** fechar por decurso de prazo é carimbar como entregue uma corrida que talvez não tenha sido. Enquanto a Etapa 8 não definir o destino, corrida parada em Pago aparece em `corridasParadas` e é resolvida por gente.

**Prazo de validade da cobrança (QR):** **5 minutos**, o mesmo relógio da espera na porta (seção 7) — não é número novo. O motoboy pode **regerar** o QR enquanto a corrida estiver no estado 4; regerar **não estende** a espera de 5 minutos, que corre desde a chegada declarada. Vencida a espera, a corrida vai para 6 e a cobrança é cancelada antes da transição.

## 5. Cancelamento

- **Livre e sem custo** no **estado 1**, para qualquer parte (lojista, cliente ou operação): ninguém saiu do lugar.
- **Dos estados 2, 3, 4 e 6**, só a operação cancela, sempre com **motivo registrado** (motivo em branco é recusado).
- **Cancelamento pós-aceite causado pelo lojista:** cobrado do **cartão de garantia do lojista** e repassado ao motoboy.
- **Depois do estado 5 (Pago) não se cancela.** O dinheiro já foi dividido em três contas que não são nossas. O que existe dali em diante é **disputa** (estado 7), resolvida no painel por evento compensatório.

> **Buraco declarado até a Etapa 11:** o estado 7 nasce **sem nenhuma aresta** — nem de entrada. Ou seja, entre o pagamento e a Etapa 11 **não existe recurso dentro do sistema**: o que der errado depois do split se resolve por fora, com gente. É consciente — inventar um fluxo de disputa antes da etapa que o especifica seria pior — e é o motivo de a Etapa 11 não poder ficar para o fim.

> Princípio: **quem causa paga.** Não existe custo sem dono. O Corre nunca banca do próprio bolso.

## 6. Despacho

- Oferta para o **motoboy mais próximo, um de cada vez**.
- **30 segundos** para aceitar antes de passar ao próximo.
- **Nota desempata apenas em empate técnico** (chegada com até ~2 min de diferença). Fora disso, distância manda.
- Recusar é **livre e sem punição**. 4 recusas seguidas → offline por 15 min.
- Cascata roda **5 minutos**. Ninguém aceitou → estado 9.
- Motoboy pode aceitar uma segunda corrida estando ocupado. **Teto: 2 ativas.** Cada corrida permanece independente (cobrança própria, preço próprio, estado próprio) — o app não roteiriza nem rateia.
- **Ocupam vaga os estados 2, 3, 4 e 6** — os quatro em que ele está a caminho ou com mercadoria de alguém. **Não ocupam o 5 nem o 7:** o 5 dura segundos e prender vaga nele travaria o motoboy por causa de uma entrega que já foi paga; o 7 é decisão de painel e pode demorar dias.
- **Ele pode ter duas corridas no estado 4 ao mesmo tempo** — duas portas, dois QR. As cobranças são independentes e cada uma tem a própria espera de 5 minutos, contada da própria chegada declarada.
- O rastreio mostra ao lojista e ao cliente quando o motoboy tem outra parada antes.

**O despacho passou a ser a primeira coisa que acontece.** Antes ele só começava depois do Pix confirmado; agora a corrida nasce nele. Consequência: o motoboy pode gastar a viagem e não receber nada se o cliente não pagar — e é por isso que o retorno é pago pelo cartão do lojista (seções 3 e 5) e que a reputação do cliente existe (seção 12).

## 7. Entrega

- **A prova de entrega é o pagamento.** O cliente só paga quando o motoboy está na porta com a mercadoria; a confirmação vem do banco, com valor e horário, e não de um número que alguém digita. **O PIN de 4 dígitos saiu da especificação.**
- **Ordem obrigatória:** chegada declarada → QR exibido → **confirmação do backend** → mercadoria entregue → motoboy confirma. O app do motoboy **não mostra o botão de entregar** antes da confirmação.
- **Espera na porta:** 5 minutos, com **1 aviso registrado**. Depois vira retorno (estado 6). *Antes era "1 ligação registrada"; sem telefone exposto (seção 19), a ligação deixou de ser possível.*
  **O aviso é o evento gravado, não o canal.** Até a Etapa 10 (chat) e a Etapa 14 (SMS) existirem, o critério de aceite da Etapa 8 é o **registro** do aviso; o canal de entrega — chat para quem tem app, SMS para quem não tem — entra com as etapas que o constroem. Amarrar a Etapa 8 a um canal que ainda não existe seria criar dependência para trás.
- **Espera na loja:** grátis, sem taxa. Controlada por reputação, não por cobrança.

**O que o fim do PIN custou e o que ganhou.** Ganhou: a prova virou um fato bancário com horário, que o cliente não consegue passar por telefone para outra pessoa, e sumiu o atrito de ditar número na porta. Custou: o pagamento prova que o cliente estava lá e pagou, **não prova que a mercadoria mudou de mão**. Essa fresta dura segundos e é coberta pela disputa de 24h (seção 11), tendo o chat como prova (seção 19).

## 8. Preço e prazo

### Preço do frete

- Tabela por zona, transcrita da tabela que já opera na cidade. **Não alterar valores no lançamento** — o motoboy tem que ver o preço que já sabe de cor.
- **Fora de zona:** zona mais cara + adicional por km, com distância em **linha reta** a partir do centro da última zona (evita custo de API de mapa).
- **Sem preço dinâmico.** Sem adicional de chuva, sem adicional de pico. Nenhum parâmetro de tempo entra no cálculo.

*Consequência conhecida e aceita: em chuva forte a oferta cai e corridas morrem em "sem motoboy".*

**Como o motor de preço funciona (implementado na Etapa 3):**

1. **Tabela de zonas é dado versionado no banco** (`tabelas_preco` + `zonas`). Alterar preço **cria uma versão nova**, nunca sobrescreve; versão publicada é imutável — a aplicação só tem `SELECT`, e publicar é ato de dono via `corre-api/scripts/importar-tabela-preco.js`. Toda corrida guarda `tabela_preco_id` + `frete_centavos` + `zona_nome`, para auditar um preço cobrado anos depois.
2. **Geometria:** retângulo em lat/lng (graus × 1e6, inteiro). Resolução por contenção, sem API externa.
3. **Fronteira e sobreposição:** as zonas têm `ordem`; vence a de **menor ordem** que contém o ponto. Retângulos inclusivos nas duas bordas ⇒ ponto exatamente na fronteira cai sempre na de menor ordem — determinístico, nunca aleatório.
4. **Arredondamento (num lugar só, `corre-api/src/dominio/preco.js`):** a distância vira km **para cima (teto)**, e esse é o **único** arredondamento do caminho — não há piso por eixo antes dele. Tudo em `BigInt`, centavos inteiros; fatores metros/grau gravados como dado inteiro na versão da tabela, sem `cos`/float.
5. **Correção pendente (PR próprio):** o preço é **par origem-destino** — matriz 6×6 de anéis, `preço = tabela_anel1[max(anel_origem, anel_destino)]` —, não propriedade do destino. Travada na tabela real.
6. **Tabela real de Sobral ainda não existe** (seção 17, item 4): trabalha-se com `corre-api/dados/tabela-preco-exemplo.json`, **marcada como exemplo** (`exemplo=true`). Os valores de exemplo (inclusive o adicional de R$ 1,50/km) **não são reais**.

### Preço da mercadoria

O valor da mercadoria é **digitado pelo lojista e cobrado integral**. O Corre **não tem comissão nenhuma sobre mercadoria** (seção 9), não confere preço, não tabela produto e não guarda catálogo — a mercadoria é um número que atravessa a cobrança e cai inteiro na subconta do lojista.

Ele **substituiu o "valor declarado"** da versão anterior: antes era uma declaração para limitar responsabilidade em caso de perda; agora é o valor efetivamente cobrado. O teto da seção 11 passa a incidir sobre um número real, e não sobre uma estimativa de quem tem interesse nela.

### Prazo estimado de entrega

- **Fórmula:** `prazo = tempo base de coleta da cidade + tempo do anel max(anel_origem, anel_destino)`. Dois números, nenhuma API de mapa, nenhuma rota.
- **O prazo é par origem-destino, igual ao preço.** Distância é simétrica: uma entrega do anel 2 para o Centro leva a travessia inteira, e o anel de destino sozinho prometeria o tempo de metade dela. Usar o **anel maior** nunca promete menos tempo do que a viagem leva. *Prometer a menos é o erro caro — o cliente espera 10 minutos, chega em 25, e o prazo criou a reclamação que existia para evitar.*
- **Fora de zona herda a lógica do preço:** `tempo base + tempo do anel mais externo + minutos por km adicional`, com **a mesma distância em linha reta** já calculada para o preço (centro da última zona, aritmética inteira, sem API).
- **Onde os números moram:** minutos por anel são **coluna da tabela de preço versionada**; o **tempo base de coleta** e os **minutos por km adicional** são colunas da mesma versão — mesma imutabilidade, mesma auditoria. O tempo base é **dado da cidade**, não da loja.
- **Um lugar só:** a fórmula, o `max` dos anéis, o teto de km e a faixa vivem em `corre-api/src/dominio/prazo.js`. Nenhum minuto se calcula fora dali, como nenhum arredondamento de preço se calcula fora de `preco.js`.
- **É estimativa, e o texto na tela diz isso.** Não é SLA, não é promessa, não gera multa, não gera desconto, não entra na reputação de ninguém. Corrida atrasada não é corrida com defeito.
- **Gravado na criação** junto com a versão da tabela: a mesma corrida mostra o mesmo prazo para lojista, motoboy e cliente, para sempre.

**O prazo se mostra como FAIXA, nunca como ponto.** "20 a 30 minutos", nunca "25 minutos". Número exato vira promessa na cabeça de quem lê, e erro de três minutos vira reclamação.

Como a faixa se forma, num lugar só (`prazo.js`):

| | |
|---|---|
| **Teto** | o menor múltiplo de 5 **estritamente maior** que o tempo calculado |
| **Piso** | teto − 10 |
| **Faixa mínima** | se o piso cair abaixo de 5, a faixa é **5 a 15** |

Tempo calculado 25 → **20 a 30**. Calculado 23 → **15 a 25**. Calculado 27 → **20 a 30**. A largura é sempre 10 minutos, e **o teto é sempre maior que o calculado** — a faixa nunca promete menos do que a conta disse.

**O app nunca mostra o valor pontual, nem em tela de detalhe.** A garantia não é disciplina de quem escreve tela: o valor pontual fica gravado para auditoria e a aplicação **não tem privilégio de lê-lo** — só o dono do banco lê. O que a API devolve é a faixa. *(Princípio das dez leis: quando dá para tornar impossível, não se pede cuidado.)*

## 9. Dinheiro

**Comissão: 5% do frete. Zero sobre a mercadoria.** Num frete de R$ 10, R$ 0,50 — o mesmo em uma entrega de R$ 20 de mercadoria e em uma de R$ 400.

**Por que zero sobre a mercadoria** (decisão de 2026-08-09, três motivos):
1. **Nosso serviço é o frete.** Cobrar percentual da mercadoria é cobrar por um valor que não produzimos.
2. **Fiscal.** A NFS-e sai só sobre a comissão de 5% (seção 15). No instante em que o Corre tira percentual da mercadoria, ele vira revendedor, e a mercadoria entra na base tributária dele.
3. **Adoção.** Percentual sobre mercadoria o lojista embute no produto e o cliente paga — e ele descobre isso na primeira conta. Frete é caro de vender uma vez; mercadoria é caro de vender todo dia.

### Como o dinheiro anda

**Uma cobrança só, na porta, com três recebedores declarados desde o nascimento:**

| Parcela | Vai para | Quanto |
|---|---|---|
| Mercadoria | Subconta do **lojista** | Integral |
| Frete − 5% | Subconta do **motoboy** | 95% do frete |
| Comissão | Conta do **Corre** | 5% do frete |

**O split é declarado quando a cobrança nasce e liquidado pelo gateway no pagamento.** A transição 4→5 é o **registro** desse fato, não a ordem que o dispara — o Corre não manda transferir nada, e é exatamente por isso que não existe endpoint que "só transfere" (Lei 6).

### A aritmética do split, em centavos inteiros

5% de um frete ímpar não é centavo inteiro, e a soma das três parcelas tem que bater com o total **ao centavo, sempre**. A regra é fechada, não deixada ao acaso — **três arredondamentos, cada um com um princípio**:

1. **Comissão: PISO.** `comissão = piso(frete × 5%)`, e `parcela do motoboy = frete − comissão`.
2. **Taxa: TETO.** A taxa é estimada **para cima**. Nunca subestimar custo.
3. **Rateio: ninguém paga taxa maior que a própria parcela, e toda sobra cai na plataforma.**

Os três saem de um princípio só, e o princípio vale mais que as regras:

> ### **O centavo do arredondamento é sempre do parceiro, nunca da plataforma.**
>
> Toda vez que uma conta não fecha em centavo inteiro, quem fica com a sobra é **o motoboy ou o lojista** — nunca o Corre. Quando o Corre é o único que pode absorver (a taxa fixa, o resto do rateio), ele absorve.

Isto **não é detalhe de implementação: é cláusula de contrato e argumento de venda.** Diz-se ao motoboy e ao lojista com estas palavras, e escreve-se no contrato de adesão dos dois. Uma plataforma que arredonda a favor de si mesma ganha centavos e perde a frase que a vende; e num volume de 34 mil corridas por mês, "só um centavo" é a diferença entre ser sócio e ser cobrador.

Corolário para quem for construir: **numa dúvida de arredondamento não escolhida por esta seção, arredonde contra a plataforma.** Se isso quebrar a conta, a conta estava errada.

**Mercadoria entre zero e o valor da taxa** (venda quase toda acertada fora) cai na mesma regra: o lojista paga no máximo a própria parcela e o resto da taxa é da plataforma. Não existe faixa em que alguém receba valor negativo.

`corre-api/src/dominio/split.js` é o **único** lugar onde essa conta existe, e a mesma fórmula está no banco (`parcela_corre_centavos`) — a bateria prova que as duas coincidem em milhares de casos, porque duas implementações que divergem em silêncio seriam pior que uma só.

### A trava: a plataforma se recusa a operar no prejuízo

**A parcela do Corre nunca pode resultar negativa nem zero.** Se resultar, **não é erro do usuário — é falha de configuração**, a corrida não é criada, o erro é registrado como problema nosso e responde **503**, nunca 4xx.

Sem isso, o ponto de equilíbrio (`mercadoria ≤ 3,2 × frete`) seria só uma nota nesta página: bastaria o parâmetro de concentração de taxa não estar ativo — contrato diferente, gateway trocado, configuração errada — para a plataforma passar a pagar para trabalhar **em silêncio**, em todo pedido acima de ~R$ 32 de mercadoria.

**A garantia mora no banco, no momento mais cedo possível:** a configuração de taxa é **dado versionado e imutável** (`configuracoes_taxa`), publicada por ato de dono, e o banco **recusa publicar** uma configuração que possa produzir parcela do Corre ≤ 0 dentro do envelope que ela mesma declara (frete mínimo, mercadoria máxima). **Sem configuração publicada não há corrida, e sem corrida não há cobrança.** A conferência por corrida é defesa em profundidade, não a trava.

### Estorno: quanto volta, e para quem

**Ao cliente volta o valor da mercadoria, integral.** Ele pagou por mercadoria que não ficou com ele; devolver menos seria cobrá-lo pelo erro de outro.

**O frete não é tocado:** a entrega foi prestada — o motoboy fez a viagem e o Corre fez a intermediação.

Sobra a diferença: o lojista recebeu a mercadoria **menos a taxa**, e devolve a mercadoria **inteira**. Essa diferença é **custo de quem deu causa**, decidido no painel com motivo registrado (Etapa 11): mercadoria errada ou avariada é do lojista; desistência do cliente é do cliente, e como não há de onde cobrá-lo, entra na reputação dele (seção 12). **Se a taxa percentual volta ou não num estorno parcial de Pix é pergunta comercial em aberto** (`GATEWAY.md`, seção 6) — a resposta muda o tamanho da diferença, não de quem ela é.

E o split precisa ser **reenviado explicitamente** no cancelamento: se não for, o gateway reaplica a proporção original e tira dinheiro do motoboy e do Corre.

**Não existe mais retenção, custódia ou escrow.** Ela existia para dar lastro ao estorno de "sem motoboy", de cancelamento e de disputa, quando o pagamento vinha **antes** da entrega. Com o pagamento **na** entrega, esses três casos acontecem quando ninguém pagou nada: não há o que reter e não há o que estornar. **O Portão C morreu com o problema que ele resolvia.**

**O dinheiro nunca encosta na conta do Corre — critério permanente.** Não é questão de taxa, é a **Res. BCB 494/2025**: guardar dinheiro de terceiro é ser instituição de pagamento, com autorização e responsabilidade que este negócio não comporta. Com a mercadoria dentro da cobrança isso ficou **mais** severo, não menos: o valor que atravessa a plataforma deixou de ser R$ 10 de frete e virou R$ 10 + o preço da mercadoria. Qualquer desenho em que esse valor transite pela conta da plataforma está **descartado por construção**, por mais barato que seja.

**O saldo exibido nos apps é espelho da subconta do titular no gateway, não conta nossa.** O saque é ato dele, pelos canais do gateway, e o custo da transferência é dele. O Corre **não intermedeia saque nem promete gratuidade**. **Primeiro saque travado** até conferência dos documentos: é estado gravado da conta (`primeiro_saque`), nasce `travado` por padrão do banco, e só a operação libera.

### O colchão de reserva — regra permanente, não manobra de largada

O gateway trata o saldo do marketplace como **um só**: o teto de saque de **qualquer** recebedor é a soma algébrica de todos, **negativos inclusive**. Um recebedor negativo — por estorno, chargeback ou taxa cobrada sem saldo — **trava o saque de todo mundo**. E **não existe isolamento por recebedor**: nenhum campo de reserva, retenção ou limite na criação. **A reserva é o único remédio.**

**Como ela nasce:** no **primeiro mês** a conta do Corre opera com `transfer_enabled: false`, e a comissão acumulada vira o colchão — **≈ R$ 17.100 sem tirar um centavo de ninguém**.

> **E depois ela não some. A regra é permanente:**
>
> ### **A conta do Corre nunca saca abaixo do colchão.**
>
> **O saldo de reserva é passivo operacional, não lucro disponível.** Ele está ali para que o estorno de um lojista não impeça 66 motoboys de sacar no mesmo dia. Sacar a reserva é gastar dinheiro que já tem dono.

**Detecção: pelo nosso log, não pelo saque.** O gateway **não tem webhook de saldo** e consulta saldo um recebedor por chamada. Mas ele emite os webhooks das **causas** — cobrança estornada, chargeback recebido —, e o Corre **declara o split de toda cobrança**. Logo o saldo de cada recebedor é **derivável dos nossos próprios eventos**, e o negativo é conhecido **no instante da causa, nunca na tentativa de saque**. É o log de eventos fazendo o que o gateway não faz; a consulta ao gateway vira **conciliação periódica**, não detecção. **É critério de aceite da Etapa 9.**

### O retorno: dívida primeiro, cartão só em último caso

**Quanto vale o retorno: o frete da corrida.** A viagem foi feita, e é o frete que a paga. Não é número novo — sai da mesma tabela versionada, já gravada na corrida. O mesmo valor vale para o cancelamento pós-aceite causado pelo lojista. **Sobre o retorno não incide a comissão de 5%:** o Corre não intermediou entrega nenhuma ali, e cobrar comissão de uma entrega que não aconteceu seria ganhar com o fracasso.

**São dois caminhos, nesta ordem — e o segundo quase nunca acontece.**

**1. Caminho normal: o retorno vira saldo devedor do lojista.** Nasce um **débito na conta dele** — agregado próprio, com eventos próprios, **fora da corrida: nenhuma aresta nova na máquina de estados**. Ele é quitado no **split da próxima corrida**, debitado da **parcela do lojista**, com o **motoboy credor entrando como recebedor adicional**. Quem paga é quem deve, e o cliente da próxima corrida não vê nada nem paga nada — embutir a dívida no QR faria um cliente pagar pelo que outro não pagou, e isso fere "quem causa paga" de frente.

**O débito nunca impede o lojista de pedir.** Se impedisse, ele pararia de pedir, a dívida nunca quitaria e o motoboy nunca receberia — a trava trabalharia contra o credor.

**2. Último recurso: o cartão de garantia.** Cobrado **só quando a dívida não quita sozinha**: **30 dias corridos após o lançamento do débito**, se ele ainda estiver aberto, o cartão é cobrado pelo saldo devedor inteiro. O lojista é avisado aos **15 dias**. Enquanto ele opera normalmente, a dívida quita em dias e **o cartão nunca é tocado**.

> **Por que o relógio conta do lançamento da dívida, e não da última corrida:** um lojista que continuasse pedindo só corridas de **mercadoria zero** nunca teria de onde descontar, e a dívida ficaria aberta para sempre com o motoboy esperando. Contando da dívida, o buraco fecha sozinho.
>
> **E por que 30 dias, não 90:** cartão envelhece. Quanto mais tempo passa, maior a chance de o cartão ter vencido, sido cancelado ou trocado — e maior a estranheza da cobrança para quem a recebe, o que **aumenta** a contestação. Esperar não protege ninguém.

**Por que esta ordem, e não o cartão direto** — o motivo é o **índice, não o valor**:

- **O chargeback é debitado da conta do Corre**, por contrato, **mesmo com documentos apresentados** e recusados pelo emissor. Não é o lojista que perde: somos nós.
- **Contestar é perda garantida:** custa da ordem de **R$ 55** numa cobrança de **R$ 10**.
- **Passar do índice de chargeback custa R$ 99 por ocorrência** e pode disparar uma **Reserva de Segurança de 90 dias corridos** no gateway — o que travaria o dinheiro de todo mundo, não só o nosso.

**A defesa contra chargeback não é ganhar a disputa. É nunca chegar ao cartão.** Os dois caminhos existem para isso: o normal cobre a grande maioria dos casos sem tocar em cartão nenhum, e o cartão fica para o lojista que sumiu — que é justamente o caso em que não há alternativa.

**As três pedras do caminho normal, com regra escrita:**

| Pedra | Regra |
|---|---|
| **O motoboy credor não participa da entrega que quita a dívida** | Ele entra no split como **recebedor adicional**, e o vínculo dele é **com a dívida, não com a entrega**. A corrida que quita registra qual débito quitou e de quem |
| **Mercadoria zero não tem de onde descontar** | A dívida **não quita nessa corrida e rola para a próxima que tiver parcela de mercadoria**. O relógio dos 30 dias **não para** — é o que impede o lojista de nunca quitar |
| **Abater dívida pretérita em split futuro não está documentado em gateway nenhum** | **Pergunta comercial, e não detalhe.** Se nenhum fornecedor suportar, **a Saída A cai e a arquitetura do retorno muda** — isso é **bloqueio a reportar**, não item a contornar em obra |

**Se o cartão for cobrado, ele precisa de meio, e ele não é Pix.** Exige do fornecedor **cobrança de cartão com repasse direto para a subconta do motoboy, sem passar pela conta do Corre** — mesmo critério (C). **A taxa dessa cobrança sai do lojista**, que é quem deu causa.

### A conta da Lei 7, refeita

A taxa do gateway incide sobre o **total** (mercadoria + frete). A receita do Corre é **5% do frete**. A 1,19% (preço de tabela dos dois candidatos mais baratos):

| Mercadoria R$ 100 + frete R$ 10 · total R$ 110 · taxa R$ 1,31 | Lojista | Motoboy | **Corre** |
|---|---|---|---|
| **Taxa debitada do lojista** | R$ 98,69 | R$ 9,50 | **+ R$ 0,50** |
| Taxa proporcional entre os três | R$ 98,81 | R$ 9,39 | + R$ 0,49 |
| **Taxa debitada do Corre** | R$ 100,00 | R$ 9,50 | **− R$ 0,81** |

**Ponto de equilíbrio, se a taxa sair da comissão:** `mercadoria ≤ 3,2 × frete`. Com frete de R$ 10, só fecha até ~R$ 32 de mercadoria. Acima disso **toda entrega dá prejuízo, e o prejuízo cresce com o preço da mercadoria, que não é nosso** — R$ 500 de mercadoria custariam R$ 5,57 do bolso do Corre.

**Com a taxa debitada da mercadoria, a margem do Corre é imune ao valor da mercadoria:** R$ 0,50 por corrida, em R$ 100 ou em R$ 500.

Portanto a especificação exige, do gateway e do contrato: **a taxa é debitada da parcela de mercadoria**, e a comissão de 5% do frete chega inteira. Fornecedor que não permita dizer **de quem sai a taxa** não serve, ainda que seja o mais barato — é o critério (D) da seção 17, item 1.

**Duas consequências que não são negociáveis:**

1. **Custo fixo não é só caro, é insplitável.** Os gateways só aceitam regra de split para a taxa **percentual**; qualquer componente **fixo** cai obrigatoriamente na plataforma e nenhum parâmetro o move. Um fixo de R$ 0,99 por Pix vira 50 centavos de receita contra 99 de custo — prejuízo em toda entrega, em todo cenário. É o que torna o critério (A) duplamente eliminatório.
2. **"Comissão zero sobre a mercadoria" continua verdade, mas a taxa muda de bolso.** O Corre não tira nada da mercadoria; o gateway tira. O lojista recebe R$ 98,69 num pedido de R$ 100 — 1,31%, **menos do que qualquer maquininha que ele já usa**, e pior em pedido pequeno (1,79% num de R$ 20, porque ele paga a taxa sobre o frete também). **Isso tem que estar no contrato de adesão do lojista e ser dito antes de assinar.**

**Quando a mercadoria é zero** (venda já acertada fora, seção 3) não existe parcela de lojista de onde debitar: a taxa sai do Corre e a comissão vira R$ 0,38 num frete de R$ 10. **Fecha sempre**, porque 1,19% do frete é muito menor que 5% do frete.

O levantamento completo, o ranking e as perguntas que faltam estão em [`GATEWAY.md`](GATEWAY.md).

## 10. Cadastro

### Motoboy
- CNH + CRLV da moto + selfie
- **Chave Pix obrigatoriamente do mesmo CPF do cadastro**
- **Subconta no gateway** (é para lá que a parcela do frete cai)
- Um aparelho por conta
- Aprovação automática — roda na hora. O **primeiro saque** fica travado até conferência

**MEI continua não sendo exigido — isso foi verificado, não presumido.** Os quatro gateways candidatos abrem subconta de recebedor para **pessoa física com CPF** (`GATEWAY.md`, seção 8). A regra da seção 15 sobrevive inteira.

**Ele roda antes de poder sacar, e a tela tem que dizer isso.** No candidato melhor colocado a subconta nasce apta a **receber** antes de estar apta a **movimentar** — ele participa do split na primeira corrida, no mesmo dia do cadastro, e o KYC (documento, biometria) corre em paralelo em até 24h. O app **mostra o estado do KYC** e **não promete saque** antes de a subconta estar ativa. Prometer é fazer o motoboy trabalhar, ver saldo e não conseguir tirar — que é o jeito mais rápido de perder um motoboy. *(Nem todo fornecedor tem esse estado intermediário: em dois deles a conta só transaciona depois de aprovada, e aí "cadastra e roda na hora" morre. Isso virou critério de escolha — seção 17, item 1.)*

**O cadastro precisa de mais do que a lista acima, e o app coleta tudo antes de criar a subconta:** data de nascimento, ocupação profissional, renda mensal declarada, endereço completo **com ponto de referência**, e os **dados bancários no mesmo ato** — não existe recebedor sem conta. **A conta de saque tem que ser do CPF dele**, o que casa com a regra "chave Pix = CPF" que já existe. A prova de vida é por link que **expira em 20 minutos** e precisa ser regerado; a lista exata de artefatos que ela pede **não está documentada** e não pode ser prometida na tela.

**Saque agregado, não por corrida.** A tarifa de saque é fixa e sai do bolso dele; com R$ 9,50 líquidos por corrida, sacar a cada corrida come o ganho. A configuração padrão da subconta é **transferência periódica agregada**, e o app explica por quê.

**Chave Pix = o próprio CPF do cadastro**, verificada no ato (dígitos verificadores no código **e** `CHECK` no banco). Motivo: sem consulta DICT no MVP, chave de outro tipo (e-mail, telefone, aleatória) não é verificável quanto ao dono — seria brecha de conta laranja. Quando o gateway trouxer consulta de titularidade, ampliar é decisão nova.

**Um aparelho por conta:** o identificador do aparelho fica amarrado à conta. Segundo aparelho é **recusado**. Troca de aparelho existe, mas é **ação da operação**, registrada como evento — nunca automática. Trocar aparelho e bloquear conta **revogam as sessões vivas na hora**, e toda requisição revalida a sessão contra a conta viva.

### Lojista

- Nome e telefone para **entrar**
- **Cartão de garantia** antes do primeiro pedido
- **Subconta no gateway** antes do primeiro pedido — é para lá que a mercadoria cai

**São três condições separadas, e a terceira é nova:** **pode entrar** (cadastro ativo) ≠ **pode pedir** (cartão registrado) ≠ **pode receber** (subconta aprovada). Sem cartão **ou** sem subconta, a criação de corrida é recusada — no domínio e por trigger no banco, com a razão certa em cada caso.

**"Cadastro em 1 minuto: entra, olha, mexe" continua verdade — e agora só até o primeiro pedido.** Com a mercadoria dentro da cobrança, o lojista virou recebedor, e recebedor precisa de KYC. Ele entra e olha em um minuto; para vender, precisa da subconta aprovada. **Isso é uma piora real de onboarding e está registrada como risco** (seção 17, item 11).

**Loja com CNPJ: quem cadastra é o sócio, não o gerente.** Os gateways exigem que o responsável pela subconta seja **sócio registrado e qualificado no QSA** — administrador e procurador não são aceitos (Circular BCB 3.978/20). Em Sobral isso significa **o dono da loja em pessoa**, e é esforço de campo a planejar no lançamento, não surpresa a descobrir no cadastro.

**O lojista precisa saber, antes de assinar, que a taxa do gateway sai da parcela dele** (seção 9). Vai no contrato de adesão, não numa tela que ninguém lê.

### Cliente

- **Telefone.** Só isso para receber e pagar.
- **Não precisa de app**: na primeira compra existe a ponte web (seção 2).
- A conta do cliente **nasce sozinha** quando o primeiro lojista digita o telefone dele, e passa a ser dele quando ele entra pelo código de 6 dígitos por SMS.
- **O cliente é da plataforma, não da cidade.** Ele recebe entrega onde estiver; quem pertence a uma cidade é o lojista, o motoboy e a corrida (seção 20).
- Cliente **não tem subconta e não recebe dinheiro** — ele só paga.

**Telefone digitado errado.** É o erro mais provável do fluxo, e ele cria conta e reputação no nome de um estranho. Três regras:
1. O lojista **confere o número mascarado** (últimos dígitos) na confirmação da criação. Uma tela, dois toques.
2. **Corrigir o telefone antes do aceite é ato do lojista, sem custo** — a corrida ainda não saiu do lugar.
3. **Falta de pagamento só entra na reputação de conta já reivindicada** pelo dono do número (isto é, que já entrou pelo código de 6 dígitos). Conta que nunca foi reivindicada não acumula nota — punir quem nunca soube que existia é punir o inocente.

### Sessão e re-login
- Sessão nasce no cadastro: token opaco, **só o hash fica no banco**, validade 30 dias.
- **Motoboy** re-entra por **CPF + aparelho vinculado** (posse do aparelho é a credencial).
- **Lojista, cliente e operador** re-entram por **código de 6 dígitos via SMS**: expira em 10 min, uso único, no máximo 5 tentativas erradas (ao estourar, o código morre e é preciso pedir outro), com limite de envios por telefone e por IP para o endpoint não virar torneira de SMS pago. O código **nunca é gravado em claro** — só o hash. O envio fica atrás de uma interface; **nenhum provedor real até a Etapa 14** — a partir dela ele é obrigatório, porque é por SMS que o cliente novo recebe o link para pagar (seção 2 e seção 17, item 9).
- **Sessão não confia no cliente:** papel e identidade saem sempre do servidor. Nada de identidade vinda do corpo da requisição.
- Todo login bem-sucedido gera evento.

> Princípio: **trava o dinheiro, não a porta.** Fraude só compensa se o dinheiro sai.

## 11. Disputa

- **Pagamento confirmado = cliente presente e cobrança quitada, com horário do banco.** É o que substituiu o PIN.
- **Prazo para abrir disputa: 24h** após a entrega. O chat da corrida (seção 19) é a prova de as duas partes: ele não se edita nem se apaga.
- Mercadoria quebrada ou sumida: **responsabilidade do motoboy**, limitada ao **valor da mercadoria cobrado** — que agora é um número real, não uma declaração de parte interessada.
- **Teto de valor de mercadoria no MVP: R$ 500.** Acima disso o app recusa a corrida.
- Disputa **não reabre estado final**: resolve por evento compensatório no painel (Etapa 11).

> A regra do pagamento é política operacional, não escudo jurídico. Não afasta CDC.

## 12. Reputação

**Três notas, e cada uma muda uma coisa concreta.** Nota que não muda nada é enfeite.

| Quem é avaliado | Quem avalia | Como se forma | O que muda |
|---|---|---|---|
| **Loja** | Motoboy e cliente | Tempo real de espera na loja + nota do motoboy + nota do cliente | **É visível.** Loja lenta é despachada por último — é a alavanca que substitui a taxa de espera |
| **Motoboy** | Lojista e cliente | Nota das duas pontas depois da entrega | **Só desempata dentro da janela de ~2 min.** Nunca fura a distância |
| **Cliente** *(novo)* | Lojista e motoboy | **Um fato observado** — pagou ou não pagou, que é o backend que sabe — mais o **motivo declarado pelo motoboy** no retorno (*ausente* × *presente e não pagou*) e a nota das duas pontas | Acima do teto de faltas, **é recusado como destino de nova corrida** até a operação liberar. *(O escopo — a plataforma toda ou só aquela loja — é decisão do dono, seção 17, item 13)* |

**Por que o cliente passou a ter nota:** com o pagamento na porta, é ele quem pode fazer a viagem inteira virar prejuízo. Quem não paga tem que ficar visível **antes** do próximo motoboy sair da loja.

**Regras de atribuição:**
- Entrega falhada por **endereço errado** conta **contra a loja**, nunca contra o motoboy.
- **Não pagamento** conta **contra o cliente**, nunca contra o motoboy nem contra a loja.
- **Atraso não conta contra ninguém** — o prazo é estimativa (seção 8).
- **Desempenho:** 3 avisos antes de qualquer bloqueio.
- **Fraude:** bloqueio imediato, sem aviso.

O **teto de faltas de pagamento** que bloqueia um cliente ainda não tem número (seção 17, item 13).

## 13. Painel da operação

- Permite: ver tudo, forçar cancelamento, estornar e bloquear
- **Acesso por níveis:** atendimento resolve o dia a dia; **só o dono estorna e bloqueia**. Atendimento recebe **403**, não uma tela escondida
- **Nada se apaga nem se edita.** Correção só por evento compensatório
- Toda ação do painel gera evento **com autor identificado**
- **Estorno:** a autorização (exclusiva do dono) e o registro do ato existem desde a Etapa 2; o **efeito financeiro só existe a partir da Etapa 7**. Até lá o evento é gravado no agregado do operador sem tocar o log da corrida, que é só de transições
- **Estorno depois do split é diferente do que era.** O dinheiro está em três contas que não são nossas, e o estado já é final — então o que o move é **evento compensatório com autor identificado**, não transição (Lei 6). A regra do valor é a da seção 9: **ao cliente volta a mercadoria integral, o frete não é tocado, e a diferença é de quem deu causa**, decidido aqui com motivo registrado. E o split precisa ser **reenviado explicitamente** no cancelamento — se não for, o gateway reaplica a proporção original e tira dinheiro do motoboy e do Corre. **Controle negativo obrigatório desta etapa:** estorno sem split explícito tem que ficar vermelho

## 14. Antifraude

| Golpe | Trava no MVP | Custo |
|---|---|---|
| **Motoboy exibe um QR próprio no lugar do da plataforma** | O QR **nasce no backend** e a corrida só anda com a confirmação que o backend recebe. Cliente com app ou com o link do SMS vê a cobrança **vinda do backend**, com valor e recebedor, e é essa a via recomendada na tela. Motoboy que cobra por fora não fecha corrida: ela vira retorno, o cartão do lojista paga a viagem e o padrão aparece na operação | Zero |
| Corrida fantasma com GPS falso | Corrida só existe se um lojista real criou e confirmou coleta. Flag de localização simulada do Android | Zero |
| Bônus fraudado | **Não existe bônus por número de entregas no MVP** | Zero |
| Conta laranja | Chave Pix do mesmo CPF + selfie + 1 aparelho por conta | Zero |
| Estorno de cartão pelo cliente | **O cliente só paga por Pix.** Pix não tem chargeback — a devolução é ato de quem recebeu, não de quem pagou | Zero |
| **Chargeback do cartão de garantia do lojista** | **Nenhuma trava no MVP.** O único cartão do modelo é o do lojista, cobrado em retorno e cancelamento pós-aceite (seção 9) — e esse **tem** chargeback. Se ele contestar, o dinheiro já foi para o motoboy. Mitigação parcial: é cobrança pequena, rastreada e com motivo registrado; reincidência é bloqueio | **Risco aberto** |
| Conluio lojista+motoboy | Contador do par em cancelamentos pós-aceite | Zero |
| **Cliente que não paga na porta** | Cartão do lojista paga o retorno; a falta entra na reputação do cliente e, no teto, bloqueia | Zero |
| "Entreguei" vs "não recebi" | Pagamento confirmado pelo banco com horário + chat imutável como prova + disputa de 24h | Zero |

**Risco residual registrado:** o pagamento prova presença e quitação, **não prova a entrega física**. É uma fresta de segundos, entre a confirmação e a mercadoria mudar de mão, coberta só por disputa. Foi o preço de tirar o PIN, e está aceito.

## 15. Jurídico

- O Corre se posiciona como **intermediação de tecnologia**. Motoboy é autônomo
- **NFS-e emitida somente sobre a comissão de 5% do frete**, nunca sobre o frete cheio e **nunca sobre a mercadoria**. É o split que garante isso: a mercadoria nasce endereçada à subconta do lojista e não passa pela nossa conta em momento nenhum. **É essa mecânica que impede o Corre de ser revendedor** — não uma cláusula de contrato
- **MEI não é exigido** do motoboy

> **Risco a monitorar:** três regras apontam para controle e aparecem em ação de vínculo — offline por 4 recusas, nota influenciando despacho, e bloqueio por desempenho. Todas existem em iFood e Uber. Revisar com advogado antes do lançamento.
>
> **Risco novo (2026-08-09):** com a mercadoria dentro da cobrança, o valor que atravessa a plataforma multiplicou. A separação entre "intermediar tecnologia" e "processar pagamento de terceiro" ficou mais fina, e é o critério do dinheiro nunca encostar na conta do Corre (seção 9) que a mantém. Entra na revisão jurídica do lançamento.

## 16. Fora de escopo do MVP

- Catálogo, vitrine ou qualquer descoberta de loja
- Carteira dentro do app — saldo é espelho da subconta no gateway
- Cartão de crédito como meio de pagamento do cliente
- **Pagamento antes da entrega** — não existe pré-pago no MVP
- **Entrega entre cidades** — origem e destino na mesma cidade (seção 20)
- Roteirização e rateio de entregas agrupadas
- Pedido agendado
- Foto como prova de entrega
- Anexo, foto ou áudio no chat — **texto e nada mais** (seção 19)
- Integração com WhatsApp, oficial ou não
- Preço dinâmico / surge
- Bônus e metas para motoboy

**Saíram desta lista em 2026-08-09** (viraram escopo): pagamento da mercadoria dentro do app, e app para o cliente final.

## 17. Pontos ainda em aberto

> ### ⛔ O maior risco aberto do projeto não é técnico: é o cadastro do lojista MEI
>
> **MEI é CNPJ e, por definição legal, não pode ter sócio** (`gov.br`) — enquanto o candidato melhor colocado exige **sócio qualificado no QSA** e recusa administradores e procuradores por escrito. **Nenhum dos quatro fornecedores documenta caminho para MEI.** Em Sobral, **MEI é a maioria dos lojistas**: sem resposta, não se cadastra a maior parte do mercado, e isso é maior que qualquer etapa técnica.
>
> Some-se **"um documento = um recebedor"**: quem é **motoboy e lojista** não teria as duas contas — e em Sobral isso é comum, não hipótese.
>
> **Consequência imediata e vinculante: enquanto não houver resposta por escrito, nenhuma etapa toca fornecedor real.** A obra é feita **exclusivamente contra a interface falsa** — sem credencial, sem chamada, sem depender de particularidade de nenhum gateway. A resposta do MEI pode trocar o fornecedor inteiro, e **o código não pode ter que ser reescrito por causa disso**.

### As quatro perguntas da mesa comercial, em ordem de peso

As três primeiras decidem **se o fornecedor serve**. Preço é a última.

| # | Pergunta | O que ela derruba |
|---|---|---|
| **1** | **Cadastro de lojista MEI: existe caminho? Por escrito.** | A maioria do mercado de Sobral |
| **2** | **Um documento = um recebedor: quem é motoboy e lojista pode ter as duas contas?** | Uma parte real da base, dos dois lados |
| **3** | **Abatimento de dívida pretérita no split de uma cobrança futura: é suportado?** | **A arquitetura do retorno** (seção 9). Se ninguém suportar, o caminho normal cai e o desenho muda |
| 4 | **Pix percentual ou fixo no contrato? Existe "taxa por transação" incidindo sobre Pix?** | A margem — mas só se as três de cima passarem |

### As duas premissas que sustentam o modelo inteiro

Elas não são detalhe de planejamento: **toda conta desta especificação repousa numa das duas**, e **nenhuma das duas foi medida**. São a **primeira medição do piloto**, antes de qualquer otimização.

| Premissa | O que depende dela nesta spec |
|---|---|
| **Entregas por dia, por motoboy** | Todos os números da seção 18: corridas/mês, comissão bruta, projeção com os três grupos, e o custo mensal para o motoboy. **A 8/dia em vez de 20/dia, o negócio é outro** |
| **Ticket médio da mercadoria** | O **tamanho do colchão de reserva** (seção 9); a **exposição por entrega**; se o **teto de R$ 500** (seção 11) é apertado ou folgado; e **quanto o lojista efetivamente paga de taxa** (seção 21) — que é o argumento de venda |

**Nenhum número derivado destas duas pode ser tratado como número medido.** Onde esta spec apresenta uma conta que depende delas, a conta vale como ordem de grandeza e nada mais — inclusive a reserva de ≈ R$ 17.100, que foi dimensionada com **ticket suposto**.

1. **Escolha do gateway — REABERTA e pesquisada; falta decidir.** A decisão anterior (PagBank com Custódia) **caiu junto com o Portão C**: ela existia para reter dinheiro pago antes da entrega, e não se paga mais antes da entrega. **Três critérios eliminatórios:**
   - **(A) Pix percentual.** Custo **fixo** por transação descarta o fornecedor — a comissão de 5% não se ajusta a ele, e taxa fixa **não é splitável** (seção 9). *(Foi o que descartou o Asaas: R$ 1,99 fixo.)*
   - **(C) O dinheiro nunca encosta na conta do Corre.** **Res. BCB 494/2025.** Desenho em que o valor cheio cai na plataforma e ela repassa está descartado por construção. *(Foi o que descartou a Woovi, apesar do menor percentual do mercado, e o Mercado Pago, cujo split público é 1:1.)*
   - **(D) *(novo)* De quem sai a taxa tem que ser declarável.** *(É o que separa o 1º do 2º e do 3º lugar.)*

   Além dos três, o fornecedor precisa de: **QR Pix dinâmico por API** com **cancelamento da cobrança**, confirmação por **webhook e consulta ativa**, **split de 3 recebedores** na mesma cobrança, **estorno parcial com split reenviável**, subconta para **lojista e motoboy** — e **cobrança de cartão do lojista com repasse direto à subconta do motoboy**, sem passar pela conta do Corre (é o meio do retorno, seção 9, e o critério (C) vale igual para ele).

   **Regra de triagem permanente — KYC fraco não é facilidade.** Fornecedor que abre subconta pedindo pouco ou nada do titular **não está sendo prático: está dizendo que o risco ficou com a plataforma.** Quem não pede documento de ninguém **não está abrindo conta de terceiro — está guardando o dinheiro dele mesmo**, e isso reprova no critério (C) por construção, por mais barato que seja. *(Foi assim com a Woovi: menor percentual do mercado, 0,80%, e subconta que se cria com nome e chave Pix e nada mais.)* Vale para qualquer fornecedor que apareça depois: **antes de olhar o preço, pergunte o que ele exige de quem vai receber.** Se a resposta for "quase nada", o dinheiro não é de quem parece.

   **O mais barato que atende, em 2026-08-09: Pagar.me** (Pix 1,19%; `options.charge_processing_fee` por recebedor concentra a taxa no lojista; único do grupo com **estorno parcial de Pix com split reenviável**). **Não é escolha feita** — depende de duas respostas comerciais por escrito, e o critério (A) fica **formalmente em aberto** enquanto não vierem: o contrato do Pagar.me também pode ser Pix **fixo**. Ranking, conta e perguntas em [`GATEWAY.md`](GATEWAY.md). **Nada se implementa antes desta escolha.**
2. **Quem paga a taxa do gateway.** É decisão do dono, não do fornecedor. A recomendação da spec é **debitar da parcela de mercadoria** — o Corre continua com comissão zero sobre ela e o motoboy recebe o frete inteiro, mas **o lojista recebe R$ 98,69 num pedido de R$ 100** e precisa saber disso **antes de assinar**. Alternativa a considerar: **embutir a taxa no total cobrado do cliente**, elevando o QR — muda o preço na ponta. **Trava a Etapa 7 junto com o item 1**
3. **Valor do adicional por km** fora de zona
4. **Transcrição da tabela de zonas de Sobral** — agora com **duas colunas**: preço por anel **e minutos por anel** (seção 8)
5. **Tempo base de coleta** — o outro número do prazo estimado. É **dado da cidade**, coluna da versão da tabela (seção 8)
6. **Taxa zero nos primeiros 90 dias** — carta de lançamento não decidida
7. **Teto de R$ 500** de valor de mercadoria — sugerido, não confirmado, e agora incide sobre valor cobrado de verdade
8. **Registro da marca CORRE** (mista, classes 39 e 42) e do **domínio `corre.com.br`** — virou **pré-requisito de publicação**: os pacotes `br.com.corre.*` são definitivos e não se trocam depois de publicados
9. **Provedor real de SMS.** Deixou de ser detalhe de re-login: **sem SMS não existe primeira compra**, porque é por ele que o cliente novo recebe o link para pagar. Escalou de "falta para o lançamento" para "falta para o produto funcionar"
10. **Custo do saque** da subconta para o banco do titular — agora para **motoboy e lojista**. É custo deles, não nosso, mas afeta a atratividade dos dois lados
11. **Exigências e prazo de aprovação da subconta.** **Resolvido em parte:** todos os candidatos aceitam **pessoa física** — a regra "MEI não é exigido" sobrevive —, e o melhor colocado deixa o motoboy **receber antes de o KYC terminar**, preservando "cadastra e roda na hora" (`GATEWAY.md`, seção 8). **Continua aberto:** (a) como se cadastra um **lojista MEI**, que não tem quadro de sócios, e a documentação não diz; (b) o prazo real de aprovação, que só o contrato confirma. Do lado do lojista é pior que do motoboy: ele **não vende nada** até aprovar
12. **Frase de posicionamento para o lojista.** A antiga ficou falsa (seção 1). A substituta proposta — *"eu não tenho vitrine; ninguém descobre outra loja aqui"* — é decisão comercial do dono
13. **Teto de faltas de pagamento** que bloqueia um cliente (seção 12) — e se o bloqueio é da plataforma toda ou só daquela loja
14. **Confirmar que o retorno por cliente que não pagou é do cartão do lojista.** É o que a regra "quem causa paga" e a regra de cliente ausente já implicam, mas deixou de ser caso raro e virou o principal modo de falha do modelo
15. **Revisão jurídica** das três cláusulas de controle, mais o risco novo da seção 15
16. **A ponte web deve permitir abrir disputa?** Hoje ela sobrevive 24h só leitura, com o comprovante — o cliente sem app não abre disputa sozinho (seção 2). Ampliar a ponte contraria "paga e acompanha, nada mais", então é decisão do dono
17. **Chargeback do cartão de garantia — DECISÃO ABERTA, duas saídas levantadas** (`GATEWAY.md`, 9.1). O cartão entrou pela porta dos fundos quando o retorno virou cobrança de cartão, e **cartão tem contestação**. O contrato do candidato é explícito: chargeback é *"de responsabilidade exclusiva do Cliente"* — **o Corre**, debitado da nossa conta, mesmo com documentos apresentados. Contestar custa mais que o valor de um retorno de R$ 10. As duas saídas — **débito na próxima corrida** (o cartão volta a ser só garantia) × **cartão como cobrança com o chargeback aceito** — estão levantadas com número. **Nenhuma foi escolhida**
18. **Saldo global do marketplace prende o saque de todo mundo.** No candidato melhor colocado, o teto de saque de **qualquer** recebedor é o saldo global da plataforma: um recebedor negativo trava o saque dos outros. É vigilância operacional, não código — mas precisa de dono
19. **KYC reprovado depois de o motoboy já ter recebido.** O dinheiro **não volta nem sai sozinho**: fica travado e a ação é nossa. Precisa de fluxo no painel (Etapa 11) e de decisão sobre para onde vai esse saldo
20. **Reserva da plataforma para o saldo global** (`GATEWAY.md`, 9.2). Não é risco, é arquitetura: **não existe isolamento por recebedor** em nenhum campo da API, e um recebedor negativo trava o saque de todos. **A reserva é o único remédio**, e ela se financia com um mês de comissão (≈ R$ 17.100) deixando `transfer_enabled: false` na nossa própria conta. Falta o dono decidir **o tamanho e por quanto tempo** — e isso depende da taxa de recusa, que só o piloto mede
21. **Ticket médio de mercadoria nunca foi medido** (seção 18). É ele que dimensiona a reserva, o teto de R$ 500 e a exposição por entrega. Entra na lista de medições do piloto ao lado das entregas/dia
22. **Cadastro de lojista MEI — nenhum fornecedor documenta caminho** (`GATEWAY.md`, 9.3). MEI é CNPJ e **não pode ter sócio** por definição legal, enquanto o candidato melhor colocado exige sócio qualificado no QSA. Em Sobral, MEI é a maioria dos lojistas. **Esta pergunta vai à mesa comercial junto com as duas de preço, e a resposta dela pesa mais que preço na escolha**
23. **Um documento = um recebedor** (`GATEWAY.md`, 9.3). O candidato está fechando a criação de recebedores com o mesmo documento. **Motoboy que também é lojista não teria as duas contas** — e em Sobral isso não é hipótese
24. **Tempo base de coleta por LOJA, em vez de por cidade** (seção 8). **Sem etapa dona, de propósito.** Existe loja que separa o pedido em dois minutos e loja que leva quinze, e um dia a operação vai querer distinguir. Quando quiser, isso é **uma versão nova da tabela** — que é exatamente para o que o versionamento existe, e por isso não se constrói nada agora. Construir hoje o campo que ninguém preenche seria "deixar preparado", que é proibido

## 18. Números de referência

Estimativa a partir do grupo de 66 motoboys que já opera em Sobral:

| Métrica | Valor |
|---|---|
| Corridas/mês (66 × 20/dia × 26 dias) | ~34.300 |
| Frete médio | R$ 10 |
| Comissão bruta (5% do frete) | ~R$ 17.100/mês |
| Projeção com os 3 grupos da cidade | ~R$ 40.000/mês |
| Custo para o motoboy (20 corridas/dia) | R$ 260/mês |

**A linha "líquido após gateway" saiu da tabela**, e o motivo é que ela deixou de ser uma linha: com a mercadoria dentro da cobrança, o líquido depende inteiramente de **quem paga a taxa** (seção 17, item 2).

| Se a taxa… | Líquido por corrida | Líquido/mês |
|---|---|---|
| …for debitada da mercadoria | **R$ 0,50** (comissão intacta) | ~R$ 17.100 |
| …for rateada entre os três | R$ 0,49 | ~R$ 16.800 |
| …sair da comissão do Corre | **negativo**, e pior quanto mais cara a mercadoria | **prejuízo** |

A linha volta à tabela como número único quando o item 2 for decidido.

**Premissa mais frágil de todo o modelo:** entregas por dia por motoboy. A 8/dia o negócio é outro. Medir isso é a prioridade número 1 do piloto.

**Premissas novas a medir no piloto, as duas do mesmo tamanho da primeira:**

1. **Quantos clientes não pagam na porta.** Decide se o cartão de garantia aguenta o modelo — e, com o número abaixo, dimensiona a reserva da plataforma (`GATEWAY.md`, 9.2).
2. **O ticket médio de mercadoria.** **Nunca foi medido, e não está nesta tabela por isso.** É ele que dimensiona a exposição por entrega, a reserva, e diz se o teto de R$ 500 é apertado ou folgado. Sem ele, toda conta de risco desta especificação roda com número suposto.

## 19. Chat interno

**Ninguém vê o telefone de ninguém.** Nem o motoboy vê o do cliente, nem o cliente vê o do motoboy, nem o lojista vê o do motoboy. O telefone existe no cadastro e para o SMS do sistema, e **nunca sai numa resposta da API**.

**Três conversas, todas amarradas a uma corrida:**

| Conversa | Abre | Fecha |
|---|---|---|
| Lojista ↔ Cliente | Na criação da corrida | Estado final |
| Lojista ↔ Motoboy | No aceite | Estado final |
| Motoboy ↔ Cliente | No aceite | Estado final |

- **Não existe chat fora de corrida.** Sem lista de contatos, sem conversa avulsa, sem grupo.
- **Mensagem é evento** (Leis 2 e 3): não se edita, não se apaga, nem pelo painel. Por isso **serve de prova em disputa** (seção 11) — inclusive o combinado de endereço, ponto de referência e "deixa com o vizinho".
- **Texto e nada mais** no MVP: sem foto, sem áudio, sem anexo, sem localização.
- **Depois do estado final o chat fica legível e imutável**, para a janela de disputa de 24h e para a auditoria. Ele não some quando a corrida acaba.
- A **operação lê tudo** pelo painel, e escreve na conversa quando há disputa aberta. Leitura do painel também é evento.
- **Nenhuma API de WhatsApp**, oficial ou não. O único canal que sai da plataforma é o **SMS do sistema** (seção 2), que não é conversa: ele avisa e manda link.

## 20. Multi-cidade

**Cidade é entidade de primeira classe desde a primeira migration**, não uma coluna acrescentada quando a segunda cidade aparecer. Retrofit de escopo geográfico em base com dinheiro dentro é o tipo de mudança que ninguém faz com segurança depois.

- **Pertencem a uma cidade:** lojista, motoboy, corrida, tabela de preço, zona, tempo base de coleta.
- **Não pertence a cidade:** o **cliente**. Ele é da plataforma e recebe entrega onde estiver.
- **A corrida acontece dentro de uma cidade só.** Origem e destino na mesma cidade — entrega intermunicipal está fora do MVP (seção 16).
- **O banco impõe, não o código:** corrida cujo lojista, motoboy ou zona sejam de outra cidade é **recusada por constraint**. É critério de aceite da Etapa 4, provado pelo efeito.
- **Cada cidade tem a sua tabela de preço versionada.** Publicar em uma não toca a outra.
- **Sobral é a cidade 1.** Nenhuma segunda cidade se abre no MVP — o que se constrói é o **lugar** dela, não a operação dela.

### O isolamento é Row Level Security, no banco

**Consulta sem cidade não vaza dado de cidade alheia — e isso é política do banco contra o papel `corre_app`, não disciplina de quem escreve consulta.** Disciplina não se prova por efeito e depende de ninguém esquecer, que é o oposto de tudo que este projeto decidiu: a imutabilidade dos eventos e a trava de configuração de taxa já moram no banco, e o isolamento mora junto.

**Fecha por padrão:** a política compara `cidade_id` com uma variável de sessão. **Variável não definida ⇒ nenhuma linha.** Esquecer de declarar a cidade não vaza dado: cega.

> ### A armadilha que precisa de teste próprio
>
> **RLS depende de variável de sessão, e conexão de pool é reaproveitada entre requisições.** Se a variável for definida no nível da **conexão** em vez da **transação**, uma requisição herda a cidade da anterior — **vazamento entre cidades, silencioso, e só sob carga**, que é quando ninguém está olhando.
>
> **A regra:** a cidade é definida **por transação** (`SET LOCAL` / `set_config(..., true)`), e some no `COMMIT`. Nunca no `connect`, nunca por sessão.
>
> **Critério de aceite:** com pool de conexões e requisições concorrentes de cidades diferentes, **nenhuma consulta devolve dado da cidade errada, em milhares de requisições intercaladas**. E, depois de uma transação de uma cidade, a conexão devolvida ao pool **não carrega** aquela cidade.
>
> **Controle negativo:** mova a definição para o nível da conexão e prove que o teste fica **vermelho**.

**De onde vem a cidade da requisição:** da **sessão**, não do corpo. A sessão guarda a cidade do ator no momento em que nasce; a requisição abre transação, declara aquela cidade e só então lê qualquer coisa. Identidade e cidade saem sempre do servidor (seção 10).

**A exceção, e por que ela não é brecha:** em **cadastro e login** ainda não existe sessão, então a cidade vem do corpo — não há de onde mais vir. E declarar a cidade errada ali **não vaza nada**: a política simplesmente não acha a conta, e o pedido falha como "não existe". A exceção só cega quem erra.

**O que é operação, e não requisição, varre cidade por cidade.** O varredor de prazos não tem sessão — e **não ganha atalho de "ver tudo"**: ele percorre as cidades e roda dentro do contexto de cada uma. A política vale para ele igual, e é isso que impede o processo de fundo de virar a porta dos fundos do isolamento.

**Limite declarado até a Etapa 11:** a sessão do **operador** enxerga uma cidade só — a que ela declara. **Escolher e trocar a cidade no painel é da Etapa 11.** Até lá, operação em duas cidades exige duas sessões.

**O cliente não tem cidade, e por isso `clientes` não tem RLS.** O que o isolamento protege dele é o que importa: **as corridas dele são da cidade**, então a operação de uma cidade nunca vê o que ele comprou na outra. O que atravessa é só a identidade — telefone e nome —, e isso é consequência de ele ser da plataforma. *(A política de leitura do cliente sobre as próprias corridas é da Etapa 14, quando ele ganha app. Hoje ele não lê corrida nenhuma.)*

### Configuração de taxa é por cidade

Pelo mesmo motivo de tudo o mais — e por um concreto: **a carta de lançamento com taxa zero nos primeiros 90 dias é inerentemente por cidade** (seção 17, item 6). Se todas as cidades tiverem a mesma configuração, replicar é barato; transformar global em por-cidade depois é migração em tabela com dinheiro apontando para ela.

### Telefone: espaços separados por papel

**O mesmo telefone pode ser de um lojista, de um motoboy e de um cliente ao mesmo tempo — e em Sobral isso é o caso comum, não a exceção.** Cada papel tem seu espaço de unicidade: um telefone é único **dentro** de `clientes`, e a existência dele em `lojistas` não impede nada.

**É decisão deliberada, não omissão.** Papéis são identidades distintas que por acaso compartilham um número. Unificar depois — uma pessoa, vários papéis — é possível e continua sobre a mesa; o que não se faz é assumir hoje que quem tem o mesmo telefone é a mesma pessoa. O gateway já força a mesma leitura pelo outro lado, com **"um documento, um recebedor"** (seção 17, item 23).

## 21. A venda

Esta seção é regra, não sugestão de marketing: ela diz **o que se fala primeiro** e **o que não se esconde**.

### A taxa não é custo novo. É a maquininha dele sendo substituída.

O lojista vai receber R$ 98,69 num pedido de R$ 100. **Isso se diz na primeira frase da venda, não no contrato de adesão.**

E se diz assim, porque é o que é verdade:

> **"Não é uma taxa nova. É a taxa da sua maquininha — e menor."**

Ele já paga para receber. Paga no débito, paga mais no crédito, paga mais ainda no parcelado, e ainda paga **aluguel da máquina todo mês**, tenha vendido ou não. O 1,19% sobre a mercadoria **substitui** isso na venda que sai para entrega: **sem aluguel, sem máquina, sem antecipação, e o dinheiro cai na conta dele no ato.**

E o Corre continua **sem tirar um centavo da mercadoria** — a comissão de 5% é só do frete. Quem cobra o 1,19% é o banco, não nós.

### O QR no celular do motoboy é a maquininha da loja parando de atravessar a cidade

É esse o argumento, e ele não é sobre taxa:

- Hoje, para receber na entrega, ou o motoboy leva a maquininha da loja na mochila — e a loja fica sem ela —, ou leva dinheiro vivo e volta com o troco, ou o lojista fica cobrando o cliente por WhatsApp depois.
- Com o Corre, **a maquininha fica na loja** e a cobrança vai no celular do motoboy, que é dele. **O dinheiro não passa pela mão de ninguém** e não volta com o motoboy: cai dividido, na hora, na conta de cada um.

### O que não se esconde

Três coisas são ditas **antes de assinar**, com estas palavras ou melhores:

1. **A taxa sai da sua parte.** R$ 98,69 num pedido de R$ 100 — 1,31%, e menos que isso quanto maior a venda.
2. **Você precisa de uma subconta aprovada para vender**, não só para sacar. Entra e olha em um minuto; para vender, o cadastro tem KYC (seção 10).
3. **Se o cliente não pagar na porta, o retorno é cobrado do seu cartão de garantia** e vai integral para o motoboy. É o preço de a mercadoria sair da loja antes de o dinheiro entrar — e é por isso que a reputação do cliente existe (seção 12).

**Vender escondendo qualquer um dos três é pior do que não vender:** o lojista descobre na primeira conta, e aí o problema não é mais a taxa.
