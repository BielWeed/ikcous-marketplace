import { TrendingUp, Trophy, Star } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { DashboardStats } from '@/hooks/useAnalytics';

interface TopProductsListProps {
    stats: DashboardStats | null;
    loading: boolean;
    onNavigate: (view: any, id?: string) => void;
}

const SectionTitle = ({ title, icon: Icon }: { title: string; icon: any }) => (
    <div className="flex items-center gap-3 px-2 mb-6">
        <div className="relative">
            <div className="w-1.5 h-6 bg-admin-gold rounded-full shadow-[0_0_15px_rgba(234,179,8,0.6)]" />
            <div className="absolute top-0 -left-1 w-3.5 h-6 bg-admin-gold/20 blur-md rounded-full animate-pulse" />
        </div>
        <Icon className="w-5 h-5 text-admin-gold animate-pulse" />
        <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white/90 drop-shadow-sm">{title}</h2>
    </div>
);

export function TopProductsList({ stats, loading, onNavigate }: TopProductsListProps) {
    const products = stats?.topProducts || [];
    const maxTotal = products.length > 0 ? Math.max(...products.map(p => p.total || 0)) : 0;

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.1
            }
        }
    };

    const itemVariants = {
        hidden: { x: -20, opacity: 0 },
        visible: { x: 0, opacity: 1 }
    };

    return (
        <div className="space-y-4">
            <SectionTitle title="top 5 produtos mais lucrativos" icon={Trophy} />
            
            <div className="relative">
                {/* Decorative background element */}
                <div className="absolute -top-20 -right-20 w-64 h-64 bg-admin-gold/5 rounded-full blur-[100px] pointer-events-none" />
                
                <div className="admin-glass sm:rounded-[2.5rem] overflow-hidden border border-white/5 shadow-2xl relative">
                    <div className="absolute inset-0 bg-gradient-to-b from-admin-gold/[0.03] via-transparent to-transparent pointer-events-none" />
                    
                    <div className="p-4 sm:p-6 space-y-3 relative z-10">
                        {loading ? (
                            <div className="space-y-4">
                                {[1, 2, 3, 4, 5].map(i => (
                                    <div key={i} className="flex items-center gap-4 p-4">
                                         <Skeleton className="h-14 w-14 rounded-2xl bg-white/5" />
                                         <div className="flex-1 space-y-2">
                                            <Skeleton className="h-4 w-32 bg-white/5" />
                                            <Skeleton className="h-3 w-40 bg-white/5" />
                                         </div>
                                    </div>
                                ))}
                            </div>
                        ) : products.length === 0 ? (
                            <motion.div 
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="text-center py-20 bg-white/[0.02] rounded-[2rem] border border-white/5"
                            >
                                 <TrendingUp className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
                                 <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em]">Nenhum dado de vendas disponível</p>
                            </motion.div>
                        ) : (
                            <motion.div 
                                variants={containerVariants}
                                initial="hidden"
                                animate="visible"
                                className="space-y-2"
                            >
                                {products.map((item, idx) => {
                                    const isFirst = idx === 0;
                                    const sharePercentage = maxTotal > 0 ? (item.total / maxTotal) * 100 : 0;
                                    
                                    return (
                                        <motion.div
                                            key={item.id}
                                            variants={itemVariants}
                                            onClick={() => onNavigate('admin-products', item.id)}
                                            className={cn(
                                                "group relative flex items-center justify-between p-4 rounded-[1.5rem] transition-all cursor-pointer border border-transparent overflow-hidden",
                                                isFirst 
                                                    ? "bg-gradient-to-r from-admin-gold/[0.08] to-transparent border-admin-gold/20 shadow-lg shadow-admin-gold/10" 
                                                    : "hover:bg-white/[0.03] hover:border-white/10"
                                            )}
                                        >
                                            {/* Progress background bar effect */}
                                            <div className="absolute bottom-0 left-0 h-[2px] bg-admin-gold/10 transition-all duration-1000" style={{ width: `${sharePercentage}%` }} />
                                            
                                            <div className="flex items-center gap-5 relative z-10">
                                                <div className="relative flex items-center justify-center">
                                                    {isFirst ? (
                                                        <div className="absolute -top-2 -left-2 bg-admin-gold rounded-full p-1 shadow-lg shadow-admin-gold/50 z-20">
                                                            <Star className="w-2.5 h-2.5 text-black fill-current" />
                                                        </div>
                                                    ) : null}
                                                    <span className={cn(
                                                        "text-[10px] font-black w-4 transition-colors",
                                                        isFirst ? "text-admin-gold" : "text-zinc-700 group-hover:text-zinc-400"
                                                    )}>
                                                        {(idx + 1).toString().padStart(2, '0')}
                                                    </span>
                                                </div>

                                                <div className={cn(
                                                    "w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-zinc-950 overflow-hidden border relative group-hover:scale-105 transition-transform duration-500 shadow-2xl",
                                                    isFirst ? "border-admin-gold/40 scale-105" : "border-white/10"
                                                )}>
                                                    <img
                                                        src={item.image || `https://placehold.co/100x100/18181b/d4af37?text=${encodeURIComponent(item.name.substring(0, 2))}`}
                                                        alt={item.name}
                                                        className="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
                                                        onError={(e) => {
                                                            (e.target as HTMLImageElement).src = `https://placehold.co/100x100/18181b/d4af37?text=${encodeURIComponent(item.name.substring(0, 2))}`;
                                                        }}
                                                    />
                                                </div>

                                                <div className="flex flex-col gap-1">
                                                    <h4 className={cn(
                                                        "text-xs sm:text-sm font-black transition-all tracking-tight leading-tight",
                                                        isFirst ? "text-white" : "text-zinc-400 group-hover:text-white"
                                                    )}>
                                                        {item.name}
                                                    </h4>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[9px] font-black text-admin-gold/80 uppercase tracking-tighter">
                                                            {item.quantity} {item.quantity === 1 ? 'Venda' : 'Vendas'}
                                                        </span>
                                                        <span className="w-1 h-1 bg-zinc-800 rounded-full" />
                                                        <div className="w-20 sm:w-32">
                                                            <Progress 
                                                                value={sharePercentage} 
                                                                className="h-1 bg-white/5" 
                                                                // @ts-ignore
                                                                indicatorClassName={cn("bg-admin-gold", isFirst ? "shadow-[0_0_8px_rgba(234,179,8,0.5)]" : "")}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="text-right flex flex-col items-end relative z-10">
                                                <span className={cn(
                                                    "text-sm sm:text-base font-black transition-transform origin-right group-hover:scale-110",
                                                    isFirst ? "text-admin-gold font-black" : "text-white"
                                                )}>
                                                    R$ {(item.total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                </span>
                                                <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
                                                    <span className="text-[8px] font-black text-admin-gold uppercase tracking-[0.1em]">Analisar SKU</span>
                                                    <div className="w-1.5 h-1.5 bg-admin-gold rounded-full animate-pulse shadow-[0_0_8px_rgba(234,179,8,0.8)]" />
                                                </div>
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </motion.div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}


