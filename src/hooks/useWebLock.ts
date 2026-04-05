import { useCallback, useRef } from 'react';

type LockMode = 'exclusive' | 'shared';

interface WebLockOptions {
    mode?: LockMode;
    ifAvailable?: boolean;
    steal?: boolean;
    signal?: AbortSignal;
}

/**
 * useWebLock v17.0
 * Web Locks API — mutual exclusion for critical PWA operations.
 * Prevents race conditions when multiple tabs try to update simultaneously.
 * Supersedes the localStorage-based leader election (no race conditions).
 *
 * Usage:
 *   const { withLock } = useWebLock();
 *   await withLock('sw-update', async () => { await doUpdate(); });
 */
export function useWebLock() {
    const isSupported = 'locks' in navigator;
    const heldLockRef = useRef<Set<string>>(new Set());

    const withLock = useCallback(async <T>(
        name: string,
        fn: () => Promise<T>,
        options: WebLockOptions = {}
    ): Promise<T | null> => {
        if (!isSupported) {
            // Fallback: just run without lock
            return fn();
        }

        try {
            return await (navigator as Navigator & {
                locks: {
                    request: (name: string, options: WebLockOptions, fn: (lock: unknown) => Promise<T>) => Promise<T>
                }
            }).locks.request(name, { mode: 'exclusive', ...options }, async (_lock) => {
                heldLockRef.current.add(name);
                try {
                    return await fn();
                } finally {
                    heldLockRef.current.delete(name);
                }
            });
        } catch (e) {
            // Lock was aborted or not available
            console.warn(`[WebLock] Lock "${name}" unavailable:`, e);
            return null;
        }
    }, [isSupported]);

    const tryLock = useCallback(async <T>(
        name: string,
        fn: () => Promise<T>
    ): Promise<T | null> => {
        return withLock(name, fn, { ifAvailable: true });
    }, [withLock]);

    const isHoldingLock = useCallback((name: string) => {
        return heldLockRef.current.has(name);
    }, []);

    return { withLock, tryLock, isHoldingLock, isSupported };
}
