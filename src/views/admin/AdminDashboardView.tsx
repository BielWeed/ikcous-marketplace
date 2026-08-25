import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { KpiSummaryCards } from "@/components/admin/dashboard/KpiSummaryCards";
import { OperationalPerformanceChart } from "@/components/admin/dashboard/OperationalPerformanceChart";
import { StrategicIntelligenceBlocks } from "@/components/admin/dashboard/StrategicIntelligenceBlocks";
import { TopProductsList } from "@/components/admin/dashboard/TopProductsList";
import { Button } from "@/components/ui/button";
import { LocalErrorBoundary } from "@/components/ui/custom/LocalErrorBoundary";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useAuth } from "@/hooks/useAuth";
import { useLeaderElection } from "@/hooks/useLeaderElection";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import {
  Activity,
  AlertCircle,
  BarChart3,
  HelpCircle,
  RefreshCw,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

interface AdminDashboardViewProps {
  onNavigate: (view: View, id?: string) => void;
  active?: boolean;
}

interface CategoryData {
  name: string;
  value: number;
  avg_ticket?: number;
  orders?: number;
}

export const AdminDashboardView = memo(function AdminDashboardView({
  onNavigate,
  active,
}: Readonly<AdminDashboardViewProps>) {
  const { session } = useAuth();
  const isOffline = useOnlineStatus();
  const { ref: viewRef } = useScrollRestoration(
    "admin-dashboard",
    active ?? false,
  );
  const {
    fetchExecutiveSummary,
    fetchCategoryAnalytics,
    stats,
    categoryData,
    error: analyticsError,
    categoryError,
  } = useAnalytics();

  const [showHelpModal, setShowHelpModal] = useState(false);
  const [isLoading, setIsLoading] = useState(() => !stats || !categoryData);

  const statsRef = useRef(stats);
  const categoryDataRef = useRef(categoryData);

  useEffect(() => {
    statsRef.current = stats;
    categoryDataRef.current = categoryData;
  }, [stats, categoryData]);

  const loadDashboardData = useCallback(
    async (force = false) => {
      const hasData = !!statsRef.current && !!categoryDataRef.current;
      if (!hasData || force) {
        setIsLoading(true);
      }
      try {
        await Promise.all([
          fetchExecutiveSummary(force),
          fetchCategoryAnalytics(
            "2020-01-01T00:00:00.000Z",
            new Date().toISOString(),
            force,
          ),
        ]);
      } catch (err) {
        console.error("Error loading dashboard data:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [fetchExecutiveSummary, fetchCategoryAnalytics],
  );

  const { isLeader } = useLeaderElection();
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerRealtimeRefresh = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      console.log(
        "[AdminDashboardView] Debounced real-time refresh triggering...",
      );
      loadDashboardData(true);
    }, 1500); // 1.5s protection buffer to safeguard DB
  }, [loadDashboardData]);

  // Real-time synchronization subscription for active admin dashboard
  useEffect(() => {
    if (!session || !active) return;

    console.log(
      `[AdminDashboardView] Setting up real-time listener (isLeader: ${isLeader})`,
    );
    const bc = new BroadcastChannel("ikcous_admin_dashboard_realtime");
    let ordersChannel: any = null;
    let productsChannel: any = null;
    let reviewsChannel: any = null;
    let qaChannel: any = null;

    if (isLeader) {
      console.log(
        "[AdminDashboardView-Leader] Establishing active Supabase subscriptions...",
      );

      const handleDbChange = (payload: any) => {
        console.log(
          "[AdminDashboardView-Leader] Detected DB change on:",
          payload.table,
          payload.eventType,
        );
        triggerRealtimeRefresh();
        bc.postMessage({ type: "dashboard_refresh" });
      };

      ordersChannel = supabase
        .channel("admin-dashboard-orders")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "marketplace_orders" },
          handleDbChange,
        )
        .subscribe();

      productsChannel = supabase
        .channel("admin-dashboard-products")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "produtos" },
          handleDbChange,
        )
        .subscribe();

      reviewsChannel = supabase
        .channel("admin-dashboard-reviews")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "reviews" },
          handleDbChange,
        )
        .subscribe();

      qaChannel = supabase
        .channel("admin-dashboard-qa")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "questions" },
          handleDbChange,
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "answers" },
          handleDbChange,
        )
        .subscribe();
    } else {
      console.log(
        "[AdminDashboardView-Follower] Listening to updates via BroadcastChannel...",
      );
      bc.onmessage = (event) => {
        if (event.data?.type === "dashboard_refresh") {
          console.log(
            "[AdminDashboardView-Follower] Received refresh signal from Leader tab",
          );
          triggerRealtimeRefresh();
        }
      };
    }

    return () => {
      console.log(
        "[AdminDashboardView] Cleaning up real-time coordination resources",
      );
      bc.close();
      if (ordersChannel) supabase.removeChannel(ordersChannel);
      if (productsChannel) supabase.removeChannel(productsChannel);
      if (reviewsChannel) supabase.removeChannel(reviewsChannel);
      if (qaChannel) supabase.removeChannel(qaChannel);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [session, active, isLeader, triggerRealtimeRefresh]);

  const mappedCategoryData = useMemo<CategoryData[]>(() => {
    if (!categoryData) return [];
    return categoryData.map(
      (c: {
        name: string;
        value: string | number;
        avg_ticket?: number;
        orders?: number;
      }) => ({
        name: c.name,
        value: Number(c.value),
        avg_ticket: c.avg_ticket ? Number(c.avg_ticket) : undefined,
        orders: c.orders ? Number(c.orders) : undefined,
      }),
    );
  }, [categoryData]);

  useEffect(() => {
    if (session && active) {
      const timer = setTimeout(() => {
        loadDashboardData(false);
      }, 320);
      return () => clearTimeout(timer);
    }
  }, [loadDashboardData, session, active]);

  // Auto-refresh when coming back online
  const wasOfflineRef = useRef(isOffline);
  useEffect(() => {
    if (wasOfflineRef.current && !isOffline && active) {
      toast.success("Conexão restabelecida. Atualizando dashboard...", {
        icon: "⚡",
      });
      loadDashboardData(true);
    }
    wasOfflineRef.current = isOffline;
  }, [isOffline, active, loadDashboardData]);

  return (
    <div
      ref={viewRef}
      className="h-auto bg-[#09090b] pb-admin lg:pb-12 text-white selection:bg-emerald-500/30"
    >
      {/* Dashboard Headers Section */}
      <div className="flex items-center justify-between gap-4 px-6 pb-2 pt-6">
        <h1 className="flex shrink-0 select-none items-center gap-3 text-2xl font-black uppercase leading-none tracking-tighter md:text-3xl">
          <span className="flex flex-nowrap items-baseline whitespace-nowrap">
            <span className="italic text-white">Dashboard</span>
          </span>
          <button
            type="button"
            onClick={() => setShowHelpModal(true)}
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/5 bg-zinc-900/60 text-zinc-500 transition-all duration-300 hover:border-white/10 hover:text-white active:scale-95"
            title="Guia de Ajuda e Informações"
          >
            <HelpCircle className="size-4.5" />
          </button>
        </h1>

        <div className="flex items-center gap-4">
          <button
            disabled={isLoading || isOffline}
            onClick={() => !isOffline && loadDashboardData(true)}
            className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 transition-all hover:bg-white/10 disabled:opacity-50 sm:px-6 sm:py-3"
          >
            <RefreshCw
              className={cn(
                "w-4 h-4 text-zinc-400 group-hover:rotate-180 transition-transform duration-700",
                isLoading && "animate-spin",
              )}
            />
            <span className="hidden text-[10px] font-black uppercase tracking-widest text-zinc-400 sm:inline">
              Sincronizar
            </span>
          </button>
        </div>
      </div>

      {analyticsError && !isLoading && (
        <div className="px-6 py-2">
          <div className="flex items-center gap-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-red-400">
            <AlertCircle className="size-5 shrink-0" />
            <p className="text-xs">Falha ao carregar dados: {analyticsError}</p>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-8 border-red-500/20 text-[10px] text-red-400 hover:bg-red-500/10"
              onClick={() => loadDashboardData(true)}
            >
              Tentar
            </Button>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-6 px-4 sm:space-y-12">
        {/* KPI Overview Section */}
        <div className="duration-300 animate-in fade-in slide-in-from-bottom-2">
          <LocalErrorBoundary>
            <KpiSummaryCards
              stats={stats}
              loading={isLoading && !stats}
              active={active}
            />
          </LocalErrorBoundary>
        </div>

        {/* Strategic Intelligence Section */}
        <div className="px-0 delay-75 duration-300 animate-in fade-in slide-in-from-bottom-2 sm:px-6">
          <LocalErrorBoundary>
            <StrategicIntelligenceBlocks
              categoryData={mappedCategoryData}
              loading={isLoading && !stats}
              active={active}
              error={categoryError}
              onRetry={() => loadDashboardData(true)}
            />
          </LocalErrorBoundary>
        </div>

        {/* Performance Grid - Old chart as secondary or removed */}
        <div className="grid grid-cols-1 gap-6 delay-100 duration-300 animate-in fade-in slide-in-from-bottom-2 sm:gap-10 lg:grid-cols-3">
          <LocalErrorBoundary>
            <OperationalPerformanceChart
              stats={stats}
              loading={isLoading && !stats}
              active={active}
              className="lg:col-span-3"
            />
          </LocalErrorBoundary>
        </div>

        {/* Bottom Grid */}
        <div className="grid grid-cols-1 gap-6 delay-150 duration-300 animate-in fade-in slide-in-from-bottom-2 sm:gap-10">
          <LocalErrorBoundary>
            <TopProductsList
              stats={stats}
              loading={isLoading && !stats}
              onNavigate={onNavigate}
            />
          </LocalErrorBoundary>
        </div>
      </div>

      {/* Modal de Ajuda */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Central de Inteligência & KPIs"
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-zinc-400">
            Bem-vindo ao painel geral de controle do administrador. Esta tela
            fornece uma visão executiva em tempo real sobre a saúde financeira e
            operacional do marketplace.
          </p>

          <div className="space-y-3">
            <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Principais Indicadores (KPIs)
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Wallet className="size-4 text-emerald-500" />
                  Capital Alocado
                </div>
                <p className="text-xs leading-relaxed text-zinc-400">
                  Representa o custo total acumulado de todos os produtos
                  físicos no estoque atualmente. É a multiplicação do preço de
                  custo de cada item pela quantidade disponível.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <TrendingUp className="size-4 text-admin-gold" />
                  Lucro Potencial
                </div>
                <p className="text-xs leading-relaxed text-zinc-400">
                  O lucro bruto estimado que a loja receberá quando todas as
                  unidades em estoque forem vendidas pelos respectivos preços de
                  venda cadastrados.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Activity className="size-4 text-sky-500" />
                  Faturamento
                </div>
                <p className="text-xs leading-relaxed text-zinc-400">
                  Volume financeiro bruto total gerado pelas vendas
                  faturadas/pagas no período. Reflete a tração geral e o volume
                  de transações.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <BarChart3 className="size-4 text-purple-500" />
                  Ticket Médio
                </div>
                <p className="text-xs leading-relaxed text-zinc-400">
                  O valor médio consumido por pedido (Faturamento dividido pelo
                  total de pedidos pagos). Útil para entender o comportamento de
                  compra do cliente.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Outros Componentes
            </h4>
            <ul className="list-inside list-disc space-y-2 text-xs text-zinc-400">
              <li>
                <strong className="text-white">Performance Operacional:</strong>{" "}
                Histórico de pedidos e faturamento ao longo do tempo em gráficos
                interativos.
              </li>
              <li>
                <strong className="text-white">
                  Inteligência Estratégica por Categoria:
                </strong>{" "}
                Divisão proporcional de faturamento, volume de vendas e ticket
                médio por categoria de produto.
              </li>
              <li>
                <strong className="text-white">Produtos Mais Lucrativos:</strong>{" "}
                Os cinco produtos com maior lucro (preço de venda menos o
                custo cadastrado) em pedidos válidos de todo o período.
                Produto sem custo cadastrado conta custo zero — cadastre o
                custo para o ranking refletir a margem de verdade.
              </li>
            </ul>
          </div>
        </div>
      </AdminHelpModal>
    </div>
  );
});
