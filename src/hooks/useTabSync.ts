import { useEffect, useCallback } from 'react';
import { toast } from 'sonner';

const TAB_CHANNEL = 'ikcous-tab-sync';

export type TabSyncMessage =
    | { type: 'CART_UPDATE'; count: number }
    | { type: 'AUTH_CHANGE'; userId: string | null }
    | { type: 'FORCE_RELOAD'; reason?: string }
    | { type: 'TAB_PING' }
    | { type: 'TAB_PONG'; tabId: string };

const TAB_ID = Math.random().toString(36).slice(2, 8);

interface UseTabSyncOptions {
    onCartUpdate?: (count: number) => void;
    onAuthChange?: (userId: string | null) => void;
    onForceReload?: (reason: string) => void;
}

/**
 * useTabSync v15.0
 * Multi-tab state synchronization via BroadcastChannel.
 * Syncs cart count, auth state and allows force reload across tabs.
 */
export function useTabSync({ onCartUpdate, onAuthChange, onForceReload }: UseTabSyncOptions = {}) {
    useEffect(() => {
        const bc = new BroadcastChannel(TAB_CHANNEL);

        bc.onmessage = (event: MessageEvent<TabSyncMessage>) => {
            const msg = event.data;

            switch (msg.type) {
                case 'CART_UPDATE':
                    onCartUpdate?.(msg.count);
                    break;
                case 'AUTH_CHANGE':
                    onAuthChange?.(msg.userId);
                    break;
                case 'FORCE_RELOAD':
                    toast.info('Sincronizando...', {
                        description: msg.reason || 'Atualização detectada pelo sistema.',
                        duration: 3000,
                    });
                    setTimeout(() => {
                        onForceReload?.(msg.reason || '');
                    }, 1000);
                    break;
                case 'TAB_PING':
                    bc.postMessage({ type: 'TAB_PONG', tabId: TAB_ID });
                    break;
                default:
                    break;
            }
        };

        // Also listen for SW-triggered force reload
        const swForceReload = (event: MessageEvent) => {
            if (event.data?.type === 'FORCE_RELOAD') {
                console.log('[TabSync] SW signal: Force reload requested.');
                onForceReload?.('Service Worker Signal');
            }
        };
        navigator.serviceWorker?.addEventListener('message', swForceReload);

        return () => {
            bc.close();
            navigator.serviceWorker?.removeEventListener('message', swForceReload);
        };
    }, [onCartUpdate, onAuthChange, onForceReload]);

    // Broadcast helpers
    const broadcastCartUpdate = useCallback((count: number) => {
        const bc = new BroadcastChannel(TAB_CHANNEL);
        bc.postMessage({ type: 'CART_UPDATE', count });
        bc.close();
    }, []);

    const broadcastForceReload = useCallback((reason = '') => {
        const bc = new BroadcastChannel(TAB_CHANNEL);
        bc.postMessage({ type: 'FORCE_RELOAD', reason });
        bc.close();
    }, []);

    return { broadcastCartUpdate, broadcastForceReload, tabId: TAB_ID };
}
