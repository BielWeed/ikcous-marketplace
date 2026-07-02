import { useMemo } from 'react';
import { ShoppingBag, TrendingUp, Star, Users } from 'lucide-react';
import type { DashboardStats } from '@/hooks/useAnalytics';
import { Skeleton } from '@/components/ui/skeleton';
import { AdminKpiCarousel, type KpiCardConfig } from '@/components/admin/AdminKpiCarousel';

interface KpiSummaryCardsProps {
    stats: DashboardStats | null;
    loading?: boolean;
}

export function KpiSummaryCards({ stats, loading }: KpiSummaryCardsProps) {
    const kpiCards = useMemo<readonly KpiCardConfig[]>(() => [
        { 
            id: 'volume',
            label: 'Volume Total', 
            value: `R$ ${(stats?.executive?.totalRevenue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
            subValue: "Histórico acumulado", 
            icon: ShoppingBag,
            accent: "text-admin-gold",
        },
        { 
            id: 'pedidos',
            label: 'Total de Pedidos', 
            value: (stats?.executive?.totalOrders || 0).toString(), 
            subValue: "Histórico acumulado", 
            icon: TrendingUp,
            accent: "text-emerald-500",
        },
        { 
            id: 'ticket',
            label: 'Ticket Médio', 
            value: `R$ ${(stats?.executive?.avgTicket || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
            subValue: "Histórico acumulado", 
            icon: Star,
            accent: "text-blue-500",
        },
        { 
            id: 'clientes',
            label: 'Clientes Únicos', 
            value: (stats?.executive?.activeCustomers || 0).toString(),
            subValue: "Histórico acumulado", 
            icon: Users,
            accent: "text-purple-500",
        },
    ], [stats]);

    if (loading) {
        return (
            <div className="w-full space-y-4">
                <div className="px-0 sm:px-6 flex items-center justify-between">
                    <div className="flex items-center gap-2 select-none">
                        <span className="w-1.5 h-1.5 rounded-full bg-admin-gold animate-pulse" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Métricas Principais</span>
                    </div>
                </div>
                <div className="px-0 sm:px-6 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="bg-zinc-950 bg-gradient-to-br from-zinc-900/50 to-zinc-950/80 p-5 rounded-[1.5rem] flex flex-col border border-white/[0.04] shadow-2xl relative space-y-3 sm:space-y-4 w-full">
                            <div className="flex items-center gap-3">
                                <Skeleton className="w-10 h-10 rounded-xl bg-white/5" />
                                <Skeleton className="h-3 w-20 bg-white/5" />
                            </div>
                            <div className="flex flex-col xl:flex-row xl:items-baseline gap-1 xl:gap-2">
                                <Skeleton className="h-8 w-24 bg-white/5" />
                                <Skeleton className="h-3 w-16 bg-white/5" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="w-full px-0 sm:px-6">
            <AdminKpiCarousel cards={kpiCards} title="Métricas Principais" />
        </div>
    );
}
