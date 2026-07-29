"use client";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { formatCurrency } from "@/lib/utils";
import { Eye, EyeOff, PieChart as PieChartIcon } from "lucide-react";
import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  Cell,
  Label,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
} from "recharts";
import type { SectorProps } from "recharts";

export interface CategoryData {
  name: string;
  value: number;
  color?: string;
  avg_ticket?: number;
  orders?: number;
  gradientId?: string;
  solidColor?: string;
  valueType?: "currency" | "number";
}

interface StrategicIntelligenceBlocksProps {
  readonly categoryData: CategoryData[];
  readonly loading: boolean;
  readonly active?: boolean;
}

const PREMIUM_PALETTE = [
  { id: "cat-gold", color: "#ffbf00" }, // Ouro
  { id: "cat-cyan", color: "#06b6d4" }, // Ciano
  { id: "cat-rose", color: "#f43f5e" }, // Rosa
  { id: "cat-emerald", color: "#10b981" }, // Esmeralda
  { id: "cat-purple", color: "#a855f7" }, // Roxo
  { id: "cat-orange", color: "#f97316" }, // Laranja
  { id: "cat-blue", color: "#3b82f6" }, // Azul Real
  { id: "cat-zinc", color: "#a1a1aa" }, // Zinco/Prata
  { id: "cat-lime", color: "#84cc16" }, // Lima
  { id: "cat-amber", color: "#f59e0b" }, // Âmbar
];

const GRADIENT_MAP = Object.fromEntries(
  PREMIUM_PALETTE.map((g) => [g.id, g.color]),
);

interface CustomPieLabelProps {
  readonly viewBox?: any;
  readonly totalRevenue: number;
  readonly fontSize: string;
  readonly activeCategory: CategoryData | null;
}

const CustomPieLabel = React.memo(
  ({
    viewBox,
    totalRevenue,
    fontSize,
    activeCategory,
  }: CustomPieLabelProps) => {
    if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) return null;
    const { cx, cy } = viewBox;

    const hasActive = !!activeCategory;
    const label = activeCategory
      ? activeCategory.name.length > 14
        ? `${activeCategory.name.substring(0, 12)}..`
        : activeCategory.name
      : "Total";
    const value = activeCategory ? activeCategory.value : totalRevenue;

    const percentage =
      activeCategory && totalRevenue > 0
        ? `(${((activeCategory.value / totalRevenue) * 100).toFixed(1)}%)`
        : "";

    const labelDy = hasActive ? "-14" : "-8";
    const valueDy = hasActive ? "8" : "14";

    return (
      <g>
        <text
          x={cx}
          y={cy}
          dy={labelDy}
          textAnchor="middle"
          dominantBaseline="middle"
          className="pointer-events-none fill-zinc-400 text-[9px] font-black uppercase tracking-[0.15em] opacity-80 transition-all duration-300"
        >
          {label}
        </text>
        <text
          x={cx}
          y={cy}
          dy={valueDy}
          textAnchor="middle"
          dominantBaseline="middle"
          className={`pointer-events-none fill-white font-black italic tracking-tight transition-all duration-300 ${fontSize}`}
        >
          {formatCurrency(value)}
        </text>
        {percentage && (
          <text
            x={cx}
            y={cy}
            dy="26"
            textAnchor="middle"
            dominantBaseline="middle"
            className="pointer-events-none fill-admin-gold text-[10px] font-bold tracking-wide transition-all duration-300"
          >
            {percentage}
          </text>
        )}
      </g>
    );
  },
);
CustomPieLabel.displayName = "CustomPieLabel";

