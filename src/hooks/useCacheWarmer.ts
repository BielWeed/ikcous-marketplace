import { useEffect } from 'react';

const IDLE_TIMEOUT = 2000; // ms before starting warm

const CRITICAL_URLS = [
    '/',
];

/**
 * useCacheWarmer v15.0
 * Pre-warms critical routes using requestIdleCallback when browser is idle.
 * Signals the SW to add them to the 'warmed-routes' cache.
 */
export function useCacheWarmer() {
    useEffect(() => {
        if (!('serviceWorker' in navigator)) return;

        const warmCache = async () => {
            try {
                const reg = await navigator.serviceWorker.getRegistration();
                if (!reg?.active) return;

                // Collect critical routes
                const urls = [...CRITICAL_URLS];

                reg.active.postMessage({ type: 'WARM_CACHE', urls });

                // Also cache directly from client side as fallback
                const cache = await caches.open('warmed-routes');
                await Promise.all(
                    CRITICAL_URLS.map(url =>
                        fetch(url, { cache: 'reload' })
                            .then(res => { if (res.ok) cache.put(url, res); })
                            .catch(() => null)
                    )
                );

                // Log to forensics
                const logs = JSON.parse(localStorage.getItem('pwa_forensics') || '[]');
                localStorage.setItem('pwa_forensics', JSON.stringify(
                    [{ t: new Date().toISOString(), m: 'Cache Warmed', d: { urls } }, ...logs].slice(0, 20)
                ));
            } catch (e) {
                console.warn('[CacheWarmer] Failed:', e);
            }
        };

        // Use requestIdleCallback if available, fallback to setTimeout
        let idleId: number | ReturnType<typeof setTimeout> | null = null;

        if ('requestIdleCallback' in window) {
            idleId = window.requestIdleCallback(warmCache, { timeout: 5000 });
        } else {
            idleId = setTimeout(warmCache, IDLE_TIMEOUT);
        }

        return () => {
            if (idleId === null) return;
            if ('cancelIdleCallback' in window) {
                window.cancelIdleCallback(idleId as number);
            } else {
                clearTimeout(idleId as ReturnType<typeof setTimeout>);
            }
        };
    }, []);
}
