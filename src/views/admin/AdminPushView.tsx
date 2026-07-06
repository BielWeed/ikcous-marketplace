import { useState, useEffect, useCallback, memo } from 'react';
import { ArrowLeft, Send, Users, Info, Sparkles, Zap, History, Target, HelpCircle, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { LocalBufferedInput, LocalBufferedTextarea } from '@/components/admin/LocalBufferedInput';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useVOR } from '@/hooks/useVOR';
import type { View } from '@/types';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

interface AdminPushViewProps {
    onNavigate: (view: View, id?: string) => void;
    targetUserId?: string;
}

export const AdminPushView = memo(function AdminPushView({ onNavigate, targetUserId }: AdminPushViewProps) {
    const { user } = useAuth();
    const isOffline = useOnlineStatus();
    const [loading, setLoading] = useState(false);
    const [showHelpModal, setShowHelpModal] = useState(false);
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
    const [targetUserName, setTargetUserName] = useState<string | null>(null);

    useEffect(() => {
        if (targetUserId) {
            setSegment(targetUserId);
            const fetchUserName = async () => {
                const { data, error } = await supabase
                    .from('profiles')
                    .select('full_name')
                    .eq('id', targetUserId)
                    .single();
                if (!error && data) {
                    setTargetUserName(data.full_name);
                }
            };
            fetchUserName();
        } else {
            setTargetUserName(null);
            setSegment('all');
        }
    }, [targetUserId]);

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
        if (isOffline) {
            toast.error('Você está offline', {
                description: 'Não é possível se inscrever para notificações de teste sem conexão.'
            });
            return;
        }
        try {
            await subscribe();
            setIsTestSubscribed(true);
            fetchSubscribers();
        } catch (_error) {
            // Error handled in hook
        }
    };

    const handleSend = async () => {
        if (isOffline) {
            toast.error('Você está offline', {
                description: 'Não é possível enviar notificações push sem conexão.'
            });
            return;
        }
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

            // 2.5. Save in-app notifications
            try {
                if (targetUserId) {
                    await supabase.from('notificacoes').insert({
                        titulo: notification.title,
                        mensagem: notification.body,
                        tipo: 'aviso',
                        usuario_id: targetUserId,
                        dados: { segment, action_url: notification.url }
                    });
                } else if (segment === 'all') {
                    await supabase.from('notificacoes').insert({
                        titulo: notification.title,
                        mensagem: notification.body,
                        tipo: 'aviso',
                        usuario_id: null,
                        dados: { segment, action_url: notification.url }
                    });
                } else {
                    const uniqueUserIds = Array.from(new Set(targetList.map((t: any) => t.user_id).filter(Boolean))) as string[];
                    if (uniqueUserIds.length > 0) {
                        const inAppRows = uniqueUserIds.map(uId => ({
                            titulo: notification.title,
                            mensagem: notification.body,
                            tipo: 'aviso',
                            usuario_id: uId,
                            dados: { segment, action_url: notification.url }
                        }));
                        const chunkSize = 100;
                        for (let i = 0; i < inAppRows.length; i += chunkSize) {
                            const chunk = inAppRows.slice(i, i + chunkSize);
                            await supabase.from('notificacoes').insert(chunk);
                        }
                    }
                }
            } catch (inAppErr) {
                console.error('Error saving in-app notification:', inAppErr);
            }

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

    const handleBack = () => {
        if (targetUserId) {
            onNavigate('admin-customers');
        } else {
            onNavigate('admin-dashboard');
        }
    };

    return (
        <div className="h-auto bg-[#09090b] text-white selection:bg-emerald-500/30 selection:text-emerald-200 pb-8 animate-in fade-in duration-700">
            {/* Header Executivo */}
            <div className="px-6 py-6">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={handleBack}
                            className="w-12 h-12 flex items-center justify-center bg-zinc-950 text-zinc-400 rounded-2xl hover:bg-zinc-900 hover:border-admin-gold/50 transition-all active:scale-95 border border-zinc-800 group shadow-inner"
                            title="Voltar"
                        >
                            <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                        </button>
                        <div>
                            <h1 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
                                <span>Push Center</span>
                                <button
                                    type="button"
                                    onClick={() => setShowHelpModal(true)}
                                    className="w-7 h-7 rounded-full flex items-center justify-center border transition-all duration-300 active:scale-95 bg-zinc-900/60 border-white/5 text-zinc-500 hover:text-white hover:border-white/10 shrink-0"
                                    title="Guia do Push Center e Ajuda"
                                >
                                    <HelpCircle className="w-3.5 h-3.5" />
                                </button>
                                <Target className="w-4 h-4 text-emerald-500 animate-pulse" />
                            </h1>
                            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Centro de Comando de Engajamento</p>
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
                            disabled={isOffline}
                            className="px-6 py-3 bg-white text-emerald-600 text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-emerald-50 transition-all border border-emerald-100 flex items-center gap-3 shadow-premium-sm active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
                        >
                            <Zap className="w-4 h-4 fill-emerald-500" />
                            Monitorar este Dispositivo (Admin Test)
                        </button>
                    </div>
                )}
                {/* Stats Card - Radar Estilo Hi-Tech */}
                <div className="admin-glass rounded-[3rem] p-10 border border-white/5 relative overflow-hidden shadow-2xl bg-zinc-900/40 backdrop-blur-3xl">
                    <div className="relative z-10 flex items-center justify-between">
                        <div className="space-y-4">
                            <div>
                                <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.3em] mb-2 flex items-center gap-2">
                                    <Sparkles className="w-3 h-3 text-admin-gold" /> Alcance Instantâneo
                                </p>
                                <h2 className="text-6xl font-black tracking-tighter text-white tabular-nums">
                                    {subCount}
                                </h2>
                                <p className="text-emerald-400 text-[10px] font-bold mt-2 uppercase tracking-widest flex items-center gap-2">
                                    <Zap className="w-3 h-3" /> Dispositivos Prontos para Receber
                                </p>
                            </div>
                            <div className="flex gap-4 pt-4">
                                <div className="px-5 py-2.5 bg-zinc-950/60 rounded-2xl border border-white/5 text-[10px] font-black uppercase tracking-widest text-zinc-400 shadow-inner">
                                    iOS: {Math.floor(subCount * 0.4)}
                                </div>
                                <div className="px-5 py-2.5 bg-zinc-950/60 rounded-2xl border border-white/5 text-[10px] font-black uppercase tracking-widest text-zinc-400 shadow-inner">
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
                                <Users className="w-12 h-12 text-zinc-700" />
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
                        <div className="admin-glass border border-white/5 rounded-[2.5rem] p-8 space-y-8 shadow-2xl bg-zinc-900/40 backdrop-blur-3xl">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 bg-zinc-950 text-white rounded-2xl flex items-center justify-center shadow-inner border border-white/5">
                                    <Send className="w-5 h-5 text-admin-gold" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-black text-white uppercase tracking-widest italic">Redigir Campanha</h3>
                                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Disparo imediato segmentado</p>
                                </div>
                            </div>

                            {isOffline && (
                                <div className="p-5 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center gap-3.5 text-rose-400 animate-in fade-in slide-in-from-top-3">
                                    <AlertCircle className="w-5 h-5 shrink-0" />
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-wider">Modo Offline Ativo</p>
                                        <p className="text-[10px] text-zinc-500 font-bold mt-0.5">Disparos de notificação desativados temporariamente.</p>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-6">
                                <div className="space-y-3">
                                    <Label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Segmentação do Público</Label>
                                    {targetUserId ? (
                                        <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
                                            <div>
                                                <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest leading-none">Envio Direcionado</p>
                                                <p className="text-sm font-bold text-white mt-1.5 leading-none">
                                                    Cliente: {targetUserName || 'Carregando...'}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => {
                                                    onNavigate('admin-push');
                                                }}
                                                disabled={isOffline}
                                                className="px-4 py-2 bg-zinc-900 border border-white/10 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-zinc-800 transition-all active:scale-95 shadow-sm disabled:opacity-40"
                                            >
                                                Cancelar
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-2">
                                            {[
                                                { id: 'all', label: 'Todos' },
                                                { id: 'vip', label: 'Clientes VIP' },
                                                { id: 'inactive', label: 'Inativos (30d)' },
                                                { id: 'new', label: 'Novos Clientes' }
                                            ].map(s => (
                                                <button
                                                    key={s.id}
                                                    onClick={() => !isOffline && setSegment(s.id)}
                                                    disabled={isOffline}
                                                    className={`h-12 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${segment === s.id
                                                        ? 'bg-white text-black border-white shadow-lg shadow-white/10'
                                                        : 'bg-white/5 text-zinc-400 border-white/5 hover:bg-white/10 hover:text-white'
                                                        } disabled:opacity-30 disabled:pointer-events-none`}
                                                >
                                                    {s.label}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    <p className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest ml-1">
                                        Alcance Estimado: {segment === 'all' ? subCount : predictedReach} dispositivos
                                    </p>
                                </div>

                                <div className="space-y-3">
                                    <Label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Título do Gancho</Label>
                                    <LocalBufferedInput
                                        value={notification.title}
                                        onFlush={val => setNotification(prev => ({ ...prev, title: val }))}
                                        disabled={isOffline || loading}
                                        placeholder={isOffline ? "Indisponível offline" : "Ex: Almoço VIP Liberado! 🥂"}
                                        useShadcn={true}
                                        className="h-16 bg-black/40 border-white/10 rounded-2xl focus:ring-admin-gold/50 focus:bg-black/60 focus:border-admin-gold/50 text-white placeholder:text-zinc-700 shadow-inner transition-all disabled:opacity-40"
                                    />
                                </div>

                                <div className="space-y-3">
                                    <Label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Mensagem Persuasiva</Label>
                                    <LocalBufferedTextarea
                                        value={notification.body}
                                        onFlush={val => setNotification(prev => ({ ...prev, body: val }))}
                                        disabled={isOffline || loading}
                                        placeholder={isOffline ? "Indisponível offline" : "Os primeiros 10 clientes ganham um presente exclusivo..."}
                                        rows={4}
                                        useShadcn={true}
                                        className="bg-black/40 border-white/10 rounded-2xl focus:ring-admin-gold/50 focus:bg-black/60 focus:border-admin-gold/50 text-sm font-medium text-white placeholder:text-zinc-700 resize-none p-5 shadow-inner transition-all disabled:opacity-40"
                                    />
                                </div>

                                <div className="space-y-3">
                                    <Label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Caminho de Destino</Label>
                                    <LocalBufferedInput
                                        value={notification.url}
                                        onFlush={val => setNotification(prev => ({ ...prev, url: val }))}
                                        disabled={isOffline || loading}
                                        placeholder="/"
                                        useShadcn={true}
                                        className="h-16 bg-black/40 border-white/10 rounded-2xl focus:ring-admin-gold/50 focus:bg-black/60 focus:border-admin-gold/50 text-sm font-bold font-mono text-white placeholder:text-zinc-700 shadow-inner transition-all disabled:opacity-40"
                                    />
                                </div>

                                <button
                                    className="w-full h-20 mt-4 flex items-center justify-center gap-4 bg-emerald-500 text-white rounded-[2rem] text-sm font-black uppercase tracking-[0.3em] hover:bg-emerald-400 transition-all active:scale-95 shadow-[0_20px_40px_rgba(16,185,129,0.2)] disabled:opacity-30 disabled:grayscale disabled:active:scale-100"
                                    onClick={handleSend}
                                    disabled={loading || subCount === 0 || isOffline}
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
                        <div className="bg-emerald-500/5 rounded-[2rem] p-6 border border-emerald-500/10 flex gap-5 backdrop-blur-md">
                            <div className="w-12 h-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center flex-shrink-0 border border-emerald-500/20">
                                <Info className="w-6 h-6 text-emerald-400" />
                            </div>
                            <div className="space-y-1">
                                <h4 className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.2em]">Diretriz de Conversão</h4>
                                <p className="text-[11px] font-bold text-zinc-400 leading-relaxed uppercase tracking-tight italic">
                                    Notificações entre 10h e 12h têm <span className="text-white font-black">40% mais cliques</span>.
                                    Lembre-se: Menos é Mais Luxo.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Histórico - 2 Colunas */}
                    <div className="md:col-span-2 space-y-6">
                        <div className="flex items-center gap-3 px-2">
                            <History className="w-4 h-4 text-zinc-500" />
                            <h3 className="text-[11px] font-black text-zinc-500 uppercase tracking-[0.2em]">Log de Campanha</h3>
                        </div>

                        <div className="space-y-4 relative before:absolute before:left-6 before:top-2 before:bottom-0 before:w-[1px] before:bg-white/5">
                            {history.length === 0 ? (
                                <div className="text-center py-10 opacity-30 italic">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Sem histórico</p>
                                </div>
                            ) : history.map((item) => (
                                <div key={item.id} className="relative pl-14 group">
                                    <div className="absolute left-4 top-1 w-4 h-4 bg-zinc-950 border-2 border-zinc-800 rounded-full z-10 shadow-md group-hover:scale-125 transition-transform" />
                                    <div className="bg-zinc-900/40 backdrop-blur-md p-6 rounded-[1.5rem] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 hover:shadow-2xl transition-all cursor-default">
                                        <div className="flex justify-between items-start mb-3">
                                            <span className="text-[9px] font-black text-emerald-400/70 uppercase tracking-widest">
                                                {new Date(item.sent_at).toLocaleDateString()} • {new Date(item.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                        <h4 className="text-[10px] font-black text-white uppercase tracking-wider mb-2 line-clamp-1">{item.title}</h4>
                                        <div className="flex items-center justify-between text-[9px] font-bold text-zinc-500 uppercase tracking-widest">
                                            <span className="flex items-center gap-1 text-zinc-400"><Users className="w-3 h-3" /> {item.recipient_count}</span>
                                            <span className="text-zinc-700">|</span>
                                            <span className="truncate max-w-[80px] text-zinc-400">{item.url}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Modal de Ajuda */}
            {showHelpModal && (
              <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300 text-left">
                <div className="relative bg-zinc-950/95 border border-white/10 rounded-[2rem] sm:rounded-[2.5rem] w-full max-w-2xl p-5 sm:p-8 flex flex-col max-h-[88vh] sm:max-h-[85vh] shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden animate-in zoom-in-95 duration-300 text-zinc-300 text-sm">
                  {/* Header */}
                  <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4 shrink-0">
                    <h3 className="text-sm font-black text-admin-gold uppercase tracking-[0.2em] flex items-center gap-2">
                      <HelpCircle className="w-5 h-5 text-admin-gold animate-pulse" />
                      Push Center & Engajamento
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowHelpModal(false)}
                      className="w-8 h-8 rounded-xl bg-zinc-900/50 border border-white/5 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all flex items-center justify-center font-bold text-sm"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto space-y-6 pr-1 pb-6 custom-scrollbar text-zinc-300 text-sm">
                    <div className="space-y-4">
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        O Push Center é o centro de comando de engajamento do marketplace. Aqui você pode disparar notificações em massa para todos os usuários inscritos no sistema de notificações Web Push.
                      </p>

                      <div className="space-y-3">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 border-l-2 border-admin-gold pl-2">
                          Seções Principais
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <Target className="w-4 h-4 text-emerald-500" />
                              Disparo de Campanhas
                            </div>
                            <p className="text-xs text-zinc-400">
                              Configure o título da notificação, a mensagem (corpo) e uma URL interna ou externa. Os usuários que clicarem na notificação serão direcionados para esse link.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <Sparkles className="w-4 h-4 text-admin-gold" />
                              SROS Manifesto Generator
                            </div>
                            <p className="text-xs text-zinc-400">
                              Uma ferramenta assistiva interna que gera copys otimizadas para as notificações de acordo com o objetivo da sua campanha promocional.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <Users className="w-4 h-4 text-sky-500" />
                              Usuários Inscritos
                            </div>
                            <p className="text-xs text-zinc-400">
                              Exibe a quantidade total de dispositivos aptos a receber as notificações disparadas (usuários que concederam permissão no navegador).
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <History className="w-4 h-4 text-purple-500" />
                              Linha do Tempo (Logs)
                            </div>
                            <p className="text-xs text-zinc-400">
                              O histórico completo das notificações enviadas no passado, incluindo data, quantidade de destinatários e link de redirecionamento.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="pt-4 border-t border-white/5 flex justify-end shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowHelpModal(false)}
                      className="px-5 py-2.5 rounded-xl bg-admin-gold text-black text-[10px] font-black uppercase tracking-widest hover:bg-admin-gold/90 transition-all"
                    >
                      Entendi
                    </button>
                  </div>
                </div>
              </div>
            )}
        </div>
    );
});