export const StrategicIntelligenceBlocks = React.memo(
  function StrategicIntelligenceBlocks({
    categoryData,
    loading,
    active = true,
  }: StrategicIntelligenceBlocksProps) {
    const [isChartReady, setIsChartReady] = useState(false);

    useEffect(() => {
      if (active) {
        const timer = setTimeout(() => {
          setIsChartReady(true);
        }, 180);
        return () => clearTimeout(timer);
      }
      setIsChartReady(false);
    }, [active]);
    const _isMobile = useMediaQuery("(max-width: 1023px)");
    const [activeIndex, setActiveIndex] = useState(-1);
    const [mounted, setMounted] = useState(false);
    const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(
      new Set(),
    );
    const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastScrollYRef = useRef<number | null>(null);

    useEffect(() => {
      setMounted(true);
      return () => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      };
    }, []);

    useEffect(() => {
      if (activeIndex === -1) {
        lastScrollYRef.current = null;
        return;
      }

      const initialScrollY = window.scrollY;
      lastScrollYRef.current = initialScrollY;

      const handleScroll = () => {
        if (lastScrollYRef.current !== null) {
          const currentScrollY = window.scrollY;
          if (Math.abs(currentScrollY - lastScrollYRef.current) > 15) {
            setActiveIndex(-1);
            lastScrollYRef.current = null;
          }
        }
      };

      window.addEventListener("scroll", handleScroll, { passive: true });
      return () => {
        window.removeEventListener("scroll", handleScroll);
      };
    }, [activeIndex]);

    const isMobile = mounted ? _isMobile : false;

    const safeCategoryData = useMemo<CategoryData[]>(() => {
      return (categoryData || []).map((item, index) => {
        // Se excedermos itens, usamos offset
        const safeIndex =
          index >= PREMIUM_PALETTE.length
            ? index + Math.floor(index / PREMIUM_PALETTE.length)
            : index;
        const gradientId =
          PREMIUM_PALETTE[safeIndex % PREMIUM_PALETTE.length].id;
        const newItem = Object.assign({}, item);
        newItem.name = item.name
          ? item.name.charAt(0).toUpperCase() + item.name.slice(1)
          : "";
        newItem.value = Number(item.value) || 0;
        newItem.gradientId = gradientId;
        newItem.solidColor = GRADIENT_MAP[gradientId];
        return newItem;
      });
    }, [categoryData]);

    const visibleCategoryData = useMemo(() => {
      return safeCategoryData.filter((c) => !hiddenCategories.has(c.name));
    }, [safeCategoryData, hiddenCategories]);

    const visibleCategoryDataRef = useRef(visibleCategoryData);
    useEffect(() => {
      visibleCategoryDataRef.current = visibleCategoryData;
    }, [visibleCategoryData]);

    const totalRevenue = useMemo(() => {
      return visibleCategoryData.reduce(
        (acc, curr) => acc + (curr.value || 0),
        0,
      );
    }, [visibleCategoryData]);

    const toggleCategory = useCallback(
      (categoryName: string) => {
        setHiddenCategories((prev) => {
          const next = new Set(prev);
          if (next.has(categoryName)) {
            next.delete(categoryName);
          } else {
            // Impede esconder se for a única categoria ativa remanescente
            if (safeCategoryData.length - next.size <= 1) {
              return prev;
            }
            next.add(categoryName);
          }
          return next;
        });
      },
      [safeCategoryData.length],
    );

    const onPieEnter = useCallback((_: any, index: number) => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      setActiveIndex(index);
    }, []);

    const onPieLeave = useCallback(() => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = setTimeout(() => {
        setActiveIndex(-1);
      }, 150);
    }, []);

    const renderActiveShape = useCallback(
      (props: SectorProps & { payload?: CategoryData }) => {
        const {
          cx,
          cy,
          innerRadius,
          outerRadius,
          startAngle,
          endAngle,
          fill,
          payload,
        } = props;
        const glowColor = payload?.solidColor || "#ffbf00";

        return (
          <g>
            <Sector
              cx={cx}
              cy={cy}
              innerRadius={Math.max(
                0,
                Number(innerRadius) - (isMobile ? 2 : 4),
              )}
              outerRadius={Number(outerRadius) + (isMobile ? 5 : 8)}
              startAngle={startAngle}
              endAngle={endAngle}
              fill={fill}
              stroke="#09090b"
              strokeWidth={2}
              cornerRadius={6}
              style={{
                outline: "none",
                filter: `drop-shadow(0px ${isMobile ? 4 : 8}px ${isMobile ? 8 : 16}px ${glowColor}70)`,
                transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
              className="focus:outline-none focus:ring-0 focus-visible:outline-none"
            />
          </g>
        );
      },
      [isMobile],
    );

    if (
      !mounted ||
      !isChartReady ||
      (loading && (!categoryData || categoryData.length === 0))
    ) {
      return (
        <div className="space-y-12 pb-10 sm:pb-20">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
            <Skeleton className="relative h-[340px] w-full overflow-hidden rounded-[3rem] border border-white/5 bg-zinc-800/20 shadow-lg backdrop-blur-xl sm:h-[380px] lg:col-span-5" />
          </div>
        </div>
      );
    }

    if (!loading && (safeCategoryData.length === 0 || totalRevenue === 0)) {
      return (
        <div className="flex flex-col items-center justify-center space-y-4 rounded-[3rem] border border-white/5 bg-zinc-950/60 p-12 text-center shadow-2xl backdrop-blur-3xl">
          <div className="flex size-16 items-center justify-center rounded-full border border-white/10 bg-white/5">
            <PieChartIcon className="text-zinc-500" size={24} />
          </div>
          <div>
            <h3 className="text-lg font-black text-white">
              Sem Dados Registrados
            </h3>
            <p className="mt-1 max-w-sm text-sm font-medium text-zinc-500">
              Nenhuma categoria registrou faturamento no período selecionado.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-12 pb-10 duration-500 animate-in fade-in sm:pb-20">
        {/* A11y - Accessibility Layer for Screen Readers */}
        <section
          className="sr-only"
          aria-label="Relatório Estratégico de Faturamento"
          aria-live="polite"
          aria-atomic="true"
        >
          <h2>Relatório Estratégico de Faturamento</h2>
          <ul>
            {safeCategoryData.map((cat) => (
              <li key={`sr-cat-${cat.name}`}>
                Categoria {cat.name}: {formatCurrency(cat.value || 0)}
                {cat.avg_ticket
                  ? `, Ticket Médio: ${formatCurrency(cat.avg_ticket)}`
                  : ""}
              </li>
            ))}
          </ul>
          <p>Faturamento Total: {formatCurrency(totalRevenue)}</p>
        </section>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
          {/* Performance por Categoria Elite */}
          <Card className="group relative overflow-hidden rounded-[3rem] border border-white/5 bg-zinc-950/60 p-5 shadow-2xl backdrop-blur-3xl transition-all duration-700 hover:border-admin-gold/10 sm:p-7 lg:col-span-5">
            <div
              className="absolute left-0 top-0 size-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-admin-gold/5 blur-[100px] transition-colors duration-1000 group-hover:bg-admin-gold/10"
              style={{ willChange: "background-color" }}
            />
            <div className="relative z-10 mb-3 flex items-center justify-between sm:mb-5">
              <div className="space-y-1">
                <h3 className="text-[11px] font-black uppercase tracking-[0.4em] text-zinc-500">
                  Divisão de Faturamento
                </h3>
                <p className="text-[10px] font-bold uppercase tracking-tight text-zinc-600">
                  Desempenho por Categoria
                </p>
              </div>
              <div className="flex size-8 items-center justify-center rounded-xl border border-white/10 bg-white/5 transition-colors group-hover:border-admin-gold/40">
                <PieChartIcon size={14} className="text-admin-gold" />
              </div>
            </div>

            {/* CONTAINER DO GRÁFICO E DA LEGENDA DETALHADA */}
            <div className="relative z-10 flex flex-col items-center justify-between gap-4 sm:gap-10 lg:flex-row">
              {/* COLUNA DO GRÁFICO DONUT */}
              <div className="relative flex h-[210px] w-full min-w-0 overflow-hidden items-center justify-center sm:h-[260px] lg:h-[320px] lg:w-[55%]">
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  minWidth={0}
                  minHeight={0}
                >
                  <PieChart>
                    <Pie
                      key={isMobile ? "mobile-pie" : "desktop-pie"}
                      activeIndex={activeIndex}
                      activeShape={renderActiveShape}
                      data={visibleCategoryData}
                      innerRadius={isMobile ? 65 : 85}
                      outerRadius={isMobile ? 82 : 108}
                      paddingAngle={3}
                      cornerRadius={8}
                      dataKey="value"
                      stroke="#09090b"
                      strokeWidth={2.5}
                      isAnimationActive={!isMobile}
                      cx="50%"
                      cy="50%"
                      onMouseEnter={onPieEnter}
                      onClick={onPieEnter}
                      onMouseLeave={onPieLeave}
                      onTouchStart={onPieEnter}
                    >
                      <Label
                        content={
                          <CustomPieLabel
                            totalRevenue={totalRevenue}
                            fontSize={isMobile ? "text-[16px]" : "text-[18px]"}
                            activeCategory={
                              activeIndex !== -1 &&
                              visibleCategoryData[activeIndex]
                                ? visibleCategoryData[activeIndex]
                                : null
                            }
                          />
                        }
                      />
                      {visibleCategoryData.map((entry, index) => (
                        <Cell
                          key={`cell-${entry.name || index}`}
                          fill={entry.solidColor}
                          className="cursor-pointer outline-none focus:outline-none"
                          style={{
                            transition:
                              "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                            outline: "none",
                          }}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* COLUNA DA TABELA DE LEGENDAS DETALHADAS */}
              <div className="flex w-full flex-col justify-center space-y-3 lg:w-[45%]">
                <div className="hidden items-center justify-between border-b border-white/5 pb-2 lg:flex">
                  <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">
                    Divisão de Categorias
                  </span>
                  <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">
                    Faturamento (%)
                  </span>
                </div>
                <div className="custom-scrollbar grid max-h-[300px] grid-cols-1 gap-2 overflow-y-auto pr-1">
                  {safeCategoryData.map((entry) => {
                    const isInactive = hiddenCategories.has(entry.name);
                    const isSelected =
                      activeIndex !== -1 &&
                      visibleCategoryData[activeIndex]?.name === entry.name;
                    const percentage =
                      totalRevenue > 0
                        ? ((entry.value / totalRevenue) * 100).toFixed(1)
                        : "0.0";
                    const color = isInactive ? "#3f3f46" : entry.solidColor;

                    return (
                      <div
                        key={`legend-row-${entry.name}`}
                        role="button"
                        tabIndex={isInactive ? -1 : 0}
                        onKeyDown={(e) => {
                          if (isInactive) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            const vIndex = visibleCategoryData.findIndex(
                              (c) => c.name === entry.name,
                            );
                            if (vIndex !== -1) {
                              setActiveIndex((prev) =>
                                prev === vIndex ? -1 : vIndex,
                              );
                            }
                          }
                        }}
                        className={`flex flex-col rounded-2xl border p-3 transition-all duration-300 ${
                          isSelected
                            ? "border-white/10 bg-white/[0.04] shadow-lg"
                            : "border-white/5 bg-zinc-950/30 hover:border-white/10 hover:bg-white/[0.02]"
                        } ${isInactive ? "opacity-40" : "opacity-100"}`}
                        onMouseEnter={() => {
                          if (!isInactive) {
                            const vIndex = visibleCategoryData.findIndex(
                              (c) => c.name === entry.name,
                            );
                            if (vIndex !== -1) {
                              setActiveIndex(vIndex);
                            }
                          }
                        }}
                        onMouseLeave={() => {
                          setActiveIndex(-1);
                        }}
                        onClick={() => {
                          if (!isInactive) {
                            const vIndex = visibleCategoryData.findIndex(
                              (c) => c.name === entry.name,
                            );
                            if (vIndex !== -1) {
                              setActiveIndex((prev) =>
                                prev === vIndex ? -1 : vIndex,
                              );
                            }
                          }
                        }}
                        style={{ cursor: isInactive ? "default" : "pointer" }}
                      >
                        {/* Top Row: Category dot/name & value/percentage */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-3">
                            <span
                              className={`size-2.5 rounded-full transition-all duration-300 ${isSelected ? "scale-125" : "scale-100"}`}
                              style={{
                                backgroundColor: color,
                                boxShadow:
                                  isInactive || !isSelected
                                    ? "none"
                                    : `0 0 10px ${color}`,
                              }}
                            />
                            <span className="text-[11px] font-black uppercase tracking-widest text-white">
                              {entry.name}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-black italic text-zinc-100">
                              {formatCurrency(entry.value)}
                            </span>
                            <span className="min-w-[42px] rounded-md bg-admin-gold/10 px-1.5 py-0.5 text-center text-[9px] font-black text-admin-gold">
                              {percentage}%
                            </span>
                            <button
                              type="button"
                              className="ml-1 p-1 text-zinc-600 transition-colors hover:text-zinc-300 focus:outline-none"
                              onClick={(e) => {
                                e.stopPropagation(); // Evita ativar o destaque de hover do card
                                toggleCategory(entry.name);
                              }}
                              title={
                                isInactive
                                  ? "Mostrar no gráfico"
                                  : "Ocultar do gráfico"
                              }
                            >
                              {isInactive ? (
                                <EyeOff size={13} />
                              ) : (
                                <Eye
                                  size={13}
                                  className="text-zinc-400 hover:text-admin-gold"
                                />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Sub Details Row */}
                        {!isInactive && (entry.avg_ticket || entry.orders) && (
                          <div className="pl-5.5 mt-1.5 flex items-center gap-4 text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                            {entry.avg_ticket && (
                              <span>
                                Ticket M.:{" "}
                                <strong className="text-zinc-400">
                                  {formatCurrency(entry.avg_ticket)}
                                </strong>
                              </span>
                            )}
                            {entry.orders && (
                              <span>
                                Pedidos:{" "}
                                <strong className="text-zinc-400">
                                  {entry.orders}
                                </strong>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  },
);
