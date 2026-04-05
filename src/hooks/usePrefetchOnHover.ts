import { useCallback } from 'react';

/**
 * usePrefetchOnHover v16.0
 * Pre-fetches lazy-loaded view chunks when user hovers interactive elements.
 * Uses dynamic import() speculation to warm the module graph.
 *
 * Usage:
 *   const { prefetchView } = usePrefetchOnHover();
 *   <button onMouseEnter={() => prefetchView('cart')} onClick={...}>Cart</button>
 */

// Map view names to their dynamic import factories
const VIEW_PREFETCH_MAP: Record<string, () => Promise<unknown>> = {
    cart: () => import('@/views/customer/CartView'),
    checkout: () => import('@/views/customer/CheckoutView'),
    favorites: () => import('@/views/customer/FavoritesView'),
    orders: () => import('@/views/customer/CartView'),
    profile: () => import('@/views/customer/ProfileView'),
    search: () => import('@/views/customer/SearchView'),
};

const prefetched = new Set<string>();

export function usePrefetchOnHover() {
    const prefetchView = useCallback((view: string) => {
        if (prefetched.has(view)) return; // already prefetched
        const factory = VIEW_PREFETCH_MAP[view];
        if (!factory) return;

        prefetched.add(view);

        // Use requestIdleCallback if available
        const warm = () => {
            factory().catch(() => { prefetched.delete(view); }); // retry next hover if failed
        };

        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(warm, { timeout: 2000 });
        } else {
            setTimeout(warm, 100);
        }
    }, []);

    // Prefetch all on network idle (only on fast connections)
    const prefetchAll = useCallback(() => {
        Object.keys(VIEW_PREFETCH_MAP).forEach(v => prefetchView(v));
    }, [prefetchView]);

    return { prefetchView, prefetchAll };
}
