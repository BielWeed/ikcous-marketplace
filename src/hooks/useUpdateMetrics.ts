import { useState, useEffect, useCallback } from 'react';

declare const __APP_VERSION__: string;

const METRICS_KEY = 'pwa_update_metrics';

interface UpdateMetric {
    deployVersion: string;
    deployDetectedAt: string;    // ISO timestamp when update was detected
    updateAppliedAt: string | null; // ISO timestamp when user reloaded
    adoptionMs: number | null;   // ms from detection to reload
    wasAutomatic: boolean;
}

interface MetricsState {
    currentMetric: UpdateMetric | null;
    avgAdoptionSeconds: number | null;
    totalUpdates: number;
}

/**
 * useUpdateMetrics v15.0
 * Tracks update adoption time: from deploy detection to actual reload.
 * Stores history in localStorage and exposes stats for PwaDiagnostics.
 */
export function useUpdateMetrics() {
    const [metrics, setMetrics] = useState<MetricsState>(() => {
        try {
            const raw = localStorage.getItem(METRICS_KEY);
            const history: UpdateMetric[] = raw ? JSON.parse(raw) : [];
            const completed = history.filter(m => m.adoptionMs !== null);
            const avg = completed.length > 0
                ? completed.reduce((acc, m) => acc + (m.adoptionMs || 0), 0) / completed.length / 1000
                : null;

            return {
                currentMetric: history[0] || null,
                avgAdoptionSeconds: avg ? Math.round(avg) : null,
                totalUpdates: completed.length,
            };
        } catch (_) {
            return {
                currentMetric: null,
                avgAdoptionSeconds: null,
                totalUpdates: 0,
            };
        }
    });

    const loadMetrics = useCallback(() => {
        try {
            const raw = localStorage.getItem(METRICS_KEY);
            const history: UpdateMetric[] = raw ? JSON.parse(raw) : [];
            const completed = history.filter(m => m.adoptionMs !== null);
            const avg = completed.length > 0
                ? completed.reduce((acc, m) => acc + (m.adoptionMs || 0), 0) / completed.length / 1000
                : null;

            setMetrics({
                currentMetric: history[0] || null,
                avgAdoptionSeconds: avg ? Math.round(avg) : null,
                totalUpdates: completed.length,
            });
        } catch (_) { /* silent */ }
    }, []);

    // Record that an update was detected
    const recordUpdateDetected = useCallback((newVersion: string) => {
        try {
            const history: UpdateMetric[] = JSON.parse(localStorage.getItem(METRICS_KEY) || '[]');
            const newMetric: UpdateMetric = {
                deployVersion: newVersion,
                deployDetectedAt: new Date().toISOString(),
                updateAppliedAt: null,
                adoptionMs: null,
                wasAutomatic: false,
            };
            localStorage.setItem(METRICS_KEY, JSON.stringify([newMetric, ...history].slice(0, 20)));
            loadMetrics();
        } catch (_) { /* silent */ }
    }, [loadMetrics]);

    // Record that the update was applied (called just before reload)
    const recordUpdateApplied = useCallback((wasAutomatic = false) => {
        try {
            const raw = localStorage.getItem(METRICS_KEY);
            const history: UpdateMetric[] = raw ? JSON.parse(raw) : [];
            if (history.length === 0 || history[0].updateAppliedAt) return;

            const appliedAt = new Date().toISOString();
            const detectedAt = new Date(history[0].deployDetectedAt).getTime();
            const ms = Date.now() - detectedAt;

            history[0] = { ...history[0], updateAppliedAt: appliedAt, adoptionMs: ms, wasAutomatic };
            localStorage.setItem(METRICS_KEY, JSON.stringify(history));

            // Log to pwa_forensics
            const logs = JSON.parse(localStorage.getItem('pwa_forensics') || '[]');
            localStorage.setItem('pwa_forensics', JSON.stringify(
                [{ t: appliedAt, m: 'Update Applied', d: { version: history[0].deployVersion, adoptionMs: ms, wasAutomatic } }, ...logs].slice(0, 20)
            ));

            loadMetrics();
        } catch (_) { /* silent */ }
    }, [loadMetrics]);

    // On mount: check if previous session had a pending update (reload happened)
    useEffect(() => {
        // We only check for pending updates here to avoid unneeded setMetrics on every mount if already loaded by lazy init
        const raw = localStorage.getItem(METRICS_KEY);
        const history: UpdateMetric[] = raw ? JSON.parse(raw) : [];
        if (history.length > 0 && history[0].updateAppliedAt === null) {
            // Check if current version matches expected new version (update was applied)
            if (history[0].deployVersion !== __APP_VERSION__) {
                setTimeout(() => recordUpdateApplied(true), 0);
            }
        }
    }, [recordUpdateApplied]);

    return { metrics, recordUpdateDetected, recordUpdateApplied };
}
