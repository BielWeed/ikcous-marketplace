import { useEffect, useCallback } from 'react';
import { logForensic } from '@/lib/forensicsDB';

/**
 * useIdleMaintenance v20.0
 * Idle Detection API — triggers background cleanup when user is away.
 * Requires permission 'idle-detection'.
 * 
 * Perfect for: Deep IndexedDB cleanup, Cache pruning, Syncing large datasets.
 */
export function useIdleMaintenance(onIdleMaintenance: () => Promise<void>) {
    const runMaintenance = useCallback(async () => {
        void logForensic({
            t: new Date().toISOString(),
            m: 'Starting Idle Maintenance (User Away)',
            level: 'info',
            source: 'app',
        });

        await onIdleMaintenance();

        void logForensic({
            t: new Date().toISOString(),
            m: 'Idle Maintenance Complete',
            level: 'info',
            source: 'app',
        });
    }, [onIdleMaintenance]);

    useEffect(() => {
        if (!('IdleDetector' in window)) return;

        const controller = new AbortController();
        const { signal } = controller;

        const startDetection = async () => {
            try {
                const detector = new (window as any).IdleDetector();
                detector.addEventListener('change', () => {
                    const { userState, screenState } = detector;
                    if (userState === 'idle' || screenState === 'locked') {
                        runMaintenance();
                    }
                });

                await detector.start({
                    threshold: 60000, // 1 minute of inactivity
                    signal,
                });
                console.log('[IdleDetection] Started successfully');
            } catch (err) {
                // Silently handle start errors if already aborted or background blocked
                if ((err as Error).name !== 'AbortError') {
                    console.warn('[IdleDetection] Start failed:', err);
                }
            }
        };

        const init = async () => {
            try {
                // Check current permission state if available
                if ('permissions' in navigator) {
                    const status = await navigator.permissions.query({ name: 'idle-detection' as any });

                    if (status.state === 'granted') {
                        return startDetection();
                    }

                    if (status.state === 'denied') {
                        console.debug('[IdleDetection] Permission was previously denied.');
                        return;
                    }
                }

                // If prompt or unknown, wait for a natural user gesture to request it
                const requestPerm = async () => {
                    try {
                        const state = await (window as any).IdleDetector.requestPermission();
                        if (state === 'granted') {
                            startDetection();
                        }
                    } catch (err) {
                        // Suppress NotAllowedError noise if gesture wasn't captured perfectly
                        if ((err as Error).name !== 'NotAllowedError') {
                            console.warn('[IdleDetection] requestPermission failed:', err);
                        } else {
                            console.debug('[IdleDetection] requestPermission blocked: No persistent user gesture.');
                        }
                    }
                };

                const handleGesture = () => {
                    requestPerm();
                    window.removeEventListener('click', handleGesture);
                    window.removeEventListener('touchstart', handleGesture);
                };

                window.addEventListener('click', handleGesture, { once: true });
                window.addEventListener('touchstart', handleGesture, { once: true });

            } catch (err) {
                console.debug('[IdleDetection] Setup skipped:', err);
            }
        };

        init();
        return () => controller.abort();
    }, [runMaintenance]);
}
