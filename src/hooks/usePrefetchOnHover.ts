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
  favorites: () => import("@/views/customer/FavoritesView"),

  // --- ADMIN VIEWS ---
  admin: () => import("@/views/admin/AdminDashboardView"),
  "admin-dashboard": () => import("@/views/admin/AdminDashboardView"),
  "admin-products": () => import("@/views/admin/AdminProductsView"),
  "admin-product-form": () => import("@/views/admin/AdminProductFormView"),
  "admin-orders": () => import("@/views/admin/AdminOrdersView"),
  // `chavesParaPrefetchAll` (abaixo) já filtra tudo que começa com "admin"
  // do prefetch em massa do boot para quem não é admin confirmado — o
  // chunk do PDV (que arrasta o leitor de código) nunca desce para
  // cliente nenhum; só aquece no hover/touch de quem já está no painel.
  "admin-pdv": () => import("@/views/admin/AdminPdvView"),
  "admin-coupons": () => import("@/views/admin/AdminCouponsView"),
  "admin-coupon-form": () => import("@/views/admin/AdminCouponFormView"),
  "admin-banners": () => import("@/views/admin/AdminBannersView"),
  "admin-carousels": () => import("@/views/admin/AdminCarouselsView"),
  "admin-shipping": () => import("@/views/admin/AdminShippingView"),
  "admin-settings": () => import("@/views/admin/AdminSettingsView"),
  "admin-reviews": () => import("@/views/admin/AdminReviewsView"),
  "admin-whatsapp-config": () =>
    import("@/views/admin/AdminWhatsAppConfigView"),
  "admin-about-store": () => import("@/views/admin/AdminAboutStoreView"),
  "admin-qa": () => import("@/views/admin/AdminQAView"),
  "admin-customers": () => import("@/views/admin/AdminCustomersView"),
  "admin-user-detail": () => import("@/views/admin/AdminUserDetailView"),
  "admin-push": () => import("@/views/admin/AdminPushView"),
  "admin-notifications": () => import("@/views/admin/AdminNotificationsView"),
  "admin-login": () => import("@/views/admin/AdminLoginView"),
};

const prefetched = new Set<string>();

/**
 * App-2114: filtra as chaves de VIEW_PREFETCH_MAP que entram no prefetch em
 * massa do boot. As views "admin-*" somam 1,23 MB de fonte TSX (o dashboard
 * ainda puxa recharts) contra 0,57 MB das de cliente — baixar isso para
 * QUALQUER visitante 800ms após o boot competia com as imagens de produto e
 * o chunk de checkout, e crescia a cada tela nova do painel (o comentário
 * em App.tsx que promete "handled internally within AdminArea.tsx" nunca
 * foi verdade para esse prefetch em massa). Extraída como função pura
 * (mesmo padrão de src/lib/rede-lenta.ts) para não precisar dos 27 import()
 * reais do mapa só para testar a regra do filtro.
 *
 * Quem NÃO é admin confirmado só recebe as views de cliente; o prefetch das
 * views admin continua existindo — via hover/touch de handleHoverTab em
 * AdminLayout.tsx — para quem já está dentro do painel.
 */
export function chavesParaPrefetchAll(
  chaves: string[],
  isAdmin: boolean,
): string[] {
  if (isAdmin) return chaves;
  return chaves.filter((chave) => !chave.startsWith("admin"));
}

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

  // Prefetch all on network idle. `isAdmin` (default false, o caso mais
  // comum e mais barato de errar) decide se as views "admin-*" entram —
  // rede lenta/economia de dados continua barrada por isSlow() dentro de
  // prefetchView, sem duplicar essa checagem aqui (App-2114).
  const prefetchAll = useCallback(
    (isAdmin = false) => {
      chavesParaPrefetchAll(Object.keys(VIEW_PREFETCH_MAP), isAdmin).forEach(
        (v) => prefetchView(v),
      );
    },
    [prefetchView],
  );

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
