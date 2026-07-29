import { cn } from "@/lib/utils";
import useEmblaCarousel from "embla-carousel-react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type React from "react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

export interface KpiCardConfig {
  id?: string;
  label: string;
  value: string | number;
  subValue?: string;
  icon: LucideIcon;
  accent?: string; // Tailwind class for icon color, e.g., 'text-emerald-500'
  iconClass?: string; // Override icon class
  iconBg?: string; // Tailwind class for icon background, e.g., 'bg-emerald-500/10'
  hoverBorder?: string; // Custom hover border class
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
  isCompact = false,
}: {
  readonly stat: KpiCardConfig;
  readonly index: number;
  readonly isCompact?: boolean;
}) {
  const Icon = stat.icon;

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -3, scale: 1.015 }}
      className={cn(
        "bg-zinc-950 bg-gradient-to-br from-zinc-900/50 to-zinc-950/80 border border-white/[0.04] shadow-2xl relative group transition-colors duration-300 w-full select-none cursor-default flex",
        isCompact
          ? "flex-row items-center justify-between p-3 rounded-xl min-h-[64px] sm:flex-col sm:items-stretch sm:justify-start sm:p-5 sm:rounded-[1.5rem] sm:min-h-[128px]"
          : "flex-col p-5 rounded-[1.5rem] min-h-[128px]",
        stat.hoverBorder ||
          "hover:border-admin-gold/30 hover:shadow-[0_0_30px_rgba(212,175,55,0.06)]",
      )}
      style={{ transform: "translateZ(0)", backfaceVisibility: "hidden" }}
    >
      <div
        className={cn(
          "flex items-center gap-2.5 sm:gap-3",
          isCompact ? "mb-0 sm:mb-4" : "mb-4",
        )}
      >
        <div
          className={cn(
            "flex items-center justify-center border border-white/5 shadow-inner bg-zinc-950 transition-colors duration-300 group-hover:border-admin-gold/20",
            isCompact
              ? "w-8 h-8 rounded-lg sm:w-10 sm:h-10 sm:rounded-xl"
              : "w-10 h-10 rounded-xl",
            stat.iconBg || "bg-zinc-950 border-white/5",
            stat.accent,
          )}
        >
          <Icon
            className={cn(
              "flex-shrink-0 transition-transform duration-500 group-hover:scale-110",
              isCompact ? "w-3.5 h-3.5 sm:w-4 sm:h-4" : "w-4 h-4",
              stat.iconClass,
            )}
          />
        </div>
        <p className="text-[9px] font-black uppercase leading-tight tracking-[0.2em] text-zinc-500 transition-colors duration-300 group-hover:text-zinc-400 sm:text-[11px]">
          {stat.label}
        </p>
      </div>

      <div
        className={cn(
          "relative z-10 flex flex-col xl:flex-row xl:items-baseline xl:gap-2",
          isCompact ? "items-end sm:items-start gap-0.5 sm:gap-1" : "gap-1",
        )}
      >
        <h3
          className={cn(
            "whitespace-nowrap font-black leading-none tracking-tighter text-white transition-colors duration-300 group-hover:text-admin-gold sm:text-2xl",
            isCompact ? "text-base sm:text-xl" : "text-xl sm:text-2xl",
          )}
        >
          {stat.value}
        </h3>
        {stat.subValue && (
          <p
            className={cn(
              "truncate font-bold uppercase tracking-tight text-zinc-600 opacity-80 transition-colors duration-300 group-hover:text-zinc-500 xl:whitespace-nowrap",
              isCompact ? "text-[8px] sm:text-[9px]" : "text-[9px]",
            )}
          >
            {stat.subValue}
          </p>
        )}
      </div>

      {stat.content && (
        <div className={cn(isCompact && "hidden sm:block")}>{stat.content}</div>
      )}

      {stat.footer && (
        <div
          className={cn(
            "mt-4 border-t border-white/5 pt-3 text-[9px] font-bold uppercase tracking-wider text-zinc-600 transition-colors duration-300 group-hover:text-zinc-500",
            isCompact && "hidden sm:block",
          )}
        >
          {stat.footer}
        </div>
      )}
    </motion.div>
  );
});

const KpiSkeleton = memo(function KpiSkeleton({
  index,
  isCompact = false,
}: {
  readonly index: number;
  readonly isCompact?: boolean;
}) {
  return (
    <div
      key={`skeleton-${index}`}
      className={cn(
        "flex w-full cursor-default select-none border border-white/[0.04] bg-zinc-950 bg-gradient-to-br from-zinc-900/50 to-zinc-950/80 shadow-2xl transition-all duration-300",
        isCompact
          ? "flex-row items-center justify-between p-3 rounded-xl min-h-[64px] sm:flex-col sm:items-stretch sm:justify-start sm:p-5 sm:rounded-3xl sm:min-h-[128px]"
          : "flex-col p-5 rounded-3xl min-h-[128px]",
      )}
      style={{ transform: "translateZ(0)", backfaceVisibility: "hidden" }}
    >
      <div
        className={cn(
          "flex items-center gap-2.5 sm:gap-3",
          isCompact ? "mb-0 sm:mb-4" : "mb-4",
        )}
      >
        <div
          className={cn(
            "animate-pulse border border-white/5 bg-white/5",
            isCompact
              ? "size-8 rounded-lg sm:size-10 sm:rounded-xl"
              : "size-10 rounded-xl",
          )}
        />
        <div className="h-3 w-16 animate-pulse rounded bg-white/5 sm:w-20" />
      </div>
      <div
        className={cn(
          "flex flex-col gap-1 sm:gap-1.5 xl:flex-row xl:items-baseline xl:gap-2",
          isCompact ? "items-end sm:items-start" : "items-start",
        )}
      >
        <div className="h-4 w-16 animate-pulse rounded bg-white/5 sm:h-6 sm:w-24" />
        <div className="h-2.5 w-12 animate-pulse rounded bg-white/5 opacity-60 sm:h-3 sm:w-16" />
      </div>
    </div>
  );
});

