import { ExplicacaoDoRelatorio } from "@/components/admin/crm/ExplicacaoDoRelatorio";
import { SUPERFICIE_DO_CRM } from "@/components/admin/crm/PecasDoCrm";
import {
  ALTURA_LUCRO,
  ALTURA_VENDAS,
  BalaoDoGrafico,
  MARGEM_TOPO_LUCRO,
  MARGEM_TOPO_VENDAS,
  reais,
} from "@/components/admin/dashboard/BalaoDoGrafico";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardStats } from "@/hooks/useAnalytics";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { formatarBRLCompacto, formatarPercentual } from "@/lib/financeiro";
import { classeDoTexto, tomDoValor } from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import { desdeOPrimeiroDiaDeMovimento } from "@/utils/desde-o-primeiro-dia-de-movimento";
import {
  VISAO_SEM_CUSTO,
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
  /** Atalho "Cadastrar custo" do aviso de produtos sem custo (abre a lista de
   * Produtos na visão "Sem custo"). Sem ele, o aviso aparece sem o botão. */
  onNavigate?: (view: View, id?: string) => void;
}

/**
 * Crescimento do faturamento: os últimos 30 dias contra os 30 anteriores (é o
 * que a RPC calcula — não muda com os botões 30/90/Tudo, então a legenda não
 * promete mais que isso). Queda em vermelho e alta em verde, com o sinal
 * escrito: a cor nunca é a única pista.
 */
function SeloDeCrescimento({ valor }: { readonly valor: number }) {
  const arredondado = Math.round(valor * 10) / 10;
  return (
    <div
      data-selo-de-crescimento=""
      className="shrink-0 text-right leading-tight"
    >
      <p
        className={cn(
          "text-[13px] font-extrabold tabular-nums",
          classeDoTexto(tomDoValor(arredondado)),
        )}
      >
        {arredondado > 0 ? "+" : ""}
        {formatarPercentual(arredondado)}
      </p>
      <p className="text-admin-text-soft text-[11px]">vs. 30 dias antes</p>
    </div>
  );
}

/**
 * A RPC devolve +100 quando os 30 dias anteriores não tiveram venda e os
 * últimos 30 tiveram ("de zero para qualquer coisa"). Isso não é crescimento:
 * sem base, sem selo (mesmo critério dos chips de Receita/Pedidos do CRM).
 * A base sai do próprio histórico diário: os 30 dias antes dos últimos 30.
 */
function semVendaNosTrintaDiasAntes(stats: DashboardStats): boolean {
  const temVenda = (dias: readonly { revenue?: number | null }[]) =>
    dias.some((dia) => (dia.revenue ?? 0) > 0);
  const historico = stats.revenueHistory ?? [];
  // growth 0 sem nenhuma venda nos 60 dias: a RPC devolve 0 quando as duas
  // janelas são zero, e isso não é "0% de crescimento".
  if (stats.growth === 0) return !temVenda(historico.slice(-60));
  if (stats.growth !== 100) return false;
  return !temVenda(historico.slice(-60, -30));
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
                    onClick={() =>
                      onNavigate("admin-products", VISAO_SEM_CUSTO)
                    }
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
            typeof stats?.growth === "number" &&
            Number.isFinite(stats.growth) &&
            !semVendaNosTrintaDiasAntes(stats) && (
              <SeloDeCrescimento valor={stats.growth} />
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
                    onClick={() =>
                      onNavigate("admin-products", VISAO_SEM_CUSTO)
                    }
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
                  {reais(
                    processedRoiData[processedRoiData.length - 1]
                      ?.cumulativeProfit ?? 0,
                  )}
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

        {!loading && stats && chartMode === "roi" && (
          <p className="text-admin-text-soft shrink-0 text-[11px] leading-tight">
            Lucro das vendas. Devolução parcial e estorno só são descontados na
            aba Resultado do Financeiro.
          </p>
        )}

        <div
          className={cn(
            "relative z-10 w-full min-w-0 shrink-0 overflow-hidden transition-opacity duration-300",
            isPending && "opacity-60",
          )}
          style={{
            height: chartMode === "roi" ? ALTURA_LUCRO : ALTURA_VENDAS,
          }}
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
                  margin={{
                    top: MARGEM_TOPO_VENDAS,
                    right: 10,
                    left: -8,
                    bottom: 0,
                  }}
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
                    tickFormatter={formatarBRLCompacto}
                    width={72}
                    tickCount={3}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(16, 185, 129, 0.05)", radius: 8 }}
                    offset={20}
                    position={{ y: 0 }}
                    allowEscapeViewBox={{ x: false, y: false }}
                    wrapperStyle={{ pointerEvents: "none", zIndex: 30 }}
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <BalaoDoGrafico
                            tipo="vendas"
                            data={data.full_date || data.date}
                            receita={data.revenue || 0}
                            pedidos={
                              typeof data.orders === "number" ? data.orders : 0
                            }
                          />
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
                  margin={{
                    top: MARGEM_TOPO_LUCRO,
                    right: 10,
                    left: -8,
                    bottom: 0,
                  }}
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
                    tickFormatter={formatarBRLCompacto}
                    width={72}
                    tickCount={3}
                  />
                  <Tooltip
                    cursor={{
                      stroke: "rgba(255, 255, 255, 0.05)",
                      strokeWidth: 1,
                      strokeDasharray: "4 4",
                    }}
                    offset={20}
                    position={{ y: 0 }}
                    allowEscapeViewBox={{ x: false, y: false }}
                    wrapperStyle={{ pointerEvents: "none", zIndex: 30 }}
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <BalaoDoGrafico
                            tipo="lucro"
                            data={data.full_date || data.date}
                            lucroAcumulado={data.cumulativeProfit}
                            estoqueInvestido={data.inventoryCost}
                          />
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
