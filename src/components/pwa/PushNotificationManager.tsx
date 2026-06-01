import { useState, useEffect } from 'react';
import { BellRing, Sparkles, Zap, ShieldCheck } from 'lucide-react';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';

export function PushNotificationManager() {
    const { isSupported, permission, subscribe, subscription } = usePushNotifications();
    const [showPrompt, setShowPrompt] = useState(false);

    useEffect(() => {
        // Show prompt if supported but not granted and no subscription exists locally
        if (isSupported && permission === 'default' && !subscription) {
            const timer = setTimeout(() => setShowPrompt(true), 3000); // Show after 3 seconds
            return () => clearTimeout(timer);
        }
    }, [isSupported, permission, subscription]);

    const handleSubscribe = async () => {
        try {
            await subscribe();
            setShowPrompt(false);
        } catch (err) {
            console.error('Failed to subscribe:', err);
        }
    };

    if (!isSupported || permission === 'granted') return null;

    return (
        <Dialog open={showPrompt} onOpenChange={setShowPrompt}>
            <DialogContent 
                showCloseButton={false}
                className="sm:max-w-md bg-zinc-950/95 backdrop-blur-3xl border border-white/10 p-0 overflow-hidden rounded-[2.5rem] shadow-[0_50px_100px_rgba(0,0,0,0.85),_0_0_80px_rgba(245,158,11,0.08)] outline-none"
            >
                {/* Custom Keyframe Styles */}
                <style>{`
                    @keyframes luxury-swing {
                        0%, 100% { transform: rotate(0deg); }
                        20% { transform: rotate(12deg); }
                        40% { transform: rotate(-10deg); }
                        60% { transform: rotate(6deg); }
                        80% { transform: rotate(-4deg); }
                    }
                    .luxury-bell-active {
                        animation: luxury-swing 2.5s ease-in-out infinite;
                        transform-origin: top center;
                    }
                    @keyframes luxury-shimmer {
                        0% { transform: translateX(-100%); }
                        100% { transform: translateX(100%); }
                    }
                    .animate-luxury-shimmer {
                        animation: luxury-shimmer 2.5s infinite linear;
                    }
                `}</style>

                {/* Banner de Luxo superior */}
                <div className="relative h-48 bg-gradient-to-b from-amber-500/10 via-zinc-950 to-zinc-950 flex items-center justify-center overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/5 via-transparent to-transparent opacity-50" />

                    {/* Animação de Pulsar Neon */}
                    <div className="relative z-10 w-24 h-24 flex items-center justify-center">
                        <div className="absolute inset-0 bg-amber-400/20 rounded-full animate-ping opacity-20" />
                        <div className="absolute inset-0 bg-amber-400/10 rounded-full animate-pulse blur-xl" />
                        <div className="w-20 h-20 bg-zinc-900 border border-amber-500/20 rounded-full flex items-center justify-center shadow-2xl relative z-10">
                            <BellRing className="w-9 h-9 text-amber-400 luxury-bell-active" />
                        </div>
                        <Sparkles className="absolute -top-2 -right-2 w-6 h-6 text-amber-300 animate-pulse" />
                    </div>

                    {/* Badge de Verificação */}
                    <div className="absolute bottom-4 left-6 px-4 py-1.5 bg-amber-500/10 backdrop-blur-md rounded-full border border-amber-500/20 flex items-center gap-2">
                        <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-amber-300/80">Conexão Criptografada</span>
                    </div>
                </div>

                <div className="px-8 pb-10 pt-4 space-y-6 text-center">
                    <DialogHeader className="space-y-4">
                        <DialogTitle className="text-2xl font-black text-white italic tracking-tighter leading-none flex flex-col items-center gap-1">
                            <span className="text-[9px] font-black uppercase tracking-[0.35em] text-amber-400/80 mb-1">VIP Platform Channel</span>
                            ACESSO <span className="bg-gradient-to-r from-amber-400 via-yellow-200 to-amber-300 bg-clip-text text-transparent font-extrabold not-italic">VIP EXCLUSIVO</span>
                        </DialogTitle>
                        <DialogDescription className="text-zinc-400 text-xs font-medium leading-relaxed max-w-xs mx-auto">
                            Seja o primeiro a saber. Receba convites para drops limitados, status de pedidos e ofertas que <span className="text-amber-300 font-bold">desaparecem em minutos</span>.
                        </DialogDescription>
                    </DialogHeader>

                    {/* VIP Features list */}
                    <div className="grid grid-cols-1 gap-2.5 text-left max-w-xs mx-auto py-2">
                        <div className="flex items-start gap-3 bg-white/5 border border-white/5 p-3 rounded-2xl transition-colors hover:bg-white/10">
                            <div className="w-8 h-8 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center shrink-0">
                                <Sparkles className="w-4 h-4 text-amber-400" />
                            </div>
                            <div>
                                <h4 className="text-[11px] font-bold text-white uppercase tracking-wider">Drops & Lançamentos</h4>
                                <p className="text-[9px] text-zinc-400 leading-tight">Prioridade absoluta antes que o estoque acabe.</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-3 bg-white/5 border border-white/5 p-3 rounded-2xl transition-colors hover:bg-white/10">
                            <div className="w-8 h-8 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center shrink-0">
                                <Zap className="w-4 h-4 text-amber-400" />
                            </div>
                            <div>
                                <h4 className="text-[11px] font-bold text-white uppercase tracking-wider">Status em Tempo Real</h4>
                                <p className="text-[9px] text-zinc-400 leading-tight">Acompanhe a entrega dos seus pedidos instantaneamente.</p>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col gap-4 pt-4">
                        <button
                            onClick={handleSubscribe}
                            className="group relative h-16 w-full bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 text-zinc-950 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all active:scale-95 overflow-hidden shadow-[0_20px_40px_rgba(245,158,11,0.2)] hover:shadow-[0_25px_50px_rgba(245,158,11,0.35)] flex items-center justify-center gap-3 border border-yellow-300/30"
                        >
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full group-hover:animate-luxury-shimmer pointer-events-none" />
                            <Zap className="w-4 h-4 fill-zinc-950" />
                            Ativar Conexão VIP
                        </button>

                        <button
                            onClick={() => setShowPrompt(false)}
                            className="h-10 w-full text-zinc-500 hover:text-zinc-300 text-[10px] font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
                        >
                            Talvez em outro momento
                        </button>
                    </div>

                    <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">
                        Você pode desativar este canal a qualquer momento.
                    </p>
                </div>
            </DialogContent>
        </Dialog>
    );
}

