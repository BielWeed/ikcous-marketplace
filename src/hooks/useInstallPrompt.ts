import { useState, useEffect, useCallback, useRef } from 'react';

interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[];
    readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
    prompt(): Promise<void>;
}

interface InstallAnalytics {
    promptShownAt: string | null;
    promptDeferredAt: string | null;
    installedAt: string | null;
    decisionMs: number | null;
    outcome: 'accepted' | 'dismissed' | 'pending' | null;
    platform: string | null;
}

const ANALYTICS_KEY = 'pwa_install_analytics';

/**
 * useInstallPrompt v17.0
 * Enhanced A2HS (Add to Home Screen) with analytics tracking.
 * - Defers install prompt for optimal timing (after user engagement)
 * - Tracks prompt → decision time for UX analytics
 * - Detects standalone mode vs browser mode
 */
export function useInstallPrompt() {
    const [canInstall, setCanInstall] = useState(false);
    const [isInstalled, setIsInstalled] = useState(false);
    const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
    const analytics = useRef<InstallAnalytics>({
        promptShownAt: null,
        promptDeferredAt: null,
        installedAt: null,
        decisionMs: null,
        outcome: null,
        platform: null,
    });

    // Detect if already running in standalone (installed)
    const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    const saveAnalytics = useCallback(() => {
        try {
            const existing = JSON.parse(localStorage.getItem(ANALYTICS_KEY) || '[]');
            localStorage.setItem(ANALYTICS_KEY, JSON.stringify(
                [{ ...analytics.current, savedAt: new Date().toISOString() }, ...existing].slice(0, 10)
            ));
        } catch { /* silent */ }
    }, []);

    useEffect(() => {
        if (isStandalone) {
            setTimeout(() => setIsInstalled(true), 0);
            return;
        }

        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault(); // Defer browser's default prompt
            deferredPromptRef.current = e as BeforeInstallPromptEvent;
            setCanInstall(true);
            analytics.current.promptDeferredAt = new Date().toISOString();

            // Log
            try {
                const logs = JSON.parse(localStorage.getItem('pwa_forensics') || '[]');
                localStorage.setItem('pwa_forensics', JSON.stringify(
                    [{ t: new Date().toISOString(), m: 'Install Prompt Deferred' }, ...logs].slice(0, 20)
                ));
            } catch { /* silent */ }
        };

        const handleAppInstalled = () => {
            setIsInstalled(true);
            setCanInstall(false);
            analytics.current.installedAt = new Date().toISOString();
            analytics.current.outcome = 'accepted';
            saveAnalytics();
            deferredPromptRef.current = null;
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleAppInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, [isStandalone, saveAnalytics]);


    const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
        if (!deferredPromptRef.current) return 'unavailable';
        analytics.current.promptShownAt = new Date().toISOString();

        try {
            await deferredPromptRef.current.prompt();
            const { outcome, platform } = await deferredPromptRef.current.userChoice;

            if (analytics.current.promptShownAt) {
                analytics.current.decisionMs = Date.now() - new Date(analytics.current.promptShownAt).getTime();
            }
            analytics.current.outcome = outcome;
            analytics.current.platform = platform;
            saveAnalytics();

            deferredPromptRef.current = null;
            setCanInstall(false);

            if (outcome === 'accepted') setIsInstalled(true);
            return outcome;
        } catch {
            return 'unavailable';
        }
    }, [saveAnalytics]);

    return {
        canInstall,
        isInstalled,
        isStandalone,
        promptInstall,
        getAnalytics: () => analytics.current,
    };
}
