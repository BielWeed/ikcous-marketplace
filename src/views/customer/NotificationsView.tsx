import { X, Info, Package, Gift, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNotificationCenter } from '@/contexts/NotificationContextCore';

export function NotificationsView() {
    const { notifications, markAllAsRead, deleteNotification, markAsRead } = useNotificationCenter();

    return (
        <div className="min-h-full bg-zinc-50/50 pb-24 flex flex-col">
            <div className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-zinc-100 px-4 py-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <h1 className="text-xl font-bold">Notificações</h1>
                </div>
                {notifications.length > 0 && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={markAllAsRead}
                        className="text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-zinc-900"
                    >
                        Limpar Tudo
                    </Button>
                )}
            </div>

            <div className="flex-1 flex flex-col px-4 pt-4">
                {notifications.length > 0 ? (
                    <div className="space-y-3">
                        {notifications.map((notif: any) => (
                            <div
                                key={notif.id}
                                onClick={() => !notif.lida && markAsRead(notif.id)}
                                className={`p-4 md:p-6 rounded-2xl bg-white border border-zinc-100 transition-all hover:border-zinc-200 group relative cursor-pointer shadow-sm ${!notif.lida ? 'bg-amber-50/10 border-amber-100' : ''}`}
                            >
                                {!notif.lida && (
                                    <div className="absolute left-0 top-4 bottom-4 w-1 rounded-r-lg bg-amber-400" />
                                )}
                                <div className="flex gap-4">
                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border border-zinc-100 shadow-sm ${notif.tipo === 'order' || notif.tipo === 'sucesso' ? 'bg-blue-50 text-blue-600' :
                                        notif.tipo === 'referral' || notif.tipo === 'promo' ? 'bg-amber-50 text-amber-600' :
                                            'bg-zinc-50 text-zinc-600'
                                        }`}>
                                        {notif.tipo === 'order' || notif.tipo === 'sucesso' ? <Package className="w-5 h-5" /> :
                                            notif.tipo === 'referral' || notif.tipo === 'promo' ? <Gift className="w-5 h-5" /> :
                                                <Info className="w-5 h-5" />}
                                    </div>
                                    <div className="space-y-1 pr-8 flex-1">
                                        <h4 className="text-sm font-black text-zinc-900 leading-tight">{notif.titulo}</h4>
                                        <p className="text-xs text-zinc-500 leading-relaxed font-medium line-clamp-2 md:line-clamp-none">{notif.mensagem}</p>
                                        <p className="text-[9px] font-black text-zinc-300 uppercase tracking-widest pt-1">
                                            {new Date(notif.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                    </div>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            deleteNotification(notif.id);
                                        }}
                                        className="absolute right-4 top-4 md:opacity-0 md:group-hover:opacity-100 transition-opacity p-2 hover:bg-zinc-100 rounded-lg"
                                    >
                                        <X className="w-4 h-4 text-zinc-400" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-20 px-6 text-center h-full">
                        <div className="w-20 h-20 bg-zinc-100 rounded-full flex items-center justify-center mb-6">
                            <Inbox className="w-10 h-10 text-zinc-300" />
                        </div>
                        <h2 className="text-lg font-bold mb-2">Sem notificações ainda</h2>
                        <p className="text-zinc-500 max-w-xs text-sm">
                            Fique atento! Avisaremos você sobre promoções e atualizações dos seus pedidos aqui.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
