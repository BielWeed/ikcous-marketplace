import { useEffect, useRef, useCallback } from 'react';

const CRASH_KEY = 'pwa_crash_guard';
const CRASH_THRESHOLD = 3;       // crashes before rollback
const SESSION_WINDOW_MS = 60000; // 60s window for "crash" detection

interface CrashRecord {
    count: number;
    firstCrashAt: string;
    version: string;
    rolledBack: boolean;
}

/**
 * useRollbackGuard v18.0
 * Automatic self-healing: if the app crashes/freezes on load N times in a row
 * (detected by not reaching "stable" state within SESSION_WINDOW_MS),
 * unregisters the current SW and forces a fresh install.
 *
 * "Crash" = page load that does NOT call markStable() within SESSION_WINDOW_MS.
 */
export function useRollbackGuard() {
    const stableRef = useRef(false);

    const markStable = useCallback(() => {
        if (stableRef.current) return;
        console.log('[RollbackGuard] ✅ Stability signal received. Application loaded successfully.');
        stableRef.current = true;
        try {
            // Reset crash counter on successful stable load
            const record: CrashRecord = JSON.parse(localStorage.getItem(CRASH_KEY) || '{"count":0,"firstCrashAt":"","version":"","rolledBack":false}');
            if (record.count > 0 && !record.rolledBack) {
                record.count = 0;
                record.rolledBack = false;
                localStorage.setItem(CRASH_KEY, JSON.stringify(record));
            }
        } catch { /* silent */ }
    }, []);

    useEffect(() => {
        // On every load, increment crash counter immediately
        try {
            const rawRecord = localStorage.getItem(CRASH_KEY);
            const record: CrashRecord = rawRecord
                ? JSON.parse(rawRecord)
                : { count: 0, firstCrashAt: '', version: '', rolledBack: false };

            // If already rolled back this session, don't count again
            if (!record.rolledBack) {
                record.count = (record.count || 0) + 1;
                if (!record.firstCrashAt || record.count === 1) {
                    record.firstCrashAt = new Date().toISOString();
                }
                localStorage.setItem(CRASH_KEY, JSON.stringify(record));
            }

            console.log(`[RollbackGuard] Crash record loaded: count=${record.count}, firstCrashAt=${record.firstCrashAt || 'none'}`);

            // Check if threshold exceeded
            if (record.count >= CRASH_THRESHOLD && !record.rolledBack) {
                console.error(`[RollbackGuard] 🚨 Crash threshold reached (${record.count}/${CRASH_THRESHOLD}) — triggering SW rollback`);
                record.rolledBack = true;
                localStorage.setItem(CRASH_KEY, JSON.stringify(record));

                // Unregister all SWs → force fresh install
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.getRegistrations().then(regs => {
                        Promise.all(regs.map(r => r.unregister())).then(() => {
                            // Clear all caches
                            caches.keys().then(names => {
                                Promise.all(names.map(n => caches.delete(n))).then(() => {
                                    // Hard reload from network
                                    console.warn('[RollbackGuard] 🔌 Rolling back. Forcing reload.');
                                    localStorage.setItem('pwa_reload_reason', `Rollback Guard (Threshold: ${record.count})`);
                                    setTimeout(() => window.location.reload(), 500);
                                });
                            });
                        });
                    });
                }
            }
        } catch { /* silent */ }

        // Mark stable after window (if no crash happened, clear counter)
        const timer = setTimeout(markStable, SESSION_WINDOW_MS);
        return () => clearTimeout(timer);
    }, [markStable]);

    // Call this from critical lifecycle points to confirm stability
    return { markStable };
}
