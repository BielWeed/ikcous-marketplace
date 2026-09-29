// Pedido do Gabriel (27/09/2026, testando o preview): o preço "Por:" da
// promoção usava vermelho/rosa (`text-rose-600`/`text-rose-500`) -- a MESMA
// cor que o resto da loja usa pra "negativo" (estoque baixo, erro,
// cancelado). Verde é o sinal certo pra promoção. O alerta de estoque baixo
// ("Apenas N restam!") continua vermelho de propósito -- é alerta de
// verdade, não desconto.
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

// Segunda decisão do Gabriel (27/09/2026): o selo "X% OFF" também vira
// verde -- mesmo raciocínio do preço. Estilo pareado com o selo "Economize
// R$…" que já é verde (ProductCard.tsx/PremiumOffers.tsx): fundo
// verde-claro, borda e texto verde-escuro; contraste AA de sobra (texto
// pequeno em negrito sobre `bg-emerald-50` mede o mesmo 5,5:1 do
// `text-emerald-700` no branco, o fundo é quase branco).
//
// SEM variante de fundo escuro: os selos de desconto do PhoneSimulator (os
// dois modos, cartão e página) flutuam como cartão claro com
// `backdrop-blur` POR CIMA da foto do produto -- nunca sobre a tira sólida
// `bg-zinc-950` do modo "cartão" (só o PREÇO mora ali, ver
// CLASSE_PRECO_PROMOCIONAL_FUNDO_ESCURO acima). Não existe, portanto, selo
// de desconto sobre fundo realmente escuro nesta tela.
export const CLASSE_SELO_DESCONTO =
  "border-emerald-200 bg-emerald-50 text-emerald-700";
