import { useEffect, useRef, useCallback } from 'react';

type WakeLockType = 'screen';

interface WakeLockSentinel {
    released: boolean;
    type: WakeLockType;
    release(): Promise<void>;
    addEventListener(type: 'release', listener: () => void): void;
}

/**
 * useWakeLock v17.0
 * Screen Wake Lock API — prevents screen from sleeping.
 * Acquire during checkout or long-running operations.
 *
 * Usage:
 *   const { acquire, release, isActive } = useWakeLock();
 *   // During checkout:
 *   useEffect(() => { acquire(); return () => release(); }, []);
 */
export function useWakeLock() {
    const sentinelRef = useRef<WakeLockSentinel | null>(null);
    const isActiveRef = useRef(false);
    const isSupported = 'wakeLock' in navigator;

    const acquire = useCallback(async () => {
        if (!isSupported || isActiveRef.current) return;
        try {
            const wl = navigator as Navigator & {
                wakeLock?: { request: (type: WakeLockType) => Promise<WakeLockSentinel> }
            };
            const sentinel = await wl.wakeLock?.request('screen');
            if (!sentinel) return;
            sentinelRef.current = sentinel;
            isActiveRef.current = true;

            // Log to forensics
            try {
                const logs = JSON.parse(localStorage.getItem('pwa_forensics') || '[]');
                localStorage.setItem('pwa_forensics', JSON.stringify(
                    [{ t: new Date().toISOString(), m: 'WakeLock Acquired' }, ...logs].slice(0, 20)
                ));
            } catch { /* silent */ }

            // Auto re-acquire on visibility change (lock released when tab hidden)
            sentinel.addEventListener('release', () => {
                isActiveRef.current = false;
                sentinelRef.current = null;
            });
        } catch (e) {
            console.warn('[WakeLock] Acquire failed:', e);
        }
    }, [isSupported]);

    const release = useCallback(async () => {
        if (!sentinelRef.current || !isActiveRef.current) return;
        try {
            await sentinelRef.current.release();
            sentinelRef.current = null;
            isActiveRef.current = false;
        } catch { /* silent */ }
    }, []);

    // Re-acquire when tab becomes visible (wake lock is auto-released when hidden)
    useEffect(() => {
        const onVisible = async () => {
            if (document.visibilityState === 'visible' && isActiveRef.current === false && sentinelRef.current === null) {
                // Only re-acquire if we had it before (sentinel was set before going hidden)
                // Don't auto-re-acquire unless caller explicitly manages lifecycle
            }
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            release();
        };
    }, [release]);

    return {
        acquire,
        release,
        isActive: () => isActiveRef.current,
        isSupported,
    };
}
