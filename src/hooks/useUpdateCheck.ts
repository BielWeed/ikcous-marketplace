import { useEffect, useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useStore } from '@/contexts/StoreContext';
import { useRegisterSW } from 'virtual:pwa-register/react';

declare const __APP_VERSION__: string;
const SAFE_APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev';

export function useUpdateCheck() {
    const { config } = useStore();
    const [isMandatory, setIsMandatory] = useState(false);
    const [newVersion, setNewVersion] = useState<string | null>(null);

    // Track if we already notified about this specific update to avoid spam
    const notifiedUpdateRef = useRef<string | null>(null);

    // ==============================
    // CORE: Vite PWA Native Events
    // ==============================
    const {
        offlineReady: [offlineReady, setOfflineReady],
        needRefresh: [needRefresh, _setNeedRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegisteredSW(swUrl, r) {
            console.log(`[PWA] Service Worker registered: ${swUrl}`);
            // Force a check every 3 minutes
            if (r) {
                setInterval(() => {
                    console.log('[PWA] Checking for SW updates...');
                    r.update();
                }, 3 * 60 * 1000);
            }
        },
        onRegisterError(error) {
            console.error('[PWA] Service Worker registration error:', error);
        },
    });

    // ==============================
    // CORE: Nuclear Purge (mandatory)
    // ==============================
    const performNuclearPurge = useCallback(async (immediate = false) => {
        console.warn('[Update] 🔴 NUCLEAR_PURGE_START: Initiating full cleanup...');
        
        const doPurge = async () => {
            // 1. Service Worker cleanup
            if ('serviceWorker' in navigator) {
                try {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    for (const r of regs) {
                        if (r.waiting) r.waiting.postMessage({ type: 'SKIP_WAITING' });
                        await r.unregister();
                    }
                } catch (e) { console.error('[Purge] SW error:', e); }
            }

            // 2. Cache storage cleanup
            if ('caches' in window) {
                try {
                    const keys = await caches.keys();
                    for (const k of keys) await caches.delete(k);
                } catch (e) { console.error('[Purge] Cache error:', e); }
            }

            // 3. Selective localStorage purge
            // Keep auth tokens, user data, and brand specific keys
            const whitelist = ['sb-', 'supabase.auth', 'pwa_', 'marketplace_', 'ikcous_', 'cart_', 'favorites_'];
            try {
                Object.keys(localStorage).forEach(key => {
                    if (!whitelist.some(prefix => key.startsWith(prefix))) {
                        localStorage.removeItem(key);
                    }
                });
            } catch (e) { console.error('[Purge] LocalStorage error:', e); }

            // 4. Set reload reason for next boot
            localStorage.setItem('pwa_reload_reason', 'Sistema atualizado e otimizado.');
            
            // 5. Hard reload
            window.location.href = `${window.location.origin}/?forceUpdate=${Date.now()}`;
        };

        if (immediate) {
            await doPurge();
        } else {
            // Give UI time to show "Updating..." state
            setTimeout(doPurge, 1500);
        }
    }, []);

    // Helper to trigger the update process
    const handleUpdate = useCallback(async (_immediate?: boolean) => {
        console.log('[Update] Triggering SW update and purge...');
        await updateServiceWorker(true);
        await performNuclearPurge(true);
    }, [updateServiceWorker, performNuclearPurge]);

    // ==============================
    // CORE: Mandatory Version Check (DB)
    // ==============================
    const checkMandatoryUpdate = useCallback(() => {
        const isDev = import.meta.env.DEV;
        if (isDev) return false;

        // Skip check if SAFE_APP_VERSION is a dev timestamp (optional logic)
        const isTimestampVersion = SAFE_APP_VERSION.length > 10 && !isNaN(Number(SAFE_APP_VERSION));
        
        // Versão local não coincide com a mínima exigida (e não é timestamp de dev)
        if (config.minAppVersion && config.minAppVersion !== SAFE_APP_VERSION && !isTimestampVersion) {
            console.log(`[Update] 🚨 Mandatory version mismatch detected!`);
            console.log(`[Update] Local: ${SAFE_APP_VERSION} | Required: ${config.minAppVersion}`);
            setIsMandatory(true);
            
            // Grava log para o próximo boot saber o que aconteceu
            localStorage.setItem('pwa_update_log', `Version Mismatch: ${SAFE_APP_VERSION} -> ${config.minAppVersion}`);
            
            performNuclearPurge(true);
            return true;
        }
        return false;
    }, [config.minAppVersion, performNuclearPurge]);

    useEffect(() => {
        checkMandatoryUpdate();
    }, [checkMandatoryUpdate]);

    // ==============================
    // UI Sync: Refresh Notifications
    // ==============================
    useEffect(() => {
        if (needRefresh) {
            console.log('[PWA] New content available! User prompt should appear.');
            setNewVersion('Nova Versão');
            
            // Prevent duplicate toasts if already shown
            if (notifiedUpdateRef.current !== 'PROMPT_SHOWN') {
                toast.success('Sincronizando Sistema', {
                    description: 'Aplicando melhorias automaticamente. Aguarde um instante...',
                    duration: 3000,
                });
                notifiedUpdateRef.current = 'PROMPT_SHOWN';
            }
        }
    }, [needRefresh]);

    useEffect(() => {
        if (offlineReady) {
            console.log('[PWA] App ready for offline use.');
            toast.success('App pronto para uso offline!', {
                duration: 3000,
            });
            setOfflineReady(false); // Reset to avoid re-triggering
        }
    }, [offlineReady, setOfflineReady]);

    // ==============================
    // ChunkLoadError auto-recovery
    // ==============================
    useEffect(() => {
        const handleError = (e: ErrorEvent) => {
            const msg = (e.message || '').toLowerCase();
            const isChunkError =
                msg.includes('loading chunk') ||
                msg.includes('unexpected token') ||
                msg.includes('failed to fetch dynamically imported module') ||
                msg.includes('importing a module script failed');

            if (isChunkError) {
                console.error('[Update] 💥 ChunkLoadError detected');

                const lastReload = sessionStorage.getItem('pwa_chunk_error_reload');
                const now = Date.now();

                if (lastReload && now - parseInt(lastReload) < 15000) {
                    console.warn('[Update] 🛡️ Reload Guard Active.');
                    toast.error('Ocorreu um erro persistente', {
                        description: 'Por favor, tente recarregar manualmente.',
                        duration: 10000,
                    });
                    return;
                }

                sessionStorage.setItem('pwa_chunk_error_reload', now.toString());
                localStorage.setItem('pwa_reload_reason', 'Auto-recuperação (Erro de Módulo)');
                
                toast.loading('Sincronizando nova versão...', {
                    description: 'Corrigindo erro de carregamento automaticamente.',
                });

                setTimeout(() => performNuclearPurge(true), 1500);
            }
        };

        window.addEventListener('error', handleError);
        return () => window.removeEventListener('error', handleError);
    }, [performNuclearPurge]);

    return { 
        isMandatory, 
        updateAvailable: needRefresh, 
        newVersion, 
        checkUpdate: useCallback(() => {
            // Fallback: check mandatory version manually if called
            checkMandatoryUpdate();
        }, [checkMandatoryUpdate]), 
        performNuclearPurge: handleUpdate 
    };
}

