import {
    BarChart,
    Bar,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer
} from 'recharts';
import { BarChart3, Activity } from 'lucide-react';
import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { DashboardStats } from '@/hooks/useAnalytics';
import { useDeferredRender } from '@/hooks/useDeferredRender';

interface OperationalPerformanceChartProps {
    stats: DashboardStats | null;
    loading: boolean;
    className?: string;
}

export function OperationalPerformanceChart({ stats, loading, className }: OperationalPerformanceChartProps) {
    const isDeferredReady = useDeferredRender(180);
    const [chartMode, setChartMode] = useState<'revenue' | 'roi'>('revenue');
    const [timeframe, setTimeframe] = useState<'30' | '90' | 'all'>('30');

    // Filter history based on timeframe before processing
    const filteredRevenueHistory = stats?.revenueHistory ? (
        timeframe === '30' 
            ? stats.revenueHistory.slice(-30) 
            : timeframe === '90' 
                ? stats.revenueHistory.slice(-90) 
                : stats.revenueHistory
    ) : [];

    // Process data for ROI chart
    const processedRoiData = (() => {
        if (!filteredRevenueHistory || filteredRevenueHistory.length === 0) return [];
        
        const totalCost = stats?.inventory?.totalCost ?? 0;
        let runningInventoryCost = totalCost;
        let runningCumulativeProfit = 0;
        
        // Reverse array to reconstruct inventory cost backwards
        const reversedHistory = [...filteredRevenueHistory].reverse();
        const historyWithInv = reversedHistory.map(day => {
            const costOnDay = runningInventoryCost;
            runningInventoryCost += (day.cost_sold ?? 0);
            return {
                ...day,
                inventoryCost: costOnDay
            };
        }).reverse();
        
        // Go forward to calculate cumulative profit
        return historyWithInv.map(day => {
            runningCumulativeProfit += (day.profit ?? 0);
            return {
                ...day,
                inventoryCost: Number(day.inventoryCost.toFixed(2)),
                cumulativeProfit: Number(runningCumulativeProfit.toFixed(2)),
                revenue: Number(day.revenue)
            };
        });
    })();

    return (
        <div className={cn("admin-glass pt-0 pb-6 px-4 sm:pt-0 sm:pb-10 sm:px-10 sm:rounded-[3rem] border border-white/5 space-y-4 sm:space-y-6 relative overflow-hidden group", className)}>
            <div className="absolute -right-20 -bottom-20 w-96 h-96 bg-admin-gold/[0.02] blur-[100px] rounded-full" />
            
            <div className="flex flex-row items-center justify-between relative z-10 px-2 sm:px-0 mt-5">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
                    <div className="-mt-1 sm:-mt-2">
                        <h3 className="text-xl sm:text-3xl font-black tracking-tighter leading-tight bg-gradient-to-r from-white via-white to-white/40 bg-clip-text text-transparent italic uppercase pr-2">Performance</h3>
                        <div className="flex items-center gap-2 mt-0.5 sm:mt-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_12px_rgba(16,185,129,0.4)]" />
                            <p className="text-[8px] sm:text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em]">
                                {chartMode === 'revenue' ? 'Fluxo Operacional' : 'Retorno sobre Estoque'}
                            </p>
                        </div>
                    </div>

                    {!loading && (stats?.growth !== undefined || stats?.today?.revenueTrend !== undefined) && (
                        <div className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                            <Activity className="w-3 h-3 text-emerald-500" />
                            <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest leading-none">
                                {((stats?.growth ?? stats?.today?.revenueTrend ?? 0) >= 0 ? '+' : '')}
                                {(stats?.growth ?? stats?.today?.revenueTrend ?? 0).toFixed(1)}%
                            </span>
                        </div>
                    )}
                </div>

                <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3 relative z-30">
                    {/* Timeframe Selectors */}
                    <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-2xl p-1 shrink-0">
                        {(['30', '90', 'all'] as const).map((t) => (
                            <button
                                key={t}
                                onClick={() => setTimeframe(t)}
                                className={cn(
                                    "px-2 py-1 sm:px-3 sm:py-1.5 rounded-xl text-[8px] sm:text-[9px] font-black uppercase tracking-wider transition-all select-none",
                                    timeframe === t 
                                        ? "bg-white text-black shadow-lg" 
                                        : "text-zinc-400 hover:text-white hover:bg-white/5"
                                )}
                            >
                                {t === 'all' ? 'Tudo' : `${t}D`}
                            </button>
                        ))}
                    </div>

                    {/* Toggle Chart Mode Buttons */}
                    <div className="flex items-center gap-1 sm:gap-2 bg-white/5 border border-white/10 rounded-2xl p-1 shrink-0">
                        <button
                            onClick={() => setChartMode('revenue')}
                            className={cn(
                                "px-2 py-1 sm:px-3 sm:py-1.5 rounded-xl text-[8px] sm:text-[9px] font-black uppercase tracking-wider transition-all select-none",
                                chartMode === 'revenue' 
                                    ? "bg-white text-black shadow-lg" 
                                    : "text-zinc-400 hover:text-white hover:bg-white/5"
                            )}
                        >
                            Faturamento
                        </button>
                        <button
                            onClick={() => setChartMode('roi')}
                            className={cn(
                                "px-2 py-1 sm:px-3 sm:py-1.5 rounded-xl text-[8px] sm:text-[9px] font-black uppercase tracking-wider transition-all select-none",
                                chartMode === 'roi' 
                                    ? "bg-emerald-500 text-black shadow-lg" 
                                    : "text-zinc-400 hover:text-white hover:bg-white/5"
                            )}
                        >
                            ROI do Estoque
                        </button>
                    </div>
                </div>
            </div>

            {/* Premium Summary Metrics Panel */}
            {!loading && stats && (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 relative z-10 px-2 sm:px-0 mt-2 text-[9px] sm:text-xs text-zinc-400 font-bold uppercase tracking-wider select-none animate-in fade-in slide-in-from-top-2 duration-300">
                    {chartMode === 'revenue' ? (
                        <>
                            <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                <span>Faturamento Total: <strong className="text-white italic text-[11px] sm:text-sm font-black tracking-tighter">R$ {(stats.executive?.totalRevenue ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</strong></span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                                <span>Pedidos: <strong className="text-white italic text-[11px] sm:text-sm font-black tracking-tighter">{(stats.executive?.totalOrders ?? 0)}</strong></span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-admin-gold" />
                                <span>Ticket Médio: <strong className="text-white italic text-[11px] sm:text-sm font-black tracking-tighter">R$ {(stats.averageTicket ?? stats.executive?.avgTicket ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</strong></span>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]" />
                                <span>Estoque Atual (Custo): <strong className="text-white italic text-[11px] sm:text-sm font-black tracking-tighter">R$ {(stats.inventory?.totalCost ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
                                <span>Lucro Acumulado: <strong className="text-white italic text-[11px] sm:text-sm font-black tracking-tighter">R$ {processedRoiData[processedRoiData.length - 1]?.cumulativeProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '0,00'}</strong></span>
                            </div>
                            {stats.inventory?.totalCost && stats.inventory.totalCost > 0 && (
                                <div className="flex items-center gap-1 bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/20 text-emerald-400 font-extrabold normal-case">
                                    <span>Recuperação: {((processedRoiData[processedRoiData.length - 1]?.cumulativeProfit ?? 0) / stats.inventory.totalCost * 100).toFixed(0)}%</span>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            <div className="h-[200px] sm:h-[300px] w-full relative z-10 px-0">
                {loading || !isDeferredReady ? (
                    <Skeleton className="w-full h-full rounded-3xl bg-white/5 animate-pulse" />
                ) : !stats?.revenueHistory || stats.revenueHistory.length === 0 ? (
                    <div className="w-full h-full rounded-3xl bg-white/5 border border-white/5 flex flex-col items-center justify-center space-y-4">
                         <div className="w-16 h-16 bg-admin-gold/5 rounded-2xl flex items-center justify-center border border-admin-gold/10">
                            <BarChart3 className="w-8 h-8 text-admin-gold/30" />
                        </div>
                        <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em]">Nenhum dado disponível no período</p>
                    </div>
                ) : chartMode === 'revenue' ? (
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                        <BarChart data={filteredRevenueHistory} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                            <CartesianGrid vertical={false} stroke="#ffffff" strokeOpacity={0.03} strokeDasharray="4 4" />
                            <XAxis
                                dataKey="date"
                                axisLine={false}
                                tickLine={false}
                                fontSize={9}
                                tick={{ fill: '#71717a', fontWeight: 900 }}
                                tickFormatter={(val) => {
                                    const part = val.split('-');
                                    return part.length >= 3 ? `${part[2]}/${part[1]}` : val;
                                }}
                                dy={10}
                            />
                            <YAxis
                                axisLine={false}
                                tickLine={false}
                                fontSize={8}
                                tick={{ fill: '#71717a', fontWeight: 900 }}
                                tickFormatter={(val) => val >= 1000 ? `R$ ${(val/1000).toFixed(0)}k` : `R$ ${val}`}
                                width={45}
                            />
                            <Tooltip
                                cursor={{ fill: 'rgba(16, 185, 129, 0.05)', radius: 8 }}
                                offset={20}
                                content={({ active, payload }) => {
                                    if (active && payload && payload.length) {
                                        const data = payload[0].payload;
                                        const orderCount = typeof data.orders === 'number' ? data.orders : 0;
                                        
                                        return (
                                            <div className="bg-zinc-950/98 border border-white/10 px-2.5 py-1.5 rounded-xl backdrop-blur-3xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] flex flex-col gap-1.5 inline-flex pointer-events-none ring-1 ring-white/10 select-none z-50">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[7px] font-black text-white/50 uppercase tracking-[0.2em] leading-none whitespace-nowrap">
                                                        {data.full_date || data.date}
                                                    </span>
                                                    <div className="h-[1px] flex-1 bg-white/10" />
                                                </div>

                                                <div className="flex items-center gap-3">
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)]" />
                                                        <div className="flex flex-col">
                                                            <span className="text-[5.5px] font-black text-white/40 uppercase tracking-widest leading-none">Receita</span>
                                                            <span className="text-[10px] font-black text-white italic tracking-tighter whitespace-nowrap leading-tight mt-0.5">
                                                                R${(data.revenue || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-1.5 bg-emerald-500/10 px-2 py-1 rounded-lg border border-emerald-500/20">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                                        <div className="flex flex-col">
                                                            <span className="text-[5.5px] font-black text-emerald-500/50 uppercase tracking-widest leading-none">Pedidos</span>
                                                            <span className="text-[10px] font-black text-emerald-500 italic tracking-tighter leading-tight mt-0.5">
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
                            <Bar dataKey="revenue" fill="#10b981" radius={[6, 6, 6, 6]} opacity={0.3} barSize={20} className="hover:opacity-60 transition-opacity cursor-pointer" />
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                        <AreaChart data={processedRoiData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                </linearGradient>
                                <linearGradient id="colorInventory" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.08}/>
                                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid vertical={false} stroke="#ffffff" strokeOpacity={0.03} strokeDasharray="4 4" />
                            <XAxis
                                dataKey="date"
                                axisLine={false}
                                tickLine={false}
                                fontSize={9}
                                tick={{ fill: '#71717a', fontWeight: 900 }}
                                tickFormatter={(val) => {
                                    const part = val.split('-');
                                    return part.length >= 3 ? `${part[2]}/${part[1]}` : val;
                                }}
                                dy={10}
                            />
                            <YAxis
                                axisLine={false}
                                tickLine={false}
                                fontSize={8}
                                tick={{ fill: '#71717a', fontWeight: 900 }}
                                tickFormatter={(val) => val >= 1000 ? `R$ ${(val/1000).toFixed(0)}k` : `R$ ${val}`}
                                width={45}
                            />
                            <Tooltip
                                cursor={{ stroke: 'rgba(255, 255, 255, 0.05)', strokeWidth: 1, strokeDasharray: '4 4' }}
                                offset={20}
                                content={({ active, payload }) => {
                                    if (active && payload && payload.length) {
                                        const data = payload[0].payload;
                                        return (
                                            <div className="bg-zinc-950/98 border border-white/10 px-2.5 py-2 rounded-xl backdrop-blur-3xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] flex flex-col gap-1.5 inline-flex pointer-events-none ring-1 ring-white/10 select-none z-50">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[7px] font-black text-white/50 uppercase tracking-[0.2em] leading-none whitespace-nowrap">
                                                        {data.full_date || data.date}
                                                    </span>
                                                    <div className="h-[1px] flex-1 bg-white/10" />
                                                </div>

                                                <div className="flex flex-col gap-1.5">
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                                                        <div className="flex flex-col">
                                                            <span className="text-[5.5px] font-black text-emerald-500/70 uppercase tracking-widest leading-none">Lucro Acumulado</span>
                                                            <span className="text-[10px] font-black text-white italic tracking-tighter whitespace-nowrap leading-tight mt-0.5">
                                                                R${data.cumulativeProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-1.5">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
                                                        <div className="flex flex-col">
                                                            <span className="text-[5.5px] font-black text-amber-500/70 uppercase tracking-widest leading-none">Valor Investido (Estoque)</span>
                                                            <span className="text-[10px] font-black text-white italic tracking-tighter whitespace-nowrap leading-tight mt-0.5">
                                                                R${data.inventoryCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                                activeDot={{ r: 5, fill: '#10b981', stroke: '#fff', strokeWidth: 1.5 }}
                                name="Lucro Acumulado"
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
                                activeDot={{ r: 5, fill: '#f59e0b', stroke: '#fff', strokeWidth: 1.5 }}
                                name="Valor Investido (Estoque)"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
}
