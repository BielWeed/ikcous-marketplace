import { useEffect } from 'react';
import { logForensic } from '@/lib/forensicsDB';

interface ContentIndexItem {
    id: string;
    title: string;
    description: string;
    url: string;
    category: 'article' | 'video' | 'audio' | 'image' | 'homepage' | 'other';
    icons: Array<{ src: string; sizes: string; type: string }>;
}

const CONTENT_TO_INDEX: ContentIndexItem[] = [
    {
        id: 'ikcous-home',
        title: 'IKCOUS — Marketplace',
        description: 'Produtos com estoque imediato em Monte Carmelo, MG',
        url: '/',
        category: 'homepage',
        icons: [{ src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' }],
    },
    {
        id: 'ikcous-favorites',
        title: 'IKCOUS — Favoritos',
        description: 'Seus produtos favoritos salvos offline',
        url: '/?view=favorites',
        category: 'other',
        icons: [{ src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' }],
    },
    {
        id: 'ikcous-orders',
        title: 'IKCOUS — Pedidos',
        description: 'Acompanhe seus pedidos',
        url: '/?view=orders',
        category: 'other',
        icons: [{ src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' }],
    },
];

/**
 * useContentIndex v19.0
 * Content Indexing API — registers key offline-available pages.
 * Allows the browser to surface the app's content in offline search.
 * Only supported in Chrome on Android with an installed PWA.
 */
export function useContentIndex() {
    useEffect(() => {
        const registerContent = async () => {
            if (!('serviceWorker' in navigator)) return;
            const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
            if (!reg) return;

            const contentIndexReg = reg as ServiceWorkerRegistration & {
                index?: {
                    add: (item: ContentIndexItem) => Promise<void>;
                    delete: (id: string) => Promise<void>;
                    getAll: () => Promise<ContentIndexItem[]>;
                };
            };

            if (!contentIndexReg.index) return; // Not supported

            let registered = 0;
            for (const item of CONTENT_TO_INDEX) {
                try {
                    await contentIndexReg.index.add(item);
                    registered++;
                } catch { /* Already registered or not supported */ }
            }

            if (registered > 0) {
                void logForensic({
                    t: new Date().toISOString(),
                    m: 'Content Indexing API',
                    d: { registered, total: CONTENT_TO_INDEX.length },
                    level: 'info',
                    source: 'app',
                });
            }
        };

        // Register on idle
        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(() => registerContent(), { timeout: 10000 });
        } else {
            setTimeout(registerContent, 5000);
        }
    }, []);
}
