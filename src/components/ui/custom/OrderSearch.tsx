import { useState } from 'react';
import { ChevronRight, User, Mail, Phone, Hash, KeyRound, Loader2, ArrowRight } from 'lucide-react';
import type { View, Order } from '@/types';
import { useOrders } from '@/hooks/useOrders';
import { cn } from '@/lib/utils';
import { haptic } from '@/utils/haptic';
import { toast } from 'sonner';

interface OrderSearchProps {
    onNavigate: (view: View) => void;
    title?: string;
    description?: string;
    onOrdersFound?: (orders: Order[]) => void;
}

export function OrderSearch({
    onNavigate,
    title = "Acesse sua conta",
    description = "Faça login para ver seu histórico completo automaticamente e gerenciar seus pedidos.",
    onOrdersFound
}: OrderSearchProps) {
    const { generateOrderOtp, fetchOrdersByOtp } = useOrders(true, false);
    const [tab, setTab] = useState<'login' | 'guest'>('login');
    
    // Guest fields
    const [email, setEmail] = useState('');
    const [whatsapp, setWhatsapp] = useState('');
    const [orderFragment, setOrderFragment] = useState('');
    const [otp, setOtp] = useState('');
    
    // Loading/Wizard states
    const [step, setStep] = useState<'request' | 'verify'>('request');
    const [isLoading, setIsLoading] = useState(false);

    const formatWhatsApp = (value: string) => {
        const numbers = value.replaceAll(/\D/g, '');
        if (numbers.length <= 2) return numbers;
        if (numbers.length <= 7) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
        if (numbers.length <= 11) return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
        return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7, 11)}`;
    };

    const handleWhatsappChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const formatted = formatWhatsApp(e.target.value);
        setWhatsapp(formatted);
    };

    const handleSendOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        haptic.light();
        
        if (!email.trim() || !email.includes('@')) {
            toast.error('Por favor, informe um e-mail válido.');
            return;
        }
        
        const cleanWhatsapp = whatsapp.replaceAll(/\D/g, '');
        if (cleanWhatsapp.length < 10) {
            toast.error('Por favor, informe um WhatsApp válido com DDD.');
            return;
        }

        setIsLoading(true);
        try {
            const token = await generateOrderOtp(email.trim().toLowerCase(), cleanWhatsapp, orderFragment.trim());
            if (token) {
                toast.success('Código de verificação enviado para seu e-mail!');
                setStep('verify');
            }
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleVerifyOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        haptic.medium();

        if (otp.length < 6) {
            toast.error('O código de verificação deve conter 6 dígitos.');
            return;
        }

        setIsLoading(true);
        try {
            const foundOrders = await fetchOrdersByOtp(email.trim().toLowerCase(), otp.trim());
            if (foundOrders && foundOrders.length > 0) {
                toast.success(`${foundOrders.length} pedido(s) encontrado(s)!`);
                // Store in session cache
                sessionStorage.setItem('guest_tracked_orders', JSON.stringify(foundOrders));
                if (onOrdersFound) {
                    onOrdersFound(foundOrders);
                }
            } else {
                toast.error('Nenhum pedido encontrado. Verifique se o código OTP está correto.');
            }
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-4 xs:space-y-6">
            <div className="bg-zinc-950 rounded-3xl p-4 xs:p-6 text-white relative overflow-hidden border border-zinc-900 group">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl group-hover:bg-white/10 transition-all duration-1000" />
                
                <div className="relative z-10 flex flex-col h-full">
                    {/* Mode selector tab header */}
                    <div className="flex bg-zinc-900/80 p-1.5 rounded-2xl mb-4 xs:mb-6 border border-zinc-800">
                        <button
                            type="button"
                            onClick={() => { haptic.light(); setTab('login'); }}
                            className={cn(
                                "flex-1 py-2 text-[10px] xs:text-[11px] font-black uppercase tracking-[0.1em] rounded-xl transition-all duration-300",
                                tab === 'login' ? "bg-white text-zinc-950 shadow-md" : "text-zinc-400 hover:text-white"
                            )}
                        >
                            Entrar na Conta
                        </button>
                        <button
                            type="button"
                            onClick={() => { haptic.light(); setTab('guest'); }}
                            className={cn(
                                "flex-1 py-2 text-[10px] xs:text-[11px] font-black uppercase tracking-[0.1em] rounded-xl transition-all duration-300",
                                tab === 'guest' ? "bg-white text-zinc-950 shadow-md" : "text-zinc-400 hover:text-white"
                            )}
                        >
                            Rastrear sem Conta
                        </button>
                    </div>

                    {tab === 'login' ? (
                        <div className="space-y-4">
                            <div className="w-10 h-10 xs:w-12 xs:h-12 bg-white/10 rounded-2xl flex items-center justify-center">
                                <User className="w-5 h-5 xs:w-6 xs:h-6 text-white" />
                            </div>
                            <div>
                                <h3 className="text-base xs:text-xl font-black tracking-tighter italic uppercase mb-1 xs:mb-2">{title}</h3>
                                <p className="text-[10px] xs:text-[12px] font-bold text-zinc-400 uppercase tracking-widest leading-relaxed mb-4 xs:mb-6">
                                    {description}
                                </p>
                            </div>
                            <button
                                onClick={() => onNavigate('auth')}
                                className="w-full py-3.5 xs:py-4 bg-white text-zinc-950 text-[10px] xs:text-[11px] font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-zinc-100 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                            >
                                Entrar
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {step === 'request' ? (
                                <form onSubmit={handleSendOtp} className="space-y-4">
                                    <div>
                                        <h3 className="text-base xs:text-xl font-black tracking-tighter italic uppercase mb-1 xs:mb-2">Rastrear Pedido</h3>
                                        <p className="text-[10px] xs:text-[11px] font-bold text-zinc-400 uppercase tracking-widest leading-relaxed mb-4">
                                            Preencha as informações do pedido para receber um código de validação.
                                        </p>
                                    </div>
                                    
                                    <div className="space-y-3">
                                        <div className="relative">
                                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                            <input
                                                type="email"
                                                required
                                                placeholder="SEU E-MAIL"
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                className="w-full pl-11 pr-4 py-3 bg-zinc-900 border border-zinc-800 text-[11px] font-bold uppercase tracking-wider text-white rounded-2xl placeholder-zinc-650 focus:outline-none focus:border-zinc-700 transition-colors"
                                            />
                                        </div>

                                        <div className="relative">
                                            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                            <input
                                                type="tel"
                                                required
                                                placeholder="SEU WHATSAPP"
                                                value={whatsapp}
                                                onChange={handleWhatsappChange}
                                                className="w-full pl-11 pr-4 py-3 bg-zinc-900 border border-zinc-800 text-[11px] font-bold uppercase tracking-wider text-white rounded-2xl placeholder-zinc-650 focus:outline-none focus:border-zinc-700 transition-colors"
                                            />
                                        </div>

                                        <div className="relative">
                                            <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                            <input
                                                type="text"
                                                placeholder="ID DO PEDIDO (OPCIONAL)"
                                                value={orderFragment}
                                                onChange={(e) => setOrderFragment(e.target.value)}
                                                className="w-full pl-11 pr-4 py-3 bg-zinc-900 border border-zinc-800 text-[11px] font-bold uppercase tracking-wider text-white rounded-2xl placeholder-zinc-650 focus:outline-none focus:border-zinc-700 transition-colors"
                                            />
                                        </div>
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={isLoading}
                                        className="w-full py-3.5 bg-white text-zinc-950 text-[10px] xs:text-[11px] font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-zinc-100 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-55"
                                    >
                                        {isLoading ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                Gerando Código...
                                            </>
                                        ) : (
                                            <>
                                                Enviar Código
                                                <ArrowRight className="w-4 h-4" />
                                            </>
                                        )}
                                    </button>
                                </form>
                            ) : (
                                <form onSubmit={handleVerifyOtp} className="space-y-4">
                                    <div className="flex items-center gap-2 text-amber-400 bg-amber-500/10 p-3 rounded-2xl border border-amber-500/20">
                                        <KeyRound className="w-4 h-4 flex-shrink-0" />
                                        <span className="text-[9px] xs:text-[10px] font-bold uppercase tracking-wide">
                                            Código enviado para {email}
                                        </span>
                                    </div>

                                    <div className="space-y-3">
                                        <input
                                            type="text"
                                            required
                                            maxLength={6}
                                            placeholder="DIGITE O CÓDIGO DE 6 DÍGITOS"
                                            value={otp}
                                            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                                            className="w-full py-4 text-center bg-zinc-900 border border-zinc-800 text-lg font-black tracking-[0.3em] text-white rounded-2xl focus:outline-none focus:border-zinc-700 transition-colors"
                                        />
                                    </div>

                                    <div className="flex gap-3">
                                        <button
                                            type="button"
                                            onClick={() => { haptic.light(); setStep('request'); setOtp(''); }}
                                            className="flex-1 py-3.5 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-750 text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl transition-all active:scale-[0.98]"
                                        >
                                            Voltar
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={isLoading}
                                            className="flex-[2] py-3.5 bg-white text-zinc-950 text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-zinc-100 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-55"
                                        >
                                            {isLoading ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    Verificando...
                                                </>
                                            ) : (
                                                <>
                                                    Verificar
                                                    <ChevronRight className="w-4 h-4" />
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
