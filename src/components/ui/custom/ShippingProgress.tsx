import { useState } from 'react';
import { motion } from 'framer-motion';
import { ShoppingCart, Truck, Sparkles as SparklesIcon, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/utils/haptic';
import type { Product } from '@/types';

interface ShippingProgressProps {
    shipping: number;
    savings: number;
    progressPercent: number;
    amountToFree: number;
    isNearlyThere: boolean;
    freeShippingProducts: Product[];
    onAddToCart?: (product: Product, quantity?: number) => void;
}

export function ShippingProgress({
    shipping,
    savings,
    progressPercent,
    amountToFree,
    isNearlyThere,
    freeShippingProducts,
    onAddToCart
}: ShippingProgressProps) {
    const [quantities, setQuantities] = useState<Record<string, number>>({});

    const getQuantity = (productId: string) => quantities[productId] || 1;
    const updateQuantity = (productId: string, delta: number) => {
        haptic.light();
        setQuantities(prev => ({
            ...prev,
            [productId]: Math.max(1, (prev[productId] || 1) + delta)
        }));
    };

    return (
        <div className={cn(
            "px-6 py-7 sm:px-8 text-white shadow-2xl relative overflow-hidden group transition-all duration-700 rounded-none mb-0",
            shipping === 0
                ? "bg-gradient-to-br from-emerald-600 to-emerald-900 shadow-emerald-200/20"
                : "bg-zinc-950 shadow-zinc-200/10"
        )}>
            {/* Animated Background Orbs */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl group-hover:bg-white/10 transition-all duration-1000" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-emerald-500/5 rounded-full translate-y-1/2 -translate-x-1/2 blur-3xl" />

            {/* Top: Premium Header & Status */}
            <div className="flex items-center justify-between mb-8 relative z-10 h-14">
                {/* Visual Spotlight behind the title */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-white/5 blur-[80px] pointer-events-none rounded-full" />

                {/* Left: Premium Icon Badge */}
                <motion.div 
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    whileHover={{ scale: 1.05 }}
                    className={cn(
                        "relative w-12 h-12 rounded-[1.25rem] flex items-center justify-center transition-all duration-500 z-10 shadow-2xl overflow-hidden",
                        shipping === 0 
                            ? "bg-emerald-500/10 border border-emerald-500/30 shadow-emerald-500/10" 
                            : "bg-white/5 border border-white/10 backdrop-blur-md"
                    )}
                >
                    {/* Subtle glass reflection */}
                    <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent opacity-50 pointer-events-none" />
                    
                    {shipping === 0 ? (
                        <SparklesIcon className="w-6 h-6 text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
                    ) : (
                        <Truck className="w-5 h-5 text-zinc-400" />
                    )}
                </motion.div>

                {/* Center: Metallic Title Section */}
                <div className="absolute left-1/2 -translate-x-1/2 text-center w-full pointer-events-none px-12 sm:px-16 z-10 flex flex-col items-center">
                    <h3 className="text-lg sm:text-2xl font-black uppercase tracking-tighter sm:tracking-tight leading-none">
                        <span className="bg-gradient-to-b from-white via-white to-white/40 bg-clip-text text-transparent drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]">
                            {shipping === 0 ? "Frete VIP Liberado" : "Meta Frete Grátis"}
                        </span>
                    </h3>
                    <div className="flex items-center gap-1.5 mt-1.5 opacity-40">
                        <div className={cn("w-1 h-1 rounded-full", shipping === 0 ? "bg-emerald-400 animate-pulse" : "bg-zinc-500")} />
                        <span className="text-[7px] font-bold tracking-[0.2em] text-white uppercase">Premium Delivery Service</span>
                    </div>
                </div>

                {/* Right: Minimalist Savings Area */}
                <div className="flex flex-col items-end min-w-[48px] z-10">
                    {savings > 0 && (
                        <div className="flex flex-col items-end gap-0.5 text-emerald-400 animate-in fade-in slide-in-from-right-4">
                            <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-500 leading-none">Economia</span>
                            <span className="text-xs font-black uppercase tracking-tighter leading-none">R$ {savings.toFixed(2).replace('.', ',')}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Progress System */}
            <div className="mb-8 relative z-10">
                <div className="flex justify-between items-end mb-3 px-1">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Seu Progresso</span>
                        <span className={cn(
                            "text-2xl font-black tracking-tighter leading-none transition-colors duration-500",
                            shipping === 0 ? "text-emerald-400" : isNearlyThere ? "text-amber-400" : "text-white"
                        )}>
                            {Math.floor(progressPercent)}%
                        </span>
                    </div>
                    {shipping > 0 && (
                        <div className="flex flex-col items-end">
                            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-1">Faltam apenas</span>
                            <span className="text-sm font-black text-white leading-none">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amountToFree)}</span>
                        </div>
                    )}
                </div>

                <div className="h-3 w-full bg-white/5 rounded-full overflow-hidden p-0.5 border border-white/5 relative">
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${progressPercent}%` }}
                        transition={{ duration: 1.5, ease: "circOut" }}
                        className={cn(
                            "h-full rounded-full relative transition-colors duration-1000",
                            shipping === 0
                                ? "bg-gradient-to-r from-emerald-400 to-emerald-300"
                                : isNearlyThere
                                    ? "bg-gradient-to-r from-amber-500 to-amber-200"
                                    : "bg-gradient-to-r from-zinc-700 via-zinc-400 to-white"
                        )}
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
                    </motion.div>
                </div>

            </div>

            {/* Free Shipping Catalog Section */}
            {shipping > 0 && freeShippingProducts.length > 0 && (
                <div className="mb-8 relative z-10 animate-in fade-in slide-in-from-bottom-4 duration-1000">
                    <div className="flex items-center justify-between mb-4">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500 flex items-center gap-2">
                            <SparklesIcon className="w-3.5 h-3.5 text-amber-500 fill-amber-500/20" />
                            Atinja a Meta
                        </h4>
                        <div className="h-px flex-1 bg-white/5 mx-4" />
                    </div>

                    <div className="flex gap-4 overflow-x-auto pb-4 -mx-6 px-6 sm:-mx-8 sm:px-8 no-scrollbar scroll-smooth">
                        {freeShippingProducts.map((p: Product) => (
                            <div
                                key={p.id}
                                onClick={() => {
                                    haptic.light();
                                    window.location.href = `?product=${p.id}`;
                                }}
                                className="w-36 flex-shrink-0 group/card cursor-pointer"
                            >
                                <div className="relative aspect-[4/5] bg-zinc-900 rounded-3xl overflow-hidden mb-3 border border-white/10 group-hover/card:border-white/30 transition-all duration-500 shadow-xl">
                                    <img
                                        src={p.images[0]}
                                        alt={p.name}
                                        className="w-full h-full object-cover group-hover/card:scale-110 transition-transform duration-700"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />
                                </div>
                                <div className="px-1">
                                    <div className="h-8 flex items-start mb-1">
                                        <p className="text-[10px] font-black leading-snug text-zinc-400 line-clamp-2 group-hover/card:text-white transition-colors uppercase tracking-tight">
                                            {p.name}
                                        </p>
                                    </div>
                                    <div className="flex flex-col gap-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-[13px] font-black text-white tracking-tighter shrink-0">
                                                R$ {p.price.toFixed(2).replace('.', ',')}
                                            </p>
                                            
                                            <div className="flex items-center gap-1.5 bg-white/5 rounded-xl border border-white/5 p-0.5 ml-auto">
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); updateQuantity(p.id, -1); }}
                                                    className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-white/50 hover:text-white active:scale-90"
                                                >
                                                    <Minus className="w-3 h-3" />
                                                </button>
                                                <span className="text-[11px] font-black text-white w-4 text-center">
                                                    {getQuantity(p.id)}
                                                </span>
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); updateQuantity(p.id, 1); }}
                                                    className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-white/50 hover:text-white active:scale-90"
                                                >
                                                    <Plus className="w-3 h-3" />
                                                </button>
                                            </div>
                                        </div>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                haptic.medium();
                                                onAddToCart?.(p, getQuantity(p.id));
                                            }}
                                            className="w-full py-2.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 transition-all duration-300 flex items-center justify-center gap-2 border border-white/10 hover:border-emerald-300 group/btn active:scale-95 shadow-lg shadow-emerald-500/20"
                                        >
                                            <ShoppingCart className="w-3.5 h-3.5 text-white group-hover/btn:scale-110 transition-transform" />
                                            <span className="text-[10px] font-black text-white uppercase tracking-widest">Adicionar</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
