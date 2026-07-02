import { useCallback } from 'react';

/**
 * useViewTransition v18.1
 * View Transitions API — smooth animations between PWA "pages" with direction support.
 * Falls back to immediate execution if not supported.
 *
 * Usage:
 *   const { navigate } = useViewTransition();
 *   navigate(() => setCurrentView('cart'), 'forward');
 */
export function useViewTransition() {
    const isSupported = 'startViewTransition' in document;

    const navigate = useCallback((
        updateFn: () => void,
        direction?: 'forward' | 'back' | 'none',
        onFinished?: () => void
    ) => {
        if (!isSupported) {
            updateFn();
            onFinished?.();
            return;
        }

        // Apply view-specific direction class to documentElement
        const docEl = document.documentElement;
        if (direction && direction !== 'none') {
            docEl.classList.remove('view-transition-forward', 'view-transition-back');
            docEl.classList.add(`view-transition-${direction}`);
        }

        const transition = (document as Document & {
            startViewTransition: (cb: () => void) => { ready: Promise<void>; finished?: Promise<void> }
        }).startViewTransition(() => {
            updateFn();
        });

        // Catch promise rejections to prevent uncaught "AbortError: Transition was skipped"
        if (transition) {
            transition.ready?.catch(() => {});
            transition.finished?.then(() => {
                docEl.classList.remove('view-transition-forward', 'view-transition-back');
                onFinished?.();
            }).catch(() => {
                docEl.classList.remove('view-transition-forward', 'view-transition-back');
                onFinished?.();
            });
        }
    }, [isSupported]);

    return { navigate, isSupported };
}
