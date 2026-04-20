import { cn } from '@/lib/utils';
import { useMemo } from 'react';
import { ShoppingBag, TrendingUp, Star, Users } from 'lucide-react';
import type { DashboardStats } from '@/hooks/useAnalytics';

import { Skeleton } from '@/components/ui/skeleton';

interface KpiSummaryCardsProps {
    stats: DashboardStats | null;
    loading?: boolean;
}

export function KpiSummaryCards({ stats, loading }: KpiSummaryCardsProps) {
    const kpiCards = useMemo(() => [
        { 
            label: 'Volume Mensal', 
            value: `R$ ${(stats?.month?.revenue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
            subValue: "Acumulado do mês", 
            icon: ShoppingBag,
            accent: "text-admin-gold",
            trend: stats?.month?.revenueTrend !== undefined ? `${stats.month.revenueTrend > 0 ? '+' : ''}${stats.month.revenueTrend}%` : "0%"
        },
        { 
            label: 'Pedidos do Mês', 
            value: (stats?.month?.count || 0).toString(), 
            subValue: "Total de vendas", 
            icon: TrendingUp,
            accent: "text-emerald-500",
            trend: stats?.month?.countTrend !== undefined ? `${stats.month.countTrend > 0 ? '+' : ''}${stats.month.countTrend}%` : "0%"
        },
        { 
            label: 'Ticket Médio', 
            value: `R$ ${(stats?.executive?.avgTicket || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
            subValue: "Por transação", 
            icon: Star,
            accent: "text-blue-500",
            trend: stats?.executive?.avgTicketTrend !== undefined ? `${stats.executive.avgTicketTrend > 0 ? '+' : ''}${stats.executive.avgTicketTrend}%` : "0%"
        },
        { 
            label: 'Núcleo Ativo', 
            value: (stats?.executive?.activeCustomers || 0).toString(),
            subValue: "Clientes fiéis", 
            icon: Users,
            accent: "text-purple-500",
            trend: stats?.executive?.activeCustomersTrend !== undefined ? `${stats.executive.activeCustomersTrend > 0 ? '+' : ''}${stats.executive.activeCustomersTrend}%` : "0%"
        },
    ], [stats]);

    return (
        <div className="px-0 sm:px-6 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
            {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="bg-zinc-950 bg-gradient-to-br from-zinc-900/50 to-zinc-950/80 p-5 rounded-[1.5rem] flex flex-col border border-white/[0.04] shadow-2xl relative group hover:border-[var(--admin-gold)]/30 hover:shadow-[0_0_30px_rgba(212,175,55,0.05)] transition-all duration-500 space-y-3 sm:space-y-4" style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}>
                        <div className="flex items-center gap-3">
                            <Skeleton className="w-10 h-10 rounded-xl bg-white/5" />
                            <Skeleton className="h-3 w-20 bg-white/5" />
                        </div>
                        <div className="flex flex-col xl:flex-row xl:items-baseline gap-1 xl:gap-2">
                            <Skeleton className="h-8 w-24 bg-white/5" />
                            <Skeleton className="h-3 w-16 bg-white/5" />
                        </div>
                    </div>
                ))
            ) : (
                kpiCards.map((stat, index) => (
                    <div key={index} className="bg-zinc-950 bg-gradient-to-br from-zinc-900/50 to-zinc-950/80 p-5 rounded-[1.5rem] flex flex-col border border-white/[0.04] shadow-2xl relative group hover:border-[var(--admin-gold)]/30 hover:shadow-[0_0_30px_rgba(212,175,55,0.05)] transition-all duration-500" style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}>
                        <div className="flex items-center gap-3 mb-4">
                            <div className={cn(
                                "w-10 h-10 rounded-xl flex items-center justify-center border border-white/5 shadow-inner bg-zinc-950",
                                stat.accent
                            )}>
                                <stat.icon className="w-4 h-4 flex-shrink-0" />
                            </div>
                            <p className="text-[10px] sm:text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500 leading-tight">
                                {stat.label}
                            </p>
                        </div>
                        <div className="flex flex-col xl:flex-row xl:items-baseline gap-1 xl:gap-2 relative z-10">
                            <h3 className="text-xl sm:text-2xl font-black tracking-tighter text-white leading-none whitespace-nowrap">
                                {stat.value}
                            </h3>
                            <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-tight truncate xl:whitespace-nowrap opacity-80">
                                {stat.subValue}
                            </p>
                        </div>
                    </div>
                ))
            )}
        </div>
    );
}
