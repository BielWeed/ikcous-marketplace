import { AlertCircle, Package, ShoppingBag } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import type { DashboardStats } from '@/hooks/useAnalytics';

interface PendingOperationsQueueProps {
    stats: DashboardStats | null;
    loading: boolean;
    onNavigate: (view: any, id?: string) => void;
}

const SectionTitle = ({ title, icon: Icon }: { title: string; icon: any }) => (
    <div className="flex items-center gap-3 px-2">
        <div className="w-1.5 h-6 bg-admin-gold rounded-full shadow-[0_0_12px_rgba(234,179,8,0.4)]" />
        <Icon className="w-5 h-5 text-zinc-500" />
        <h2 className="text-sm font-black uppercase tracking-[0.2em] text-zinc-400">{title}</h2>
    </div>
);

export function PendingOperationsQueue({ stats, loading, onNavigate }: PendingOperationsQueueProps) {
    const pendingCount = stats?.today?.pending || 0;

    return (
        <div className="space-y-8">
            <SectionTitle title="Fila de Operação" icon={AlertCircle} />
            <div className="admin-glass sm:rounded-[3.5rem] border-y sm:border-x border-white/5 shadow-2xl overflow-hidden relative group">
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
                
                <div className="divide-y divide-white/[0.03] relative z-10">
                    {loading ? (
                        <div className="p-8 space-y-6">
                            {[1, 2].map(i => <Skeleton key={i} className="h-24 w-full rounded-[2rem] bg-white/5 border border-white/5" />)}
                        </div>
                    ) : pendingCount === 0 ? (
                        <div className="p-16 text-center group/empty">
                            <div className="w-24 h-24 bg-zinc-900 rounded-[2.5rem] flex items-center justify-center mx-auto mb-8 border border-white/5 shadow-2xl group-hover/empty:scale-110 transition-transform duration-700">
                                <Package className="w-10 h-10 text-zinc-700 group-hover/empty:text-admin-gold transition-colors" />
                            </div>
                            <h3 className="text-lg font-black tracking-tight text-white mb-2">Monitorando Fluxo</h3>
                            <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.4em]">Operação 100% Estabilizada</p>
                        </div>
                    ) : (
                        <div className="p-10 space-y-8">
                            <div className="relative">
                                <div className="absolute inset-0 bg-rose-500/20 blur-[40px] rounded-full opacity-20" />
                                <div className="w-28 h-28 bg-zinc-950 rounded-[3.5rem] flex items-center justify-center mx-auto border border-rose-500/20 relative z-10 shadow-2xl">
                                    <ShoppingBag className="w-12 h-12 text-rose-500 animate-bounce" />
                                    <div className="absolute -top-1 -right-1 w-10 h-10 bg-rose-600 rounded-full flex items-center justify-center border-4 border-zinc-950 shadow-xl">
                                        <span className="text-xs font-black text-white">{pendingCount}</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="text-center space-y-2">
                                <h3 className="text-2xl font-black tracking-tighter text-white">Pendências Críticas</h3>
                                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Processar {pendingCount} pedidos imediatamente</p>
                            </div>

                            <Button
                                onClick={() => onNavigate('admin-orders')}
                                className="w-full bg-white text-black hover:bg-admin-gold transition-all duration-500 rounded-2xl h-16 font-black text-xs uppercase tracking-[0.2em] shadow-xl group/btn"
                            >
                                <span className="mr-2">Assumir Controle</span>
                                <ShoppingBag className="w-4 h-4 group-hover/btn:rotate-12 transition-transform" />
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

