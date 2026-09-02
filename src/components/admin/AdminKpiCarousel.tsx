import { cn } from "@/lib/utils";
import useEmblaCarousel from "embla-carousel-react";
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

/**
 * Card COMPACTO (pedido do Gabriel de 02/09 à tarde: a faixa de métricas
 * ocupava um espaço enorme — card vertical de 128px de altura mínima para
 * mostrar UM número, com o carrossel mostrando só 4 por vez no desktop).
 * O dono virou a versão em grade e decidiu: carrossel fica, card encolhe.
 * Layout horizontal (ícone + rótulo em cima, valor grande na linha de
 * baixo, ~64px de altura) e slides mais densos — mais métricas visíveis
 * na mesma largura, metade da altura.
 */
const KpiCard = memo(function KpiCard({
  stat,
}: {
  readonly stat: KpiCardConfig;
}) {
  const Icon = stat.icon;
  const temAlturaFixa = !stat.content && !stat.footer;

  return (
    <div
      className={cn(
        // Altura FIXA nas métricas simples (Pedidos/Produtos/Clientes/
        // Cupons/Dashboard): a faixa fica idêntica em qualquer tela — era
        // isto que o dono pediu ("padronizada, uma não maior que a outra").
        // Card com conteúdo extra (barra de progresso das Perguntas,
        // rodapé dos Cupons) cresce o mínimo necessário com overflow
        // escondido para nunca romper o desenho.
        "group relative flex select-none items-center gap-2.5 overflow-hidden rounded-2xl border border-white/[0.04] bg-zinc-950 bg-gradient-to-br from-zinc-900/50 to-zinc-950/80 p-3 shadow-lg transition-colors duration-300 sm:gap-3",
        temAlturaFixa ? "h-16 sm:h-[68px]" : "min-h-16 sm:min-h-[68px]",
        stat.hoverBorder ||
          "hover:border-admin-gold/30 hover:shadow-[0_0_30px_rgba(212,175,55,0.06)]",
      )}
    >
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-zinc-950 shadow-inner transition-colors duration-300 group-hover:border-admin-gold/20",
          stat.accent,
        )}
      >
        <Icon
          className={cn(
            "size-4 shrink-0 transition-transform duration-500 group-hover:scale-110",
            stat.iconClass,
          )}
        />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[8.5px] font-black uppercase leading-none tracking-[0.18em] text-zinc-500 transition-colors duration-300 group-hover:text-zinc-400">
          {stat.label}
        </p>
        {/* Valor na linha INTEIRA (pedido do Gabriel, 02/09: o dado completo
            não cabia — "R$ 1.31... / CAPITAL LIQ..." era valor e subtítulo
            brigando pela mesma linha). Empilhado em 3 linhas dentro da
            mesma altura: rótulo / valor / subtítulo. */}
        <h3
          className={cn(
            "truncate font-black leading-tight tracking-tighter text-white transition-colors duration-300 group-hover:text-admin-gold sm:text-lg",
            stat.subValue || stat.footer ? "text-base" : "text-lg",
          )}
        >
          {stat.value}
        </h3>
        {stat.subValue && (
          <p className="truncate text-[9px] font-bold uppercase leading-none tracking-tight text-zinc-600 opacity-80 transition-colors duration-300 group-hover:text-zinc-500">
            {stat.subValue}
          </p>
        )}
        {stat.footer && (
          <p className="truncate text-[8.5px] font-bold uppercase leading-none tracking-wider text-zinc-600 transition-colors duration-300 group-hover:text-zinc-500">
            {stat.footer}
          </p>
        )}
        {stat.content}
      </div>
    </div>
  );
});

const KpiSkeleton = memo(function KpiSkeleton() {
  return (
    <div className="flex h-16 select-none items-center gap-3 rounded-2xl border border-white/[0.04] bg-zinc-950 bg-gradient-to-br from-zinc-900/50 to-zinc-950/80 p-3 shadow-lg sm:h-[68px]">
      <div className="size-9 animate-pulse rounded-xl bg-white/5" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-2.5 w-20 animate-pulse rounded bg-white/5" />
        <div className="h-4 w-14 animate-pulse rounded bg-white/5" />
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
    <div className="w-full space-y-2.5">
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
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <KpiSkeleton key={`skeleton-expanded-${i}`} />
              ))
            : displayCards.map((stat, index) => (
                <KpiCard key={stat.id || stat.label || index} stat={stat} />
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
              className="-ml-2.5 flex sm:-ml-3"
              style={{ touchAction: "pan-y" }}
            >
              {/* Slides densos (pedido do Gabriel: "cabe 2 barrinha de
                  métrica por exibição" — eram 100%/50%/33%/25%, com o
                  celular mostrando UM card por vez): agora são 2 por vez no
                  celular, 3 no tablet, 4 no desktop e 5 no telão. */}
              {loading
                ? Array.from({ length: displayCards.length || 4 }).map(
                    (_, i) => (
                      <div
                        key={`loading-skeleton-${i}`}
                        className="min-w-0 flex-[0_0_50%] pl-2.5 sm:flex-[0_0_33.333%] sm:pl-3 lg:flex-[0_0_25%] xl:flex-[0_0_20%]"
                      >
                        <KpiSkeleton />
                      </div>
                    ),
                  )
                : displayCards.map((stat, index) => (
                    <div
                      key={stat.id || stat.label || index}
                      className="min-w-0 flex-[0_0_50%] pl-2.5 sm:flex-[0_0_33.333%] sm:pl-3 lg:flex-[0_0_25%] xl:flex-[0_0_20%]"
                    >
                      <KpiCard stat={stat} />
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
