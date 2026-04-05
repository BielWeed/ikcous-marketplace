import { useEffect } from 'react';
import { logForensic } from '@/lib/forensicsDB';

interface WebVitalEntry {
    name: string;
    value: number;
    rating: 'good' | 'needs-improvement' | 'poor';
    delta: number;
}

function getRating(name: string, value: number): WebVitalEntry['rating'] {
    const thresholds: Record<string, [number, number]> = {
        LCP: [2500, 4000],
        FCP: [1800, 3000],
        CLS: [0.1, 0.25],
        INP: [200, 500],
        TTFB: [800, 1800],
    };
    const [good, poor] = thresholds[name] || [Infinity, Infinity];
    if (value <= good) return 'good';
    if (value <= poor) return 'needs-improvement';
    return 'poor';
}

/**
 * useWebVitals v19.0
 * Records Core Web Vitals (LCP, FCP, CLS, INP, TTFB) via PerformanceObserver.
 * Logs them to IndexedDB forensicsDB for historical analysis.
 * Also signals SW so offline analytics queue can submit when back online.
 */
export function useWebVitals() {
    useEffect(() => {
        if (typeof PerformanceObserver === 'undefined') return;

        const observers: PerformanceObserver[] = [];

        const logVital = (name: string, value: number, delta: number) => {
            const rating = getRating(name, value);
            const entry: WebVitalEntry = { name, value: Math.round(value), rating, delta: Math.round(delta) };

            void logForensic({
                t: new Date().toISOString(),
                m: `Web Vital: ${name}`,
                d: entry,
                level: rating === 'poor' ? 'warn' : 'info',
                source: 'app',
            });

            // Queue to offline analytics via BroadcastChannel → SW BackgroundSync
            try {
                const bc = new BroadcastChannel('sw-messages');
                bc.postMessage({ type: 'WEB_VITAL', vital: entry });
                bc.close();
            } catch { /* silent */ }
        };

        // LCP
        try {
            const lcpObs = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                const last = entries[entries.length - 1];
                logVital('LCP', last.startTime, last.startTime);
            });
            lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
            observers.push(lcpObs);
        } catch { /* not supported */ }

        // FCP
        try {
            const fcpObs = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry.name === 'first-contentful-paint') {
                        logVital('FCP', entry.startTime, entry.startTime);
                    }
                }
            });
            fcpObs.observe({ type: 'paint', buffered: true });
            observers.push(fcpObs);
        } catch { /* not supported */ }

        // CLS
        let clsValue = 0;
        try {
            const clsObs = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    const layoutShiftEntry = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
                    if (!layoutShiftEntry.hadRecentInput) {
                        clsValue += layoutShiftEntry.value || 0;
                    }
                }
            });
            clsObs.observe({ type: 'layout-shift', buffered: true });
            observers.push(clsObs);
            // Log CLS on page unload
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden' && clsValue > 0) {
                    logVital('CLS', clsValue * 1000, clsValue * 1000); // store as ms-scale for consistency
                }
            }, { once: true });
        } catch { /* not supported */ }

        // INP (Interaction to Next Paint)
        try {
            const inpObs = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    const interactionEntry = entry as PerformanceEntry & { duration?: number; interactionId?: number };
                    if (interactionEntry.interactionId && (interactionEntry.duration || 0) > 0) {
                        logVital('INP', interactionEntry.duration || 0, interactionEntry.duration || 0);
                    }
                }
            });
            inpObs.observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
            observers.push(inpObs);
        } catch { /* not supported */ }

        // TTFB via navigation timing
        try {
            const navObs = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    const navEntry = entry as PerformanceEntry & { responseStart?: number; requestStart?: number };
                    const ttfb = (navEntry.responseStart || 0) - (navEntry.requestStart || 0);
                    if (ttfb > 0) logVital('TTFB', ttfb, ttfb);
                }
            });
            navObs.observe({ type: 'navigation', buffered: true });
            observers.push(navObs);
        } catch { /* not supported */ }

        return () => observers.forEach(o => o.disconnect());
    }, []);
}
