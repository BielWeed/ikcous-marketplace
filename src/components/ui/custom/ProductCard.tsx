import { LazyImage } from "@/components/LazyImage";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { isViewTransitionSupported } from "@/hooks/useViewTransition";
import { cn, formatCurrency } from "@/lib/utils";
import type { Product } from "@/types";
import { triggerFlyingCartAnimation } from "@/utils/cartAnimation";
import {
  Check,
  Flame,
  Heart,
  Loader2,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { memo, useId, useState } from "react";
import { StarRating } from "./StarRating";

interface ProductCardProps {
  product: Product;
  isFavorite: boolean;
  onToggleFavorite: (product: Product, e: React.MouseEvent) => void;
  onAddToCart?: (product: Product, e: React.MouseEvent) => void;
  onQuickBuy?: (product: Product, e: React.MouseEvent) => void;
  onClick: (productId: string) => void;
  onMouseEnter?: (productId: string) => void;
  onTouchStart?: (productId: string) => void;
  className?: string;
  priority?: boolean;
  isEligibleForFreeShipping?: boolean;
  selectedProductId?: string;
}

// Global trackers for view transitions to prevent duplicate view-transition-names
let activeTransitionCardId: string | null = null;

export const ProductCard = memo(function ProductCard({
  product,
  isFavorite,
  onToggleFavorite,
  onAddToCart,
  onClick,
  onMouseEnter,
  onTouchStart,
  className,
  priority = false,
  isEligibleForFreeShipping = false,
  selectedProductId,
}: Readonly<ProductCardProps>) {
  const instanceId = useId();
  const { prefetchImage } = usePrefetchOnHover();

  const discount = product.originalPrice
    ? Math.round(
        ((product.originalPrice - product.price) / product.originalPrice) * 100,
      )
    : 0;

  const [cartStatus, setCartStatus] = useState<"idle" | "loading" | "success">(
    "idle",
  );

  // Safely determine if this specific card should have the view transition name applied.
  // We apply it strictly to the clicked instance (via activeTransitionCardId) to avoid duplicate transition names.
  let shouldApplyTransitionName = false;
  if (isViewTransitionSupported && selectedProductId === product.id) {
    if (activeTransitionCardId === instanceId) {
      shouldApplyTransitionName = true;
    }
  }

  const handleAddToCartClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cartStatus !== "idle") return;

    setCartStatus("loading");

    if (onAddToCart) {
      onAddToCart(product, e);
    }

    const startEl = (e.currentTarget as HTMLElement) || document.body;
    triggerFlyingCartAnimation(startEl, product.images[0]);

    setTimeout(() => {
      setCartStatus("success");
      setTimeout(() => {
        setCartStatus("idle");
      }, 1500);
    }, 600);
  };

  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    activeTransitionCardId = instanceId;
    if (isViewTransitionSupported) {
      document
        .querySelectorAll<HTMLElement>('img, [style*="view-transition-name"]')
        .forEach((el) => {
          el.style.removeProperty("view-transition-name");
        });
      const img = e.currentTarget.querySelector("img");
      if (img) {
        img.style.setProperty("view-transition-name", "product-image");
      }
    }
    onClick(product.id);
  };

  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activeTransitionCardId = instanceId;
      if (isViewTransitionSupported) {
        document
          .querySelectorAll<HTMLElement>('img, [style*="view-transition-name"]')
          .forEach((el) => {
            el.style.removeProperty("view-transition-name");
          });
        const img = e.currentTarget.querySelector("img");
        if (img) {
          img.style.setProperty("view-transition-name", "product-image");
        }
      }
      onClick(product.id);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onMouseEnter={() => {
        prefetchImage(product.images[0]);
        if (onMouseEnter) onMouseEnter(product.id);
      }}
      onTouchStart={() => {
        prefetchImage(product.images[0]);
        if (onTouchStart) onTouchStart(product.id);
      }}
      onKeyDown={handleCardKeyDown}
      className={cn(
        "group bg-zinc-50/30 rounded-[2rem] overflow-hidden hover:-translate-y-2 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] hover:bg-white transition-[transform,box-shadow,background-color] duration-300 ease-out cursor-pointer border border-zinc-200/60 flex flex-col relative active:scale-[0.98] h-full flex-1 gpu-accelerated",
        className,
      )}
    >
      {/* Image Container */}
      <div className="relative aspect-[4/5] overflow-hidden bg-slate-50">
        <LazyImage
          src={product.images[0]}
          alt={product.name}
          className="size-full object-cover transition-transform duration-1000 ease-out group-hover:scale-105"
          priority={priority}
          style={
            shouldApplyTransitionName
              ? { viewTransitionName: "product-image" }
              : undefined
          }
        />

        {/* Action Buttons */}
        <div className="absolute right-3 top-3 flex translate-x-0 flex-col gap-2 opacity-100 transition-all duration-500 ease-out hover-hover:translate-x-12 hover-hover:opacity-0 hover-hover:group-hover:translate-x-0 hover-hover:group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(product, e);
            }}
            aria-label={
              isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos"
            }
            title={
              isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos"
            }
            className={cn(
              "p-2.5 rounded-full glass transition-all active:scale-75",
              isFavorite
                ? "bg-red-500 text-white border-red-500/20 shadow-lg shadow-red-200/50"
                : "text-slate-600 hover:text-red-500",
            )}
          >
            <Heart
              className={cn(
                "size-4",
                isFavorite && "fill-current animate-heart-pop",
              )}
            />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-0.5 p-2.5">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="max-w-[80%] truncate text-[9px] font-bold uppercase tracking-widest text-slate-400">
              {product.category}
            </p>
            {(isEligibleForFreeShipping || product.freeShipping) && (
              <div className="flex shrink-0 items-center gap-1 rounded-md border border-emerald-100/50 bg-emerald-50 px-1.5 py-0.5 text-[8px] font-black text-emerald-800">
                <Truck className="animate-bounce-subtle size-2.5 shrink-0" />
                <span className="truncate">Frete Grátis</span>
              </div>
            )}
          </div>
          <h3 className="line-clamp-2 text-[13px] font-black leading-tight text-slate-900 transition-colors duration-300 group-hover:text-primary sm:text-[14px]">
            {product.name}
          </h3>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <StarRating rating={product.rating || 5} size={11} />
            <div className="flex items-center gap-1 text-[9px] font-bold">
              <span
                className={cn(
                  "w-1 h-1 rounded-full animate-pulse",
                  product.stock <= 0
                    ? "bg-zinc-400"
                    : product.stock <= 5
                      ? "bg-rose-500"
                      : "bg-emerald-500",
                )}
              />
              <span
                className={
                  product.stock <= 0
                    ? "text-zinc-500"
                    : product.stock <= 5
                      ? "text-rose-600"
                      : "text-emerald-600"
                }
              >
                {product.stock <= 0
                  ? "Esgotado"
                  : product.stock <= 5
                    ? `Apenas ${product.stock} restam!`
                    : `Estoque: ${product.stock}`}
              </span>
            </div>
          </div>
        </div>

        {/* Price */}
        <div className="mt-auto flex w-full items-end justify-between gap-2 pt-1">
          <div className="flex flex-col justify-end">
            {product.originalPrice && product.originalPrice > product.price ? (
              <div className="flex flex-col">
                <span className="text-[9px] font-bold uppercase leading-none tracking-wider text-slate-400">
                  De:{" "}
                  <span className="line-through">
                    {formatCurrency(product.originalPrice)}
                  </span>
                </span>
                <span className="mt-1 text-[15px] font-black leading-none tracking-tight text-rose-600">
                  Por: {formatCurrency(product.price)}
                </span>
              </div>
            ) : (
              <div className="flex flex-col">
                <span className="text-[15px] font-black leading-none tracking-tight text-slate-900">
                  {formatCurrency(product.price)}
                </span>
              </div>
            )}
          </div>

          {/* Badges */}
          <div className="flex shrink-0 items-center gap-1">
            {discount > 0 && (
              <span className="shrink-0 select-none rounded border border-rose-100 bg-rose-50 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-rose-700">
                {discount}% OFF
              </span>
            )}
            {product.isBestseller && (
              <span className="flex shrink-0 select-none items-center gap-0.5 rounded border border-amber-100 bg-amber-50 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-amber-700">
                <Flame className="size-2.5 shrink-0 fill-orange-500/20 text-orange-500" />
                <span>EM ALTA</span>
              </span>
            )}
          </div>
        </div>

        {/* Action Button */}
        <div className="mt-1.5">
          <button
            onClick={handleAddToCartClick}
            disabled={product.stock <= 0 || cartStatus !== "idle"}
            className={cn(
              "w-full py-2 px-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-150 active:scale-95 shadow-[0_4px_10px_rgba(199,65,86,0.1)] flex items-center justify-center gap-1.5",
              product.stock <= 0
                ? "bg-zinc-100 text-zinc-400 cursor-not-allowed shadow-none"
                : cartStatus === "success"
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : "bg-primary hover:opacity-90 text-primary-foreground",
            )}
          >
            {cartStatus === "loading" && (
              <Loader2 className="size-3 shrink-0 animate-spin" />
            )}
            {cartStatus === "success" && <Check className="size-3 shrink-0" />}
            {cartStatus === "idle" && product.stock > 0 && (
              <ShoppingCart className="size-3 shrink-0" />
            )}
            <span className="truncate">
              {product.stock <= 0
                ? "Esgotado"
                : cartStatus === "idle"
                  ? "Carrinho"
                  : cartStatus === "loading"
                    ? "Salvando..."
                    : "Salvo!"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
});
