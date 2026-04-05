import { motion } from 'framer-motion';
import { ShoppingBag, ArrowRight } from 'lucide-react';
import { haptic } from '@/utils/haptic';
import type { View } from '@/types';

interface EmptyCartProps {
    onNavigate: (view: View) => void;
}

export function EmptyCart({ onNavigate }: EmptyCartProps) {
    return (
        <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center h-full px-10 text-center"
        >
            <div className="relative mb-8">
                <motion.div 
                    animate={{ 
                        scale: [1, 1.1, 1],
                        rotate: [0, 5, -5, 0]
                    }}
                    transition={{ 
                        duration: 4,
                        repeat: Infinity,
                        ease: "easeInOut"
                    }}
                    className="w-32 h-32 bg-zinc-100/50 rounded-[3rem] flex items-center justify-center relative z-10 border border-zinc-200/50 shadow-inner"
                >
                    <ShoppingBag className="w-12 h-12 text-zinc-300" strokeWidth={1.5} />
                </motion.div>

                {/* Decorative Blobs */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-zinc-400/5 blur-3xl rounded-full -z-10" />
            </div>

            <h2 className="text-2xl font-black text-zinc-900 mb-3 tracking-tight">Seu carrinho está vazio</h2>
                <p className="text-zinc-500 text-xs font-medium leading-relaxed max-w-[280px] mx-auto">
                    Parece que você ainda não adicionou nenhum item ao seu carrinho. Que tal explorar nossas novidades?
                </p>

            <button
                onClick={() => { haptic.medium(); onNavigate('home'); }}
                className="group relative flex items-center gap-3 bg-zinc-950 text-white px-8 py-5 rounded-[2rem] font-black uppercase tracking-[0.2em] text-[10px] overflow-hidden transition-all active:scale-95 shadow-xl shadow-zinc-200/50"
            >
                <div className="absolute inset-0 bg-gradient-to-r from-primary/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <span>Explorar Produtos</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
        </motion.div>
    );
}
