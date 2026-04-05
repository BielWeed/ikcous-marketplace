import { ChevronRight, User } from 'lucide-react';
import type { View } from '@/types';

interface OrderSearchProps {
    onNavigate: (view: View) => void;
    title?: string;
    description?: string;
}

export function OrderSearch({
    onNavigate,
    title = "Acesse sua conta",
    description = "Faça login para ver seu histórico completo automaticamente e gerenciar seus pedidos."
}: OrderSearchProps) {
    return (
        <div className="space-y-3 xs:space-y-6">
            <div className="bg-zinc-900 rounded-3xl p-3.5 xs:p-6 text-white relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl group-hover:bg-white/10 transition-all duration-1000" />
                <div className="relative z-10">
                    <div className="w-9 h-9 xs:w-12 xs:h-12 bg-white/10 rounded-xl xs:rounded-2xl flex items-center justify-center mb-2 xs:mb-4">
                        <User className="w-4 h-4 xs:w-6 xs:h-6 text-white" />
                    </div>
                    <h3 className="text-base xs:text-xl font-black tracking-tighter italic uppercase mb-1 xs:mb-2">{title}</h3>
                    <p className="text-[9px] xs:text-[11px] font-bold text-zinc-400 uppercase tracking-widest leading-relaxed mb-4 xs:mb-6">
                        {description}
                    </p>
                    <button
                        onClick={() => onNavigate('auth')}
                        className="w-full py-2.5 xs:py-4 bg-white text-zinc-900 text-[9px] xs:text-[10px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-zinc-100 transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                        Entrar
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}
