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
            <DialogContent className="sm:max-w-md bg-zinc-950 border-white/5 p-0 overflow-hidden rounded-[2.5rem] shadow-[0_50px_100px_rgba(0,0,0,0.8)]">
                {/* Banner de Luxo superior */}
                <div className="relative h-48 bg-gradient-to-br from-zinc-900 to-zinc-950 flex items-center justify-center overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/10 via-transparent to-transparent opacity-50" />

                    {/* Animação de Pulsar Neon */}
                    <div className="relative z-10 w-24 h-24 flex items-center justify-center">
                        <div className="absolute inset-0 bg-white/20 rounded-full animate-ping opacity-20" />
                        <div className="absolute inset-0 bg-white/10 rounded-full animate-pulse blur-xl" />
                        <div className="w-20 h-20 bg-zinc-900 border border-white/10 rounded-full flex items-center justify-center shadow-2xl relative z-10">
                            <BellRing className="w-10 h-10 text-white animate-bounce" />
                        </div>
                        <Sparkles className="absolute -top-2 -right-2 w-6 h-6 text-amber-400 animate-pulse" />
                    </div>

                    {/* Badge de Verificação */}
                    <div className="absolute bottom-4 left-6 px-4 py-1.5 bg-zinc-900/80 backdrop-blur-md rounded-full border border-white/10 flex items-center gap-2">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-white/60">Privacidade Blindada</span>
                    </div>
                </div>

                <div className="p-10 space-y-6 text-center">
                    <DialogHeader className="space-y-4">
                        <DialogTitle className="text-2xl font-black text-white italic tracking-tighter leading-none">
                            ACESSO <span className="text-zinc-500">EXCLUSIVO</span>
                        </DialogTitle>
                        <DialogDescription className="text-zinc-400 text-sm font-medium leading-relaxed">
                            Seja o primeiro a saber. Receba convites para drops limitados, status VIP de pedidos e ofertas que <span className="text-white font-bold">desaparecem em minutos</span>.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col gap-4 pt-4">
                        <button
                            onClick={handleSubscribe}
                            className="group relative h-16 w-full bg-white text-zinc-950 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all active:scale-95 overflow-hidden shadow-[0_20px_40px_rgba(255,255,255,0.1)] hover:shadow-[0_25px_50px_rgba(255,255,255,0.15)] flex items-center justify-center gap-3"
                        >
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full group-hover:animate-[shimmer_2s_infinite] pointer-events-none" />
                            <Zap className="w-4 h-4 fill-zinc-950" />
                            Ativar Conexão VIP
                        </button>

                        <button
                            onClick={() => setShowPrompt(false)}
                            className="h-12 w-full text-zinc-600 hover:text-white text-[10px] font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
                        >
                            Talvez em outro momento
                        </button>
                    </div>

                    <p className="text-[9px] font-bold text-zinc-700 uppercase tracking-widest">
                        Você pode desativar este canal a qualquer momento.
                    </p>
                </div>
            </DialogContent>
        </Dialog>
    );
}
