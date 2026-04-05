import { useEffect, useRef, useCallback } from 'react';

/**
 * usePersistentStorage v16.0
 * Requests persistent storage permission from the browser.
 * Prevents OS from evicting PWA caches under storage pressure.
 * Logs result to pwa_forensics.
 */
export function usePersistentStorage() {
    const grantedRef = useRef<boolean | null>(null);

    const requestPersistence = useCallback(async () => {
        if (!('storage' in navigator) || !navigator.storage.persist) return;

        try {
            const isPersisted = await navigator.storage.persisted();
            if (isPersisted) {
                grantedRef.current = true;
                return;
            }

            const granted = await navigator.storage.persist();
            grantedRef.current = granted;

            // Log result
            const logs = JSON.parse(localStorage.getItem('pwa_forensics') || '[]');
            localStorage.setItem('pwa_forensics', JSON.stringify(
                [{ t: new Date().toISOString(), m: 'Storage Persist', d: { granted } }, ...logs].slice(0, 20)
            ));

            if (granted) {
                console.log('[PWA] ✅ Persistent storage granted — caches protected from eviction');
            } else {
                console.warn('[PWA] ⚠️ Persistent storage denied — caches may be evicted under pressure');
            }
        } catch (e) {
            console.warn('[PWA] Storage persist error:', e);
        }
    }, []);

    useEffect(() => {
        // Request persistent storage only after user interaction
        // Browsers often require a gesture to grant persistence
        const handleGesture = () => {
            if ('requestIdleCallback' in window) {
                window.requestIdleCallback(() => requestPersistence(), { timeout: 5000 });
            } else {
                setTimeout(requestPersistence, 1000);
            }
            window.removeEventListener('click', handleGesture);
            window.removeEventListener('touchstart', handleGesture);
        };

        window.addEventListener('click', handleGesture, { once: true });
        window.addEventListener('touchstart', handleGesture, { once: true });

        return () => {
            window.removeEventListener('click', handleGesture);
            window.removeEventListener('touchstart', handleGesture);
        };
    }, [requestPersistence]);

    return { isPersisted: () => grantedRef.current };
}
