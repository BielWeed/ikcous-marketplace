import {
  AlertCircle,
  RefreshCw
} from 'lucide-react';
import {
  useEffect,
  useState,
  useCallback
} from 'react';
import { useAnalytics } from '@/hooks/useAnalytics';
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
}

interface CategoryData {
  name: string;
  value: number;
}

export function AdminDashboardView({
  onNavigate
}: Readonly<AdminDashboardViewProps>) {
  const { 
    fetchExecutiveSummary, 
    fetchCategoryAnalytics,
    error: analyticsError, 
    loading: analyticsLoading 
  } = useAnalytics();
  
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [categoryData, setCategoryData] = useState<CategoryData[]>([]);

  const loadDashboardData = useCallback(async () => {
    const [execData, catData] = await Promise.all([
      fetchExecutiveSummary(),
      fetchCategoryAnalytics(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        new Date().toISOString()
      )
    ]);

    if (execData) setStats(execData);
    if (catData) {
      setCategoryData(catData.map((c: { name: string; value: string | number }) => ({ name: c.name, value: Number(c.value) })));
    }
  }, [fetchExecutiveSummary, fetchCategoryAnalytics]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  return (
    <div className="bg-[#09090b] text-white selection:bg-emerald-500/30 w-full overflow-x-hidden pb-10">
        {/* Dashboard Headers Section */}
        <div className="px-6 flex items-center justify-between gap-4 pt-6 pb-2">
            <h1 className="text-2xl md:text-3xl font-black tracking-tighter uppercase leading-none select-none flex items-baseline shrink-0">
                <span className="italic text-white">Dash</span>
                <span className="text-admin-gold not-italic ml-0.5">board</span>
            </h1>
            
            <div className="flex items-center gap-4">
                <button 
                     disabled={analyticsLoading} 
                     onClick={loadDashboardData}
                     className="flex items-center gap-3 px-4 py-2 sm:px-6 sm:py-3 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all group disabled:opacity-50"
                >
                    <RefreshCw className={cn("w-4 h-4 text-zinc-400 group-hover:rotate-180 transition-transform duration-700", analyticsLoading && "animate-spin")} />
                    <span className="hidden sm:inline text-[10px] font-black uppercase tracking-widest text-zinc-400">Sincronizar</span>
                </button>
            </div>
        </div>

        {analyticsError && !analyticsLoading && (
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
                <KpiSummaryCards stats={stats} loading={analyticsLoading} />
            </div>

            {/* Strategic Intelligence Section */}
            <div className="animate-in fade-in slide-in-from-bottom-6 duration-700 delay-150 px-0 sm:px-6">
                <StrategicIntelligenceBlocks 
                    categoryData={categoryData}
                    loading={analyticsLoading}
                />
            </div>

            {/* Performance Grid - Old chart as secondary or removed */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-10 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-300">
                <OperationalPerformanceChart
                    stats={stats}
                    loading={analyticsLoading}
                    className="lg:col-span-3"
                />
            </div>

            {/* Bottom Grid */}
            <div className="grid grid-cols-1 gap-6 sm:gap-10 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-500">
                <TopProductsList
                    stats={stats}
                    loading={analyticsLoading}
                    onNavigate={onNavigate}
                />
            </div>
        </div>
    </div>
  );
}

