import { cn, formatCurrency } from "@/lib/utils";
import type { Product } from "@/types";
import { haptic } from "@/utils/haptic";
import { motion } from "framer-motion";
import {
  Minus,
  Plus,
  ShoppingCart,
  Sparkles as SparklesIcon,
  Truck,
} from "lucide-react";
import { useState } from "react";

interface ShippingProgressProps {
  shipping: number;
  savings: number;
  progressPercent: number;
  amountToFree: number;
  isNearlyThere: boolean;
  freeShippingProducts: Product[];
  onAddToCart?: (product: Product, quantity?: number) => void;
  deferred?: boolean;
  onNavigate?: (view: any, id?: string) => void;
}

export function ShippingProgress({
  shipping,
  savings,
  progressPercent,
  amountToFree,
  isNearlyThere,
  freeShippingProducts,
  onAddToCart,
  deferred = false,
  onNavigate,
}: ShippingProgressProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const getQuantity = (productId: string) => quantities[productId] || 1;
  const updateQuantity = (productId: string, delta: number) => {
    haptic.light();
    setQuantities((prev) => ({
      ...prev,
      [productId]: Math.max(1, (prev[productId] || 1) + delta),
    }));
  };

  return (
    <div
      className={cn(
        "mx-4 sm:mx-6 mt-4 mb-2 p-4 sm:p-5 rounded-[2rem] relative overflow-hidden transition-all duration-700 border",
        shipping === 0
          ? "bg-gradient-to-br from-emerald-50 via-white to-emerald-50/50 border-emerald-100 shadow-[0_8px_30px_-10px_rgba(16,185,129,0.15)]"
          : "bg-white border-zinc-200/60 shadow-[0_8px_30px_-10px_rgba(0,0,0,0.06)]",
      )}
    >
      {/* Animated Orbs for Premium Vibe */}
      {shipping === 0 && (
        <div className="pointer-events-none absolute right-0 top-0 size-48 -translate-y-1/2 translate-x-1/2 rounded-full bg-emerald-400/10 blur-3xl" />
      )}

      {/* Top Row: Icon + Title + Savings */}
      <div className="relative z-10 mb-4 flex items-center gap-3">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className={cn(
            "w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-sm transition-colors duration-500",
            shipping === 0
              ? "bg-gradient-to-b from-emerald-400 to-emerald-600 text-white shadow-emerald-500/30"
              : "bg-zinc-100 text-zinc-900 border border-zinc-200",
          )}
        >
          {shipping === 0 ? (
            <SparklesIcon className="size-5 drop-shadow-md" />
          ) : (
            <Truck className="size-5" />
          )}
        </motion.div>

        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              "text-sm font-black uppercase tracking-tight truncate transition-colors",
              shipping === 0 ? "text-emerald-700" : "text-zinc-900",
            )}
          >
            {shipping === 0 ? "Frete VIP Liberado" : "Meta Frete Grátis"}
          </h3>
          <p
            className={cn(
              "text-[10px] font-bold uppercase tracking-widest mt-0.5",
              shipping === 0 ? "text-emerald-600/70" : "text-zinc-400",
            )}
          >
            {shipping === 0 ? "Premium Service Ativado" : "Benefício exclusivo"}
          </p>
        </div>

        {savings > 0 && (
          <div className="flex flex-col items-end text-right animate-in fade-in slide-in-from-right-4">
            <span className="mb-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-600/70">
              Economia
            </span>
            <span className="shrink-0 rounded-lg bg-emerald-100/50 px-2 py-0.5 text-xs font-black tracking-tighter text-emerald-600 sm:text-sm">
              + {formatCurrency(savings)}
            </span>
          </div>
        )}
      </div>

      {/* Progress Bar System */}
      <div className="relative z-10">
        <div className="mb-1.5 flex items-end justify-between px-0.5">
          <span
            className={cn(
              "text-sm font-black tracking-tighter transition-colors",
              shipping === 0 ? "text-emerald-600" : "text-zinc-900",
            )}
          >
            {Math.floor(progressPercent)}%
          </span>
          {shipping > 0 && (
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Faltam{" "}
              <strong className="font-black tracking-tight text-zinc-900">
                {formatCurrency(amountToFree)}
              </strong>
            </span>
          )}
        </div>

        <div
          className={cn(
            "h-2.5 w-full rounded-full overflow-hidden p-[2px]",
            shipping === 0 ? "bg-emerald-100" : "bg-zinc-100",
          )}
        >
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: progressPercent / 100 }}
            transition={{ duration: 1.2, ease: "circOut" }}
            style={{ originX: 0 }}
            className={cn(
              "h-full w-full rounded-full relative transition-colors duration-1000",
              shipping === 0
                ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                : isNearlyThere
                  ? "bg-amber-400"
                  : "bg-zinc-900",
            )}
          />
        </div>
      </div>

      {/* Free Shipping Catalog Section (Compact) */}
      {shipping > 0 && freeShippingProducts.length > 0 && !deferred && (
        <div className="relative z-10 mt-5 border-t border-dashed border-zinc-100 pt-4 duration-1000 animate-in fade-in slide-in-from-bottom-4">
          <div className="mb-3 flex items-center justify-between px-1">
            <h4 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-500">
              <SparklesIcon className="size-3.5 text-amber-500" />
              Atinja a Meta
            </h4>
          </div>

          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto scroll-smooth px-4 pb-2 sm:-mx-5 sm:px-5">
            {freeShippingProducts.map((p: Product) => (
              <div
                key={p.id}
                onClick={() => {
                  haptic.light();
                  if (onNavigate) {
                    onNavigate("product-detail", p.id);
                  } else {
                    globalThis.history.pushState(
                      { view: "product-detail", id: p.id },
                      "",
                      `?product=${p.id}`,
                    );
                    globalThis.dispatchEvent(new PopStateEvent("popstate"));
                  }
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    haptic.light();
                    if (onNavigate) {
                      onNavigate("product-detail", p.id);
                    } else {
                      globalThis.history.pushState(
                        { view: "product-detail", id: p.id },
                        "",
                        `?product=${p.id}`,
                      );
                      globalThis.dispatchEvent(new PopStateEvent("popstate"));
                    }
                  }
                }}
                className="group/card w-[124px] flex-shrink-0 cursor-pointer rounded-2xl border border-zinc-100 bg-zinc-50 p-2 transition-colors hover:border-zinc-300"
              >
                <div className="relative mb-2 aspect-square overflow-hidden rounded-xl border border-black/[0.03] bg-white shadow-sm">
                  <img
                    src={p.images[0]}
                    alt={p.name}
                    className="size-full object-cover transition-transform duration-500 group-hover/card:scale-105"
                  />
                </div>
                <div className="px-0.5">
                  <p className="mb-1 line-clamp-2 min-h-[26px] text-[9px] font-black uppercase leading-snug tracking-tight text-zinc-600">
                    {p.name}
                  </p>
                  <p className="mb-2 text-[11px] font-black tracking-tighter text-zinc-900">
                    R$ {p.price.toFixed(2).replace(".", ",")}
                  </p>

                  <div className="mb-2 flex items-center justify-between gap-1 rounded-lg border border-zinc-200 bg-white p-0.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        updateQuantity(p.id, -1);
                      }}
                      className="flex size-5 items-center justify-center rounded-md bg-zinc-50 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 active:scale-95"
                    >
                      <Minus className="size-3" />
                    </button>
                    <span className="flex-1 text-center text-[10px] font-black text-zinc-900">
                      {getQuantity(p.id)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        updateQuantity(p.id, 1);
                      }}
                      className="flex size-5 items-center justify-center rounded-md bg-zinc-50 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 active:scale-95"
                    >
                      <Plus className="size-3" />
                    </button>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      haptic.medium();
                      onAddToCart?.(p, getQuantity(p.id));
                    }}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-zinc-900 py-1.5 text-white shadow-sm transition-colors hover:bg-zinc-800 active:scale-95"
                  >
                    <ShoppingCart className="size-3" />
                    <span className="text-[9px] font-black uppercase tracking-widest">
                      Adicionar
                    </span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
