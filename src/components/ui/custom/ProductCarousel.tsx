import { useStore } from "@/contexts/StoreContext";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { useTelaDeComputador } from "@/hooks/useTelaDeComputador";
import { promessasDeFrete } from "@/lib/estrategias-de-frete";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";
import { haptic } from "@/utils/haptic";
import { ChevronLeft, ChevronRight } from "lucide-react";
import React, {
  useRef,
  useId,
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
  onAddToCart?: (product: Product) => void;
  /** Card inteligente (02/09): presente, o card escolhe opções nele mesmo. */
  onAddToCartWithVariants?: (
    product: Product,
    variantId: string | undefined,
    variantNames: string,
    quantity?: number,
  ) => void;
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
  const computador = useTelaDeComputador();
  const faixaId = useId();
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
    (product: Product) => {
      onAddToCart?.(product);
    },
    [onAddToCart],
  );

  const handleAddToCartWithVariants = useCallback(
    (
      product: Product,
      variantId: string | undefined,
      variantNames: string,
      quantity?: number,
    ) => {
      onAddToCartWithVariants?.(product, variantId, variantNames, quantity);
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

  const rolarPagina = (direcao: number) => {
    const faixa = scrollContainerRef.current;
    faixa?.scrollBy({ left: direcao * faixa.clientWidth, behavior: "smooth" });
  };

  if (products.length === 0) return null;

  return (
    <div
      className={cn(
        "px-5 sm:px-6 py-4 overflow-hidden",
        "lg:px-0 lg:py-10",
        className,
      )}
    >
      <div
        className={cn(
          "mb-6 flex flex-col",
          "lg:relative lg:min-h-11 lg:justify-center lg:pr-28",
        )}
      >
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
        <h2
          className={cn(
            "text-3xl font-black leading-[0.9] tracking-tighter text-zinc-950 sm:text-4xl",
            "lg:text-3xl",
          )}
        >
          {title}
        </h2>
        {computador && (
          <div className="lg:absolute lg:right-0 lg:top-0 lg:flex lg:gap-2">
            <button
              type="button"
              aria-label="Ver anteriores"
              aria-controls={faixaId}
              onClick={() => rolarPagina(-1)}
              className="lg:flex lg:size-11 lg:items-center lg:justify-center lg:rounded-full lg:border lg:border-zinc-200 lg:bg-white lg:text-zinc-900 lg:hover:bg-zinc-100 lg:focus-visible:ring-2 lg:focus-visible:ring-zinc-900/50"
            >
              <ChevronLeft className="lg:size-5" />
            </button>
            <button
              type="button"
              aria-label="Ver próximos"
              aria-controls={faixaId}
              onClick={() => rolarPagina(1)}
              className="lg:flex lg:size-11 lg:items-center lg:justify-center lg:rounded-full lg:border lg:border-zinc-200 lg:bg-white lg:text-zinc-900 lg:hover:bg-zinc-100 lg:focus-visible:ring-2 lg:focus-visible:ring-zinc-900/50"
            >
              <ChevronRight className="lg:size-5" />
            </button>
          </div>
        )}
      </div>

      <div className={cn("relative -mx-6", "lg:mx-0")}>
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
          id={faixaId}
          className={cn(
            "scrollbar-hide flex snap-x snap-mandatory items-stretch gap-4 overflow-x-auto scroll-smooth pb-2",
            "lg:gap-5 lg:!px-0 lg:!scroll-pl-0",
          )}
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
                "lg:w-[calc((100%-60px)/4)] lg:snap-start xl:w-[calc((100%-80px)/5)]",
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
