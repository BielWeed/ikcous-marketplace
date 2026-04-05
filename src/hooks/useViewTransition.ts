import { useCallback } from 'react';

/**
 * useViewTransition v18.0
 * View Transitions API — smooth cross-fade animations between PWA "pages".
 * Falls back to immediate execution if not supported.
 *
 * Usage:
 *   const { navigate } = useViewTransition();
 *   navigate(() => setCurrentView('cart'));
 */
export function useViewTransition() {
    const isSupported = 'startViewTransition' in document;

    const navigate = useCallback((updateFn: () => void) => {
        if (!isSupported) {
            updateFn();
            return;
        }

        // Apply view-specific transition name via CSS
        (document as Document & {
            startViewTransition: (cb: () => void) => { ready: Promise<void> }
        }).startViewTransition(() => {
            updateFn();
        });
    }, [isSupported]);

    return { navigate, isSupported };
}
