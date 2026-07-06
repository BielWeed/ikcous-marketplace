import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { cn } from '@/lib/utils';
import { Maximize2, Minimize2, ChevronLeft, ChevronRight } from 'lucide-react';
import useEmblaCarousel from 'embla-carousel-react';
import type { LucideIcon } from 'lucide-react';
import { motion } from 'framer-motion';

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
    readonly active?: boolean;
}

const KpiCard = memo(function KpiCard({
    stat,
    index
}: {
    readonly stat: KpiCardConfig;
    readonly index: number;
}) {
    const Icon = stat.icon;
    
    return (
        <motion.div 
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1], delay: index * 0.04 }}
            whileHover={{ y: -3, scale: 1.015 }}
            className={cn(
                "bg-zinc-950 bg-gradient-to-br from-zinc-900/50 to-zinc-950/80 p-5 rounded-[1.5rem] flex flex-col border border-white/[0.04] shadow-2xl relative group transition-colors duration-300 w-full select-none cursor-default",
                stat.hoverBorder || "hover:border-admin-gold/30 hover:shadow-[0_0_30px_rgba(212,175,55,0.06)]"
            )} 
            style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}
        >
            <div className="flex items-center gap-3 mb-4">
                <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center border border-white/5 shadow-inner bg-zinc-950 transition-colors duration-300 group-hover:border-admin-gold/20",
                    stat.iconBg || "bg-zinc-950 border-white/5",
                    stat.accent
                )}>
                    <Icon className={cn("w-4 h-4 flex-shrink-0 transition-transform duration-500 group-hover:scale-110", stat.iconClass)} />
                </div>
                <p className="text-[10px] sm:text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500 leading-tight transition-colors duration-300 group-hover:text-zinc-400">
                    {stat.label}
                </p>
            </div>
            
            <div className="flex flex-col xl:flex-row xl:items-baseline gap-1 xl:gap-2 relative z-10">
                <h3 className="text-xl sm:text-2xl font-black tracking-tighter text-white leading-none whitespace-nowrap transition-colors duration-300 group-hover:text-admin-gold">
                    {stat.value}
                </h3>
                {stat.subValue && (
                    <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-tight truncate xl:whitespace-nowrap opacity-80 transition-colors duration-300 group-hover:text-zinc-500">
                        {stat.subValue}
                    </p>
                )}
            </div>

            {stat.content}

            {stat.footer && (
                <div className="mt-4 pt-3 border-t border-white/5 text-[9px] font-bold text-zinc-600 uppercase tracking-wider transition-colors duration-300 group-hover:text-zinc-500">
                    {stat.footer}
                </div>
            )}
        </motion.div>
    );
});

const KpiSkeleton = memo(function KpiSkeleton({ index }: { readonly index: number }) {
    return (
        <div 
            key={`skeleton-${index}`}
            className="bg-zinc-950 bg-gradient-to-br from-zinc-900/50 to-zinc-950/80 p-5 rounded-[1.5rem] flex flex-col border border-white/[0.04] shadow-2xl w-full cursor-default select-none min-h-[128px]" 
            style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}
        >
            <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-white/5 animate-pulse border border-white/5" />
                <div className="h-3 w-20 bg-white/5 rounded animate-pulse" />
            </div>
            <div className="flex flex-col xl:flex-row xl:items-baseline gap-1.5 xl:gap-2">
                <div className="h-6 w-24 bg-white/5 rounded animate-pulse" />
                <div className="h-3 w-16 bg-white/5 rounded animate-pulse opacity-60" />
            </div>
        </div>
    );
});

