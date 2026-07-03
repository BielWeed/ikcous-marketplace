import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Maximize2, Minimize2, ChevronLeft, ChevronRight } from 'lucide-react';
import useEmblaCarousel from 'embla-carousel-react';
import type { LucideIcon } from 'lucide-react';

export interface KpiCardConfig {
    id?: string;
    label: string;
    value: string | number;
    subValue?: string;
    icon: LucideIcon;
    accent?: string;       // Tailwind class for icon color, e.g., 'text-emerald-500'
    iconClass?: string;    // Override icon class
    iconBg?: string;       // Tailwind class for icon background, e.g., 'bg-emerald-500/10'
    hoverBorder?: string;  // Custom hover border class
    content?: React.ReactNode;
    footer?: string | React.ReactNode;
}

interface AdminKpiCarouselProps {
    readonly cards: readonly KpiCardConfig[];
    readonly loading?: boolean;
    readonly title?: string;
    readonly autoplayInterval?: number;
}

export function AdminKpiCarousel({
    cards,
    loading = false,
    title = 'Métricas Principais',
    autoplayInterval = 4000
}: AdminKpiCarouselProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [isHovered, setIsHovered] = useState(false);

    const [emblaRef, emblaApi] = useEmblaCarousel({
        loop: true,
        align: 'start',
        slidesToScroll: 1,
    });

    const onSelect = useCallback(() => {
        if (!emblaApi) return;
        setActiveIndex(emblaApi.selectedScrollSnap());
    }, [emblaApi]);

    useEffect(() => {
        if (!emblaApi) return;
        emblaApi.on('select', onSelect);
        onSelect();
        return () => {
            emblaApi.off('select', onSelect);
        };
    }, [emblaApi, onSelect]);

    // Autoplay effect
    useEffect(() => {
        if (!emblaApi || isExpanded || isHovered || loading) return;

        const interval = setInterval(() => {
            emblaApi.scrollNext();
        }, autoplayInterval);

        return () => clearInterval(interval);
    }, [emblaApi, isExpanded, isHovered, autoplayInterval, loading]);

    const renderCard = useCallback((stat: KpiCardConfig, index: number) => {
        const Icon = stat.icon;
        
        return (
            <div 
                key={stat.id || stat.label || index} 
                className={cn(
                    "bg-zinc-950 bg-gradient-to-br from-zinc-900/50 to-zinc-950/80 p-5 rounded-[1.5rem] flex flex-col border border-white/[0.04] shadow-2xl relative group transition-all duration-500 w-full",
                    stat.hoverBorder || "hover:border-admin-gold/30 hover:shadow-[0_0_30px_rgba(212,175,55,0.05)]"
                )} 
                style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}
            >
                <div className="flex items-center gap-3 mb-4">
                    <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center border border-white/5 shadow-inner bg-zinc-950",
                        stat.iconBg || "bg-zinc-950 border-white/5",
                        stat.accent
                    )}>
                        <Icon className={cn("w-4 h-4 flex-shrink-0", stat.iconClass)} />
                    </div>
                    <p className="text-[10px] sm:text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500 leading-tight">
                        {stat.label}
                    </p>
                </div>
                
                <div className="flex flex-col xl:flex-row xl:items-baseline gap-1 xl:gap-2 relative z-10">
                    <h3 className="text-xl sm:text-2xl font-black tracking-tighter text-white leading-none whitespace-nowrap">
                        {stat.value}
                    </h3>
                    {stat.subValue && (
                        <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-tight truncate xl:whitespace-nowrap opacity-80">
                            {stat.subValue}
                        </p>
                    )}
                </div>

                {stat.content}

                {stat.footer && (
                    <div className="mt-4 pt-3 border-t border-white/5 text-[9px] font-bold text-zinc-600 uppercase tracking-wider">
                        {stat.footer}
                    </div>
                )}
            </div>
        );
    }, []);

    const renderSkeleton = useCallback((index: number) => {
        return (
            <div 
                key={`skeleton-${index}`} 
                className="bg-zinc-950 bg-gradient-to-br from-zinc-900/50 to-zinc-950/80 p-5 rounded-[1.5rem] flex flex-col border border-white/[0.04] shadow-2xl space-y-3 sm:space-y-4 w-full" 
                style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}
            >
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/5 animate-pulse" />
                    <div className="h-3 w-20 bg-white/5 rounded animate-pulse" />
                </div>
                <div className="flex flex-col xl:flex-row xl:items-baseline gap-1 xl:gap-2">
                    <div className="h-8 w-24 bg-white/5 rounded animate-pulse" />
                    <div className="h-3 w-16 bg-white/5 rounded animate-pulse" />
                </div>
            </div>
        );
    }, []);

    const displayCards = useMemo(() => {
        return cards;
    }, [cards]);

    return (
        <div className="w-full space-y-4">
            {/* Control Bar */}
            <div className="px-0 flex items-center justify-between select-none">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-admin-gold animate-pulse" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">{title}</span>
                </div>
                <div className="flex items-center gap-3">
                    {/* Navigation dot indicators - only in carousel mode */}
                    {!isExpanded && !loading && (
                        <div className="flex gap-1.5 items-center">
                            {displayCards.map((_, i) => (
                                <button
                                    key={i}
                                    type="button"
                                    onClick={() => emblaApi?.scrollTo(i)}
                                    className={cn(
                                        "h-1 rounded-full transition-all duration-300",
                                        activeIndex === i ? "bg-admin-gold w-4" : "bg-white/10 w-1"
                                    )}
                                    title={`Ir para card ${i + 1}`}
                                />
                            ))}
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 hover:bg-white/10 text-zinc-400 hover:text-white transition-all text-[9px] font-black uppercase tracking-wider"
                    >
                        {isExpanded ? (
                            <>
                                <Minimize2 className="w-3 h-3 text-admin-gold" />
                                <span>Carrossel</span>
                            </>
                        ) : (
                            <>
                                <Maximize2 className="w-3 h-3 text-admin-gold" />
                                <span>Expandir</span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Main Cards View */}
            {isExpanded ? (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
                    {loading ? (
                        Array.from({ length: 4 }).map((_, i) => renderSkeleton(i))
                    ) : (
                        displayCards.map((stat, index) => renderCard(stat, index))
                    )}
                </div>
            ) : (
                <div 
                    className="relative group/carousel"
                    onMouseEnter={() => setIsHovered(true)}
                    onMouseLeave={() => setIsHovered(false)}
                >
                    {loading ? (
                        <div className="flex -ml-3 sm:-ml-6 overflow-hidden">
                            {Array.from({ length: 2 }).map((_, i) => (
                                <div key={i} className="flex-[0_0_100%] sm:flex-[0_0_50%] min-w-0 pl-3 sm:pl-6">
                                    {renderSkeleton(i)}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <>
                            <div className="overflow-hidden" ref={emblaRef}>
                                <div className="flex -ml-3 sm:-ml-6">
                                    {displayCards.map((stat, index) => (
                                        <div key={stat.id || stat.label || index} className="flex-[0_0_100%] sm:flex-[0_0_50%] md:flex-[0_0_33.333%] lg:flex-[0_0_25%] min-w-0 pl-3 sm:pl-6">
                                            {renderCard(stat, index)}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Carousel Navigation Arrows - desktop only */}
                            {displayCards.length > 2 && (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => emblaApi?.scrollPrev()}
                                        className="absolute -left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-zinc-950/90 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white opacity-0 group-hover/carousel:opacity-100 transition-opacity duration-300 shadow-xl z-20 hover:border-admin-gold/30 active:scale-95"
                                        title="Anterior"
                                    >
                                        <ChevronLeft className="w-4 h-4" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => emblaApi?.scrollNext()}
                                        className="absolute -right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-zinc-950/90 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white opacity-0 group-hover/carousel:opacity-100 transition-opacity duration-300 shadow-xl z-20 hover:border-admin-gold/30 active:scale-95"
                                        title="Próximo"
                                    >
                                        <ChevronRight className="w-4 h-4" />
                                    </button>
                                </>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
