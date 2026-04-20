import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Send, Users, Info, Sparkles, Zap, History, Target } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useVOR } from '@/hooks/useVOR';
import type { View } from '@/types';

interface AdminPushViewProps {
    onNavigate: (view: View) => void;
}

export function AdminPushView({ onNavigate }: AdminPushViewProps) {
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [subCount, setSubCount] = useState(0);
    const [notification, setNotification] = useState({
        title: '',
        body: '',
        url: '/'
    });
    const { isSupported, subscribe } = usePushNotifications();
    const { recordAction } = useVOR();
    const [isTestSubscribed, setIsTestSubscribed] = useState(false);
    const [segment, setSegment] = useState('all');
    const [predictedReach, setPredictedReach] = useState(0);
    const [history, setHistory] = useState<any[]>([]);

    const fetchSubscribers = useCallback(async () => {
        const { count, error } = await supabase
            .from('push_subscriptions')
            .select('*', { count: 'exact', head: true });

        if (!error) setSubCount(count || 0);
    }, []);

    const fetchHistory = useCallback(async () => {
        const { data, error } = await supabase
            .from('push_notifications_log')
            .select('*')
            .order('sent_at', { ascending: false })
            .limit(20);

        if (!error && data) setHistory(data);
    }, []);

    useEffect(() => {
        fetchSubscribers();
        fetchHistory();
    }, [fetchSubscribers, fetchHistory]);

    const calculateReach = useCallback(async () => {
        if (segment === 'all') {
            setPredictedReach(subCount);
            return;
        }

        try {
            const { data, error } = await (supabase.rpc as any)('get_segmented_push_targets', {
                p_segment: segment
            });
            if (!error && data) {
                setPredictedReach((data as any[]).length);
            }
        } catch (err) {
            console.error('Error calculating reach:', err);
        }
    }, [segment, subCount]);

    useEffect(() => {
        calculateReach();
    }, [calculateReach]);



    const handleTestSubscription = async () => {
        try {
            await subscribe();
            setIsTestSubscribed(true);
            fetchSubscribers();
        } catch (error) {
            // Error handled in hook
        }
    };

    const handleSend = async () => {
        if (!notification.title || !notification.body) {
            toast.error('Preencha título e mensagem');
            return;
        }

        setLoading(true);
        try {
            // ZENITH v21.7: Rely on AuthContext's verified user
            if (!user) throw new Error('Administrador não autenticado');

            // 1. Fetch real targets based on segment
            const { data: targets, error: targetError } = await (supabase.rpc as any)('get_segmented_push_targets', {
                p_segment: segment
            });

            if (targetError) throw targetError;

            const targetList = targets as any[];
            const finalRecipientCount = targetList?.length || 0;

            if (finalRecipientCount === 0) {
                toast.error('Nenhum destinatário encontrado para este segmento');
                return;
            }

            // 2. Save to logs
            const { error: logError } = await supabase
                .from('push_notifications_log')
                .insert({
                    title: notification.title,
                    body: notification.body,
                    url: notification.url,
                    recipient_count: finalRecipientCount,
                    created_by: user?.id,
                    metadata: { segment }
                });

            if (logError) throw logError;

            // 3. Call Edge Function to send real push notifications
            const { error: pushError } = await supabase.functions.invoke('send-push', {
                body: {
                    title: notification.title,
                    body: notification.body,
                    url: notification.url,
                    tokens: targetList.map((t: any) => ({
                        endpoint: t.endpoint,
                        keys: { p256dh: t.p256dh, auth: t.auth }
                    }))
                }
            });

            if (pushError) {
                console.warn('Real push delivery failed, but log was created:', pushError);
                toast.warning('Log criado, mas houve erro no disparo real');
            } else {
                toast.success(`Notificação enviada para ${finalRecipientCount} dispositivos!`);
                recordAction('PUSH_DISPATCH',
                    { title: notification.title, recipient_count: finalRecipientCount, segment },
                    { status: 'success', timestamp: new Date().toISOString() }
                );
            }

            setNotification({ title: '', body: '', url: '/' });
            fetchHistory();
        } catch (error) {
            console.error('Error sending push:', error);
            toast.error('Falha ao registrar notificação no banco');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-zinc-50/30 pb-32">
            {/* Header Executivo */}
            <div className="px-6 py-6">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => onNavigate('admin-dashboard')}
                            className="w-12 h-12 flex items-center justify-center bg-white text-zinc-900 rounded-2xl hover:bg-zinc-100 transition-all active:scale-95 border border-zinc-100 group shadow-sm"
                        >
                            <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                        </button>
                        <div>
                            <h1 className="text-xl font-black text-zinc-900 tracking-tight flex items-center gap-2">
                                Push Center <Target className="w-4 h-4 text-emerald-500" />
                            </h1>
                            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">Centro de Comando de Engajamento</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-4xl mx-auto p-6 space-y-8">
                {/* SROS Agentic Generator */}
                <div className="bg-zinc-950 rounded-[3rem] p-10 border border-white/10 shadow-2xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 scale-150 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Sparkles className="w-20 h-20 text-emerald-400" />
                    </div>

                    <div className="relative z-10 space-y-8">
                        <div className="flex items-center gap-4">
                            <div className="w-14 h-14 bg-emerald-500/20 rounded-2xl flex items-center justify-center border border-emerald-500/30">
                                <Zap className="w-6 h-6 text-emerald-400" />
                            </div>
                            <div>
                                <h3 className="text-xl font-black text-white tracking-tight">Gerador de Manifesto SROS</h3>
                                <p className="text-[10px] font-bold text-emerald-500/70 uppercase tracking-[0.2em]">Compilador Agêntico v1.0 • Geração 19</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {[
                                { id: 'fomo', title: 'Otimização de Surpresa', desc: 'Gera urgência através de escassez e exclusividade.', icon: Zap },
                                { id: 'auth', title: 'Simetria Lógica', desc: 'Foca em autoridade, provas sociais e dados.', icon: Info },
                                { id: 'value', title: 'Minimização de Energia', desc: 'Enfatiza facilidade, valor e economia direta.', icon: Target }
                            ].map((arch) => (
                                <button
                                    key={arch.id}
                                    className="p-6 rounded-[2rem] bg-white/5 border border-white/10 text-left hover:bg-white/10 transition-all group/arch active:scale-95"
                                    onClick={() => {
                                        if (arch.id === 'fomo') {
                                            setNotification({
                                                title: 'Última Chamada: Estágio VIP Encerra em 2h! ⏳',
                                                body: 'Apenas 3 unidades restantes no estoque Apex. Garanta sua prioridade agora.',
                                                url: '/favorites'
                                            });
                                        } else if (arch.id === 'auth') {
                                            setNotification({
                                                title: '98% de Aprovação: Conheça os Favoritos da Semana 💎',
                                                body: 'Nossa comunidade validou: estes são os produtos que estão definindo a tendência em Monte Carmelo.',
                                                url: '/search'
                                            });
                                        } else {
                                            setNotification({
                                                title: 'Seu Desconto de Fidelidade foi Ativado! 🎁',
                                                body: 'Como forma de reduzir sua energia livre, liberamos um cupom exclusivo para sua próxima compra.',
                                                url: '/profile'
                                            });
                                        }

                                        // VOR Record for Manifesto Compilation
                                        recordAction('SROS_MANIFESTO_COMPILE',
                                            { archetype: arch.id, title: arch.title },
                                            { result: 'compiled', timestamp: new Date().toISOString() }
                                        );

                                        toast.success(`Manifesto ${arch.title} Compilado!`);
                                    }}
                                >
                                    <arch.icon className="w-5 h-5 text-emerald-400 mb-4" />
                                    <h4 className="text-xs font-black text-white tracking-tight uppercase mb-1">{arch.title}</h4>
                                    <p className="text-[10px] font-medium text-zinc-500 leading-none">{arch.desc}</p>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {isSupported && !isTestSubscribed && (
                    <div className="flex justify-end pr-10">
                        <button
                            onClick={handleTestSubscription}
                            className="px-6 py-3 bg-white text-emerald-600 text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-emerald-50 transition-all border border-emerald-100 flex items-center gap-3 shadow-premium-sm active:scale-95"
                        >
                            <Zap className="w-4 h-4 fill-emerald-500" />
                            Monitorar este Dispositivo (Admin Test)
                        </button>
                    </div>
                )}
                {/* Stats Card - Radar Estilo Hi-Tech */}
                <div className="bg-white rounded-[3rem] p-10 border border-zinc-100 relative overflow-hidden shadow-premium">
                    <div className="relative z-10 flex items-center justify-between">
                        <div className="space-y-4">
                            <div>
                                <p className="text-zinc-400 text-[10px] font-black uppercase tracking-[0.3em] mb-2 flex items-center gap-2">
                                    <Sparkles className="w-3 h-3 text-amber-500" /> Alcance Instantâneo
                                </p>
                                <h2 className="text-6xl font-black tracking-tighter text-zinc-900 tabular-nums">
                                    {subCount}
                                </h2>
                                <p className="text-emerald-600 text-[10px] font-bold mt-2 uppercase tracking-widest flex items-center gap-2">
                                    <Zap className="w-3 h-3" /> Dispositivos Prontos para Receber
                                </p>
                            </div>
                            <div className="flex gap-4 pt-4">
                                <div className="px-5 py-2.5 bg-zinc-50 rounded-2xl border border-zinc-100 text-[10px] font-black uppercase tracking-widest text-zinc-400">
                                    iOS: {Math.floor(subCount * 0.4)}
                                </div>
                                <div className="px-5 py-2.5 bg-zinc-50 rounded-2xl border border-zinc-100 text-[10px] font-black uppercase tracking-widest text-zinc-400">
                                    Android: {Math.ceil(subCount * 0.6)}
                                </div>
                            </div>
                        </div>

                        {/* Radar Animation */}
                        <div className="relative w-48 h-48 hidden md:block">
                            <div className="absolute inset-0 border-2 border-emerald-500/20 rounded-full" />
                            <div className="absolute inset-4 border border-emerald-500/10 rounded-full" />
                            <div className="absolute inset-10 border border-emerald-500/5 rounded-full" />
                            <div className="absolute top-1/2 left-1/2 w-full h-[2px] bg-gradient-to-r from-transparent to-emerald-500/50 -translate-y-1/2 origin-left animate-[spin_4s_linear_infinite]" />
                            <div className="absolute top-1/2 left-1/2 w-48 h-48 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
                                <Users className="w-12 h-12 text-zinc-800" />
                            </div>
                            {/* Blips */}
                            <div className="absolute top-10 right-10 w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_10px_#34d399]" />
                            <div className="absolute bottom-12 left-8 w-2 h-2 bg-emerald-400 rounded-full animate-pulse delay-700 shadow-[0_0_10px_#34d399]" />
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
                    {/* Formulário - 3 Colunas */}
                    <div className="md:col-span-3 space-y-6">
                        <div className="bg-white border border-zinc-100 rounded-[2.5rem] p-8 space-y-8 shadow-premium-sm">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 bg-zinc-950 text-white rounded-2xl flex items-center justify-center shadow-premium-sm border border-white/10">
                                    <Send className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-black text-zinc-900 uppercase tracking-widest italic">Redigir Campanha</h3>
                                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Disparo imediato segmentado</p>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="space-y-3">
                                    <Label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Segmentação do Público</Label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {[
                                            { id: 'all', label: 'Todos' },
                                            { id: 'vip', label: 'Clientes VIP' },
                                            { id: 'inactive', label: 'Inativos (30d)' },
                                            { id: 'new', label: 'Novos Clientes' }
                                        ].map(s => (
                                            <button
                                                key={s.id}
                                                onClick={() => setSegment(s.id)}
                                                className={`h-12 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${segment === s.id
                                                    ? 'bg-zinc-900 text-white border-zinc-900 shadow-md'
                                                    : 'bg-zinc-50 text-zinc-400 border-zinc-100 hover:bg-zinc-100'
                                                    }`}
                                            >
                                                {s.label}
                                            </button>
                                        ))}
                                    </div>
                                    <p className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest ml-1">
                                        Alcance Estimado: {segment === 'all' ? subCount : predictedReach} dispositivos
                                    </p>
                                </div>

                                <div className="space-y-3">
                                    <Label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Título do Gancho</Label>
                                    <Input
                                        value={notification.title}
                                        onChange={e => setNotification({ ...notification, title: e.target.value })}
                                        placeholder="Ex: Almoço VIP Liberado! 🥂"
                                        className="h-16 bg-zinc-50 border-zinc-100 rounded-2xl focus:ring-zinc-950/5 text-base font-black placeholder:text-zinc-300 transition-all focus:bg-white focus:border-zinc-950 shadow-sm"
                                    />
                                </div>

                                <div className="space-y-3">
                                    <Label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Mensagem Persuasiva</Label>
                                    <Textarea
                                        value={notification.body}
                                        onChange={e => setNotification({ ...notification, body: e.target.value })}
                                        placeholder="Os primeiros 10 clientes ganham um presente exclusivo..."
                                        rows={4}
                                        className="bg-zinc-50 border-zinc-100 rounded-2xl focus:ring-zinc-950/5 text-sm font-medium placeholder:text-zinc-300 transition-all focus:bg-white focus:border-zinc-950 resize-none p-5 shadow-sm"
                                    />
                                </div>

                                <div className="space-y-3">
                                    <Label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Caminho de Destino</Label>
                                    <Input
                                        value={notification.url}
                                        onChange={e => setNotification({ ...notification, url: e.target.value })}
                                        placeholder="/"
                                        className="h-16 bg-zinc-50 border-zinc-100 rounded-2xl focus:ring-zinc-950/5 text-sm font-bold font-mono transition-all focus:bg-white focus:border-zinc-950 shadow-sm"
                                    />
                                </div>

                                <button
                                    className="w-full h-20 mt-4 flex items-center justify-center gap-4 bg-emerald-500 text-white rounded-[2rem] text-sm font-black uppercase tracking-[0.3em] hover:bg-emerald-400 transition-all active:scale-95 shadow-[0_20px_40px_rgba(16,185,129,0.2)] disabled:opacity-30 disabled:grayscale disabled:active:scale-100"
                                    onClick={handleSend}
                                    disabled={loading || subCount === 0}
                                >
                                    {loading ? (
                                        <div className="w-6 h-6 border-3 border-white/20 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <>
                                            <Zap className="w-5 h-5 fill-current" />
                                            Lançar Notificação
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Conversão Tip Card */}
                        <div className="bg-emerald-50 rounded-[2rem] p-6 border border-emerald-100 flex gap-5">
                            <div className="w-12 h-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center flex-shrink-0">
                                <Info className="w-6 h-6 text-emerald-600" />
                            </div>
                            <div className="space-y-1">
                                <h4 className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em]">Diretriz de Conversão</h4>
                                <p className="text-[11px] font-bold text-zinc-500 leading-relaxed uppercase tracking-tight italic">
                                    Notificações entre 10h e 12h têm <span className="text-zinc-900">40% mais cliques</span>.
                                    Lembre-se: Menos é Mais Luxo.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Histórico - 2 Colunas */}
                    <div className="md:col-span-2 space-y-6">
                        <div className="flex items-center gap-3 px-2">
                            <History className="w-4 h-4 text-zinc-700" />
                            <h3 className="text-[11px] font-black text-zinc-500 uppercase tracking-[0.2em]">Log de Campanha</h3>
                        </div>

                        <div className="space-y-4 relative before:absolute before:left-6 before:top-2 before:bottom-0 before:w-[1px] before:bg-zinc-100">
                            {history.length === 0 ? (
                                <div className="text-center py-10 opacity-30 italic">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Sem histórico</p>
                                </div>
                            ) : history.map((item) => (
                                <div key={item.id} className="relative pl-14 group">
                                    <div className="absolute left-4 top-1 w-4 h-4 bg-white border-2 border-zinc-950 rounded-full z-10 shadow-premium-sm group-hover:scale-125 transition-transform" />
                                    <div className="bg-white p-6 rounded-[1.5rem] border border-zinc-100 hover:bg-zinc-50/50 hover:shadow-premium-sm transition-all cursor-default">
                                        <div className="flex justify-between items-start mb-3">
                                            <span className="text-[9px] font-black text-emerald-600/70 uppercase tracking-widest">
                                                {new Date(item.sent_at).toLocaleDateString()} • {new Date(item.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                        <h4 className="text-[10px] font-black text-zinc-900 uppercase tracking-wider mb-2 line-clamp-1">{item.title}</h4>
                                        <div className="flex items-center justify-between text-[9px] font-bold text-zinc-400 uppercase tracking-widest">
                                            <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {item.recipient_count}</span>
                                            <span className="text-zinc-200">|</span>
                                            <span className="truncate max-w-[80px]">{item.url}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
