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
 * Altura mínima ÚNICA do cartão real e do esqueleto (J2-B, rodada 1): 100px no
 * celular e 96px (`sm:min-h-24`) de 640px em diante. O cartão real mede de
 * ~72 a ~96px (Clientes e Pedidos/Produtos a 412px são os menores); com o piso
 * igual ao do esqueleto o cartão nunca é MENOR que ele e o conteúdo abaixo da
 * faixa não sobe quando os números chegam. Troca: os cartões menores ganham
 * ~14–18px de folga (aceito pelo dono da revisão). Uma constante só, para os
 * dois nunca divergirem.
 */
const ALTURA_MINIMA_DO_CARTAO = "min-h-[100px] sm:min-h-24";

/**
 * Setas do carrossel: só no computador (`hidden sm:flex` — abaixo de 640px elas
 * nem existem, então não há foco invisível no Tab; o celular tem pontos, swipe
 * e "Expandir"). O reveal (hover da faixa ou foco dentro dela) só é aplicado
 * à seta que PODE rolar: a variante `sm:group-hover/carousel:*` vence o
 * `opacity-0` de base, então a desabilitada ficava visível e clicável no
 * hover sem fazer nada.
 */
const SETA_BASE =
  "absolute top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-zinc-950/90 border border-white/10 hidden sm:flex items-center justify-center text-zinc-400 hover:text-white opacity-0 pointer-events-none transition-all duration-300 shadow-xl z-20 hover:border-admin-gold/30 active:scale-95";
const SETA_REVELADA =
  "sm:group-hover/carousel:opacity-100 sm:group-hover/carousel:pointer-events-auto sm:group-focus-within/carousel:opacity-100 sm:group-focus-within/carousel:pointer-events-auto";

/**
 * Card COMPACTO (pedido do Gabriel de 02/09 à tarde: a faixa de métricas
 * ocupava um espaço enorme — card vertical de 128px de altura mínima para
 * mostrar UM número, com o carrossel mostrando só 4 por vez no desktop).
 * O dono virou a versão em grade e decidiu: carrossel fica, card encolhe.
 * Layout horizontal (ícone + rótulo em cima, valor grande na linha de
 * baixo) e slides mais densos — mais métricas visíveis na mesma largura.
 *
 * Altura: NATURAL, com piso igual ao do esqueleto (`ALTURA_MINIMA_DO_CARTAO`:
 * 100px no celular, 96px no computador). Rótulo, valor e subtítulo a 11px+
 * quebram em até 2 linhas (o rótulo, até 3 de 640px em diante, J2-B:
 * "DINHEIRO PARADO EM…" era cortado a 1280px) e por isso um cartão pode
 * passar do piso (medido: até ~107px no pior caso). Todos os cartões de uma
 * mesma faixa têm a MESMA altura (o slide estica, `h-full`); o texto nunca é
 * cortado nem desce de 11px.
 */
