import { useCallback } from 'react';
import { logForensic } from '@/lib/forensicsDB';

/**
 * useBackgroundFetch v20.0
 * Background Fetch API — handles large downloads that continue even if browser closes.
 */
export function useBackgroundFetch() {
    const isSupported = 'backgroundFetch' in (navigator.serviceWorker.controller || {});

    const startBackgroundSync = useCallback(async (id: string, urls: string[], title: string) => {
        if (!('serviceWorker' in navigator)) return;

        try {
            const reg = await navigator.serviceWorker.ready;
            const fetchReg = await (reg as any).backgroundFetch.fetch(id, urls, {
                title: title,
                icons: [{ src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' }],
                downloadTotal: 0, // optional, sum of content-lengths
            });

            void logForensic({
                t: new Date().toISOString(),
                m: `Background Fetch Started: ${id}`,
                d: { urlsCount: urls.length, title },
                level: 'info',
                source: 'sw',
            });

            return fetchReg;
        } catch (err) {
            console.error('[BackgroundFetch] Failed to start:', err);
            return null;
        }
    }, []);

    return { startBackgroundSync, isSupported };
}
