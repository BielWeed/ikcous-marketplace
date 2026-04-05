import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export function usePushNotifications() {
    const { user } = useAuth();
    const [subscription, setSubscription] = useState<PushSubscription | null>(null);
    const [isSupported, setIsSupported] = useState(false);
    const [permission, setPermission] = useState<NotificationPermission>('default');

    useEffect(() => {
        const checkSupport = async () => {
            const supported = 'serviceWorker' in navigator && 'PushManager' in globalThis;
            setIsSupported(supported);

            if (supported) {
                setPermission(Notification.permission);
                const registration = await navigator.serviceWorker.ready;
                const sub = await registration.pushManager.getSubscription();
                setSubscription(sub);
            }
        };

        checkSupport();
    }, []);

    const subscribe = useCallback(async () => {
        if (!isSupported) return;

        try {
            // Get VAPID public key from env or use a default one for dev
            const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;

            if (!vapidPublicKey) {
                console.warn('VAPID Public Key not found in environment');
                return;
            }

            const result = await Notification.requestPermission();
            setPermission(result);

            if (result !== 'granted') {
                throw new Error('Permissão de notificação negada');
            }

            const registration = await navigator.serviceWorker.ready;

            // Convert VAPID key from base64 to Uint8Array
            const padding = '='.repeat((4 - vapidPublicKey.length % 4) % 4);
            const base64 = (vapidPublicKey + padding).replaceAll('-', '+').replaceAll('_', '/');
            const rawData = globalThis.atob(base64);
            const outputArray = new Uint8Array(rawData.length);
            for (let i = 0; i < rawData.length; ++i) {
                outputArray[i] = rawData.codePointAt(i) || 0;
            }

            const newSubscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: outputArray
            });

            // ZENITH v21.7: Rely on AuthContext's verified user
            if (!user) {
                console.warn('[Push] No user session for subscription.');
                return;
            }
            const subJSON = newSubscription.toJSON();

            const { error } = await (supabase
                .from('push_subscriptions' as any) as any)
                .upsert({
                    endpoint: subJSON.endpoint,
                    p256dh: subJSON.keys?.p256dh,
                    auth: subJSON.keys?.auth,
                    user_id: user?.id || null
                }, { onConflict: 'endpoint' });

            if (error) throw error;

            setSubscription(newSubscription);
            toast.success('Inscrição realizada com sucesso!');
            return newSubscription;
        } catch (error: any) {
            console.error('Error subscribing to push:', error);
            toast.error(error.message || 'Erro ao se inscrever para notificações');
            throw error;
        }
    }, [isSupported, user]);

    const unsubscribe = useCallback(async () => {
        if (!subscription) return;

        try {
            await subscription.unsubscribe();

            // Remove from Supabase
            const { error } = await (supabase
                .from('push_subscriptions' as any) as any)
                .delete()
                .eq('endpoint', subscription.endpoint);

            if (error) throw error;

            setSubscription(null);
            toast.success('Você não receberá mais notificações.');
        } catch (error) {
            console.error('Error unsubscribing:', error);
            toast.error('Erro ao cancelar inscrição');
        }
    }, [subscription]);

    return {
        subscription,
        isSupported,
        permission,
        subscribe,
        unsubscribe
    };
}
