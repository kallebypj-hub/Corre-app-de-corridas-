# corre-app-lojista — app do lojista

Flutter (Android e iOS). Pacote **`br.com.corre.lojista`**.

**Ainda não construído.** É a **Etapa 15** da ordem de construção (ver
`CORRE.md` na raiz). Este diretório existe para reservar o lugar.

Substitui a web do lojista da especificação anterior. Motivo da mudança: com a
mercadoria dentro da cobrança (revisão de 2026-08-09), o lojista virou
**recebedor** — precisa de subconta, saldo, chat e acompanhamento, e não só de
um formulário para criar corrida.

**Três condições, e as três aparecem na tela com a razão certa:** pode entrar
(cadastro ativo) ≠ pode pedir (cartão de garantia) ≠ pode receber (subconta
aprovada no gateway). Sem cartão **ou** sem subconta, a criação de corrida é
recusada.
