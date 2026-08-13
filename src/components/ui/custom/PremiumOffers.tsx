import { LazyImage } from "@/components/LazyImage";
import { useStore } from "@/contexts/StoreContext";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { cn, formatCurrency } from "@/lib/utils";
import type { Product } from "@/types";
import { triggerFlyingCartAnimation } from "@/utils/cartAnimation";
import { haptic } from "@/utils/haptic";
import useEmblaCarousel from "embla-carousel-react";
import {
  Check,
  Clock,
  Flame,
  Heart,
  Loader2,
  ShoppingCart,
  Truck,
} from "lucide-react";
import React, { useState, useEffect, useCallback } from "react";
import { StarRating } from "./StarRating";

interface PremiumOffersProps {
  products: Product[];
  favorites: string[];
  onToggleFavorite: (product: Product) => void;
  onProductClick: (productId: string) => void;
  onAddToCart?: (product: Product) => void;
  onQuickBuy?: (product: Product) => void;
  title?: string;
}

// Helper to get time remaining until midnight
function getTimeRemaining() {
  const now = new Date();
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  const diff = midnight.getTime() - now.getTime();

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);

  return {
    hours: String(hours).padStart(2, "0"),
    minutes: String(minutes).padStart(2, "0"),
    seconds: String(seconds).padStart(2, "0"),
  };
}

