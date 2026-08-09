# corre-app-motoboy — app Android do motoboy

Kotlin nativo. Pacote **`br.com.corre.motoboy`**. Foreground service para GPS,
FCM para push.

**Ainda não construído.** É a **Etapa 13** da ordem de construção (ver
`CORRE.md` na raiz). Este diretório existe para reservar o lugar — nada além
disso foi criado, de propósito: uma etapa por vez.

*(Chamava-se `corre-app/` até a revisão de 2026-08-09, quando o projeto passou
a ter três apps e o nome genérico deixou de dizer qual.)*

**O que este app faz de diferente dos outros dois:** é nele que o **QR Pix da
cobrança na porta** aparece. A tela mostra o QR, e o botão de entregar só
existe depois que o backend confirma o pagamento — a mercadoria é consignada
ao pagamento (`CORRE.md`, seções 3 e 7). O QR **nasce no backend**; o app não
gera nada e não aceita cobrança vinda de outro lugar.
