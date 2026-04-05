import { useCallback, useRef } from 'react';

const COALESCE_DELAY = 3000; // ms — wait 3s before applying update signal
const SIGNALS_KEY = 'pwa_update_signals';

/**
 * useUpdateCoalescing v18.0
 * Debounces multiple rapid update signals into a single controlled action.
 * Problem: multiple tabs/push/BroadcastChannel events can fire update logic
 * simultaneously → this ensures only one update fires after a quiet period.
 *
 * Usage: replace direct updateServiceWorker() calls with coalesced version.
 */
export function useUpdateCoalescing() {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const signalCountRef = useRef(0);

    const coalesceUpdate = useCallback((fn: () => void, delay = COALESCE_DELAY) => {
        signalCountRef.current++;

        // Track signal count for diagnostics
        try {
            const signals = JSON.parse(localStorage.getItem(SIGNALS_KEY) || '[]');
            localStorage.setItem(SIGNALS_KEY, JSON.stringify(
                [{ t: new Date().toISOString(), count: signalCountRef.current }, ...signals].slice(0, 10)
            ));
        } catch { /* silent */ }

        // Cancel previous timer, start fresh
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            fn();
        }, delay);
    }, []);

    const cancelCoalesced = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const isPending = useCallback(() => timerRef.current !== null, []);

    return { coalesceUpdate, cancelCoalesced, isPending, getSignalCount: () => signalCountRef.current };
}
