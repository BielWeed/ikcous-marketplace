import { Bell, X, Info, Package, Zap, Gift, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet";
import { cn } from '@/lib/utils';
import type { Notification } from '@/types';
import { useNotificationCenter } from '@/contexts/NotificationContextCore';

interface NotificationCenterProps {
    readonly isOpen: boolean;
    readonly onOpenChange: (open: boolean) => void;
}

export function NotificationCenter({ isOpen, onOpenChange }: Readonly<NotificationCenterProps>) {
    const { notifications, markAllAsRead, deleteNotification, markAsRead } = useNotificationCenter();

    return (
        <Sheet open={isOpen} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full sm:max-w-md bg-white border-zinc-100 p-0 flex flex-col">
                <SheetHeader className="p-8 border-b border-zinc-50 bg-zinc-50/50">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-zinc-900 rounded-2xl flex items-center justify-center">
                                <Bell className="w-5 h-5 text-white" />
                            </div>
                            <SheetTitle className="text-xl font-black tracking-tighter italic">ACTION CENTER</SheetTitle>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={markAllAsRead}
                            className="text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-zinc-900"
                        >
                            Limpar Tudo
                        </Button>
                    </div>
                    <SheetDescription className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em] mt-2">
                        Mensagens e Alertas importantes
                    </SheetDescription>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto">
                    {notifications.length > 0 ? (
                        <div className="divide-y divide-zinc-50">
                            {notifications.map((notif: Notification) => {
                                const isUrgent = notif.type === 'order' || notif.type === 'delivery';
                                const isPromo = notif.type === 'promotion';
                                
                                const statusColor = isUrgent ? "bg-blue-50 text-blue-600" :
                                                   isPromo ? "bg-amber-50 text-amber-600" :
                                                   "bg-zinc-50 text-zinc-600";
                                
                                const Icon = isUrgent ? Package :
                                            isPromo ? Gift :
                                            Info;

                                return (
                                    <div
                                        key={notif.id}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => !notif.read && markAsRead(notif.id)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                if (!notif.read) markAsRead(notif.id);
                                            }
                                        }}
                                        className={cn(
                                            "p-6 transition-all hover:bg-zinc-50 group relative cursor-pointer",
                                            !notif.read && "bg-amber-50/20"
                                        )}
                                    >
                                        {!notif.read && (
                                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400" />
                                        )}
                                        <div className="flex gap-4">
                                            <div className={cn(
                                                "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border border-zinc-100 shadow-sm",
                                                statusColor
                                            )}>
                                                <Icon className="w-5 h-5" />
                                            </div>
                                            <div className="space-y-1 pr-8">
                                                <h4 className="text-sm font-black text-zinc-900 leading-tight">{notif.title}</h4>
                                                <p className="text-xs text-zinc-500 leading-relaxed font-medium">{notif.message}</p>
                                                <p className="text-[9px] font-black text-zinc-300 uppercase tracking-widest pt-1">
                                                    {new Date(notif.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                </p>
                                            </div>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    deleteNotification(notif.id);
                                                }}
                                                className="absolute right-6 top-6 opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-zinc-100 rounded-lg"
                                                aria-label="Excluir notificação"
                                            >
                                                <X className="w-4 h-4 text-zinc-400" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center p-12 space-y-4">
                            <div className="w-20 h-20 bg-zinc-50 rounded-[2.5rem] flex items-center justify-center">
                                <Inbox className="w-8 h-8 text-zinc-200" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-black text-zinc-300 uppercase tracking-widest">A caixa está vazia</p>
                                <p className="text-xs text-zinc-400 font-medium">Você será notificado assim que algo novo chegar.</p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-8 border-t border-zinc-50">
                    <button
                        onClick={() => onOpenChange(false)}
                        className="w-full h-16 bg-zinc-900 text-white rounded-2xl font-black uppercase tracking-[0.2em] text-xs hover:bg-black transition-all active:scale-95 flex items-center justify-center gap-3"
                    >
                        <Zap className="w-4 h-4" />
                        Acompanhar Ecossistema
                    </button>
                </div>
            </SheetContent>
        </Sheet>
    );
}
