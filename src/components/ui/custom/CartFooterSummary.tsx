import { ArrowRight, Sparkles as SparklesIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { View } from '@/types';

interface CartFooterSummaryProps {
    cartCount: number;
    shipping: number;
    total: number;
    onNavigate: (view: View) => void;
}

export function CartFooterSummary({ cartCount, shipping, total, onNavigate }: CartFooterSummaryProps) {
    return (
        <motion.div
            initial={{ y: '100%', opacity: 0.5 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300, mass: 0.8 }}
            className="fixed bottom-[calc(64px+env(safe-area-inset-bottom,0px))] left-0 right-0 z-[60] bg-white border-t border-zinc-100 shadow-[0_-10px_40px_-5px_rgba(0,0,0,0.08)] md:bottom-24 md:max-w-screen-md md:mx-auto md:rounded-[2.5rem] md:border"
        >
            <div className="px-4 py-4 xs:px-6 flex items-center justify-between gap-2 xs:gap-4 max-w-screen-xl mx-auto">
                {/* Visual context */}
                <div className="hidden md:flex flex-col">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 mb-0.5">Seu Carrinho</span>
                    <span className="text-xs font-black text-zinc-900">{cartCount} it{cartCount > 1 ? 'ens' : 'em'} selecionado{cartCount > 1 ? 's' : ''}</span>
                </div>

                {/* Total & Benefits */}
                <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest leading-none">Total</span>
                        {shipping === 0 && (
                            <div className="flex items-center gap-1 px-1.5 py-0.5 bg-emerald-50 rounded-md">
                                <SparklesIcon className="w-2.5 h-2.5 text-emerald-500 fill-emerald-500/20" />
                                <span className="text-[8px] font-black text-emerald-600 uppercase tracking-tighter">Bônus VIP</span>
                            </div>
                        )}
                    </div>
                    <p className={cn(
                        "text-lg xs:text-xl font-black tracking-tighter transition-all duration-500",
                        shipping === 0 ? "bg-gradient-to-r from-emerald-600 to-emerald-400 bg-clip-text text-transparent" : "text-zinc-950"
                    )}>
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(total)}
                    </p>
                </div>

                {/* Main Action */}
                <div className="flex items-center gap-2 xs:gap-3">
                    <div className="flex flex-col items-end pr-2 xs:pr-3 border-r border-zinc-100 h-8 justify-center">
                        <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest leading-none mb-1">Frete</span>
                        <span className={cn(
                            "text-xs font-black leading-none tracking-tight",
                            shipping === 0 ? "text-emerald-500" : "text-zinc-600"
                        )}>
                            {shipping === 0 ? 'GRÁTIS' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(shipping)}
                        </span>
                    </div>

                    <button
                        onClick={() => onNavigate('checkout')}
                        className="h-12 px-4 xs:h-14 xs:px-8 bg-zinc-950 hover:bg-zinc-800 text-white rounded-2xl flex items-center gap-2 xs:gap-3 transition-all active:scale-[0.98] shadow-xl shadow-zinc-200 group relative overflow-hidden"
                    >
                        <div className="relative z-10 flex items-center gap-3">
                            <span className="text-xs font-bold uppercase tracking-widest">Finalizar</span>
                            <div className="w-8 h-8 bg-white/10 rounded-xl flex items-center justify-center group-hover:bg-white/20 transition-colors">
                                <ArrowRight className="w-4 h-4 text-white group-hover:translate-x-0.5 transition-transform" />
                            </div>
                        </div>

                        {/* Subtle Shimmer */}
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                    </button>
                </div>
            </div>

            {/* Bottom Safe Area Padding for Mobile Header-style feeling */}
            <div className="h-[env(safe-area-inset-bottom,0px)] bg-white" />
        </motion.div>
    );
}
