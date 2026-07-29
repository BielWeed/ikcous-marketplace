import { QuantitySelector } from "@/components/ui/custom/QuantitySelector";
import { useStore } from "@/contexts/StoreContext";
import { cn } from "@/lib/utils";
import type { CartItem } from "@/types";
import { haptic } from "@/utils/haptic";
import { AnimatePresence, motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { memo } from "react";

interface CartItemCardProps {
  item: CartItem;
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
  removingId,
  onUpdateQuantity,
  onRemove,
}: Readonly<CartItemCardProps>) {
  // Removed unused config destructuring
  useStore();

  return (
    <motion.div
      layout={removingId !== null}
      initial={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: "hidden" }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className="group relative overflow-hidden rounded-2xl xs:rounded-3xl"
    >
      <div
        className={cn(
          "flex gap-3 xs:gap-4 bg-white p-3 xs:p-4 rounded-2xl xs:rounded-[1.5rem] border border-zinc-100/80 shadow-[0_4px_20px_rgba(0,0,0,0.01)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.03)] hover:border-zinc-200/60 transition-all duration-300 relative z-10",
          removingId === `${item.product.id}-${item.variantId || "default"}` &&
            "opacity-50",
        )}
      >
        <div className="relative size-20 flex-shrink-0 overflow-hidden rounded-xl border border-zinc-100/50 bg-zinc-50 xs:size-24 xs:rounded-2xl">
          <img
            src={
              item.product.images?.[0] ||
              "https://placehold.co/600x400?text=Sem+Imagem"
            }
            alt={item.product.name}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between py-0">
          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <h2 className="line-clamp-1 text-xs font-bold leading-tight text-zinc-900 transition-colors group-hover:text-zinc-950 xs:line-clamp-2 xs:text-sm">
                  {item.product.name}
                </h2>
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="select-none truncate text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                    {item.product.category}
                    {item.variantId && item.product.variants && (
                      <>
                        <span className="mx-1 text-zinc-300">•</span>
                        <span className="text-zinc-500">
                          {
                            item.product.variants.find(
                              (v) => v.id === item.variantId,
                            )?.name
                          }
                        </span>
                      </>
                    )}
                  </p>
                  {item.product.stock <= 3 && item.product.stock > 0 && (
                    <div className="py-0.25 animate-fade-in inline-flex select-none items-center gap-1 whitespace-nowrap rounded-md border border-rose-100/50 bg-rose-50/80 px-1.5 text-[8px] font-black uppercase tracking-wider text-rose-600">
                      <span className="relative flex size-1">
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-400 opacity-75" />
                        <span className="relative inline-flex size-1 rounded-full bg-rose-500" />
                      </span>
                      Só {item.product.stock}{" "}
                      {item.product.stock === 1 ? "restante" : "restantes"}
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={() => {
                  haptic.medium();
                  onRemove(item.product.id, item.variantId);
                }}
                className="-mr-1 flex size-7 flex-shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-all duration-300 hover:bg-red-50/50 hover:text-red-500 active:scale-90"
                aria-label="Remover item"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>

          <div className="mt-auto flex items-end justify-between pt-1">
            <div className="flex flex-col justify-end">
              {(() => {
                const variant = item.variantId
                  ? item.product.variants?.find((v) => v.id === item.variantId)
                  : null;
                const price = variant?.priceOverride || item.product.price;
                const hasDiscount =
                  item.product.originalPrice &&
                  item.product.originalPrice > price;
                return (
                  <>
                    {hasDiscount && (
                      <div className="mb-0.5 flex items-center gap-1.5">
                        <span className="text-[9px] font-bold text-zinc-400 line-through">
                          R${" "}
                          {item.product.originalPrice
                            ?.toFixed(2)
                            .replace(".", ",")}
                        </span>
                        <span className="py-0.25 rounded bg-emerald-50 px-1 text-[8px] font-black uppercase text-emerald-600">
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
                    <p className="text-sm font-black leading-none tracking-tight text-zinc-900 xs:text-base">
                      R$ {price.toFixed(2).replace(".", ",")}
                    </p>
                  </>
                );
              })()}
            </div>

            <div className="flex origin-bottom-right scale-90 items-center gap-2">
              <QuantitySelector
                quantity={item.quantity}
                maxQuantity={item.product.stock}
                onChange={(qty) =>
                  onUpdateQuantity(item.product.id, qty, item.variantId)
                }
                size="sm"
              />
            </div>
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
    <div className="pt-0">
      <div className="mb-1 flex flex-col px-6 py-2">
        <div className="flex items-center gap-2.5">
          <div className="h-0.5 w-6 rounded-full bg-zinc-900" />
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">
            {cartCount}{" "}
            {cartCount === 1 ? "Item Adicionado" : "Itens Adicionados"}
          </p>
        </div>
      </div>

      {cart.length > 50 && (
        <div className="mx-6 mb-6 flex items-center justify-between rounded-[2rem] border border-red-200 bg-red-50 p-4">
          <div>
            <p className="text-sm font-bold text-red-800">
              Instabilidade detectada
            </p>
            <p className="text-[10px] font-black uppercase tracking-widest text-red-600">
              O carrinho excedeu o limite seguro.
            </p>
          </div>
          <button
            onClick={handleClearCart}
            className="rounded-xl bg-black px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-zinc-800"
          >
            Limpar Tudo
          </button>
        </div>
      )}

      <div className="space-y-4 px-4 py-2 pb-4">
        <AnimatePresence mode="popLayout">
          {cart
            .filter((item) => item?.product?.id)
            .map((item) => (
              <CartItemCard
                key={`${item.product.id}-${item.variantId || "default"}`}
                item={item}
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
