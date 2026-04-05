import { Truck, ArrowRight } from 'lucide-react';
import { useStore } from '@/contexts/StoreContext';
import { useCartContext } from '@/contexts/CartContext';
import { useAuth } from '@/hooks/useAuth';
import { useMemo } from 'react';
import type { View } from '@/types';

interface FreeShippingBlockProps {
    onNavigate?: (view: View) => void;
}

export function FreeShippingBlock({ onNavigate }: FreeShippingBlockProps) {
    const { config } = useStore();
    const { cart } = useCartContext();
    const { user } = useAuth();

    const totalCartValue = useMemo(() => cart.reduce((sum, item) => {
        if (!item?.product) return sum;
        return sum + (item.product.price * (item.quantity || 0));
    }, 0), [cart]);

    const progressPercent = config.freeShippingMin > 0 ? Math.min((totalCartValue / config.freeShippingMin) * 100, 100) : 0;

    if (!user) {
        return (
            <div className="bg-zinc-950 border border-white/5 p-4 rounded-[2rem] shadow-2xl relative overflow-hidden group h-full flex items-center justify-between">
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 transition-colors duration-1000 group-hover:bg-emerald-500/10" />

                <div className="flex items-center gap-4 relative z-10">
                    <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10 flex-shrink-0">
                        <Truck className="w-5 h-5 text-emerald-500/50" />
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-white tracking-tight leading-none mb-1">
                            Frete <span className="text-emerald-500 italic">Grátis</span>
                        </h3>
                        <p className="text-[10px] font-medium text-zinc-500 leading-tight max-w-[140px]">
                            Faça login para ganhar frete grátis em suas compras.
                        </p>
                    </div>
                </div>

                <div 
                    onClick={() => onNavigate?.('auth')}
                    className="relative z-10 flex items-center gap-1 px-4 py-2 bg-emerald-500/10 rounded-full border border-emerald-500/20 group-hover:bg-emerald-500/20 transition-all cursor-pointer active:scale-95"
                >
                    <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Entrar</span>
                    <ArrowRight className="w-3 h-3 text-emerald-500 group-hover:translate-x-1 transition-transform" />
                </div>
            </div>
        );
    }

    return (
        <div className="bg-zinc-950 border border-white/5 p-4 rounded-[2rem] shadow-2xl relative overflow-hidden group h-full">
            {/* Subtle Glow */}
            <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 transition-colors duration-1000 group-hover:bg-emerald-500/20" />

            <div className="flex items-center gap-4 relative z-10">
                <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10 flex-shrink-0 group-hover:scale-105 transition-transform duration-500">
                    <Truck className="w-5 h-5 text-emerald-500" />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 sm:gap-2 mb-1 w-full overflow-hidden">
                        <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-[0.15em] sm:tracking-[0.2em] text-emerald-500 whitespace-nowrap">Premium Delivery</span>
                        <div className="w-0.5 h-0.5 bg-zinc-700 rounded-full flex-shrink-0" />
                        <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-widest text-zinc-500 whitespace-nowrap overflow-hidden text-ellipsis">Monte Carmelo</span>
                    </div>

                    <h3 className="text-base font-black text-white tracking-tight leading-none mb-1">
                        Frete Grátis <span className="text-emerald-500 italic">Ilimitado</span>
                    </h3>

                    <p className="text-[10px] font-medium text-zinc-400 leading-tight">
                        Acumule <span className="text-zinc-100 font-bold">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(config.freeShippingMin)}</span> em itens <span className="text-emerald-500/80 font-semibold italic">no carrinho</span>.
                    </p>
                </div>

                <div className="flex flex-col items-end gap-1.5">
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                        <div className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                        <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">Ativo</span>
                    </div>
                    <div className="text-right">
                        <p className="text-[12px] font-black text-white leading-none">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalCartValue)}
                        </p>
                        <p className="text-[7px] font-black text-zinc-600 uppercase tracking-widest">No Carrinho</p>
                    </div>
                </div>
            </div>

            {/* Ultra Slim Progress Bar */}
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/5">
                <div
                    className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)] transition-all duration-1000"
                    style={{ width: `${progressPercent}%` }}
                />
            </div>
        </div>
    );
}
