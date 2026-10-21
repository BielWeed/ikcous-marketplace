import { ExplicacaoDoRelatorio } from "@/components/admin/crm/ExplicacaoDoRelatorio";
import { SUPERFICIE_DO_CRM } from "@/components/admin/crm/PecasDoCrm";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardStats } from "@/hooks/useAnalytics";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import { desdeOPrimeiroDiaDeMovimento } from "@/utils/desde-o-primeiro-dia-de-movimento";
import {
  avisoProdutosSemCusto,
  produtosSemCusto,
} from "@/utils/produtos-sem-custo";
import { BarChart3 } from "lucide-react";
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
  /** Atalho "Cadastrar custo" do aviso de produtos sem custo. Sem ele, o
   * aviso aparece sem o botão. */
  onNavigate?: (view: View) => void;
}

export const OperationalPerformanceChart = memo(
  function OperationalPerformanceChart({
    stats,
    loading,
    className,
    active = true,
    onNavigate,
  }: OperationalPerformanceChartProps) {
    const semCusto = produtosSemCusto(stats);
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
      if (!revenueHistory) return [];
      if (timeframe === "30") return revenueHistory.slice(-30);
      if (timeframe === "90") return revenueHistory.slice(-90);
      // "Tudo": a janela cobre anos, então os dias zerados ANTES da
      // primeira venda são aparados — a loja não nasceu 10 anos atrás.
      return desdeOPrimeiroDiaDeMovimento(revenueHistory);
    }, [revenueHistory, timeframe]);

    // Faturamento Total / Pedidos / Ticket Médio do bloco de resumo, somados
    // a partir dos MESMOS dias que alimentam as barras (`filteredRevenueHistory`).
    // Antes, esses três números vinham de `stats.executive`, que a RPC marca
    // "-- executive stats (all-time)" — a lojista trocava o período no
    // seletor e via o gráfico mudar, mas os números ao lado continuavam
    // sendo o total histórico da loja inteira.
    const periodTotals = useMemo(() => {
      const revenue = filteredRevenueHistory.reduce(
        (sum, day) => sum + (day.revenue ?? 0),
        0,
      );
      const orders = filteredRevenueHistory.reduce(
        (sum, day) => sum + (day.orders ?? 0),
        0,
      );
      const avgTicket = orders > 0 ? revenue / orders : 0;
      return { revenue, orders, avgTicket };
    }, [filteredRevenueHistory]);

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
      <section
        aria-label="Histórico da loja"
        className={cn(
          SUPERFICIE_DO_CRM,
          "relative flex min-h-[404px] min-w-0 flex-col gap-2 overflow-hidden p-4",
          className,
        )}
      >
        <header className="flex min-h-11 shrink-0 items-center justify-between gap-1">
          <div className="min-w-0">
            <h2 className="text-admin-text text-[15px] font-bold">
              Histórico da loja
            </h2>
            {chartMode === "roi" && semCusto > 0 ? (
              <div className="text-xs text-amber-300">
                <p>{avisoProdutosSemCusto(semCusto)}</p>
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate("admin-products")}
                    className="min-h-11 font-bold text-admin-gold"
                  >
                    Cadastrar custo
                  </button>
                )}
              </div>
            ) : (
              <p className="text-admin-text-soft text-xs">
                Não muda com o período lá de cima
              </p>
            )}
          </div>
          {!loading &&
            (stats?.growth !== undefined ||
              stats?.today?.revenueTrend !== undefined) && (
              <span className="hidden text-[11px] font-bold text-emerald-300 sm:inline">
                {(stats?.growth ?? stats?.today?.revenueTrend ?? 0) >= 0
                  ? "+"
                  : ""}
                {(stats?.growth ?? stats?.today?.revenueTrend ?? 0).toFixed(1)}%
              </span>
            )}
          <ExplicacaoDoRelatorio titulo="Histórico da loja">
            Conta pelo dia em que o pedido foi feito, por isso pode ficar um
            pouco diferente da Receita lá de cima.
            {semCusto > 0 && (
              <div className="mt-3">
                <p>{avisoProdutosSemCusto(semCusto)}</p>
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate("admin-products")}
                    className="min-h-11 font-bold text-admin-gold"
                  >
                    Cadastrar custo
                  </button>
                )}
              </div>
            )}
          </ExplicacaoDoRelatorio>
        </header>
        <div
          role="group"
          aria-label="Gráfico do histórico"
          className="grid h-11 shrink-0 grid-cols-2 gap-1 rounded-xl bg-admin-raised"
        >
          {(["revenue", "roi"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={chartMode === mode}
              onClick={() => handleChartModeChange(mode)}
              className={cn(
                "min-h-11 rounded-xl px-1 text-xs font-bold",
                chartMode === mode
                  ? "border border-solid border-admin-border bg-admin-surface text-admin-text"
                  : "text-admin-text-soft",
              )}
            >
              {mode === "revenue" ? "Vendas" : "Retorno do estoque"}
            </button>
          ))}
        </div>
        <div className="grid h-11 shrink-0 grid-cols-3 divide-x divide-admin-border">
          {loading || !stats ? (
            [0, 1, 2].map((i) => (
              <span key={i} className="premium-shimmer m-2 h-6 rounded" />
            ))
          ) : chartMode === "revenue" ? (
            <>
              <div className="min-w-0 pr-1">
                <p className="text-admin-text-soft text-[11px]">Faturamento</p>
                <p className="text-admin-text text-base font-extrabold tabular-nums">
                  R${" "}
                  {periodTotals.revenue.toLocaleString("pt-BR", {
                    maximumFractionDigits: 0,
                  })}
                </p>
              </div>
              <div className="min-w-0 px-2">
                <p className="text-admin-text-soft text-[11px]">Pedidos</p>
                <p className="text-admin-text text-base font-extrabold tabular-nums">
                  {periodTotals.orders}
                </p>
              </div>
              <div className="min-w-0 pl-2">
                <p className="text-admin-text-soft text-[11px]">Valor médio</p>
                <p className="text-admin-text text-base font-extrabold tabular-nums">
                  R${" "}
                  {periodTotals.avgTicket.toLocaleString("pt-BR", {
                    maximumFractionDigits: 0,
                  })}
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="min-w-0 pr-1">
                <p className="text-admin-text-soft text-[11px]">
                  Estoque (custo)
                </p>
                <p className="text-admin-text text-base font-extrabold tabular-nums">
                  R${" "}
                  {(stats.inventory?.totalCost ?? 0).toLocaleString("pt-BR", {
                    maximumFractionDigits: 0,
                  })}
                </p>
              </div>
              <div className="min-w-0 px-2">
                <p className="text-admin-text-soft text-[11px]">
                  Lucro acumulado
                </p>
                <p className="text-admin-text text-base font-extrabold tabular-nums">
                  R${" "}
                  {processedRoiData[
                    processedRoiData.length - 1
                  ]?.cumulativeProfit.toLocaleString("pt-BR", {
                    maximumFractionDigits: 0,
                  }) ?? "0"}
                </p>
              </div>
              {!!stats.inventory?.totalCost &&
                stats.inventory.totalCost > 0 && (
                  <div className="min-w-0 pl-2">
                    <p className="text-admin-text-soft text-[11px]">
                      Recuperado
                    </p>
                    <p className="text-admin-text text-base font-extrabold tabular-nums">
                      {(
                        ((processedRoiData[processedRoiData.length - 1]
                          ?.cumulativeProfit ?? 0) /
                          stats.inventory.totalCost) *
                        100
                      ).toFixed(0)}
                      %
                    </p>
                  </div>
                )}
            </>
          )}
        </div>

        <div
          className={cn(
            "relative z-10 h-[150px] w-full min-w-0 shrink-0 overflow-hidden transition-opacity duration-300",
            isPending && "opacity-60",
          )}
        >
          {loading || !isChartReady ? (
            <Skeleton className="size-full animate-pulse rounded-3xl bg-white/5" />
          ) : !stats?.revenueHistory || stats.revenueHistory.length === 0 ? (
            <div className="flex size-full flex-col items-center justify-center space-y-4 rounded-3xl border border-admin-border bg-white/5">
              <div className="flex size-16 items-center justify-center rounded-2xl border border-admin-gold/10 bg-admin-gold/5">
                <BarChart3 className="size-8 text-admin-gold/30" />
              </div>
              <p className="text-admin-text-soft text-center text-[11px] font-semibold">
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
                    fontSize={11}
                    tick={{
                      fill: "hsl(var(--admin-text-soft, 240 6.8% 65.5%))",
                      fontWeight: 500,
                    }}
                    tickFormatter={(val) => {
                      const part = val.split("-");
                      return part.length >= 3 ? `${part[2]}/${part[1]}` : val;
                    }}
                    dy={10}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    fontSize={11}
                    tick={{
                      fill: "hsl(var(--admin-text-soft, 240 6.8% 65.5%))",
                      fontWeight: 500,
                    }}
                    tickFormatter={(val) =>
                      val >= 1000
                        ? `R$ ${(val / 1000).toFixed(0)}k`
                        : `R$ ${val}`
                    }
                    width={48}
                    tickCount={3}
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
                          <div className="bg-zinc-950/98 pointer-events-none z-50 flex inline-flex select-none flex-col gap-1.5 rounded-xl border border-admin-border px-2.5 py-1.5 shadow-[0_10px_40px_rgba(0,0,0,0.6)] ring-1 ring-admin-border backdrop-blur-3xl">
                            <div className="flex items-center gap-2">
                              <span className="text-admin-text-soft whitespace-nowrap text-[11px] font-black uppercase leading-none tracking-[0.2em]">
                                {data.full_date || data.date}
                              </span>
                              <div className="h-px flex-1 bg-white/10" />
                            </div>

                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-1.5">
                                <div className="size-1.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)]" />
                                <div className="flex flex-col">
                                  <span className="text-admin-text-soft text-[11px] font-black uppercase leading-none tracking-widest">
                                    Receita
                                  </span>
                                  <span className="mt-0.5 whitespace-nowrap text-[11px] font-black italic leading-tight tracking-tighter text-white">
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
                                  <span className="text-admin-text-soft text-[11px] font-black uppercase leading-none tracking-widest">
                                    Pedidos
                                  </span>
                                  <span className="mt-0.5 text-[11px] font-black italic leading-tight tracking-tighter text-emerald-500">
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
                    fill="hsl(var(--admin-accent))"
                    radius={[6, 6, 6, 6]}
                    barSize={20}
                    className="cursor-pointer"
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
                    fontSize={11}
                    tick={{
                      fill: "hsl(var(--admin-text-soft, 240 6.8% 65.5%))",
                      fontWeight: 500,
                    }}
                    tickFormatter={(val) => {
                      const part = val.split("-");
                      return part.length >= 3 ? `${part[2]}/${part[1]}` : val;
                    }}
                    dy={10}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    fontSize={11}
                    tick={{
                      fill: "hsl(var(--admin-text-soft, 240 6.8% 65.5%))",
                      fontWeight: 500,
                    }}
                    tickFormatter={(val) =>
                      val >= 1000
                        ? `R$ ${(val / 1000).toFixed(0)}k`
                        : `R$ ${val}`
                    }
                    width={48}
                    tickCount={3}
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
                          <div className="bg-zinc-950/98 pointer-events-none z-50 flex inline-flex select-none flex-col gap-1.5 rounded-xl border border-admin-border px-2.5 py-2 shadow-[0_10px_40px_rgba(0,0,0,0.6)] ring-1 ring-admin-border backdrop-blur-3xl">
                            <div className="flex items-center gap-2">
                              <span className="text-admin-text-soft whitespace-nowrap text-[11px] font-black uppercase leading-none tracking-[0.2em]">
                                {data.full_date || data.date}
                              </span>
                              <div className="h-px flex-1 bg-white/10" />
                            </div>

                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-1.5">
                                <div className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                                <div className="flex flex-col">
                                  <span className="text-admin-text-soft text-[11px] font-black uppercase leading-none tracking-widest">
                                    Lucro Acumulado
                                  </span>
                                  <span className="mt-0.5 whitespace-nowrap text-[11px] font-black italic leading-tight tracking-tighter text-white">
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
                                  <span className="text-admin-text-soft text-[11px] font-black uppercase leading-none tracking-widest">
                                    Valor Investido (Estoque)
                                  </span>
                                  <span className="mt-0.5 whitespace-nowrap text-[11px] font-black italic leading-tight tracking-tighter text-white">
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
                    stroke="hsl(var(--admin-accent))"
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
        <div
          role="group"
          aria-label="Janela do histórico"
          className="mt-auto grid h-11 shrink-0 grid-cols-3 gap-1 rounded-xl bg-admin-raised"
        >
          {(["30", "90", "all"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={timeframe === t}
              onClick={() => handleTimeframeChange(t)}
              className={cn(
                "min-h-11 rounded-xl text-xs font-bold",
                timeframe === t
                  ? "border border-solid border-admin-border bg-admin-surface text-admin-text"
                  : "text-admin-text-soft",
              )}
            >
              {t === "all" ? "Tudo" : `${t} dias`}
            </button>
          ))}
        </div>
      </section>
    );
  },
);
