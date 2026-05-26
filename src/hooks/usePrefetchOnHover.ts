import { useCallback } from 'react';
import { useNetworkAdaptive } from './useNetworkAdaptive';

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
    home: () => import('@/views/customer/HomeView'),
    cart: () => import('@/views/customer/CartView'),
    'product-detail': () => import('@/views/customer/ProductView'),
    checkout: () => import('@/views/customer/CheckoutView'),
    notifications: () => import('@/views/customer/NotificationsView'),
    'order-success': () => import('@/views/customer/OrderSuccessView'),
    profile: () => import('@/views/customer/ProfileView'),
    auth: () => import('@/views/shared/AuthView'),
    'address-form': () => import('@/views/customer/AddressFormView'),
    'account-settings': () => import('@/views/customer/AccountSettingsView'),
    'order-details': () => import('@/views/customer/OrderDetailsView'),
    search: () => import('@/views/customer/SearchView'),
    'recently-viewed': () => import('@/views/customer/RecentlyViewedView'),
    compare: () => import('@/views/customer/CompareView'),
    favorites: () => import('@/views/customer/FavoritesView'),
};

const prefetched = new Set<string>();

export function usePrefetchOnHover() {
    const { isSlow } = useNetworkAdaptive();
    const prefetchView = useCallback((view: string) => {
        if (isSlow()) return; // skip prefetching on slow connections
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
