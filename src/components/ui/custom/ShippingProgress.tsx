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
            "mx-4 sm:mx-6 mt-4 mb-2 p-4 sm:p-5 rounded-[2rem] relative overflow-hidden transition-all duration-700 border",
            shipping === 0
                ? "bg-gradient-to-br from-emerald-50 via-white to-emerald-50/50 border-emerald-100 shadow-[0_8px_30px_-10px_rgba(16,185,129,0.15)]"
                : "bg-white border-zinc-200/60 shadow-[0_8px_30px_-10px_rgba(0,0,0,0.06)]"
        )}>
            {/* Animated Orbs for Premium Vibe */}
            {shipping === 0 && (
                <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-400/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
            )}

            {/* Top Row: Icon + Title + Savings */}
            <div className="flex items-center gap-3 mb-4 relative z-10">
                <motion.div 
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className={cn(
                        "w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-sm transition-colors duration-500",
                        shipping === 0 
                            ? "bg-gradient-to-b from-emerald-400 to-emerald-600 text-white shadow-emerald-500/30" 
                            : "bg-zinc-100 text-zinc-900 border border-zinc-200"
                    )}
                >
                    {shipping === 0 ? <SparklesIcon className="w-5 h-5 drop-shadow-md" /> : <Truck className="w-5 h-5" />}
                </motion.div>

                <div className="flex-1 min-w-0">
                    <h3 className={cn(
                        "text-sm font-black uppercase tracking-tight truncate transition-colors",
                        shipping === 0 ? "text-emerald-700" : "text-zinc-900"
                    )}>
                        {shipping === 0 ? "Frete VIP Liberado" : "Meta Frete Grátis"}
                    </h3>
                    <p className={cn(
                        "text-[10px] font-bold uppercase tracking-widest mt-0.5",
                        shipping === 0 ? "text-emerald-600/70" : "text-zinc-400"
                    )}>
                        {shipping === 0 ? "Premium Service Ativado" : "Benefício exclusivo"}
                    </p>
                </div>
                
                {savings > 0 && (
                    <div className="text-right flex flex-col items-end animate-in fade-in slide-in-from-right-4">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-600/70 mb-0.5">Economia</span>
                        <span className="text-xs sm:text-sm font-black text-emerald-600 tracking-tighter shrink-0 bg-emerald-100/50 px-2 py-0.5 rounded-lg">
                           + {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(savings)}
                        </span>
                    </div>
                )}
            </div>

            {/* Progress Bar System */}
            <div className="relative z-10">
                <div className="flex justify-between items-end mb-1.5 px-0.5">
                    <span className={cn(
                        "text-sm font-black tracking-tighter transition-colors",
                        shipping === 0 ? "text-emerald-600" : "text-zinc-900"
                    )}>
                        {Math.floor(progressPercent)}%
                    </span>
                    {shipping > 0 && (
                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                            Faltam <strong className="text-zinc-900 font-black tracking-tight">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amountToFree)}</strong>
                        </span>
                    )}
                </div>

                <div className={cn(
                    "h-2.5 w-full rounded-full overflow-hidden p-[2px]",
                    shipping === 0 ? "bg-emerald-100" : "bg-zinc-100"
                )}>
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${progressPercent}%` }}
                        transition={{ duration: 1.5, ease: "circOut" }}
                        className={cn(
                            "h-full rounded-full relative transition-colors duration-1000",
                            shipping === 0
                                ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                                : isNearlyThere
                                    ? "bg-amber-400"
                                    : "bg-zinc-900"
                        )}
                    />
                </div>
            </div>

            {/* Free Shipping Catalog Section (Compact) */}
            {shipping > 0 && freeShippingProducts.length > 0 && (
                <div className="mt-5 pt-4 border-t border-zinc-100 border-dashed relative z-10 animate-in fade-in slide-in-from-bottom-4 duration-1000">
                    <div className="flex items-center justify-between mb-3 px-1">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
                            <SparklesIcon className="w-3.5 h-3.5 text-amber-500" />
                            Atinja a Meta
                        </h4>
                    </div>

                    <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 sm:-mx-5 sm:px-5 no-scrollbar scroll-smooth">
                        {freeShippingProducts.map((p: Product) => (
                            <div
                                key={p.id}
                                onClick={() => {
                                    haptic.light();
                                    window.location.href = `?product=${p.id}`;
                                }}
                                className="w-[124px] flex-shrink-0 group/card cursor-pointer bg-zinc-50 rounded-2xl p-2 border border-zinc-100 hover:border-zinc-300 transition-colors"
                            >
                                <div className="relative aspect-square bg-white rounded-xl overflow-hidden mb-2 shadow-sm border border-black/[0.03]">
                                    <img
                                        src={p.images[0]}
                                        alt={p.name}
                                        className="w-full h-full object-cover group-hover/card:scale-105 transition-transform duration-500"
                                    />
                                </div>
                                <div className="px-0.5">
                                    <p className="text-[9px] font-black leading-snug text-zinc-600 line-clamp-2 uppercase tracking-tight mb-1">
                                        {p.name}
                                    </p>
                                    <p className="text-[11px] font-black text-zinc-900 tracking-tighter mb-2">
                                        R$ {p.price.toFixed(2).replace('.', ',')}
                                    </p>
                                    
                                    <div className="flex items-center justify-between gap-1 mb-2 bg-white rounded-lg border border-zinc-200 p-0.5">
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); updateQuantity(p.id, -1); }}
                                            className="w-5 h-5 flex items-center justify-center rounded-md bg-zinc-50 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 active:scale-95"
                                        >
                                            <Minus className="w-3 h-3" />
                                        </button>
                                        <span className="text-[10px] font-black text-zinc-900 flex-1 text-center">
                                            {getQuantity(p.id)}
                                        </span>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); updateQuantity(p.id, 1); }}
                                            className="w-5 h-5 flex items-center justify-center rounded-md bg-zinc-50 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 active:scale-95"
                                        >
                                            <Plus className="w-3 h-3" />
                                        </button>
                                    </div>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            haptic.medium();
                                            onAddToCart?.(p, getQuantity(p.id));
                                        }}
                                        className="w-full py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white transition-colors flex items-center justify-center gap-1.5 active:scale-95 shadow-sm"
                                    >
                                        <ShoppingCart className="w-3 h-3" />
                                        <span className="text-[9px] font-black uppercase tracking-widest">Adicionar</span>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
