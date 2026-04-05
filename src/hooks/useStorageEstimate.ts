import { useState, useEffect, useCallback } from 'react';
import { logForensic } from '@/lib/forensicsDB';

interface StorageEstimate {
    quota: number;       // total available storage in bytes
    usage: number;       // bytes used
    usagePercent: number; // percentage used (0-100)
    quotaMB: number;     // quota in MB (rounded)
    usageMB: number;     // usage in MB (rounded)
    isPressured: boolean; // true if > 80% full
}

const EMPTY: StorageEstimate = {
    quota: 0, usage: 0, usagePercent: 0,
    quotaMB: 0, usageMB: 0, isPressured: false,
};

/**
 * useStorageEstimate v19.0
 * StorageManager.estimate() — real-time storage quota monitoring.
 * Shows how much of the device's storage the PWA is using.
 * Warns when approaching quota limits.
 */
export function useStorageEstimate() {
    const [estimate, setEstimate] = useState<StorageEstimate>(EMPTY);
    const [isLoading, setIsLoading] = useState(true);

    const refresh = useCallback(async () => {
        if (!navigator.storage?.estimate) { setIsLoading(false); return; }
        try {
            const result = await navigator.storage.estimate();
            const quota = result.quota ?? 0;
            const usage = result.usage ?? 0;
            const usagePercent = quota > 0 ? Math.round((usage / quota) * 100) : 0;
            const isPressured = usagePercent > 80;

            const est: StorageEstimate = {
                quota,
                usage,
                usagePercent,
                quotaMB: Math.round(quota / 1024 / 1024),
                usageMB: Math.round(usage / 1024 / 1024 * 10) / 10,
                isPressured,
            };
            setEstimate(est);
            setIsLoading(false);

            if (isPressured) {
                void logForensic({
                    t: new Date().toISOString(),
                    m: 'Storage Pressure Detected',
                    d: { usagePercent, usageMB: est.usageMB, quotaMB: est.quotaMB },
                    level: 'warn',
                    source: 'app',
                });
            }
        } catch { setIsLoading(false); }
    }, []);

    useEffect(() => {
        setTimeout(refresh, 0);
        // Re-check every 5 minutes
        const interval = setInterval(refresh, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [refresh]);

    return { estimate, isLoading, refresh };
}
