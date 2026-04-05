import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

/**
 * useRealtimeUpdate
 * Camada 1 da v21.0 ZENITH.
 * Assina um canal de Broadcast do Supabase para receber notificações de deploy em tempo real.
 * Elimina a dependência exclusiva de polling no version.json.
 */
export function useRealtimeUpdate(onUpdateDetected: () => void, userId?: string) {
    const callbackRef = useRef(onUpdateDetected);
    
    useEffect(() => {
        callbackRef.current = onUpdateDetected;
    }, [onUpdateDetected]);

    useEffect(() => {
        let activeChannel: ReturnType<typeof supabase.channel> | null = null;
        let retryCount = 0;
        let isUnmounting = false;
        let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

        const setupRealtime = () => {
            if (isUnmounting) return;

            // Cleanup previous channel before creating a new one
            if (activeChannel) {
                console.log('[RealtimeUpdate] Removing previous channel instance...');
                supabase.removeChannel(activeChannel).catch(() => {});
                activeChannel = null;
            }

            console.log('[RealtimeUpdate] Initializing pwa-system-signals channel' + (userId ? ` for user ${userId.slice(0, 8)}` : ' (public)') + '...');
            const channel = supabase.channel('pwa-system-signals');
            activeChannel = channel;

            channel
                .on('broadcast', { event: 'deploy-ping' }, (payload) => {
                    if (isUnmounting) return;
                    
                    let data = payload.payload;
                    if (data instanceof ArrayBuffer) {
                        data = { version: 'binary-v24' };
                    }
                    console.log('[RealtimeUpdate] Deploy signal received:', data);
                    
                    const newVersion = data?.version;
                    toast.info('Nova atualização disponível (Realtime)', {
                        description: `Versão ${newVersion || 'detectada'} está pronta.`
                    });

                    callbackRef.current();
                })
                .subscribe((status, err) => {
                    if (isUnmounting || activeChannel !== channel) return;

                    if (status === 'SUBSCRIBED') {
                        retryCount = 0;
                        console.log('[RealtimeUpdate] Active: pwa-system-signals');
                    } else if (status === 'CHANNEL_ERROR') {
                        const errorMsg = err?.message || 'Connection failed';
                        
                        if (import.meta.env.DEV) {
                            console.warn('[RealtimeUpdate] Channel unavailable (Silent in Dev):', errorMsg);
                        } else {
                            if (retryCount > 3) {
                                console.error('[RealtimeUpdate] Persistent connection failure:', errorMsg);
                            } else {
                                console.warn('[RealtimeUpdate] Transient connection issue, retrying...', errorMsg);
                            }
                        }
                        handleReconnect();
                    } else if (status === 'TIMED_OUT' || status === 'CLOSED') {
                        handleReconnect();
                    }
                });
        };

        const handleReconnect = () => {
            if (isUnmounting) return;

            const MAX_RETRIES = 12;
            if (retryCount >= MAX_RETRIES) {
                console.error('[RealtimeUpdate] Max retries reached. Stopping reconnection.');
                return;
            }

            const delay = Math.min(1000 * Math.pow(2, retryCount), 60000) + (Math.random() * 1000);
            retryCount++;

            console.log(`[RealtimeUpdate] Reconnecting in ${Math.round(delay/1000)}s (Attempt ${retryCount})`);
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            reconnectTimeout = setTimeout(setupRealtime, delay);
        };

        setupRealtime();

        return () => {
            console.log('[RealtimeUpdate] Context cleaning up...');
            isUnmounting = true;
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
                reconnectTimeout = null;
            }
            if (activeChannel) {
                const channelToCleanup = activeChannel;
                activeChannel = null;
                supabase.removeChannel(channelToCleanup).catch(() => {});
            }
        };
    }, [userId]);
}
