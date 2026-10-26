import { QuantitySelector } from "@/components/ui/custom/QuantitySelector";
import { useStore } from "@/contexts/StoreContext";
import { chaveDaLinha, estoqueDaLinha } from "@/lib/escolhas-do-item";
import { precoVendido } from "@/lib/preco-vendido";
import { cn, formatCurrency } from "@/lib/utils";
import type { CartItem } from "@/types";
import { haptic } from "@/utils/haptic";
import { AnimatePresence, motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { memo } from "react";

interface CartItemCardProps {
  item: CartItem;
  /** O carrinho todo: o limite da linha desconta o que as OUTRAS linhas do
   *  mesmo produto já levam da mesma variação. */
  cart: CartItem[];
  removingId: string | null;
  onUpdateQuantity: (
    productId: string,
    quantity: number,
    variantId?: string,
  ) => void;
  onRemove: (productId: string, variantId?: string) => void;
}

const CartItemCard = memo(function CartItemCard({
  item,
  cart,
  removingId,
  onUpdateQuantity,
  onRemove,
}: Readonly<CartItemCardProps>) {
  // Removed unused config destructuring
  useStore();

  // A identidade da linha: o id da variação, ou `idA~idB` quando o produto de
  // cadastro antigo tem duas escolhas separadas (escolhas-do-item.ts). É ela
  // que remover/mudar quantidade/marcar "removendo" usam -- Azul-P e Azul-M
  // são linhas diferentes.
  // Sem variação segue `undefined`, como as telas sempre repassaram.
  const chaveDaVariacao = chaveDaLinha(item) || undefined;

  // Quanto ESTA linha pode levar: estoque da variação escolhida (menor entre as
  // escolhas, já descontadas as outras linhas), ou o do produto se não há
  // variação. Mesma função que o CartContext usa para travar a quantidade.
  const estoqueDaEscolha = estoqueDaLinha(
    item.product,
    item.variantId,
    item.outrasVariantIds,
    // Linha sem produto (localStorage antigo) nao tira estoque de ninguem.
    cart.filter(
      (linha) =>
        linha?.product &&
        (linha.product.id !== item.product.id ||
          chaveDaLinha(linha) !== chaveDaLinha(item)),
    ),
  );

  // O carrinho tem que mostrar a mesma coisa que o checkout
  // (CheckoutView.tsx:891): preferir `variantNames`, que ja vem
  // montado como "Grupo: Opcao" (ProductView.tsx:593-595). Item
  // gravado no localStorage (marketplace_cart_v1) ANTES de
  // `variantNames` existir nao tem esse campo -- por isso o fallback
  // busca o par completo (nome do grupo + valor da opcao), nunca so
  // o `name`, que e' o defeito medido ("BRINQUEDO . COR").
  const variantText =
    item.variantNames ||
    (item.variantId
      ? (() => {
          const variant = item.product.variants?.find(
            (v) => v.id === item.variantId,
          );
          return variant ? `${variant.name}: ${variant.value}` : undefined;
        })()
      : undefined);

  const variant = item.variantId
    ? item.product.variants?.find((v) => v.id === item.variantId)
    : null;
  // Laudo 31/08 (menor E): regra única em preco-vendido.ts —
  // `||` tratava o override ZERO como ausência.
  const price = precoVendido(item.product, variant);
  const hasDiscount =
    item.product.originalPrice && item.product.originalPrice > price;

  return (
    <motion.div
      layout={removingId !== null}
      initial={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: "hidden" }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className="relative overflow-hidden rounded-[18px]"
    >
      <div
        className={cn(
          "relative z-10 flex gap-3 rounded-[18px] border border-border bg-background p-3 transition-opacity",
          removingId === `${item.product.id}-${chaveDaVariacao || "default"}` &&
            "opacity-50",
        )}
      >
        <div className="size-16 flex-shrink-0 overflow-hidden rounded-xl bg-muted min-[380px]:size-20">
          <img
            src={
              item.product.images?.[0] ||
              "https://placehold.co/600x400?text=Sem+Imagem"
            }
            alt={item.product.name}
            className="size-full object-cover"
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-2">
            <h2 className="line-clamp-2 min-w-0 flex-1 text-[15px] font-semibold leading-snug text-foreground">
              {item.product.name}
            </h2>
            <button
              onClick={() => {
                haptic.medium();
                onRemove(item.product.id, chaveDaVariacao);
              }}
              className="relative -mr-1 -mt-0.5 flex size-7 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors before:absolute before:-inset-2 before:content-[''] hover:text-red-600 active:scale-90 dark:hover:text-red-400"
              aria-label={`Remover ${item.product.name}`}
            >
              <Trash2 className="size-[18px]" />
            </button>
          </div>

          <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[13px] text-muted-foreground">
            <span className="min-w-0 break-words">
              {item.product.category}
              {variantText && (
                <>
                  <span className="mx-1">•</span>
                  <span
                    data-testid="cart-item-variacao"
                    className="text-foreground/70"
                  >
                    {variantText}
                  </span>
                </>
              )}
            </span>
            {estoqueDaEscolha <= 3 && estoqueDaEscolha > 0 && (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-semibold text-amber-700 dark:text-amber-400">
                <span className="size-1.5 rounded-full bg-amber-500" />
                Só {estoqueDaEscolha}{" "}
                {estoqueDaEscolha === 1 ? "restante" : "restantes"}
              </span>
            )}
          </p>

          <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-2">
            <div className="flex flex-col justify-end">
              {hasDiscount && (
                <div className="mb-0.5 flex items-center gap-1.5 text-xs leading-none">
                  <span className="text-muted-foreground line-through">
                    {formatCurrency(item.product.originalPrice ?? 0)}
                  </span>
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">
                    -
                    {Math.round(
                      ((item.product.originalPrice! - price) /
                        item.product.originalPrice!) *
                        100,
                    )}
                    %
                  </span>
                </div>
              )}
              <p className="text-lg font-bold leading-none tracking-tight text-foreground">
                {formatCurrency(price)}
              </p>
            </div>

            <QuantitySelector
              quantity={item.quantity}
              maxQuantity={estoqueDaEscolha}
              onChange={(qty) =>
                onUpdateQuantity(item.product.id, qty, chaveDaVariacao)
              }
              size="pill"
              produto={item.product.name}
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
});

interface CartItemsListProps {
  cart: CartItem[];
  removingId: string | null;
  onUpdateQuantity: (
    productId: string,
    quantity: number,
    variantId?: string,
  ) => void;
  onRemove: (productId: string, variantId?: string) => void;
  handleClearCart: () => void;
}

export const CartItemsList = memo(function CartItemsList({
  cart,
  removingId,
  onUpdateQuantity,
  onRemove,
  handleClearCart,
}: Readonly<CartItemsListProps>) {
  const cartCount = cart.reduce((sum, item) => sum + (item.quantity || 0), 0);

  return (
    <div>
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        {cartCount} {cartCount === 1 ? "Item Adicionado" : "Itens Adicionados"}
      </p>

      {cart.length > 50 && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-[18px] border border-red-300 p-4 dark:border-red-500/60">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-foreground">
              Instabilidade detectada
            </p>
            <p className="text-[13px] text-red-700 dark:text-red-400">
              O carrinho excedeu o limite seguro.
            </p>
          </div>
          <button
            onClick={handleClearCart}
            className="h-11 shrink-0 rounded-xl bg-foreground px-4 text-[13px] font-semibold text-background transition-colors hover:bg-foreground/90"
          >
            Limpar Tudo
          </button>
        </div>
      )}

      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {cart
            .filter((item) => item?.product?.id)
            .map((item) => (
              <CartItemCard
                key={`${item.product.id}-${chaveDaLinha(item) || "default"}`}
                item={item}
                cart={cart}
                removingId={removingId}
                onUpdateQuantity={onUpdateQuantity}
                onRemove={onRemove}
              />
            ))}
        </AnimatePresence>
      </div>
    </div>
  );
});