const KpiCard = memo(function KpiCard({
  stat,
}: {
  readonly stat: KpiCardConfig;
}) {
  const Icon = stat.icon;

  return (
    <div
      className={cn(
        // Mesma altura na faixa inteira (o dono pediu "padronizada, uma não
        // maior que a outra"), mas SEM travar a altura: o slide estica no
        // flex do Embla (`h-full`), com o mesmo piso do esqueleto
        // (`ALTURA_MINIMA_DO_CARTAO`). A altura é a natural do texto: rótulo
        // (até 3 linhas de `sm:` em diante) e subtítulo (2) quebram, e travar
        // a altura cortava o texto (decisão P-J4 reescrita, onda J). No computador o
        // padding vertical é menor (`sm:py-2`) para devolver espaço ao
        // texto. Card com conteúdo extra (barra de progresso das Perguntas,
        // rodapé dos Cupons) cresce o necessário, com overflow escondido
        // para nunca romper o desenho.
        "group relative flex select-none items-center gap-2.5 overflow-hidden rounded-2xl border border-white/[0.04] bg-zinc-950 bg-gradient-to-br from-zinc-900/50 to-zinc-950/80 p-3 shadow-lg transition-colors duration-300 sm:gap-3 sm:py-2",
        "h-full",
        ALTURA_MINIMA_DO_CARTAO,
        stat.hoverBorder ||
          "hover:border-admin-gold/30 hover:shadow-[0_0_30px_rgba(212,175,55,0.06)]",
      )}
    >
      <div
        className={cn(
          // Abaixo de 480px o ícone some: o texto ganha ~46px (de ~87 para ~135px).
          "hidden size-9 shrink-0 items-center xs:flex justify-center rounded-xl border border-white/5 bg-zinc-950 shadow-inner transition-colors duration-300 group-hover:border-admin-gold/20",
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
        <p className="line-clamp-2 break-words text-[11px] font-black uppercase leading-tight tracking-[0.06em] text-zinc-500 transition-colors duration-300 group-hover:text-zinc-400 sm:line-clamp-3 sm:tracking-[0.04em]">
          {stat.label}
        </p>
        {/* Valor na linha INTEIRA (pedido do Gabriel, 02/09: o dado completo
            não cabia — "R$ 1.31... / CAPITAL LIQ..." era valor e subtítulo
            brigando pela mesma linha). Empilhado em 3 linhas dentro da
            mesma altura: rótulo / valor / subtítulo. */}
        <h3 className="truncate text-[15px] font-black tabular-nums leading-tight tracking-tighter text-white transition-colors duration-300 group-hover:text-admin-gold xs:text-base xs:leading-tight sm:text-lg sm:leading-tight">
          {stat.value}
        </h3>
        {stat.subValue && (
          <p className="line-clamp-2 break-words text-[11px] font-bold leading-tight text-zinc-600 opacity-80 transition-colors duration-300 group-hover:text-zinc-500">
            {stat.subValue}
          </p>
        )}
        {stat.footer && (
          <p className="line-clamp-2 break-words text-[11px] font-bold leading-tight text-zinc-600 transition-colors duration-300 group-hover:text-zinc-500">
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
    // MESMO piso do cartão real (`ALTURA_MINIMA_DO_CARTAO`; J2-B: eram 96px
    // no celular e 68px de 640px em diante, e o conteúdo abaixo pulava
    // 11–28px quando os números chegavam). O cartão real nunca é menor que
    // este esqueleto; os menores (Clientes) ganham ~14–18px de folga.
    <div
      className={cn(
        "flex select-none items-center gap-3 rounded-2xl border border-white/[0.04] bg-zinc-950 bg-gradient-to-br from-zinc-900/50 to-zinc-950/80 p-3 shadow-lg sm:py-2",
        ALTURA_MINIMA_DO_CARTAO,
      )}
    >
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
  autoplayInterval = 0,
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

  // Autoplay DESLIGADO por padrão (P-J1, onda J: a faixa mudava sozinha a
  // cada 4s e o cartão que o lojista procurava saía de vista). Quem passa
  // `autoplayInterval` em milissegundos liga. Pausa com a aba em segundo
  // plano (Visibility API) ou com a tela do painel inativa.
  useEffect(() => {
    if (!autoplayInterval) return;
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
      {/* A barra QUEBRA linha (flex-wrap): cada ponto virou um alvo de 24px
          de largura, e com 6+ cartões a 360px o "Expandir" saía da tela.
          A altura é RESERVADA (J2-B): carregando a barra tinha 44px e, quando
          os pontos apareciam e quebravam em 2 linhas no celular, ~64,5px —
          o conteúdo abaixo pulava ~20px. `min-h-[65px]` = a versão quebrada;
          de 640px em diante (`sm:`) cabe numa linha só, 44px (`min-h-11`). */}
      <div className="flex min-h-[65px] select-none flex-wrap items-center justify-between gap-x-3 gap-y-1 px-0 sm:min-h-11">
        <div className="flex items-center gap-2">
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-admin-gold" />
          <span className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500">
            {title}
          </span>
        </div>
        <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-x-3">
          {/* Navigation dot indicators - only in carousel mode */}
          {!isExpanded && !loading && scrollSnaps.length > 1 && (
            <div className="flex min-w-0 flex-wrap items-center justify-end">
              {/* Cada ponto é um botão de 44px de altura (alvo de toque) com
                  a bolinha visível por dentro, nomeado em português. */}
              {scrollSnaps.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    triggerManualInteraction();
                    emblaApi?.scrollTo(i);
                  }}
                  className="flex h-11 w-6 items-center justify-center"
                  aria-label={`Mostrar o grupo ${i + 1} de ${scrollSnaps.length}`}
                  aria-current={activeIndex === i ? "true" : undefined}
                >
                  <span
                    className={cn(
                      "h-1 rounded-full transition-all duration-300",
                      activeIndex === i
                        ? "w-4 bg-admin-gold"
                        : "w-1 bg-white/10",
                    )}
                  />
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex min-h-11 items-center gap-1.5 rounded-xl border border-white/5 bg-white/5 px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-zinc-400 transition-all hover:border-white/10 hover:bg-white/10 hover:text-white"
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

          {/* Setas - só no computador (sm:), ver SETA_BASE. Invisíveis =
              `pointer-events-none` (J2-B: a seta de 32x32 com `opacity-0`
              ficava por cima da borda do 2º cartão e capturava o toque); o
              mouse em cima da faixa ou o foco do teclado a mostram e devolvem
              o clique, só se ainda houver para onde rolar. */}
          {!loading && scrollSnaps.length > 1 && (
            <>
              <button
                type="button"
                disabled={!canScrollPrev}
                onClick={() => {
                  triggerManualInteraction();
                  emblaApi?.scrollPrev();
                }}
                aria-label="Anterior"
                className={cn(
                  SETA_BASE,
                  "left-0",
                  canScrollPrev && SETA_REVELADA,
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
                aria-label="Próximo"
                className={cn(
                  SETA_BASE,
                  "right-0",
                  canScrollNext && SETA_REVELADA,
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
