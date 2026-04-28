import { useRef, useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { Product } from '@/types';
import { ProductCard } from './ProductCard';
import { haptic } from '@/utils/haptic';

interface ProductCarouselProps {
    title: string;
    subtitle?: string;
    products: Product[];
    favorites: string[];
    onToggleFavorite: (product: Product) => void;
    onProductClick: (productId: string) => void;
    onAddToCart?: (product: Product) => void;
    onQuickBuy?: (product: Product) => void;
    icon?: React.ReactNode;
    accentColor?: string;
    className?: string;
}

export function ProductCarousel({
    title,
    subtitle,
    products,
    favorites,
    onToggleFavorite,
    onProductClick,
    onAddToCart,
    onQuickBuy,
    icon,
    accentColor = "amber",
    className
}: ProductCarouselProps) {
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

        container.addEventListener('scroll', updateVignettes, { passive: true });
        updateVignettes();

        return () => {
            container.removeEventListener('scroll', updateVignettes);
            resizeObserver.disconnect();
        };
    }, [products.length]);

    if (products.length === 0) return null;

    return (
        <div className={cn("px-5 sm:px-6 py-4 overflow-hidden", className)}>
            <div className="flex flex-col mb-6">
                {subtitle && (
                    <div className="flex items-center gap-2 mb-1.5">
                        {icon}
                        <span className={cn(
                            "text-[10px] font-black uppercase tracking-[0.3em]",
                            `text-${accentColor}-600`
                        )}>
                            {subtitle}
                        </span>
                    </div>
                )}
                <h2 className="text-3xl sm:text-4xl font-black tracking-tighter text-zinc-950 leading-[0.9]">{title}</h2>
            </div>

            <div className="relative -mx-6">
                {/* Dynamic Vignettes - Improved White Gradient */}
                <div className={cn(
                    "absolute left-0 top-0 bottom-4 w-8 bg-gradient-to-r from-white/90 via-white/40 to-transparent z-10 pointer-events-none transition-opacity duration-300",
                    showLeftVignette ? "opacity-100" : "opacity-0"
                )} />
                <div className={cn(
                    "absolute right-0 top-0 bottom-4 w-8 bg-gradient-to-l from-white/90 via-white/40 to-transparent z-10 pointer-events-none transition-opacity duration-300",
                    showRightVignette ? "opacity-100" : "opacity-0"
                )} />

                <div
                    ref={scrollContainerRef}
                    className="flex gap-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory scroll-smooth pb-2"
                    style={{
                        paddingLeft: '24px',
                        paddingRight: '24px',
                        scrollPaddingLeft: '24px'
                    }}
                >
                    {products.map((product, index) => (
                        <div
                            key={product.id}
                            className={cn(
                                "flex-shrink-0 w-[260px] py-2 h-full flex flex-col",
                                index === 0 ? "snap-start" : "snap-center"
                            )}
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
                                    onAddToCart?.(product);
                                }}
                                onQuickBuy={(e) => {
                                    e.stopPropagation();
                                    onQuickBuy?.(product);
                                }}
                                priority={index < 3}
                            />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
