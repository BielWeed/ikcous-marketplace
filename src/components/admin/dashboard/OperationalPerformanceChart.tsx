import {
    BarChart,
    Bar,
    XAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer
} from 'recharts';
import { BarChart3, Activity } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { DashboardStats } from '@/hooks/useAnalytics';

interface OperationalPerformanceChartProps {
    stats: DashboardStats | null;
    loading: boolean;
    className?: string;
}

export function OperationalPerformanceChart({ stats, loading, className }: OperationalPerformanceChartProps) {
    return (
        <div className={cn("admin-glass pt-0 pb-6 px-4 sm:pt-0 sm:pb-10 sm:px-10 sm:rounded-[3rem] border border-white/5 space-y-4 sm:space-y-6 relative overflow-hidden group", className)}>
            <div className="absolute -right-20 -bottom-20 w-96 h-96 bg-admin-gold/[0.02] blur-[100px] rounded-full" />
            
            <div className="flex flex-row items-center justify-between relative z-10 px-2 sm:px-0 mt-5">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
                    <div className="-mt-1 sm:-mt-2">
                        <h3 className="text-xl sm:text-3xl font-black tracking-tighter leading-tight bg-gradient-to-r from-white via-white to-white/40 bg-clip-text text-transparent italic uppercase pr-2">Performance</h3>
                        <div className="flex items-center gap-2 mt-0.5 sm:mt-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_12px_rgba(16,185,129,0.4)]" />
                            <p className="text-[8px] sm:text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em]">Fluxo Operacional</p>
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

            </div>

            <div className="h-[200px] sm:h-[300px] w-full relative z-10 px-0">
                {loading ? (
                    <Skeleton className="w-full h-full rounded-3xl bg-white/5 animate-pulse" />
                ) : !stats?.revenueHistory || stats.revenueHistory.length === 0 ? (
                    <div className="w-full h-full rounded-3xl bg-white/5 border border-white/5 flex flex-col items-center justify-center space-y-4">
                         <div className="w-16 h-16 bg-admin-gold/5 rounded-2xl flex items-center justify-center border border-admin-gold/10">
                            <BarChart3 className="w-8 h-8 text-admin-gold/30" />
                        </div>
                        <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em]">Nenhum dado disponível no período</p>
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stats.revenueHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
                            <Tooltip
                                cursor={{ fill: 'rgba(16, 185, 129, 0.05)', radius: 8 }}
                                offset={20}
                                content={({ active, payload }) => {
                                    if (active && payload && payload.length) {
                                        const data = payload[0].payload;
                                        // Garantindo que orders seja um número, mesmo que zero
                                        const orderCount = typeof data.orders === 'number' ? data.orders : 0;
                                        
                                        return (
                                            <div className="bg-zinc-950/98 border border-white/10 px-2.5 py-1.5 rounded-xl backdrop-blur-3xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] flex flex-col gap-1.5 inline-flex pointer-events-none ring-1 ring-white/10 select-none z-50">
                                                {/* Header & Line */}
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[7px] font-black text-white/50 uppercase tracking-[0.2em] leading-none whitespace-nowrap">
                                                        {data.full_date || data.date}
                                                    </span>
                                                    <div className="h-[1px] flex-1 bg-white/10" />
                                                </div>

                                                {/* Metrics Density Row */}
                                                <div className="flex items-center gap-3">
                                                    {/* Revenue Widget */}
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)]" />
                                                        <div className="flex flex-col">
                                                            <span className="text-[5.5px] font-black text-white/40 uppercase tracking-widest leading-none">Receita</span>
                                                            <span className="text-[10px] font-black text-white italic tracking-tighter whitespace-nowrap leading-tight mt-0.5">
                                                                R${(data.revenue || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {/* Orders Widget */}
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
                )}
            </div>
        </div>
    );
}
