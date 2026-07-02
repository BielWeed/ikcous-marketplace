import {
  AlertCircle,
  RefreshCw,
  HelpCircle,
  Wallet,
  TrendingUp,
  Activity,
  BarChart3
} from 'lucide-react';
import {
  useEffect,
  useState,
  useCallback
} from 'react';
import { useAnalytics } from '@/hooks/useAnalytics';
import { useAuth } from '@/hooks/useAuth';
import type { DashboardStats } from '@/hooks/useAnalytics';
import { Button } from '@/components/ui/button';
import { KpiSummaryCards } from '@/components/admin/dashboard/KpiSummaryCards';
import { OperationalPerformanceChart } from '@/components/admin/dashboard/OperationalPerformanceChart';
import { TopProductsList } from '@/components/admin/dashboard/TopProductsList';
import { StrategicIntelligenceBlocks } from '@/components/admin/dashboard/StrategicIntelligenceBlocks';
import { cn } from '@/lib/utils';
import type { View } from '@/types';

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

export function AdminDashboardView({
  onNavigate,
  active
}: Readonly<AdminDashboardViewProps>) {
  const { session } = useAuth();
  const { 
    fetchExecutiveSummary, 
    fetchCategoryAnalytics,
    error: analyticsError 
  } = useAnalytics();
  
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [categoryData, setCategoryData] = useState<CategoryData[]>([]);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadDashboardData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [execData, catData] = await Promise.all([
        fetchExecutiveSummary(),
        fetchCategoryAnalytics(
          '2020-01-01T00:00:00.000Z',
          new Date().toISOString()
        )
      ]);

      if (execData) setStats(execData);
      if (catData) {
        setCategoryData(
          catData.map((c: { name: string; value: string | number; avg_ticket?: number; orders?: number }) => ({
            name: c.name,
            value: Number(c.value),
            avg_ticket: c.avg_ticket ? Number(c.avg_ticket) : undefined,
            orders: c.orders ? Number(c.orders) : undefined
          }))
        );
      }
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [fetchExecutiveSummary, fetchCategoryAnalytics]);

  useEffect(() => {
    if (session && active) {
      loadDashboardData();
    }
  }, [loadDashboardData, session, active]);

  return (
    <div className="bg-[#09090b] text-white selection:bg-emerald-500/30 w-full overflow-x-hidden pb-10">
        {/* Dashboard Headers Section */}
        <div className="px-6 flex items-center justify-between gap-4 pt-6 pb-2">
            <h1 className="text-2xl md:text-3xl font-black tracking-tighter uppercase leading-none select-none flex items-center gap-3 shrink-0">
                <span className="flex items-baseline flex-nowrap whitespace-nowrap">
                    <span className="italic text-white">Dash</span>
                    <span className="text-admin-gold not-italic ml-0.5">board</span>
                </span>
                <button
                    type="button"
                    onClick={() => setShowHelpModal(true)}
                    className="w-8 h-8 rounded-full flex items-center justify-center border transition-all duration-300 active:scale-95 bg-zinc-900/60 border-white/5 text-zinc-500 hover:text-white hover:border-white/10 shrink-0"
                    title="Guia de Ajuda e Informações"
                >
                    <HelpCircle className="w-4.5 h-4.5" />
                </button>
            </h1>
            
            <div className="flex items-center gap-4">
                <button 
                     disabled={isLoading} 
                     onClick={loadDashboardData}
                     className="flex items-center gap-3 px-4 py-2 sm:px-6 sm:py-3 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all group disabled:opacity-50"
                >
                    <RefreshCw className={cn("w-4 h-4 text-zinc-400 group-hover:rotate-180 transition-transform duration-700", isLoading && "animate-spin")} />
                    <span className="hidden sm:inline text-[10px] font-black uppercase tracking-widest text-zinc-400">Sincronizar</span>
                </button>
            </div>
        </div>

        {analyticsError && !isLoading && (
            <div className="px-6 py-2">
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-4 text-red-400">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <p className="text-xs">Falha ao carregar dados: {analyticsError}</p>
                    <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto border-red-500/20 hover:bg-red-500/10 text-red-400 h-8 text-[10px]"
                        onClick={loadDashboardData}
                    >
                        Tentar
                    </Button>
                </div>
            </div>
        )}

        <div className="space-y-6 sm:space-y-12 px-4 mt-6">
            {/* KPI Overview Section */}
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                <KpiSummaryCards stats={stats} loading={isLoading} />
            </div>

            {/* Strategic Intelligence Section */}
            <div className="animate-in fade-in slide-in-from-bottom-6 duration-700 delay-150 px-0 sm:px-6">
                <StrategicIntelligenceBlocks 
                    categoryData={categoryData}
                    loading={isLoading}
                />
            </div>

            {/* Performance Grid - Old chart as secondary or removed */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-10 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-300">
                <OperationalPerformanceChart
                    stats={stats}
                    loading={isLoading}
                    className="lg:col-span-3"
                />
            </div>

            {/* Bottom Grid */}
            <div className="grid grid-cols-1 gap-6 sm:gap-10 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-500">
                <TopProductsList
                    stats={stats}
                    loading={isLoading}
                    onNavigate={onNavigate}
                />
            </div>
        </div>

        {/* Modal de Ajuda */}
        {showHelpModal && (
          <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300">
            <div className="relative bg-zinc-950/95 border border-white/10 rounded-[2rem] sm:rounded-[2.5rem] w-full max-w-2xl p-5 sm:p-8 flex flex-col max-h-[88vh] sm:max-h-[85vh] shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden animate-in zoom-in-95 duration-300">
              {/* Header */}
              <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4 shrink-0">
                <h3 className="text-sm font-black text-admin-gold uppercase tracking-[0.2em] flex items-center gap-2">
                  <HelpCircle className="w-5 h-5 text-admin-gold animate-pulse" />
                  Central de Inteligência & KPIs
                </h3>
                <button
                  type="button"
                  onClick={() => setShowHelpModal(false)}
                  className="w-8 h-8 rounded-xl bg-zinc-900/50 border border-white/5 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all flex items-center justify-center font-bold text-sm"
                >
                  ✕
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto space-y-6 pr-1 pb-6 custom-scrollbar text-zinc-300 text-sm">
                <div className="space-y-4">
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Bem-vindo ao painel geral de controle do administrador. Esta tela fornece uma visão executiva em tempo real sobre a saúde financeira e operacional do marketplace.
                  </p>

                  <div className="space-y-3">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 border-l-2 border-admin-gold pl-2">
                      Principais Indicadores (KPIs)
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                        <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                          <Wallet className="w-4 h-4 text-emerald-500" />
                          Capital Alocado
                        </div>
                        <p className="text-xs text-zinc-400 leading-relaxed">
                          Representa o custo total acumulado de todos os produtos físicos no estoque atualmente. É a multiplicação do preço de custo de cada item pela quantidade disponível.
                        </p>
                      </div>

                      <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                        <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                          <TrendingUp className="w-4 h-4 text-admin-gold" />
                          Lucro Potencial
                        </div>
                        <p className="text-xs text-zinc-400 leading-relaxed">
                          O lucro bruto estimado que a loja receberá quando todas as unidades em estoque forem vendidas pelos respectivos preços de venda cadastrados.
                        </p>
                      </div>

                      <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                        <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                          <Activity className="w-4 h-4 text-sky-500" />
                          Faturamento
                        </div>
                        <p className="text-xs text-zinc-400 leading-relaxed">
                          Volume financeiro bruto total gerado pelas vendas faturadas/pagas no período. Reflete a tração geral e o volume de transações.
                        </p>
                      </div>

                      <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                        <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider text-purple-400">
                          <BarChart3 className="w-4 h-4 text-purple-500" />
                          Ticket Médio
                        </div>
                        <p className="text-xs text-zinc-400 leading-relaxed">
                          O valor médio consumido por pedido (Faturamento dividido pelo total de pedidos pagos). Útil para entender o comportamento de compra do cliente.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 border-l-2 border-admin-gold pl-2">
                      Outros Componentes
                    </h4>
                    <ul className="space-y-2 text-xs text-zinc-400 list-disc list-inside">
                      <li><strong className="text-white">Performance Operacional:</strong> Histórico de pedidos e faturamento ao longo do tempo em gráficos interativos.</li>
                      <li><strong className="text-white">Inteligência Estratégica por Categoria:</strong> Divisão proporcional de faturamento, volume de vendas e ticket médio por categoria de produto.</li>
                      <li><strong className="text-white">Produtos Mais Vendidos:</strong> Ranking de popularidade e unidades despachadas de cada produto do catálogo.</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="pt-4 border-t border-white/5 flex justify-end shrink-0">
                <button
                  type="button"
                  onClick={() => setShowHelpModal(false)}
                  className="px-5 py-2.5 rounded-xl bg-admin-gold text-black text-[10px] font-black uppercase tracking-widest hover:bg-admin-gold/90 transition-all"
                >
                  Entendi
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

