import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import type { Product } from '@/types';
import { ProductCard } from './ProductCard';
import { ProductCardSkeleton } from './Skeletons';
import { haptic } from '@/utils/haptic';
import { usePrefetchOnHover } from '@/hooks/usePrefetchOnHover';
import { useStore } from '@/contexts/StoreContext';

interface ProductListProps {
    products: Product[];
    isLoading: boolean;
    favorites: string[];
    onToggleFavorite: (product: Product) => void;
    onProductClick: (productId: string) => void;
    onAddToCart?: (product: Product) => void;
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
    onQuickBuy,
    selectedProductId
}: ProductListProps) {
    const { config } = useStore();
    const { prefetchView } = usePrefetchOnHover();
    const [visibleCount, setVisibleCount] = useState(12);
    const observerRef = useRef<IntersectionObserver | null>(null);

    useEffect(() => {
        setVisibleCount(12);
    }, [products]);

    const observerTargetRef = useCallback((node: HTMLDivElement | null) => {
        if (observerRef.current) {
            observerRef.current.disconnect();
            observerRef.current = null;
        }

        if (node) {
            const mainContainer = node.closest('main') || null;
            const observer = new IntersectionObserver(
                (entries) => {
                    if (entries[0].isIntersecting) {
                        setVisibleCount(prev => Math.min(prev + 12, products.length));
                    }
                },
                {
                    root: mainContainer,
                    threshold: 0.1,
                    rootMargin: '300px'
                }
            );
            observer.observe(node);
            observerRef.current = observer;
        }
    }, [products.length]);

    useEffect(() => {
        return () => {
            if (observerRef.current) {
                observerRef.current.disconnect();
            }
        };
    }, []);

    const handleToggleFavorite = useCallback((product: Product) => {
        haptic.medium();
        onToggleFavorite(product);
    }, [onToggleFavorite]);

    const handleProductClick = useCallback((id: string) => {
        haptic.light();
        onProductClick(id);
    }, [onProductClick]);

    const handleAddToCart = useCallback((product: Product) => {
        haptic.success();
        onAddToCart?.(product);
    }, [onAddToCart]);

    const handleQuickBuy = useCallback((product: Product) => {
        haptic.success();
        onQuickBuy?.(product);
    }, [onQuickBuy]);

    const handlePrefetchProductDetail = useCallback(() => {
        prefetchView('product-detail');
    }, [prefetchView]);

    if (isLoading) {
        return (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {[1, 2, 3, 4, 5, 6, 7, 8].map(i => <ProductCardSkeleton key={i} />)}
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {products.slice(0, visibleCount).map((product, index) => (
                    <motion.div
                        key={product.id}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{
                            type: 'spring',
                            stiffness: 300,
                            damping: 30
                        }}
                        className="h-full flex flex-col"
                    >
                        <ProductCard
                            product={product}
                            isFavorite={favorites.includes(product.id)}
                            onToggleFavorite={handleToggleFavorite}
                            onClick={handleProductClick}
                            onAddToCart={handleAddToCart}
                            onQuickBuy={handleQuickBuy}
                            onMouseEnter={handlePrefetchProductDetail}
                            onTouchStart={handlePrefetchProductDetail}
                            priority={index < 4}
                            isEligibleForFreeShipping={config.freeShippingMin > 0}
                            selectedProductId={selectedProductId}
                        />
                    </motion.div>
                ))}
            </div>

            {visibleCount < products.length && (
                <div ref={observerTargetRef} className="h-20 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-zinc-900 border-t-transparent rounded-full animate-spin" />
                </div>
            )}
        </div>
    );
});