export const AdminKpiCarousel = memo(function AdminKpiCarousel({
    cards,
    loading = false,
    title = 'Métricas Principais',
    autoplayInterval = 4000,
    active = true
}: AdminKpiCarouselProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [isHovered, setIsHovered] = useState(false);
    const [scrollSnaps, setScrollSnaps] = useState<number[]>([]);
    const [canScrollPrev, setCanScrollPrev] = useState(false);
    const [canScrollNext, setCanScrollNext] = useState(true);
    const [manualTriggerKey, setManualTriggerKey] = useState(0);

    const triggerManualInteraction = useCallback(() => {
        setManualTriggerKey(prev => prev + 1);
    }, []);

    const [emblaRef, emblaApi] = useEmblaCarousel({
        loop: false, // Disabling loop to prevent slide duplicate key errors in viewport fits
        align: 'start',
        slidesToScroll: 1,
    });

    const onSelect = useCallback(() => {
        if (!emblaApi) return;
        setActiveIndex(emblaApi.selectedScrollSnap());
        setCanScrollPrev(emblaApi.canScrollPrev());
        setCanScrollNext(emblaApi.canScrollNext());
    }, [emblaApi]);

    const onInit = useCallback(() => {
        if (!emblaApi) return;
        setScrollSnaps(emblaApi.scrollSnapList());
        onSelect();
    }, [emblaApi, onSelect]);

    useEffect(() => {
        if (!emblaApi) return;
        emblaApi.on('select', onSelect);
        emblaApi.on('init', onInit);
        emblaApi.on('reInit', onInit);
        
        onInit();
        
        return () => {
            emblaApi.off('select', onSelect);
            emblaApi.off('init', onInit);
            emblaApi.off('reInit', onInit);
        };
    }, [emblaApi, onSelect, onInit]);

    // Recalcula dimensões do carrossel quando a aba administrativa ganha foco, cards mudam ou carregamento finaliza
    useEffect(() => {
        if (!emblaApi) return;

        const triggerReInit = () => {
            requestAnimationFrame(() => {
                if (emblaApi) {
                    emblaApi.reInit();
                }
            });
        };

        if (active) {
            const timer = setTimeout(triggerReInit, 50);
            return () => clearTimeout(timer);
        } else {
            triggerReInit();
        }
    }, [active, emblaApi, cards, loading]);

    // Autoplay effect - pauses when tab is in background (Visibility API) or when panel view is inactive
    useEffect(() => {
        if (!emblaApi || !active || isExpanded || isHovered || loading) return;

        let interval: ReturnType<typeof setInterval> | undefined;

        const startAutoplay = () => {
            if (document.visibilityState === 'visible') {
                interval = setInterval(() => {
                    if (emblaApi.canScrollNext()) {
                        emblaApi.scrollNext();
                    } else {
                        emblaApi.scrollTo(0); // Manual wrap-around for linear mode
                    }
                }, autoplayInterval);
            }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                if (!interval) {
                    startAutoplay();
                }
            } else {
                if (interval) {
                    clearInterval(interval);
                    interval = undefined;
                }
            }
        };

        startAutoplay();
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            if (interval) clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [emblaApi, active, isExpanded, isHovered, autoplayInterval, loading, manualTriggerKey]);

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
                    {!isExpanded && !loading && scrollSnaps.length > 1 && (
                        <div className="flex gap-1.5 items-center">
                            {scrollSnaps.map((_, i) => (
                                <button
                                    key={i}
                                    type="button"
                                    onClick={() => {
                                        triggerManualInteraction();
                                        emblaApi?.scrollTo(i);
                                    }}
                                    className={cn(
                                        "h-1 rounded-full transition-all duration-300",
                                        activeIndex === i ? "bg-admin-gold w-4" : "bg-white/10 w-1"
                                    )}
                                    title={`Ir para snap ${i + 1}`}
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
                        Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={`skeleton-expanded-${i}`} index={i} />)
                    ) : (
                        displayCards.map((stat, index) => <KpiCard key={stat.id || stat.label || index} stat={stat} index={index} />)
                    )}
                </div>
            ) : (
                <div 
                    className="relative group/carousel"
                    onMouseEnter={() => setIsHovered(true)}
                    onMouseLeave={() => setIsHovered(false)}
                >
                    <div className="overflow-hidden" ref={emblaRef}>
                        <div className="flex -ml-3 sm:-ml-6" style={{ touchAction: 'pan-y' }}>
                            {loading ? (
                                Array.from({ length: displayCards.length || 4 }).map((_, i) => (
                                    <div key={`loading-skeleton-${i}`} className="flex-[0_0_100%] sm:flex-[0_0_50%] md:flex-[0_0_33.333%] lg:flex-[0_0_25%] min-w-0 pl-3 sm:pl-6">
                                        <KpiSkeleton index={i} />
                                    </div>
                                ))
                            ) : (
                                displayCards.map((stat, index) => (
                                    <div key={stat.id || stat.label || index} className="flex-[0_0_100%] sm:flex-[0_0_50%] md:flex-[0_0_33.333%] lg:flex-[0_0_25%] min-w-0 pl-3 sm:pl-6">
                                        <KpiCard stat={stat} index={index} />
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Carousel Navigation Arrows - desktop only */}
                    {!loading && scrollSnaps.length > 1 && (
                        <>
                            <button
                                type="button"
                                disabled={!canScrollPrev}
                                onClick={() => {
                                    triggerManualInteraction();
                                    emblaApi?.scrollPrev();
                                }}
                                className={cn(
                                    "absolute -left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-zinc-950/90 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white opacity-0 group-hover/carousel:opacity-100 transition-all duration-300 shadow-xl z-20 hover:border-admin-gold/30 active:scale-95",
                                    !canScrollPrev && "opacity-0 pointer-events-none"
                                )}
                                title="Anterior"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                disabled={!canScrollNext}
                                onClick={() => {
                                    triggerManualInteraction();
                                    emblaApi?.scrollNext();
                                }}
                                className={cn(
                                    "absolute -right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-zinc-950/90 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white opacity-0 group-hover/carousel:opacity-100 transition-all duration-300 shadow-xl z-20 hover:border-admin-gold/30 active:scale-95",
                                    !canScrollNext && "opacity-0 pointer-events-none"
                                )}
                                title="Próximo"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
});
