import { useCallback } from "react";
import { useNetworkAdaptive } from "./useNetworkAdaptive";

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
  home: () => import("@/views/customer/HomeView"),
  cart: () => import("@/views/customer/CartView"),
  "product-detail": () => import("@/views/customer/ProductView"),
  checkout: () => import("@/views/customer/CheckoutView"),
  notifications: () => import("@/views/customer/NotificationsView"),
  "order-success": () => import("@/views/customer/OrderSuccessView"),
  profile: () => import("@/views/customer/ProfileView"),
  auth: () => import("@/views/shared/AuthView"),
  "address-form": () => import("@/views/customer/AddressFormView"),
  "account-settings": () => import("@/views/customer/AccountSettingsView"),
  "order-details": () => import("@/views/customer/OrderDetailsView"),
  search: () => import("@/views/customer/SearchView"),
  compare: () => import("@/views/customer/CompareView"),
  favorites: () => import("@/views/customer/FavoritesView"),

  // --- ADMIN VIEWS ---
  admin: () => import("@/views/admin/AdminDashboardView"),
  "admin-dashboard": () => import("@/views/admin/AdminDashboardView"),
  "admin-products": () => import("@/views/admin/AdminProductsView"),
  "admin-product-form": () => import("@/views/admin/AdminProductFormView"),
  "admin-orders": () => import("@/views/admin/AdminOrdersView"),
  "admin-coupons": () => import("@/views/admin/AdminCouponsView"),
  "admin-coupon-form": () => import("@/views/admin/AdminCouponFormView"),
  "admin-banners": () => import("@/views/admin/AdminBannersView"),
  "admin-carousels": () => import("@/views/admin/AdminCarouselsView"),
  "admin-shipping": () => import("@/views/admin/AdminShippingView"),
  "admin-settings": () => import("@/views/admin/AdminSettingsView"),
  "admin-reviews": () => import("@/views/admin/AdminReviewsView"),
  "admin-whatsapp-config": () =>
    import("@/views/admin/AdminWhatsAppConfigView"),
  "admin-qa": () => import("@/views/admin/AdminQAView"),
  "admin-customers": () => import("@/views/admin/AdminCustomersView"),
  "admin-user-detail": () => import("@/views/admin/AdminUserDetailView"),
  "admin-push": () => import("@/views/admin/AdminPushView"),
  "admin-notifications": () => import("@/views/admin/AdminNotificationsView"),
  "admin-login": () => import("@/views/admin/AdminLoginView"),
};

const prefetched = new Set<string>();

export function usePrefetchOnHover() {
  const { isSlow } = useNetworkAdaptive();
  const prefetchView = useCallback(
    (view: string) => {
      if (isSlow()) return; // skip prefetching on slow connections
      if (prefetched.has(view)) return; // already prefetched
      const factory = VIEW_PREFETCH_MAP[view];
      if (!factory) return;

      prefetched.add(view);

      // Use requestIdleCallback if available
      const warm = () => {
        factory().catch(() => {
          prefetched.delete(view);
        }); // retry next hover if failed
      };

      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(warm, { timeout: 2000 });
      } else {
        setTimeout(warm, 100);
      }
    },
    [isSlow],
  );

  // Prefetch all on network idle (only on fast connections)
  const prefetchAll = useCallback(() => {
    Object.keys(VIEW_PREFETCH_MAP).forEach((v) => prefetchView(v));
  }, [prefetchView]);

  const prefetchViewPromise = useCallback((view: string): Promise<unknown> => {
    const factory = VIEW_PREFETCH_MAP[view];
    if (!factory) return Promise.resolve();
    if (prefetched.has(view)) return Promise.resolve();

    prefetched.add(view);
    return factory().catch((err) => {
      prefetched.delete(view); // Allow retry if failed
      throw err;
    });
  }, []);

  const prefetchImage = useCallback(
    (src: string) => {
      if (isSlow() || !src) return;
      const img = new Image();
      img.src = src;
    },
    [isSlow],
  );

  return { prefetchView, prefetchAll, prefetchViewPromise, prefetchImage };
}
