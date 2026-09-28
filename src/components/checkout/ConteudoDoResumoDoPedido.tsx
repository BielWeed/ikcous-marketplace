import { precoVendido } from "@/lib/preco-vendido";
import type { CartItem } from "@/types";

interface ConteudoDoResumoDoPedidoProps {
  readonly cart: CartItem[];
  readonly subtotal: number;
  readonly shipping: number;
  readonly discount: number;
  readonly economiaDoFrete: number;
  readonly semFreteSelecionado: boolean;
  readonly totalExibido: number | null;
}

/** Exibe os valores já calculados pelo checkout, tanto no painel quanto no resumo lateral. */
export function ConteudoDoResumoDoPedido({
  cart,
  subtotal,
  shipping,
  discount,
  economiaDoFrete,
  semFreteSelecionado,
  totalExibido,
}: ConteudoDoResumoDoPedidoProps) {
  return (
    <>
      {/* Sem botão de editar e sem link para o carrinho —
    voltar ao carrinho apaga o endereço já digitado
    (ver AGENTS.md/comentários do checkout), e este
    painel existe justamente para conferir sem sair
    da tela. */}
      <ul className="space-y-3">
        {cart.map((item) => {
          // Mesma fórmula de CartContext.tsx (cartTotal) —
          // não uma conta nova. Laudo 31/08 (menor E): a
          // regra única mora em preco-vendido.ts — `||`
          // cobrava o preço cheio de variação com override
          // ZERO.
          const precoUnitario = precoVendido(
            item.product,
            item.product.variants?.find((v) => v.id === item.variantId),
          );

          return (
            <li
              key={`${item.product.id}-${item.variantId ?? ""}`}
              className="flex items-center gap-3"
            >
              <img
                src={item.product.images?.[0]}
                alt=""
                className="size-12 shrink-0 rounded-xl border border-zinc-100 bg-zinc-50 object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-800">
                  {item.product.name}
                </p>
                {item.variantNames && (
                  <p className="truncate text-[11px] text-zinc-400">
                    {item.variantNames}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-xs font-semibold text-zinc-600">
                {item.quantity} × R${" "}
                {precoUnitario.toFixed(2).replace(".", ",")}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Sticky no fundo do painel (ponto de revisão de
    02/09/2026): com carrinho grande a lista rola
    DEBAIXO deste bloco e o Total nunca mais sai da
    tela. O `-mx-4 px-4` estende o fundo branco por
    toda a largura do painel (que agora só tem `px-4
    pt-3`), para nada aparecer na fresta do padding. */}
      <div className="sticky bottom-0 -mx-4 mt-3 space-y-1.5 border-t border-zinc-100 bg-white px-4 py-3 text-xs">
        <div className="flex items-center justify-between text-zinc-500">
          <span>Subtotal</span>
          <span>R$ {subtotal.toFixed(2).replace(".", ",")}</span>
        </div>
        <div className="flex items-center justify-between text-zinc-500">
          <span>Entrega</span>
          <span>
            {/* 🔴 Sem cotação válida para o endereço atual
          (`semFreteSelecionado`): "a calcular", NUNCA
          um valor antigo do carrinho — mesma família da
          peça reprovada do lote C (frete cotado para A
          não vale para B). Isto é só exibição; a
          cotação/recotação em si não muda aqui. */}
            {semFreteSelecionado ? (
              "a calcular"
            ) : shipping > 0 && economiaDoFrete > 0 ? (
              // T3 (23/09): opção NACIONAL com desconto da loja
              // mas NÃO grátis (`precoCheio > price`, e o preço
              // final continua positivo) — mesmo padrão visual
              // do card do ShippingCalculator: cheio riscado
              // (= shipping + economiaDoFrete, a fonte é a
              // PRÓPRIA opção, nunca recalculada aqui) + final.
              <>
                <span className="mr-1 text-zinc-300 line-through">
                  R$ {(shipping + economiaDoFrete).toFixed(2).replace(".", ",")}
                </span>
                R$ {shipping.toFixed(2).replace(".", ",")}
              </>
            ) : shipping > 0 ? (
              `R$ ${shipping.toFixed(2).replace(".", ",")}`
            ) : economiaDoFrete > 0 ? (
              // Frete grátis COM economia conhecida (pedido do
              // Gabriel, 12/09/2026): mostra o valor riscado
              // para explicar a pílula da barra de baixo — o
              // Total não muda (o frete grátis já entra como 0).
              <>
                <span className="mr-1 text-zinc-300 line-through">
                  R$ {economiaDoFrete.toFixed(2).replace(".", ",")}
                </span>
                Grátis
              </>
            ) : (
              "Grátis"
            )}
          </span>
        </div>
        {discount > 0 && (
          <div className="flex items-center justify-between text-red-500">
            <span>Desconto</span>
            <span>-R$ {discount.toFixed(2).replace(".", ",")}</span>
          </div>
        )}
        <div className="flex items-center justify-between pt-1 text-sm font-black text-zinc-900">
          <span>Total</span>
          <span>
            {/* Achado 1 do bloqueante: mesma regra da linha de
          Entrega — sem cotação válida não existe total
          fechado. */}
            {totalExibido === null
              ? "a calcular"
              : `R$ ${totalExibido.toFixed(2).replace(".", ",")}`}
          </span>
        </div>
      </div>
    </>
  );
}
