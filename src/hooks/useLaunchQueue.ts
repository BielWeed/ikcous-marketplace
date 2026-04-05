import { useEffect, useCallback } from 'react';
import { logForensic } from '@/lib/forensicsDB';

interface LaunchParams {
    targetURL: string;
    files?: FileSystemFileHandle[];
}

/**
 * useLaunchQueue v19.0
 * Handles the client-side consumer for the Launch Handler API.
 * Processes URLs shared to the PWA via share_target or OS launch.
 * Receives the `targetURL` and can navigate the PWA accordingly.
 *
 * This completes the share_target implementation — the SW routes,
 * the client processes the incoming shared URL.
 */
export function useLaunchQueue(onLaunch?: (url: URL) => void) {
    const processLaunch = useCallback((params: LaunchParams) => {
        try {
            const target = new URL(params.targetURL);
            const sharedUrl = target.searchParams.get('url');
            const sharedText = target.searchParams.get('text');
            const sharedTitle = target.searchParams.get('title');

            void logForensic({
                t: new Date().toISOString(),
                m: 'Launch Queue Consumer',
                d: { targetURL: params.targetURL, sharedUrl, sharedText, sharedTitle },
                level: 'info',
                source: 'app',
            });

            if (onLaunch) onLaunch(target);
        } catch (e) {
            console.warn('[LaunchQueue] Failed to process launch params:', e);
        }
    }, [onLaunch]);

    useEffect(() => {
        if (!('launchQueue' in window)) return;

        const lq = (window as Window & {
            launchQueue?: { setConsumer: (consumer: (params: LaunchParams) => void) => void }
        }).launchQueue;

        lq?.setConsumer(processLaunch);

        void logForensic({
            t: new Date().toISOString(),
            m: 'LaunchQueue consumer registered',
            level: 'info',
            source: 'app',
        });
    }, [processLaunch]);
}
