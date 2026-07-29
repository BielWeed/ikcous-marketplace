import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardStats } from "@/hooks/useAnalytics";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { Activity, BarChart3 } from "lucide-react";
import { memo, useEffect, useMemo, useState, useTransition } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface OperationalPerformanceChartProps {
  stats: DashboardStats | null;
  loading: boolean;
  className?: string;
  active?: boolean;
}

export const OperationalPerformanceChart = memo(
  function OperationalPerformanceChart({
    stats,
    loading,
    className,
    active = true,
  }: OperationalPerformanceChartProps) {
    const _isMobile = useMediaQuery("(max-width: 1023px)");
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
      setMounted(true);
    }, []);
    const isMobile = mounted ? _isMobile : false;

    const [isChartReady, setIsChartReady] = useState(false);
    const [chartMode, setChartMode] = useState<"revenue" | "roi">("revenue");
    const [timeframe, setTimeframe] = useState<"30" | "90" | "all">("30");
    const [isPending, startTransition] = useTransition();

    const handleTimeframeChange = (t: "30" | "90" | "all") => {
      startTransition(() => {
        setTimeframe(t);
      });
    };

    const handleChartModeChange = (mode: "revenue" | "roi") => {
      startTransition(() => {
        setChartMode(mode);
      });
    };

    useEffect(() => {
      if (active && !isChartReady) {
        const timer = setTimeout(() => {
          setIsChartReady(true);
        }, 250);
        return () => clearTimeout(timer);
      }
    }, [active, isChartReady]);

    // Filter history based on timeframe before processing
    const revenueHistory = stats?.revenueHistory;
    const filteredRevenueHistory = useMemo(() => {
      return revenueHistory
        ? timeframe === "30"
          ? revenueHistory.slice(-30)
          : timeframe === "90"
            ? revenueHistory.slice(-90)
            : revenueHistory
        : [];
    }, [revenueHistory, timeframe]);

    // Process data for ROI chart
    const processedRoiData = useMemo(() => {
      if (!filteredRevenueHistory || filteredRevenueHistory.length === 0)
        return [];

      const totalCost = stats?.inventory?.totalCost ?? 0;
      let runningInventoryCost = totalCost;
      let runningCumulativeProfit = 0;

      // Reverse array to reconstruct inventory cost backwards
      const reversedHistory = [...filteredRevenueHistory].reverse();
      const historyWithInv = reversedHistory
        .map((day) => {
          const costOnDay = runningInventoryCost;
          runningInventoryCost += day.cost_sold ?? 0;
          const newDay = Object.assign({ inventoryCost: 0 }, day);
          newDay.inventoryCost = costOnDay;
          return newDay;
        })
        .reverse();

      // Go forward to calculate cumulative profit
      return historyWithInv.map((day) => {
        runningCumulativeProfit += day.profit ?? 0;
        const newDay = Object.assign({ cumulativeProfit: 0 }, day);
        newDay.inventoryCost = Number(day.inventoryCost.toFixed(2));
        newDay.cumulativeProfit = Number(runningCumulativeProfit.toFixed(2));
        newDay.revenue = Number(day.revenue);
        return newDay;
      });
    }, [filteredRevenueHistory, stats?.inventory?.totalCost]);

    return (
      <div
        className={cn(
          "admin-glass pt-0 pb-6 px-4 sm:pt-0 sm:pb-10 sm:px-10 sm:rounded-[3rem] border border-white/5 space-y-4 sm:space-y-6 relative overflow-hidden group",
          className,
        )}
      >
        <div className="absolute -bottom-20 -right-20 size-96 rounded-full bg-admin-gold/[0.02] blur-[100px]" />

        <div className="relative z-10 mt-5 flex flex-row items-center justify-between px-2 sm:px-0">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
            <div className="-mt-1 sm:-mt-2">
              <h3 className="bg-gradient-to-r from-white via-white to-white/40 bg-clip-text pr-2 text-xl font-black uppercase italic leading-tight tracking-tighter text-transparent sm:text-3xl">
                Performance
              </h3>
              <div className="mt-0.5 flex items-center gap-2 sm:mt-1">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)]" />
                <p className="text-[8px] font-black uppercase tracking-[0.3em] text-zinc-500 sm:text-[10px]">
                  {chartMode === "revenue"
                    ? "Fluxo Operacional"
                    : "Retorno sobre Estoque"}
                </p>
              </div>
            </div>

            {!loading &&
              (stats?.growth !== undefined ||
                stats?.today?.revenueTrend !== undefined) && (
                <div className="hidden items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 sm:flex">
                  <Activity className="size-3 text-emerald-500" />
                  <span className="text-[10px] font-black uppercase leading-none tracking-widest text-emerald-500">
                    {(stats?.growth ?? stats?.today?.revenueTrend ?? 0) >= 0
                      ? "+"
                      : ""}
                    {(stats?.growth ?? stats?.today?.revenueTrend ?? 0).toFixed(
                      1,
                    )}
                    %
                  </span>
                </div>
              )}
          </div>

          <div className="relative z-30 flex flex-col items-end gap-3 sm:flex-row sm:items-center">
            {/* Timeframe Selectors */}
            <div className="flex shrink-0 items-center gap-1 rounded-2xl border border-white/10 bg-white/5 p-1">
              {(["30", "90", "all"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => handleTimeframeChange(t)}
                  className={cn(
                    "px-2 py-1 sm:px-3 sm:py-1.5 rounded-xl text-[8px] sm:text-[9px] font-black uppercase tracking-wider transition-all select-none",
                    timeframe === t
                      ? "bg-white text-black shadow-lg"
                      : "text-zinc-400 hover:text-white hover:bg-white/5",
                  )}
                >
                  {t === "all" ? "Tudo" : `${t}D`}
                </button>
              ))}
            </div>

            {/* Toggle Chart Mode Buttons */}
            <div className="flex shrink-0 items-center gap-1 rounded-2xl border border-white/10 bg-white/5 p-1 sm:gap-2">
              <button
                onClick={() => handleChartModeChange("revenue")}
                className={cn(
                  "px-2 py-1 sm:px-3 sm:py-1.5 rounded-xl text-[8px] sm:text-[9px] font-black uppercase tracking-wider transition-all select-none",
                  chartMode === "revenue"
                    ? "bg-white text-black shadow-lg"
                    : "text-zinc-400 hover:text-white hover:bg-white/5",
                )}
              >
                Faturamento
              </button>
              <button
                onClick={() => handleChartModeChange("roi")}
                className={cn(
                  "px-2 py-1 sm:px-3 sm:py-1.5 rounded-xl text-[8px] sm:text-[9px] font-black uppercase tracking-wider transition-all select-none",
                  chartMode === "roi"
                    ? "bg-emerald-500 text-black shadow-lg"
                    : "text-zinc-400 hover:text-white hover:bg-white/5",
                )}
              >
                ROI do Estoque
              </button>
            </div>
          </div>
        </div>

        {loading || !stats ? (
          <div className="relative z-10 mt-2 flex h-4 animate-pulse select-none flex-wrap items-center gap-x-5 gap-y-1.5 px-2 sm:h-5 sm:px-0">
            <div className="h-3.5 w-32 rounded-lg bg-white/5" />
            <div className="h-3.5 w-20 rounded-lg bg-white/5" />
            <div className="h-3.5 w-28 rounded-lg bg-white/5" />
          </div>
        ) : (
          <div className="relative z-10 mt-2 flex h-auto select-none flex-wrap items-center gap-x-5 gap-y-1.5 px-2 text-[9px] font-bold uppercase tracking-wider text-zinc-400 duration-300 animate-in fade-in slide-in-from-top-2 sm:h-5 sm:px-0 sm:text-xs">
            {chartMode === "revenue" ? (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  <span>
                    Faturamento Total:{" "}
                    <strong className="text-[11px] font-black italic tracking-tighter text-white sm:text-sm">
                      R${" "}
                      {(stats.executive?.totalRevenue ?? 0).toLocaleString(
                        "pt-BR",
                        { maximumFractionDigits: 0 },
                      )}
                    </strong>
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-zinc-400" />
                  <span>
                    Pedidos:{" "}
                    <strong className="text-[11px] font-black italic tracking-tighter text-white sm:text-sm">
                      {stats.executive?.totalOrders ?? 0}
                    </strong>
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-admin-gold" />
                  <span>
                    Ticket Médio:{" "}
                    <strong className="text-[11px] font-black italic tracking-tighter text-white sm:text-sm">
                      R${" "}
                      {(
                        stats.averageTicket ??
                        stats.executive?.avgTicket ??
                        0
                      ).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
                    </strong>
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]" />
                  <span>
                    Estoque At. (Custo):{" "}
                    <strong className="text-[11px] font-black italic tracking-tighter text-white sm:text-sm">
                      R${" "}
                      {(stats.inventory?.totalCost ?? 0).toLocaleString(
                        "pt-BR",
                        { maximumFractionDigits: 0 },
                      )}
                    </strong>
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
                  <span>
                    Lucro Acumulado:{" "}
                    <strong className="text-[11px] font-black italic tracking-tighter text-white sm:text-sm">
                      R${" "}
                      {processedRoiData[
                        processedRoiData.length - 1
                      ]?.cumulativeProfit.toLocaleString("pt-BR", {
                        maximumFractionDigits: 0,
                      }) ?? "0"}
                    </strong>
                  </span>
                </div>
                {stats.inventory?.totalCost &&
                  stats.inventory.totalCost > 0 && (
                    <div className="flex items-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 font-extrabold normal-case text-emerald-400">
                      <span>
                        Recup:{" "}
                        {(
                          ((processedRoiData[processedRoiData.length - 1]
                            ?.cumulativeProfit ?? 0) /
                            stats.inventory.totalCost) *
                          100
                        ).toFixed(0)}
                        %
                      </span>
                    </div>
                  )}
              </>
            )}
          </div>
        )}

        <div
          className={cn(
            "h-[200px] sm:h-[300px] w-full min-w-0 overflow-hidden relative z-10 px-0 transition-opacity duration-300",
            isPending && "opacity-60",
          )}
        >
          {loading || !isChartReady ? (
            <Skeleton className="size-full animate-pulse rounded-3xl bg-white/5" />
          ) : !stats?.revenueHistory || stats.revenueHistory.length === 0 ? (
            <div className="flex size-full flex-col items-center justify-center space-y-4 rounded-3xl border border-white/5 bg-white/5">
              <div className="flex size-16 items-center justify-center rounded-2xl border border-admin-gold/10 bg-admin-gold/5">
                <BarChart3 className="size-8 text-admin-gold/30" />
              </div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-600">
                Nenhum dado disponível no período
              </p>
            </div>
          ) : chartMode === "revenue" ? (
            <div className="size-full duration-500 animate-in fade-in">
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={0}
                minHeight={0}
                debounce={150}
              >
                <BarChart
                  data={filteredRevenueHistory}
                  margin={{ top: 10, right: 10, left: -8, bottom: 0 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="#ffffff"
                    strokeOpacity={0.03}
                    strokeDasharray="4 4"
                  />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    fontSize={9}
                    tick={{ fill: "#71717a", fontWeight: 900 }}
                    tickFormatter={(val) => {
                      const part = val.split("-");
                      return part.length >= 3 ? `${part[2]}/${part[1]}` : val;
                    }}
                    dy={10}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    fontSize={8}
                    tick={{ fill: "#71717a", fontWeight: 900 }}
                    tickFormatter={(val) =>
                      val >= 1000
                        ? `R$ ${(val / 1000).toFixed(0)}k`
                        : `R$ ${val}`
                    }
                    width={45}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(16, 185, 129, 0.05)", radius: 8 }}
                    offset={20}
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        const orderCount =
                          typeof data.orders === "number" ? data.orders : 0;

                        return (
                          <div className="bg-zinc-950/98 pointer-events-none z-50 flex inline-flex select-none flex-col gap-1.5 rounded-xl border border-white/10 px-2.5 py-1.5 shadow-[0_10px_40px_rgba(0,0,0,0.6)] ring-1 ring-white/10 backdrop-blur-3xl">
                            <div className="flex items-center gap-2">
                              <span className="whitespace-nowrap text-[7px] font-black uppercase leading-none tracking-[0.2em] text-white/50">
                                {data.full_date || data.date}
                              </span>
                              <div className="h-px flex-1 bg-white/10" />
                            </div>

                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-1.5">
                                <div className="size-1.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)]" />
                                <div className="flex flex-col">
                                  <span className="text-[5.5px] font-black uppercase leading-none tracking-widest text-white/40">
                                    Receita
                                  </span>
                                  <span className="mt-0.5 whitespace-nowrap text-[10px] font-black italic leading-tight tracking-tighter text-white">
                                    R$
                                    {(data.revenue || 0).toLocaleString(
                                      "pt-BR",
                                      { maximumFractionDigits: 0 },
                                    )}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-1">
                                <div className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                <div className="flex flex-col">
                                  <span className="text-[5.5px] font-black uppercase leading-none tracking-widest text-emerald-500/50">
                                    Pedidos
                                  </span>
                                  <span className="mt-0.5 text-[10px] font-black italic leading-tight tracking-tighter text-emerald-500">
                                    {orderCount}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar
                    dataKey="revenue"
                    fill="#10b981"
                    radius={[6, 6, 6, 6]}
                    opacity={0.3}
                    barSize={20}
                    className="cursor-pointer transition-opacity hover:opacity-60"
                    isAnimationActive={!isMobile}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="size-full duration-500 animate-in fade-in">
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={0}
                minHeight={0}
                debounce={150}
              >
                <AreaChart
                  data={processedRoiData}
                  margin={{ top: 10, right: 10, left: -8, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="colorProfit"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor="#10b981"
                        stopOpacity={0.15}
                      />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient
                      id="colorInventory"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor="#f59e0b"
                        stopOpacity={0.08}
                      />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    vertical={false}
                    stroke="#ffffff"
                    strokeOpacity={0.03}
                    strokeDasharray="4 4"
                  />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    fontSize={9}
                    tick={{ fill: "#71717a", fontWeight: 900 }}
                    tickFormatter={(val) => {
                      const part = val.split("-");
                      return part.length >= 3 ? `${part[2]}/${part[1]}` : val;
                    }}
                    dy={10}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    fontSize={8}
                    tick={{ fill: "#71717a", fontWeight: 900 }}
                    tickFormatter={(val) =>
                      val >= 1000
                        ? `R$ ${(val / 1000).toFixed(0)}k`
                        : `R$ ${val}`
                    }
                    width={45}
                  />
                  <Tooltip
                    cursor={{
                      stroke: "rgba(255, 255, 255, 0.05)",
                      strokeWidth: 1,
                      strokeDasharray: "4 4",
                    }}
                    offset={20}
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="bg-zinc-950/98 pointer-events-none z-50 flex inline-flex select-none flex-col gap-1.5 rounded-xl border border-white/10 px-2.5 py-2 shadow-[0_10px_40px_rgba(0,0,0,0.6)] ring-1 ring-white/10 backdrop-blur-3xl">
                            <div className="flex items-center gap-2">
                              <span className="whitespace-nowrap text-[7px] font-black uppercase leading-none tracking-[0.2em] text-white/50">
                                {data.full_date || data.date}
                              </span>
                              <div className="h-px flex-1 bg-white/10" />
                            </div>

                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-1.5">
                                <div className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                                <div className="flex flex-col">
                                  <span className="text-[5.5px] font-black uppercase leading-none tracking-widest text-emerald-500/70">
                                    Lucro Acumulado
                                  </span>
                                  <span className="mt-0.5 whitespace-nowrap text-[10px] font-black italic leading-tight tracking-tighter text-white">
                                    R$
                                    {data.cumulativeProfit.toLocaleString(
                                      "pt-BR",
                                      {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      },
                                    )}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <div className="size-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
                                <div className="flex flex-col">
                                  <span className="text-[5.5px] font-black uppercase leading-none tracking-widest text-amber-500/70">
                                    Valor Investido (Estoque)
                                  </span>
                                  <span className="mt-0.5 whitespace-nowrap text-[10px] font-black italic leading-tight tracking-tighter text-white">
                                    R$
                                    {data.inventoryCost.toLocaleString(
                                      "pt-BR",
                                      {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      },
                                    )}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="cumulativeProfit"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#colorProfit)"
                    dot={false}
                    activeDot={{
                      r: 5,
                      fill: "#10b981",
                      stroke: "#fff",
                      strokeWidth: 1.5,
                    }}
                    name="Lucro Acumulado"
                    isAnimationActive={!isMobile}
                  />
                  <Area
                    type="monotone"
                    dataKey="inventoryCost"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    fillOpacity={1}
                    fill="url(#colorInventory)"
                    dot={false}
                    activeDot={{
                      r: 5,
                      fill: "#f59e0b",
                      stroke: "#fff",
                      strokeWidth: 1.5,
                    }}
                    name="Valor Investido (Estoque)"
                    isAnimationActive={!isMobile}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    );
  },
);
