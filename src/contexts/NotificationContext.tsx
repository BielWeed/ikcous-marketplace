import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import type { Notification } from '@/types';
import { NotificationContext } from './NotificationContextCore';

export function NotificationProvider({ children }: Readonly<{ children: React.ReactNode }>) {
    const { user } = useAuth();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);
    const lastFetchRef = useRef<number>(0);

    const fetchNotifications = useCallback(async (force = false) => {
        if (!user) {
            setNotifications([]);
            setLoading(false);
            return;
        }

        const now = Date.now();
        if (!force && now - lastFetchRef.current < 10000) return; // cache 10s
        lastFetchRef.current = now;

        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('notificacoes')
                .select('*')
                .eq('usuario_id', user.id)
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) throw error;
            
            const mappedData: Notification[] = (data || []).map(item => ({
                id: item.id,
                title: item.titulo,
                message: item.mensagem || '',
                type: (item.tipo as any) || 'system',
                read: !!item.lida,
                created_at: item.created_at,
                action_url: (item.acao as any)?.url || (item.dados as any)?.action_url,
                order_id: (item.dados as any)?.order_id
            }));

            setNotifications(mappedData);
        } catch (err) {
            console.error('[Notifications] Fetch error:', err);
        } finally {
            setLoading(false);
        }
    }, [user]);

    const markAsRead = useCallback(async (id: string) => {
        try {
            const { error } = await supabase
                .from('notificacoes')
                .update({ lida: true })
                .eq('id', id);

            if (error) throw error;
            setNotifications(prev =>
                prev.map(n => n.id === id ? { ...n, read: true } : n)
            );
        } catch (err) {
            console.error('[Notifications] Mark as read error:', err);
        }
    }, []);

    const markAllAsRead = useCallback(async () => {
        if (!user) return;
        try {
            const { error } = await supabase
                .from('notificacoes')
                .update({ lida: true })
                .eq('usuario_id', user.id)
                .eq('lida', false);

            if (error) throw error;
            setNotifications(prev => prev.map(n => ({ ...n, read: true })));
        } catch (err) {
            console.error('[Notifications] Mark all as read error:', err);
        }
    }, [user]);

    const deleteNotification = useCallback(async (id: string) => {
        try {
            const { error } = await supabase
                .from('notificacoes')
                .delete()
                .eq('id', id);

            if (error) throw error;
            setNotifications(prev => prev.filter(n => n.id !== id));
        } catch (err) {
            console.error('[Notifications] Delete error:', err);
        }
    }, []);

    useEffect(() => {
        if (user) {
            fetchNotifications(true);

            // Realtime subscription
            const channel = supabase
                .channel(`notificacoes:${user.id}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'notificacoes',
                    filter: `usuario_id=eq.${user.id}`
                }, () => {
                    fetchNotifications(true);
                })
                .subscribe();

            return () => {
                supabase.removeChannel(channel);
            };
        } else {
            setNotifications([]);
            setLoading(false);
        }
    }, [user, fetchNotifications]);

    const unreadCount = notifications.filter(n => !n.read).length;

    const contextValue = useMemo(() => ({
        notifications,
        unreadCount,
        loading,
        markAsRead,
        markAllAsRead,
        deleteNotification,
        refresh: () => fetchNotifications(true)
    }), [notifications, unreadCount, loading, markAsRead, markAllAsRead, deleteNotification, fetchNotifications]);

    return (
        <NotificationContext.Provider value={contextValue}>
            {children}
        </NotificationContext.Provider>
    );
}
