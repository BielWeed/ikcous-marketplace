// Pedido do Gabriel (27/09/2026, testando o preview): o preço "Por:" da
// promoção usava vermelho/rosa (`text-rose-600`/`text-rose-500`) -- a MESMA
// cor que o resto da loja usa pra "negativo" (estoque baixo, erro,
// cancelado). Verde é o sinal certo pra promoção; vermelho continua só nos
// selos de desconto ("48% OFF") e nos alertas de verdade, que ninguém pediu
// pra mudar.
//
// Três variantes pelo mesmo motivo do laudo de product-card-estoque-
// contraste-aa.test.tsx (WCAG 2 AA, contraste de texto):
// - fundo CLARO, texto pequeno (< 18,66px bold ou < 24px normal): mede
//   4,5:1 mínimo. `text-emerald-700` (#047857) mede 5,5:1 no branco.
// - fundo CLARO, texto grande (>= 18,66px bold ou >= 24px normal): mede
//   3:1 mínimo. `text-emerald-600` (#059669) já passa.
// - fundo ESCURO (a prévia em modo "cartão" do PhoneSimulator, que nasce em
//   zinc-950): `text-emerald-400`, o mesmo tom que a própria tela já usa
//   pro selo "Frete Grátis" sobre o mesmo fundo.
export const CLASSE_PRECO_PROMOCIONAL_TEXTO_PEQUENO = "text-emerald-700";
export const CLASSE_PRECO_PROMOCIONAL_TEXTO_GRANDE = "text-emerald-600";
export const CLASSE_PRECO_PROMOCIONAL_FUNDO_ESCURO = "text-emerald-400";
