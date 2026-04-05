import { useState } from 'react';
import { Share2, Users, Gift, ChevronRight, Copy, Check, ArrowLeft, Sparkles, TrendingUp, Handshake } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface ReferralViewProps {
    readonly onBack: () => void;
}

export function ReferralView({ onBack }: ReferralViewProps) {
    const { user } = useAuth();
    const [copied, setCopied] = useState(false);

    // Link de indicação baseado no ID do usuário
    const referralLink = `${globalThis.location.origin}/#ref=${user?.id}`;

    const handleCopy = () => {
        navigator.clipboard.writeText(referralLink);
        setCopied(true);
        toast.success('Link de indicação copiado!');
        setTimeout(() => setCopied(false), 2000);
    };

    const handleShare = async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'IKCOUS Marketplace - Convite Especial',
                    text: 'Ganhe benefícios exclusivos no IKCOUS Marketplace usando meu link de indicação!',
                    url: referralLink,
                });
            } catch (err) {
                console.error('Error sharing:', err);
            }
        } else {
            handleCopy();
        }
    };

    return (
        <div className="min-h-full bg-zinc-50 pb-24">
            {/* Header Sticky Premium */}
            <div className="bg-white/80 backdrop-blur-2xl px-6 py-6 sticky top-0 z-50 border-b border-zinc-100 flex items-center gap-4">
                <button
                    onClick={onBack}
                    className="w-12 h-12 flex items-center justify-center bg-zinc-50 text-zinc-900 rounded-2xl hover:bg-zinc-100 transition-all active:scale-95 border border-zinc-100 group"
                >
                    <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                </button>
                <div>
                    <h1 className="text-xl font-black text-zinc-900 tracking-tight flex items-center gap-2">
                        Indique e Ganhe <Handshake className="w-4 h-4 text-amber-500" />
                    </h1>
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">Expanda nossa comunidade VIP</p>
                </div>
            </div>

            <div className="max-w-md mx-auto p-6 space-y-8">
                {/* Hero Card - Estilo Banco Digital */}
                <div className="bg-zinc-900 text-white rounded-[2.5rem] p-10 shadow-2xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-10 rotate-12 group-hover:rotate-0 transition-transform duration-1000">
                        <Gift className="w-32 h-32" />
                    </div>

                    <div className="relative z-10 space-y-6">
                        <div className="space-y-2">
                            <span className="px-4 py-1.5 bg-white/10 rounded-full border border-white/10 text-[10px] font-black uppercase tracking-widest text-amber-400">
                                Programa de Rewards
                            </span>
                            <h2 className="text-3xl font-black tracking-tighter italic leading-none">
                                GANHE <span className="text-zinc-500">PROGRAMA</span><br />
                                DE EXCELÊNCIA
                            </h2>
                        </div>

                        <p className="text-zinc-400 text-sm font-medium leading-relaxed">
                            Convide seus amigos para o IKCOUS. Quando eles realizarem a primeira compra, ambos ganham <span className="text-white font-bold">benefícios exclusivos</span> no próximo pedido.
                        </p>

                        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/5">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Amigos Indicados</p>
                                <p className="text-2xl font-black">12</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Membros Ativos</p>
                                <div className="flex items-center gap-2">
                                    <p className="text-2xl font-black">8</p>
                                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Referral Controls */}
                <div className="bg-white rounded-[2.5rem] border border-zinc-100 p-8 shadow-sm space-y-6">
                    <div className="space-y-4">
                        <label htmlFor="referral-link" className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 ml-1">Seu Link de Convite</label>
                        <div className="relative flex items-center">
                            <input
                                type="text"
                                id="referral-link"
                                name="referral_link"
                                readOnly
                                value={referralLink}
                                className="w-full h-16 pl-6 pr-20 bg-zinc-50 border-2 border-transparent rounded-2xl font-bold text-xs text-zinc-500 outline-none"
                            />
                            <button
                                onClick={handleCopy}
                                className="absolute right-2 w-12 h-12 flex items-center justify-center bg-white border border-zinc-100 text-zinc-900 rounded-xl hover:bg-zinc-50 transition-all active:scale-90 shadow-sm"
                            >
                                {copied ? <Check className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5" />}
                            </button>
                        </div>
                    </div>

                    <Button
                        onClick={handleShare}
                        className="w-full h-16 bg-zinc-900 text-white rounded-2xl font-black uppercase tracking-[0.2em] text-xs hover:bg-black transition-all active:scale-95 shadow-xl shadow-zinc-100 flex items-center justify-center gap-3"
                    >
                        <Share2 className="w-4 h-4" />
                        Compartilhar Convite
                    </Button>
                </div>

                {/* How it works */}
                <div className="space-y-4 px-2">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Como Funciona</h3>
                    <div className="space-y-3">
                        {[
                            { icon: Share2, title: 'Envie o Link', desc: 'Compartilhe seu link exclusivo com amigos.' },
                            { icon: Users, title: 'Eles se Cadastram', desc: 'Seus amigos criam uma conta no IKCOUS.' },
                            { icon: Sparkles, title: 'Ambos Ganham', desc: 'Pronto! Benefícios VIP para todos.' }
                        ].map((step) => (
                            <div key={step.title} className="flex items-start gap-4 p-4 bg-white rounded-2xl border border-zinc-50 shadow-sm">
                                <div className="w-10 h-10 shrink-0 bg-zinc-900 rounded-xl flex items-center justify-center">
                                    <step.icon className="w-5 h-5 text-white" />
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-black text-zinc-900 uppercase tracking-wider">{step.title}</p>
                                    <p className="text-[10px] font-bold text-zinc-400">{step.desc}</p>
                                </div>
                                <div className="ml-auto">
                                    <ChevronRight className="w-4 h-4 text-zinc-100" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <p className="text-center text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em] px-8 leading-relaxed">
                    Termos e condições se aplicam. O crédito é validado após a primeira compra aprovada do indicado.
                </p>
            </div>
        </div>
    );
}
