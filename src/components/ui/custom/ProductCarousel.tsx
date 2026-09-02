import { useStore } from "@/contexts/StoreContext";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";
import { haptic } from "@/utils/haptic";
import React, { useRef, useState, useEffect, useCallback } from "react";
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
  const { config } = useStore();
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
    (product: Product, variantId: string | undefined, variantNames: string) => {
      onAddToCartWithVariants?.(product, variantId, variantNames);
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
        <h2 className="text-3xl font-black leading-[0.9] tracking-tighter text-zinc-950 sm:text-4xl">
          {title}
        </h2>
      </div>

      <div className="relative -mx-6">
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
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
