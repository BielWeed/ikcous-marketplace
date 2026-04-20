import { ShoppingCart, ChevronRight, Truck } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCart } from '@/hooks/useCart';
import { useStore } from '@/contexts/StoreContext';
import { useAuth } from '@/hooks/useAuth';

interface CartReminderProps {
    onAction: () => void;
}

export function CartReminder({ onAction }: CartReminderProps) {
    const { cart: items, getCartCount } = useCart();
    const { config } = useStore();
    const { user } = useAuth();
    const [isVisible, setIsVisible] = useState(false);
    const [isDismissed, setIsDismissed] = useState(false);

    const totalAmount = useMemo(() => items.reduce((sum, item) => {
        if (!item?.product) return sum;
        return sum + (item.product.price * (item.quantity || 0));
    }, 0), [items]);

    const isFree = totalAmount >= config.freeShippingMin;
    const amountToFree = Math.max(0, config.freeShippingMin - totalAmount);
    const progress = Math.min(100, (totalAmount / config.freeShippingMin) * 100);

    useEffect(() => {
        if (items.length > 0 && !isDismissed) {
            const showTimer = setTimeout(() => setIsVisible(true), 1500);
            return () => clearTimeout(showTimer);
        } else {
            setTimeout(() => setIsVisible(false), 0);
        }
    }, [items.length, isDismissed]);

    useEffect(() => {
        if (isVisible) {
            const hideTimer = setTimeout(() => {
                setIsVisible(false);
                setIsDismissed(true);
            }, 5000); // 5 seconds for more readability
            return () => clearTimeout(hideTimer);
        }
    }, [isVisible]);

    const itemCount = getCartCount();

    return (
        <div className="fixed bottom-[calc(64px+var(--safe-area-bottom,0px))] left-0 right-0 z-40 flex justify-center pointer-events-none">
            <AnimatePresence>
                {isVisible && (
                    <motion.div
                        initial={{ opacity: 0, y: 100 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 100, scale: 0.95 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        className="bg-zinc-950 border-t border-x border-white/10 rounded-t-[2.5rem] px-5 py-5 shadow-[0_-12px_44px_-10px_rgba(0,0,0,0.5)] flex items-center gap-4 pointer-events-auto max-w-lg w-full relative overflow-hidden group"
                    >
                        {/* Subtle Glow */}
                        <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />

                        {/* Ultra Slim Top Progress Bar */}
                        <div className="absolute top-0 left-0 right-0 h-[2px] bg-white/5">
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${user ? progress : 0}%` }}
                                className="h-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] transition-all duration-1000"
                            />
                        </div>

                        {/* Left: Animated Icon with Badge */}
                        <div className="relative flex-shrink-0">
                            <div className="w-11 h-11 bg-white/[0.03] rounded-2xl flex items-center justify-center border border-white/10 relative group-hover:scale-105 transition-all duration-500">
                                <ShoppingCart className="w-5 h-5 text-emerald-500" />
                                {itemCount > 0 && (
                                    <motion.span
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1.5 bg-emerald-500 text-[9px] font-black text-white rounded-full flex items-center justify-center border-2 border-zinc-950 shadow-lg"
                                    >
                                        {itemCount}
                                    </motion.span>
                                )}
                            </div>
                        </div>

                        {/* Middle: Compressed Info */}
                        <div className="flex-1 min-w-0 py-0.5 relative z-10">
                            <div className="flex items-center gap-1.5 mb-1">
                                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-500">Premium Delivery</span>
                                <div className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                            </div>
                            {!user ? (
                                <p className="text-[10px] font-bold text-zinc-400 leading-tight">
                                    Faça login para liberar o <span className="text-emerald-500 italic">Frete VIP</span>
                                </p>
                            ) : isFree ? (
                                <div className="flex items-center gap-1 text-[10px] font-black text-emerald-400 uppercase tracking-tighter">
                                    <Truck className="w-3 h-3" />
                                    <span>Frete VIP Liberado</span>
                                </div>
                            ) : (
                                <p className="text-[10px] font-bold text-zinc-400 leading-tight">
                                    Faltam <span className="text-white">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amountToFree)}</span> para o <span className="text-emerald-500 italic">Frete VIP</span>
                                </p>
                            )}
                        </div>

                        {/* Right: Compact Action */}
                        <button
                            onClick={onAction}
                            className="flex-shrink-0 h-10 px-5 bg-white text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-500 hover:text-white transition-all active:scale-95 flex items-center gap-1.5 shadow-lg group/btn"
                        >
                            Carrinho
                            <ChevronRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                        </button>

                        {/* Vertical Separator for Timer */}
                        <div className="w-px h-6 bg-white/10 mx-1" />

                        {/* Compact Timer */}
                        <div className="relative w-6 h-6 flex items-center justify-center opacity-40 group-hover:opacity-60 transition-opacity">
                            <svg className="w-full h-full -rotate-90" viewBox="0 0 32 32">
                                <circle cx="16" cy="16" r="14" stroke="white" strokeWidth="3" fill="transparent" className="opacity-10" />
                                <motion.circle
                                    cx="16" cy="16" r="14" stroke="#10b981" strokeWidth="3" fill="transparent"
                                    strokeDasharray={87.96}
                                    initial={{ strokeDashoffset: 87.96 }}
                                    animate={{ strokeDashoffset: 0 }}
                                    transition={{ duration: 5, ease: "linear" }}
                                />
                            </svg>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

const style = document.createElement('style');
style.textContent = `
    @keyframes timer {
        from { stroke-dashoffset: 87.96; }
        to { stroke-dashoffset: 0; }
    }
`;
if (typeof document !== 'undefined') document.head.appendChild(style);
