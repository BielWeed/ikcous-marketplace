import { useEffect, useRef } from 'react';

type NetworkQuality = 'fast' | 'medium' | 'slow' | 'offline';

interface NetworkInfo {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
}

function getQuality(): NetworkQuality {
    if (!navigator.onLine) return 'offline';
    const conn = (navigator as Navigator & { connection?: NetworkInfo }).connection;
    if (!conn) return 'fast'; // assume fast if no info
    if (conn.saveData) return 'slow';
    const type = conn.effectiveType;
    if (type === '4g' || type === 'wifi') return 'fast';
    if (type === '3g') return 'medium';
    return 'slow'; // 2g, slow-2g
}

/**
 * useNetworkAdaptive v16.0
 * Monitors network quality via Network Information API.
 * Signals Service Worker to adapt caching strategies.
 * On slow connections: more aggressive caching, skip heavy prefetches.
 */
export function useNetworkAdaptive() {
    const qualityRef = useRef<NetworkQuality>('fast');

    useEffect(() => {
        const notifySW = async (quality: NetworkQuality) => {
            if (qualityRef.current === quality) return;
            qualityRef.current = quality;

            // Signal SW
            try {
                const reg = await navigator.serviceWorker.getRegistration();
                reg?.active?.postMessage({ type: 'SET_NETWORK_QUALITY', quality });
            } catch { /* silent */ }

            // Log to forensics
            try {
                const logs = JSON.parse(localStorage.getItem('pwa_forensics') || '[]');
                localStorage.setItem('pwa_forensics', JSON.stringify(
                    [{ t: new Date().toISOString(), m: 'Network Quality', d: { quality } }, ...logs].slice(0, 20)
                ));
            } catch { /* silent */ }
        };

        // Initial check
        notifySW(getQuality());

        const conn = (navigator as Navigator & { connection?: NetworkInfo & EventTarget }).connection;

        const handleChange = () => notifySW(getQuality());
        const handleOnline = () => notifySW(getQuality());
        const handleOffline = () => notifySW('offline');

        conn?.addEventListener('change', handleChange);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            conn?.removeEventListener('change', handleChange);
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    return {
        getQuality: () => qualityRef.current,
        isSlow: () => qualityRef.current === 'slow' || qualityRef.current === 'offline',
    };
}
