import { useStore } from "@/contexts/StoreContext";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import type { Product } from "@/types";
import { haptic } from "@/utils/haptic";
import { motion } from "framer-motion";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { ProductCard } from "./ProductCard";
import { ProductCardSkeleton } from "./ProductCardSkeleton";

interface ProductListProps {
  products: Product[];
  isLoading: boolean;
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
  selectedProductId?: string;
}

export const ProductList = React.memo(function ProductList({
  products,
  isLoading,
  favorites,
  onToggleFavorite,
  onProductClick,
  onAddToCart,
  onAddToCartWithVariants,
  onQuickBuy,
  selectedProductId,
}: ProductListProps) {
  const { config } = useStore();
  const { prefetchView } = usePrefetchOnHover();
  const [visibleCount, setVisibleCount] = useState(12);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    setVisibleCount(12);
  }, [products]);

  const observerTargetRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }

      if (node) {
        const mainContainer = node.closest("main") || null;
        const observer = new IntersectionObserver(
          (entries) => {
            if (entries[0].isIntersecting) {
              setVisibleCount((prev) => Math.min(prev + 12, products.length));
            }
          },
          {
            root: mainContainer,
            threshold: 0.1,
            rootMargin: "300px",
          },
        );
        observer.observe(node);
        observerRef.current = observer;
      }
    },
    [products.length],
  );

  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

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
      haptic.success();
      onAddToCart?.(product);
    },
    [onAddToCart],
  );

  const handleAddToCartWithVariants = useCallback(
    (product: Product, variantId: string | undefined, variantNames: string) => {
      haptic.success();
      onAddToCartWithVariants?.(product, variantId, variantNames);
    },
    [onAddToCartWithVariants],
  );

  const handleQuickBuy = useCallback(
    (product: Product) => {
      haptic.success();
      onQuickBuy?.(product);
    },
    [onQuickBuy],
  );

  const handlePrefetchProductDetail = useCallback(() => {
    prefetchView("product-detail");
  }, [prefetchView]);

  if (isLoading) {
    return (
      // Laudo de acessibilidade 03/09, achado 12 (ajuste do revisor): UMA
      // única região de status para o grid inteiro — o skeleton em si nunca
      // renderiza sozinho (a vitrine monta 8 cópias, produto 4, favoritos
      // 4) e 8 regiões aria-live idênticas enfileirariam falas repetidas
      // no leitor de tela (anti-padrão APG). Visual intacto.
      <div
        role="status"
        className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4"
      >
        <span className="sr-only">Carregando produtos</span>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
        {products.slice(0, visibleCount).map((product, index) => (
          <motion.div
            key={product.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{
              duration: 0.24,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="flex h-full flex-col"
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
              priority={index < 4}
              selectedProductId={selectedProductId}
              showRating={config.enableReviews}
            />
          </motion.div>
        ))}
      </div>

      {visibleCount < products.length && (
        <div
          ref={observerTargetRef}
          className="flex h-20 items-center justify-center"
        >
          <div className="size-6 animate-spin rounded-full border-2 border-zinc-900 border-t-transparent" />
        </div>
      )}
    </div>
  );
});