export const AdminKpiCarousel = memo(function AdminKpiCarousel({
  cards,
  loading = false,
  title = "Métricas Principais",
  autoplayInterval = 4000,
  active = true,
}: AdminKpiCarouselProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [scrollSnaps, setScrollSnaps] = useState<number[]>([]);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(true);
  const [manualTriggerKey, setManualTriggerKey] = useState(0);

  const triggerManualInteraction = useCallback(() => {
    setManualTriggerKey((prev) => prev + 1);
  }, []);

  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: false, // Disabling loop to prevent slide duplicate key errors in viewport fits
    align: "start",
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
    emblaApi.on("select", onSelect);
    emblaApi.on("init", onInit);
    emblaApi.on("reInit", onInit);

    onInit();

    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("init", onInit);
      emblaApi.off("reInit", onInit);
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
    }
    triggerReInit();
  }, [active, emblaApi, cards, loading]);

  // Autoplay effect - pauses when tab is in background (Visibility API) or when panel view is inactive
  useEffect(() => {
    if (!emblaApi || !active || isExpanded || isHovered || loading) return;

    let interval: ReturnType<typeof setInterval> | undefined;

    const startAutoplay = () => {
      if (document.visibilityState === "visible") {
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
      if (document.visibilityState === "visible") {
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
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    emblaApi,
    active,
    isExpanded,
    isHovered,
    autoplayInterval,
    loading,
    manualTriggerKey,
  ]);

  const displayCards = useMemo(() => {
    return cards;
  }, [cards]);

  return (
    <div className="w-full space-y-4">
      {/* Control Bar */}
      <div className="flex select-none items-center justify-between px-0">
        <div className="flex items-center gap-2">
          <span className="size-1.5 animate-pulse rounded-full bg-admin-gold" />
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
            {title}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Navigation dot indicators - only in carousel mode */}
          {!isExpanded && !loading && scrollSnaps.length > 1 && (
            <div className="flex items-center gap-1.5">
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
                    activeIndex === i ? "bg-admin-gold w-4" : "bg-white/10 w-1",
                  )}
                  title={`Ir para snap ${i + 1}`}
                />
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1.5 rounded-xl border border-white/5 bg-white/5 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-zinc-400 transition-all hover:border-white/10 hover:bg-white/10 hover:text-white"
          >
            {isExpanded ? (
              <>
                <Minimize2 className="size-3 text-admin-gold" />
                <span>Carrossel</span>
              </>
            ) : (
              <>
                <Maximize2 className="size-3 text-admin-gold" />
                <span>Expandir</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Cards View */}
      {isExpanded ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-4">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <KpiSkeleton
                  key={`skeleton-expanded-${i}`}
                  index={i}
                  isCompact={false}
                />
              ))
            : displayCards.map((stat, index) => (
                <KpiCard
                  key={stat.id || stat.label || index}
                  stat={stat}
                  index={index}
                  isCompact={false}
                />
              ))}
        </div>
      ) : (
        <div
          className="group/carousel relative w-full max-w-full overflow-x-hidden"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div className="overflow-hidden" ref={emblaRef}>
            <div
              className="-ml-3 flex sm:-ml-6"
              style={{ touchAction: "pan-y" }}
            >
              {loading
                ? Array.from({ length: displayCards.length || 4 }).map(
                    (_, i) => (
                      <div
                        key={`loading-skeleton-${i}`}
                        className="min-w-0 flex-[0_0_100%] pl-3 sm:flex-[0_0_50%] sm:pl-6 md:flex-[0_0_33.333%] lg:flex-[0_0_25%]"
                      >
                        <KpiSkeleton index={i} isCompact={true} />
                      </div>
                    ),
                  )
                : displayCards.map((stat, index) => (
                    <div
                      key={stat.id || stat.label || index}
                      className="min-w-0 flex-[0_0_100%] pl-3 sm:flex-[0_0_50%] sm:pl-6 md:flex-[0_0_33.333%] lg:flex-[0_0_25%]"
                    >
                      <KpiCard stat={stat} index={index} isCompact={true} />
                    </div>
                  ))}
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
                  "absolute left-0 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-zinc-950/90 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white opacity-0 group-hover/carousel:opacity-100 transition-all duration-300 shadow-xl z-20 hover:border-admin-gold/30 active:scale-95",
                  !canScrollPrev && "opacity-0 pointer-events-none",
                )}
                title="Anterior"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                disabled={!canScrollNext}
                onClick={() => {
                  triggerManualInteraction();
                  emblaApi?.scrollNext();
                }}
                className={cn(
                  "absolute right-0 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-zinc-950/90 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white opacity-0 group-hover/carousel:opacity-100 transition-all duration-300 shadow-xl z-20 hover:border-admin-gold/30 active:scale-95",
                  !canScrollNext && "opacity-0 pointer-events-none",
                )}
                title="Próximo"
              >
                <ChevronRight className="size-4" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
});