export const PremiumOffers = React.memo(function PremiumOffers({
  products,
  favorites,
  onToggleFavorite,
  onProductClick,
  onAddToCart,
  onQuickBuy,
  title = "Super Descontos",
}: PremiumOffersProps) {
  const { config } = useStore();
  const { prefetchView } = usePrefetchOnHover();
  const [timeLeft, setTimeLeft] = useState(getTimeRemaining());
  const [activeHeroIndex, setActiveHeroIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Initialize Embla Carousel for featured offers
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: true,
    duration: 35,
    skipSnaps: false,
  });

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setActiveHeroIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;

    // Use requestAnimationFrame to avoid synchronous state updates during render/mount
    const initialSelect = () => requestAnimationFrame(() => onSelect());
    initialSelect();

    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);

    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", onSelect);
    };
  }, [emblaApi, onSelect]);

  // Ticking countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(getTimeRemaining());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Auto-play timer for hero rotation
  useEffect(() => {
    if (isPaused || !emblaApi || products.length <= 1) return;

    const intervalId = setInterval(() => {
      emblaApi.scrollNext();
    }, 6000); // Rotate every 6 seconds

    return () => clearInterval(intervalId);
  }, [isPaused, emblaApi, products.length]);

  const handlePrefetchProductDetail = useCallback(() => {
    prefetchView("product-detail");
  }, [prefetchView]);

  const handleMouseEnter = useCallback(() => {
    setIsPaused(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsPaused(false);
  }, []);

  const selectHero = useCallback(
    (index: number) => {
      haptic.light();
      setActiveHeroIndex(index);
      if (emblaApi) {
        emblaApi.scrollTo(index);
      }
      setIsPaused(true); // Pause auto-rotation on manual interaction
    },
    [emblaApi],
  );

  if (products.length === 0) return null;

  // Determine the Hero Deal: product with the highest percentage discount
  const offerItems = products.map((p) => {
    const discount = p.originalPrice
      ? Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100)
      : 0;
    return { product: p, discount };
  });

  // Sort by discount descending to find the Hero
  const sortedOffers = [...offerItems].sort((a, b) => b.discount - a.discount);

  return (
    <div className="relative overflow-hidden bg-gradient-to-b from-zinc-50/20 via-zinc-50/10 to-transparent px-5 py-4 sm:px-6">
      {/* Premium Micro-Dividers */}
      <div className="absolute left-0 top-0 h-px w-full bg-gradient-to-r from-transparent via-zinc-200/20 to-transparent" />
      <div className="absolute bottom-0 left-0 h-px w-full bg-gradient-to-r from-transparent via-zinc-200/10 to-transparent" />

      {/* Decorative Glow Elements */}
      <div className="pointer-events-none absolute left-1/4 top-0 size-64 -translate-y-1/2 rounded-full bg-secondary/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-1/4 size-80 translate-y-1/2 rounded-full bg-orange-100/5 blur-3xl" />

      {/* Compact Header: Single-Row Layout */}
      <div className="relative z-10 mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span className="relative flex size-2 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-secondary opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-secondary" />
          </span>
          <h2 className="text-xl font-extrabold leading-none tracking-tight text-zinc-950 sm:text-2xl">
            {title}
          </h2>
        </div>

        {/* Ultra-Compact Countdown Timer Badge */}
        <div className="flex shrink-0 select-none items-center gap-1.5 rounded-full border border-secondary/20 bg-secondary/10 px-2.5 py-1 font-mono text-[10px] font-extrabold text-primary shadow-sm backdrop-blur-md">
          <Clock className="size-3 shrink-0 animate-pulse text-primary" />
          <span>{timeLeft.hours}</span>
          <span className="animate-pulse font-normal text-primary/40">:</span>
          <span>{timeLeft.minutes}</span>
          <span className="animate-pulse font-normal text-primary/40">:</span>
          <span>{timeLeft.seconds}</span>
        </div>
      </div>

      {/* Main Grid: Hero Offer Carousel */}
      <div className="relative z-10 flex flex-col gap-6">
        {/* HERO OFFER CAROUSEL */}
        <div
          className="-mx-1 -my-3 w-full cursor-grab overflow-hidden px-1 py-3 active:cursor-grabbing"
          ref={emblaRef}
        >
          <div className="flex">
            {sortedOffers.map((offer) => (
              <div
                key={offer.product.id}
                className="flex min-w-0 flex-[0_0_100%] flex-col p-1.5"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              >
                <HeroOfferCard
                  product={offer.product}
                  discount={offer.discount}
                  isFavorite={favorites.includes(offer.product.id)}
                  onToggleFavorite={onToggleFavorite}
                  onProductClick={onProductClick}
                  onAddToCart={onAddToCart}
                  onQuickBuy={onQuickBuy}
                  onMouseEnter={handlePrefetchProductDetail}
                  onTouchStart={handlePrefetchProductDetail}
                  isEligibleForFreeShipping={config.freeShippingMin > 0}
                  showRating={config.enableReviews}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Hero Offer Pagination Dots (Stripe/Apple Minimalist design) */}
        {sortedOffers.length > 1 && (
          <div className="mb-1 mt-2 flex items-center justify-center gap-1.5">
            {sortedOffers.map((_, idx) => (
              <button
                key={idx}
                onClick={() => selectHero(idx)}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300 ease-out focus:outline-none",
                  idx === activeHeroIndex
                    ? "w-6 bg-primary shadow-sm"
                    : "w-1.5 bg-zinc-200/80 hover:bg-zinc-400",
                )}
                aria-label={`Ver oferta ${idx + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

/* ==========================================================================
   SUB-COMPONENT: HEROOFFERCARD
   ========================================================================== */
interface HeroOfferCardProps {
  product: Product;
  discount: number;
  isFavorite: boolean;
  onToggleFavorite: (product: Product) => void;
  onProductClick: (productId: string) => void;
  onAddToCart?: (product: Product) => void;
  onQuickBuy?: (product: Product) => void;
  onMouseEnter?: () => void;
  onTouchStart?: () => void;
  isEligibleForFreeShipping: boolean;
  /** ADMIN-091 (#202): espelha `config.enableReviews`, lido uma vez pelo
   * `PremiumOffers` pai e repassado aqui -- mesmo padrão de
   * `isEligibleForFreeShipping`. */
  showRating: boolean;
}

function HeroOfferCard({
  product,
  discount,
  isFavorite,
  onToggleFavorite,
  onProductClick,
  onAddToCart,
  onQuickBuy,
  onMouseEnter,
  onTouchStart,
  isEligibleForFreeShipping,
  showRating,
}: HeroOfferCardProps) {
  const [cartStatus, setCartStatus] = useState<"idle" | "loading" | "success">(
    "idle",
  );

  // Scarcity progress calculations
  const totalSimulated = (product.sold || 3) + product.stock;
  const pctSold = Math.min(
    95,
    Math.max(60, Math.round(((product.sold || 3) / totalSimulated) * 100)),
  );

  const handleCardClick = () => {
    haptic.light();
    onProductClick(product.id);
  };

  const handleAddToCartClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cartStatus !== "idle") return;

    haptic.medium();
    setCartStatus("loading");
    onAddToCart?.(product);

    const startEl = (e.currentTarget as HTMLElement) || document.body;
    triggerFlyingCartAnimation(startEl, product.images[0]);

    setTimeout(() => {
      setCartStatus("success");
      setTimeout(() => setCartStatus("idle"), 1500);
    }, 600);
  };

  const handleQuickBuyClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    haptic.heavy();
    onQuickBuy?.(product);
  };

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    haptic.medium();
    onToggleFavorite(product);
  };

  const savings = product.originalPrice
    ? product.originalPrice - product.price
    : 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onMouseEnter={onMouseEnter}
      onTouchStart={onTouchStart}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCardClick();
        }
      }}
      className="gpu-accelerated group relative flex h-full flex-1 cursor-pointer flex-col gap-4 overflow-hidden rounded-[2rem] border border-zinc-100/40 bg-gradient-to-br from-zinc-50/60 via-orange-50/15 to-white p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_48px_-15px_rgba(24,24,27,0.06)] active:scale-[0.995] sm:p-5"
    >
      {/* Floating Sparkle / Highlight elements */}
      <div className="pointer-events-none absolute right-0 top-0 size-32 rounded-full bg-secondary/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-0 size-24 rounded-full bg-amber-200/10 blur-3xl" />

      {/* Clean Premium Tag Header (Does NOT overlap image) */}
      <div className="relative z-10 flex w-full items-center justify-center border-b border-zinc-100/50 pb-3">
        <div className="flex select-none items-center rounded-full border border-zinc-200/30 bg-zinc-100/80 p-0.5 text-[10px] font-black uppercase tracking-wider shadow-sm transition-transform duration-300 group-hover:scale-[1.02]">
          <span className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-0.5 text-white shadow-[0_2px_4px_rgba(24,24,27,0.1)]">
            <Flame className="size-3 animate-pulse fill-white text-white" />
            Super Oferta
          </span>
          {discount > 0 && (
            <span className="px-3 py-0.5 font-black text-rose-600">
              {discount}% OFF
            </span>
          )}
        </div>

        {/* Favorite Button */}
        <button
          onClick={handleFavoriteClick}
          className={cn(
            "absolute right-0 p-2 rounded-full transition-all active:scale-75 hover:bg-zinc-50 z-20 border border-transparent hover:border-zinc-100/30",
            isFavorite
              ? "text-red-500 bg-red-50/50 shadow-sm"
              : "text-slate-400 hover:text-red-500 bg-slate-50/40",
          )}
          aria-label={
            isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos"
          }
        >
          <Heart className={`size-4 ${isFavorite ? "fill-current" : ""}`} />
        </button>
      </div>

      {/* Main columns for Image & Details */}
      <div className="z-10 flex flex-1 flex-col gap-4 sm:gap-5 md:flex-row">
        {/* Hero Image Container - Completely Clean! */}
        <div className="relative aspect-[4/3] w-full flex-shrink-0 overflow-hidden rounded-2xl border border-slate-100 bg-slate-100/40 shadow-inner md:aspect-square md:w-2/5">
          <LazyImage
            src={product.images[0]}
            alt={product.name}
            className="size-full object-cover transition-transform ease-out group-hover:scale-[1.03]"
            style={{ transitionDuration: "1.2s" }}
          />
        </div>

        {/* Hero Content */}
        <div className="flex flex-1 flex-col justify-between py-0.5">
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-secondary/20 bg-secondary/10 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-primary">
                {product.category}
              </span>
              {(product.freeShipping || isEligibleForFreeShipping) && (
                <div className="flex items-center gap-1 rounded-md border border-emerald-100/40 bg-emerald-50 px-2 py-0.5 text-[9px] font-extrabold text-emerald-800">
                  <Truck className="animate-bounce-subtle size-2.5 shrink-0" />
                  <span>Frete Grátis</span>
                </div>
              )}
            </div>

            <h3 className="mb-1.5 line-clamp-2 text-lg font-extrabold leading-snug tracking-tight text-slate-900 transition-colors duration-300 group-hover:text-primary sm:text-xl">
              {product.name}
            </h3>

            <div className="mb-3 flex flex-wrap items-center gap-1.5 sm:gap-2">
              {showRating && (
                <>
                  <StarRating rating={product.rating || 5} size={12} />
                  {product.reviewCount && product.reviewCount > 0 && (
                    <span className="text-[11px] font-bold text-slate-400">
                      ({product.reviewCount})
                    </span>
                  )}
                  {/* Separador só faz sentido com a estrela antes dele --
                      some junto (ADMIN-091, #202). O selo "Alta Procura"
                      abaixo é um sinal de demanda que a loja já tinha,
                      independente de avaliação, e continua sozinho na
                      linha sem deixar buraco. */}
                  <span className="text-xs text-slate-200">|</span>
                </>
              )}
              <span className="flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-700 transition-transform duration-300 group-hover:scale-105">
                <Flame className="size-2.5 animate-pulse fill-amber-500 text-amber-500" />
                Alta Procura
              </span>
            </div>

            {/* Price details with absolute premium styling */}
            <div className="mb-3.5 flex flex-wrap items-end gap-3">
              {product.originalPrice && (
                <div className="flex flex-col">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 line-through">
                    De: {formatCurrency(product.originalPrice)}
                  </span>
                  <span className="mt-0.5 text-xl font-black leading-none tracking-tighter text-rose-600 sm:text-2xl">
                    Por: {formatCurrency(product.price)}
                  </span>
                </div>
              )}
              {savings > 0 && (
                <div className="mb-0.5 rounded-md border border-emerald-200/30 bg-emerald-50 px-2 py-0.5 text-[9px] font-extrabold uppercase text-emerald-700">
                  Economize {formatCurrency(savings)}
                </div>
              )}
            </div>

            {/* Scarcity meter progress bar */}
            <div className="mb-4 max-w-sm space-y-1">
              <div className="flex items-center justify-between text-[9px] font-extrabold uppercase tracking-wide text-slate-500">
                <span className="flex items-center gap-1 text-primary">
                  <Flame className="size-2.5 animate-pulse fill-primary" />
                  {pctSold}% VENDIDO
                </span>
                <span>
                  {product.stock <= 0
                    ? "Sem estoque"
                    : product.stock === 1
                      ? "Só resta 1!"
                      : `Apenas ${product.stock} restantes`}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100/70">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-amber-500 transition-all duration-1000 ease-out"
                  style={{ width: `${pctSold}%` }}
                />
              </div>
            </div>
          </div>

          {/* CTAs */}
          <div className="flex gap-2">
            <button
              onClick={handleAddToCartClick}
              disabled={product.stock <= 0 || cartStatus !== "idle"}
              className={cn(
                "flex-grow-2 flex-[2] py-2.5 px-3 rounded-full text-[10px] font-black uppercase tracking-wider transition-all active:scale-[0.97] shadow-sm flex items-center justify-center gap-1.5 border",
                product.stock <= 0
                  ? "bg-zinc-100 text-zinc-400 border-zinc-200/50 cursor-not-allowed shadow-none"
                  : cartStatus === "success"
                    ? "bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700"
                    : "bg-primary hover:opacity-90 text-white border-primary shadow-black/10",
              )}
            >
              {cartStatus === "loading" && (
                <Loader2 className="size-3 animate-spin" />
              )}
              {cartStatus === "success" && <Check className="size-3" />}
              {cartStatus === "idle" && product.stock > 0 && (
                <ShoppingCart className="animate-bounce-subtle size-3" />
              )}
              <span>
                {product.stock <= 0
                  ? "Esgotado"
                  : cartStatus === "idle"
                    ? "Adicionar"
                    : cartStatus === "loading"
                      ? "Adicionando..."
                      : "Adicionado!"}
              </span>
            </button>

            <button
              onClick={handleQuickBuyClick}
              disabled={product.stock <= 0}
              className={cn(
                "flex-grow-1 flex-[1] py-2.5 px-4 rounded-full text-[10px] font-black uppercase tracking-wider transition-all active:scale-[0.97] border shadow-sm",
                product.stock <= 0
                  ? "bg-zinc-50 text-zinc-300 border-zinc-100 cursor-not-allowed shadow-none"
                  : "bg-secondary/10 hover:bg-secondary/20 text-primary border-secondary/20",
              )}
            >
              Comprar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
