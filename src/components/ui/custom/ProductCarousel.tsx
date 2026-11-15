import { useStore } from "@/contexts/StoreContext";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { promessasDeFrete } from "@/lib/estrategias-de-frete";
import { nomeTemConteudoVisivel } from "@/lib/nome-visivel";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";
import { haptic } from "@/utils/haptic";
import { ChevronLeft, ChevronRight } from "lucide-react";
import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { ProductCard } from "./ProductCard";

interface ProductCarouselProps {
  title: string;
  subtitle?: string;
  products: Product[];
  favorites: string[];
  onToggleFavorite: (product: Product) => void;
  onProductClick: (productId: string) => void;
  /** Devolve quantas unidades entraram (0 = nada): o card só celebra se entrou. */
  onAddToCart?: (product: Product) => unknown;
  /** Card inteligente (02/09): presente, o card escolhe opções nele mesmo. */
  onAddToCartWithVariants?: (
    product: Product,
    variantId: string | undefined,
    variantNames: string,
    quantity?: number,
  ) => unknown;
  onQuickBuy?: (product: Product) => void;
  icon?: React.ReactNode;
  accentColor?: string;
  className?: string;
  selectedProductId?: string;
}

export const ProductCarousel = React.memo(function ProductCarousel({
  title,
  subtitle,
  products,
  favorites,
  onToggleFavorite,
  onProductClick,
  onAddToCart,
  onAddToCartWithVariants,
  onQuickBuy,
  icon,
  accentColor = "amber",
  className,
  selectedProductId,
}: ProductCarouselProps) {
  const { config } = useStore();
  // B3 do item 2 da fila (19/09): o selo "Frete Grátis" do card obedece ao
  // preset da LOJA (ProductCard-520), derivado do MESMO config que já
  // alimentava `showRating` — mesmo padrão do ProductView.
  const promessasDaLoja = useMemo(() => promessasDeFrete(config), [config]);
  const { prefetchView } = usePrefetchOnHover();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showLeftVignette, setShowLeftVignette] = useState(false);
  const [showRightVignette, setShowRightVignette] = useState(false);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const updateVignettes = () => {
      const { scrollLeft, scrollWidth, clientWidth } = container;
      setShowLeftVignette(scrollLeft > 10);
      setShowRightVignette(scrollLeft + clientWidth < scrollWidth - 10);
    };

    const resizeObserver = new ResizeObserver(updateVignettes);
    resizeObserver.observe(container);

    container.addEventListener("scroll", updateVignettes, { passive: true });
    updateVignettes();

    return () => {
      container.removeEventListener("scroll", updateVignettes);
      resizeObserver.disconnect();
    };
  }, [products.length]);

  const rolarPagina = (direcao: number) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const reduzirMovimento = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    // "auto" herda o scroll-smooth do CSS; a preferência precisa vencê-lo.
    const comportamentoAnterior = container.style.scrollBehavior;
    if (reduzirMovimento) container.style.scrollBehavior = "auto";
    container.scrollBy({
      left: direcao * (container.clientWidth - 2 * 24),
      behavior: reduzirMovimento ? "auto" : "smooth",
    });
    if (reduzirMovimento) {
      container.style.scrollBehavior = comportamentoAnterior;
    }
  };

  const handleToggleFavorite = useCallback(
    (product: Product) => {
      haptic.medium();
      onToggleFavorite(product);
    },
    [onToggleFavorite],
  );

  const handleProductClick = useCallback(
    (id: string) => {
      haptic.light();
      onProductClick(id);
    },
    [onProductClick],
  );

  const handleAddToCart = useCallback(
    (product: Product) => onAddToCart?.(product),
    [onAddToCart],
  );

  const handleAddToCartWithVariants = useCallback(
    (
      product: Product,
      variantId: string | undefined,
      variantNames: string,
      quantity?: number,
    ) => {
      return onAddToCartWithVariants?.(
        product,
        variantId,
        variantNames,
        quantity,
      );
    },
    [onAddToCartWithVariants],
  );

  const handleQuickBuy = useCallback(
    (product: Product) => {
      onQuickBuy?.(product);
    },
    [onQuickBuy],
  );

  const handlePrefetchProductDetail = useCallback(() => {
    prefetchView("product-detail");
  }, [prefetchView]);

  if (products.length === 0) return null;

  return (
    <div className={cn("px-5 sm:px-6 py-4 overflow-hidden", className)}>
      <div className="mb-6 flex flex-col">
        {subtitle && (
          <div className="mb-1.5 flex items-center gap-2">
            {icon}
            <span
              className={cn(
                "text-[10px] font-black uppercase tracking-[0.3em]",
                `text-${accentColor}-600`,
              )}
            >
              {subtitle}
            </span>
          </div>
        )}
        {nomeTemConteudoVisivel(title) ? (
          <h2 className="break-words text-3xl font-black leading-[0.9] tracking-tighter text-zinc-950 sm:text-4xl">
            {title}
          </h2>
        ) : null}
      </div>

      <div className="relative -mx-6">
        {/* Fotos 4:5 de 260px + 8px de respiro: centro em ~170px. */}
        {showLeftVignette && (
          <button
            type="button"
            aria-label="Ver produtos anteriores"
            onClick={() => rolarPagina(-1)}
            className="absolute left-2 top-[170px] z-20 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 lg:flex"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
        )}
        {showRightVignette && (
          <button
            type="button"
            aria-label="Ver próximos produtos"
            onClick={() => rolarPagina(1)}
            className="absolute right-2 top-[170px] z-20 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 lg:flex"
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </button>
        )}
        {/* Dynamic Vignettes - Improved White Gradient */}
        <div
          className={cn(
            "absolute left-0 top-0 bottom-4 w-8 bg-gradient-to-r from-white/90 via-white/40 to-transparent z-10 pointer-events-none transition-opacity duration-300",
            showLeftVignette ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          className={cn(
            "absolute right-0 top-0 bottom-4 w-8 bg-gradient-to-l from-white/90 via-white/40 to-transparent z-10 pointer-events-none transition-opacity duration-300",
            showRightVignette ? "opacity-100" : "opacity-0",
          )}
        />

        <div
          ref={scrollContainerRef}
          className="scrollbar-hide flex snap-x snap-mandatory items-stretch gap-4 overflow-x-auto scroll-smooth pb-2"
          style={{
            paddingLeft: "24px",
            paddingRight: "24px",
            scrollPaddingLeft: "24px",
          }}
        >
          {products.map((product, index) => (
            <div
              key={product.id}
              className={cn(
                "flex-shrink-0 w-[260px] py-2 flex flex-col",
                index === 0 ? "snap-start" : "snap-center",
              )}
            >
              <ProductCard
                product={product}
                isFavorite={favorites.includes(product.id)}
                onToggleFavorite={handleToggleFavorite}
                onClick={handleProductClick}
                onAddToCart={handleAddToCart}
                onAddToCartWithVariants={
                  onAddToCartWithVariants
                    ? handleAddToCartWithVariants
                    : undefined
                }
                onQuickBuy={handleQuickBuy}
                onMouseEnter={handlePrefetchProductDetail}
                onTouchStart={handlePrefetchProductDetail}
                priority={index < 3}
                selectedProductId={selectedProductId}
                showRating={config.enableReviews}
                promessasDeFrete={promessasDaLoja}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
