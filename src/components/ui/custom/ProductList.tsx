import { useState, useEffect, useRef } from 'react';
import type { Product } from '@/types';
import { ProductCard } from './ProductCard';
import { ProductCardSkeleton } from './Skeletons';
import { haptic } from '@/utils/haptic';

interface ProductListProps {
    products: Product[];
    isLoading: boolean;
    favorites: string[];
    onToggleFavorite: (product: Product) => void;
    onProductClick: (productId: string) => void;
    onAddToCart?: (product: Product) => void;
    onQuickBuy?: (product: Product) => void;
}

export function ProductList({
    products,
    isLoading,
    favorites,
    onToggleFavorite,
    onProductClick,
    onAddToCart,
    onQuickBuy
}: ProductListProps) {
    const [visibleCount, setVisibleCount] = useState(8);
    const observerTarget = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && visibleCount < products.length) {
                    setVisibleCount(prev => Math.min(prev + 8, products.length));
                }
            },
            { threshold: 0.1, rootMargin: '200px' }
        );

        if (observerTarget.current) {
            observer.observe(observerTarget.current);
        }

        return () => observer.disconnect();
    }, [visibleCount, products.length]);

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
                    <div
                        key={product.id}
                        style={{
                            animationDelay: `${(index % 8) * 50}ms`,
                            animationFillMode: 'both'
                        }}
                        className="animate-fade-in"
                    >
                        <ProductCard
                            product={product}
                            isFavorite={favorites.includes(product.id)}
                            onToggleFavorite={(e) => {
                                e.stopPropagation();
                                haptic.medium();
                                onToggleFavorite(product);
                            }}
                            onClick={() => {
                                haptic.light();
                                onProductClick(product.id);
                            }}
                            onAddToCart={(e) => {
                                e.stopPropagation();
                                haptic.success();
                                onAddToCart?.(product);
                            }}
                            onQuickBuy={(e) => {
                                e.stopPropagation();
                                haptic.success();
                                onQuickBuy?.(product);
                            }}
                        />
                    </div>
                ))}
            </div>

            {visibleCount < products.length && (
                <div ref={observerTarget} className="h-20 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-zinc-900 border-t-transparent rounded-full animate-spin" />
                </div>
            )}
        </div>
    );
}
