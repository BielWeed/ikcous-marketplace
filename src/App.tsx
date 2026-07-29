import { BottomNav } from "@/components/ui/custom/BottomNav";
import { CartReminder } from "@/components/ui/custom/CartReminder";
import { Header } from "@/components/ui/custom/Header";
import { AnimatePresence, motion } from "framer-motion";
import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useLayoutEffect,
} from "react";
const HomeView = lazyWithPreload(() =>
  import("@/views/customer/HomeView").then((m) => ({ default: m.HomeView })),
);
const CartView = lazyWithPreload(() =>
  import("@/views/customer/CartView").then((m) => ({ default: m.CartView })),
);
const ProductView = lazyWithPreload(() =>
  import("@/views/customer/ProductView").then((m) => ({
    default: m.ProductView,
  })),
);
const CheckoutView = lazyWithPreload(() =>
  import("@/views/customer/CheckoutView").then((m) => ({
    default: m.CheckoutView,
  })),
);
const NotificationsView = lazyWithPreload(() =>
  import("@/views/customer/NotificationsView").then((m) => ({
    default: m.NotificationsView,
  })),
);
const OrderSuccessView = lazyWithPreload(() =>
  import("@/views/customer/OrderSuccessView").then((m) => ({
    default: m.OrderSuccessView,
  })),
);
const ProfileView = lazyWithPreload(() =>
  import("@/views/customer/ProfileView").then((m) => ({
    default: m.ProfileView,
  })),
);
const UserProfileView = lazyWithPreload(() =>
  import("@/views/customer/UserProfileView").then((m) => ({
    default: m.UserProfileView,
  })),
);

import { useStore } from "@/contexts/StoreContext";
import { supabase } from "@/lib/supabase";
// --- LAZY LOADED ADMIN VIEWS ---
import { cn } from "@/lib/utils";
import { PreloadedOrLazy, lazyWithPreload } from "@/utils/lazyWithPreload";

const AdminDashboard = lazyWithPreload(() =>
  import("@/views/admin/AdminDashboardView").then((m) => ({
    default: m.AdminDashboardView,
  })),
);
const AdminProducts = lazyWithPreload(() =>
  import("@/views/admin/AdminProductsView").then((m) => ({
    default: m.AdminProductsView,
  })),
);
const AdminProductForm = lazyWithPreload(() =>
  import("@/views/admin/AdminProductFormView").then((m) => ({
    default: m.AdminProductFormView,
  })),
);
const AdminOrders = lazyWithPreload(() =>
  import("@/views/admin/AdminOrdersView").then((m) => ({
    default: m.AdminOrdersView,
  })),
);
const AdminCoupons = lazyWithPreload(() =>
  import("@/views/admin/AdminCouponsView").then((m) => ({
    default: m.AdminCouponsView,
  })),
);
const AdminBanners = lazyWithPreload(() =>
  import("@/views/admin/AdminBannersView").then((m) => ({
    default: m.AdminBannersView,
  })),
);
const AdminSettings = lazyWithPreload(() =>
  import("@/views/admin/AdminSettingsView").then((m) => ({
    default: m.AdminSettingsView,
  })),
);
const AdminReviews = lazyWithPreload(() =>
  import("@/views/admin/AdminReviewsView").then((m) => ({
    default: m.AdminReviewsView,
  })),
);
const AdminQA = lazyWithPreload(() =>
  import("@/views/admin/AdminQAView").then((m) => ({ default: m.AdminQAView })),
);
const AdminCustomers = lazyWithPreload(() =>
  import("@/views/admin/AdminCustomersView").then((m) => ({
    default: m.AdminCustomersView,
  })),
);
const AdminUserDetail = lazyWithPreload(() =>
  import("@/views/admin/AdminUserDetailView").then((m) => ({
    default: m.AdminUserDetailView,
  })),
);
const AdminPush = lazyWithPreload(() =>
  import("@/views/admin/AdminPushView").then((m) => ({
    default: m.AdminPushView,
  })),
);
const AdminLogin = lazyWithPreload(() =>
  import("@/views/admin/AdminLoginView").then((m) => ({
    default: m.AdminLoginView,
  })),
);

// --- LAZY LOADED CUSTOMER VIEWS ---
const AuthView = lazyWithPreload(() =>
  import("@/views/shared/AuthView").then((m) => ({ default: m.AuthView })),
);
const AddressFormView = lazyWithPreload(() =>
  import("@/views/customer/AddressFormView").then((m) => ({
    default: m.AddressFormView,
  })),
);
const AccountSettings = lazyWithPreload(() =>
  import("@/views/customer/AccountSettingsView").then((m) => ({
    default: m.AccountSettingsView,
  })),
);
const OrderDetailsView = lazyWithPreload(() =>
  import("@/views/customer/OrderDetailsView").then((m) => ({
    default: m.OrderDetailsView,
  })),
);
const SearchView = lazyWithPreload(() =>
  import("@/views/customer/SearchView").then((m) => ({
    default: m.SearchView,
  })),
);
const CompareView = lazyWithPreload(() =>
  import("@/views/customer/CompareView").then((m) => ({
    default: m.CompareView,
  })),
);
const FavoritesView = lazyWithPreload(() =>
  import("@/views/customer/FavoritesView").then((m) => ({
    default: m.FavoritesView,
  })),
);

const AdminLayout = React.lazy(() =>
  import("@/components/layouts/AdminLayout").then((m) => ({
    default: m.AdminLayout,
  })),
);
const DebugPanel = React.lazy(() =>
  import("@/components/debug/DebugPanel").then((m) => ({
    default: m.DebugPanel,
  })),
);

const VIEW_COMPONENTS = {
  home: HomeView,
  cart: CartView,
  "product-detail": ProductView,
  checkout: CheckoutView,
  profile: ProfileView,
  admin: AdminDashboard,
  "admin-dashboard": AdminDashboard,
  search: SearchView,
  auth: AuthView,
  login: AuthView,
  favorites: FavoritesView,
  notifications: NotificationsView,
  "order-success": OrderSuccessView,
  orders: CartView,
  "order-details": OrderDetailsView,
  "recently-viewed": HomeView,
  compare: CompareView,
  "account-settings": AccountSettings,
  "admin-products": AdminProducts,
  "admin-product-form": AdminProductForm,
  "admin-orders": AdminOrders,
  "admin-coupons": AdminCoupons,
  "admin-banners": AdminBanners,
  "admin-settings": AdminSettings,
  "admin-reviews": AdminReviews,
  "admin-qa": AdminQA,
  "admin-customers": AdminCustomers,
  "admin-user-detail": AdminUserDetail,
  "admin-push": AdminPush,
  "address-form": AddressFormView,
  "admin-login": AdminLogin,
  "user-profile": UserProfileView,
};

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LocalErrorBoundary } from "@/components/ui/custom/LocalErrorBoundary";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

declare global {
  interface Window {
    removeSilentGuardianLoader?: () => void;
  }
}

import { useAuth } from "@/hooks/useAuth";
import { useProducts } from "@/hooks/useProducts";

import { useAppBadge } from "@/hooks/useAppBadge";
import { useBehavioralPrefetch } from "@/hooks/useBehavioralPrefetch";
import { useCacheWarmer } from "@/hooks/useCacheWarmer";
import { useDeferredRender } from "@/hooks/useDeferredRender";
import { useFavorites } from "@/hooks/useFavorites";
import { useNetworkAdaptive } from "@/hooks/useNetworkAdaptive";
import { usePredictiveNavigation } from "@/hooks/usePredictiveNavigation";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { useSwipeBack } from "@/hooks/useSwipeBack";
import { useUpdateCheck } from "@/hooks/useUpdateCheck";
import { useViewTransition } from "@/hooks/useViewTransition";
import { useWebVitals } from "@/hooks/useWebVitals";

function DeferredTabContent({
  active,
  children,
}: {
  readonly active: boolean;
  readonly children: React.ReactNode;
}) {
  const [hasBeenActive, setHasBeenActive] = useState(active);

  useEffect(() => {
    if (active) {
      setHasBeenActive(true);
    }
  }, [active]);

  if (!hasBeenActive) return null;
  return <>{children}</>;
}

interface TabWrapperProps {
  readonly active: boolean;
  readonly isTransitionSupported: boolean;
  readonly children: React.ReactNode;
  readonly index?: number;
  readonly activeIndex?: number;
}

function TabWrapper({ active, children, index, activeIndex }: TabWrapperProps) {
  let positionClass = "";
  if (index !== undefined && activeIndex !== undefined && activeIndex !== -1) {
    if (index === activeIndex) {
      positionClass = "admin-tab-active";
    } else if (index < activeIndex) {
      positionClass = "admin-tab-left";
    } else {
      positionClass = "admin-tab-right";
    }
  } else {
    positionClass = active
      ? "opacity-100 pointer-events-auto z-10 visible"
      : "opacity-0 pointer-events-none z-0 invisible";
  }

  return (
    <div
      className={cn(
        "w-full h-full overflow-y-auto admin-scroll-container scroll-smooth absolute top-0 left-0 gpu-accelerated admin-tab-pane",
        positionClass,
        active ? "active-scroll-container" : "",
      )}
      style={{ paddingBottom: "var(--admin-tab-pb)" }}
    >
      {children}
    </div>
  );
}

function ViewLoadingFallback() {
  const isReady = useDeferredRender(150);
  if (!isReady) return null;
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center space-y-4">
      <div className="border-3 size-10 animate-spin rounded-full border-zinc-900/10 border-t-zinc-900" />
      <p className="animate-pulse text-sm font-medium text-zinc-500">
        Carregando...
      </p>
    </div>
  );
}

function AdminRouteLoading() {
  const isReady = useDeferredRender(150);
  if (!isReady) return null;
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-4">
      <div className="size-12 animate-spin rounded-full border-4 border-zinc-900 border-t-transparent" />
      <p className="animate-pulse font-medium text-muted-foreground">
        Verificando permissões...
      </p>
    </div>
  );
}

function AdminViewLoadingFallback({ view }: { readonly view?: string }) {
  const isReady = useDeferredRender(150);
  const isFormOrDetail =
    view === "admin-product-form" ||
    view === "admin-user-detail" ||
    view === "admin-push";
  const isDashboard = view === "admin-dashboard" || view === "admin";
  const isSettings = view === "admin-settings";

  if (!isReady) {
    return <div className="size-full bg-[#09090b]" />;
  }

  let title = "Painel";
  if (view === "admin-dashboard" || view === "admin") title = "Dashboard";
  else if (view === "admin-products") title = "Produtos";
  else if (view === "admin-orders") title = "Pedidos";
  else if (view === "admin-customers") title = "Clientes";
  else if (view === "admin-settings") title = "Ajustes";
  else if (view === "admin-coupons") title = "Cupons";
  else if (view === "admin-banners") title = "Banners";
  else if (view === "admin-reviews") title = "Avaliações";
  else if (view === "admin-qa") title = "Suporte Q&A";
  else if (view === "admin-push") title = "Notificações";
  else if (view === "admin-product-form") title = "Produto";
  else if (view === "admin-user-detail") title = "Detalhes";

  if (isDashboard) {
    return (
      <div className="size-full select-none bg-[#09090b] pb-28 text-white lg:pb-10">
        {/* Dashboard Headers Section */}
        <div className="flex items-center justify-between gap-4 px-6 pb-2 pt-6">
          <h1 className="flex shrink-0 select-none items-center gap-3 text-2xl font-black uppercase leading-none tracking-tighter md:text-3xl">
            <span className="flex flex-nowrap items-baseline whitespace-nowrap">
              <span className="italic text-white">{title}</span>
            </span>
          </h1>
          <div className="premium-shimmer h-10 w-32 rounded-2xl" />
        </div>

        <div className="mt-6 space-y-6 px-4 sm:space-y-12">
          {/* KPI Carousel */}
          <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex h-[128px] flex-col justify-between rounded-3xl border border-white/[0.04] bg-zinc-950 bg-gradient-to-br from-zinc-900/40 to-zinc-950/80 p-5"
              >
                <div className="flex items-center gap-3">
                  <div className="premium-shimmer size-10 rounded-xl" />
                  <div className="premium-shimmer h-3 w-16 rounded" />
                </div>
                <div className="premium-shimmer h-6 w-24 rounded" />
              </div>
            ))}
          </div>

          {/* Strategic Intelligence Blocks Skeleton */}
          <div className="px-0 sm:px-6">
            <div className="grid h-[220px] grid-cols-1 gap-6 md:grid-cols-2">
              <div className="premium-shimmer rounded-[2rem] border border-white/[0.04] bg-zinc-950 p-6" />
              <div className="premium-shimmer rounded-[2rem] border border-white/[0.04] bg-zinc-950 p-6" />
            </div>
          </div>

          {/* Large Chart Area */}
          <div className="h-[350px] rounded-[2rem] border border-white/[0.04] bg-zinc-950 p-6">
            <div className="premium-shimmer mb-6 h-6 w-48 rounded-lg" />
            <div className="premium-shimmer h-4/5 w-full rounded-2xl" />
          </div>

          {/* Bottom grid list */}
          <div className="h-[300px] rounded-[2rem] border border-white/[0.04] bg-zinc-950 p-6">
            <div className="premium-shimmer mb-6 h-6 w-36 rounded-lg" />
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="premium-shimmer size-10 rounded-xl" />
                    <div className="space-y-2">
                      <div className="premium-shimmer h-3.5 w-32 rounded" />
                      <div className="premium-shimmer h-3 w-20 rounded" />
                    </div>
                  </div>
                  <div className="premium-shimmer h-4 w-16 rounded" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isSettings) {
    return (
      <div className="size-full select-none bg-[#09090b] pb-28 text-white lg:pb-8">
        {/* Elite Header */}
        <div className="sticky top-0 z-30 mb-4 border-b border-white/5 bg-[#09090b]/90 px-6 py-4 backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
            <h1 className="flex shrink-0 select-none items-center gap-3 text-2xl font-black uppercase leading-none tracking-tighter md:text-3xl">
              <span className="flex flex-nowrap items-baseline whitespace-nowrap">
                <span className="italic text-white">{title}</span>
              </span>
            </h1>
            <div className="premium-shimmer h-11 w-36 rounded-xl" />
          </div>
        </div>

        {/* Accordions */}
        <div className="mx-auto max-w-2xl space-y-6 px-4 pb-10">
          <div className="mt-4 space-y-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex h-20 items-center justify-between rounded-[2rem] border border-white/[0.04] bg-zinc-950 p-5"
              >
                <div className="flex items-center gap-4">
                  <div className="premium-shimmer size-10 rounded-xl" />
                  <div className="space-y-2">
                    <div className="premium-shimmer h-4 w-36 rounded" />
                    <div className="premium-shimmer h-3 w-48 rounded" />
                  </div>
                </div>
                <div className="premium-shimmer size-6 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isFormOrDetail) {
    return (
      <div className="size-full select-none bg-[#09090b] pb-8 text-white">
        {/* Header Back Button & Title */}
        <div className="p-6">
          <div className="mx-auto flex max-w-4xl items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="premium-shimmer size-12 rounded-2xl" />
              <div className="space-y-1">
                <h1 className="flex shrink-0 select-none items-center gap-3 text-2xl font-black uppercase leading-none tracking-tighter md:text-3xl">
                  <span className="flex flex-nowrap items-baseline whitespace-nowrap">
                    <span className="italic text-white">{title}</span>
                  </span>
                </h1>
                <div className="premium-shimmer h-3 w-48 rounded" />
              </div>
            </div>
          </div>
        </div>

        {/* Two-Column Form Layout */}
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-8 p-6 lg:grid-cols-12">
          {/* Main Form Fields */}
          <div className="h-[600px] space-y-6 rounded-[2rem] border border-white/[0.04] bg-zinc-950 p-6 lg:col-span-8">
            <div className="premium-shimmer h-5 w-32 rounded" />
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="premium-shimmer h-3 w-20 rounded" />
                  <div className="premium-shimmer h-10 w-full rounded-xl" />
                </div>
              ))}
            </div>
          </div>

          {/* Side Preview/Upload */}
          <div className="h-[400px] space-y-6 rounded-[2rem] border border-white/[0.04] bg-zinc-950 p-6 lg:col-span-4">
            <div className="premium-shimmer h-5 w-24 rounded" />
            <div className="premium-shimmer aspect-square w-full rounded-2xl" />
            <div className="premium-shimmer h-10 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  // Default Grid/List Skeleton (Products, Orders, Customers, Coupons, Banners, Reviews, QA)
  return (
    <div className="size-full select-none bg-[#09090b] pb-8 text-white">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-6 pb-2 pt-6">
        <div className="flex items-center gap-3">
          <h1 className="flex shrink-0 select-none items-center gap-3 text-2xl font-black uppercase leading-none tracking-tighter md:text-3xl">
            <span className="flex flex-nowrap items-baseline whitespace-nowrap">
              <span className="italic text-white">{title}</span>
            </span>
          </h1>
        </div>
        <div className="premium-shimmer h-11 w-32 rounded-xl" />
      </div>

      <div className="mt-6 space-y-6 px-4 sm:space-y-12 sm:px-6">
        {/* KPI Carousel */}
        <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex h-[128px] flex-col justify-between rounded-3xl border border-white/[0.04] bg-zinc-950 bg-gradient-to-br from-zinc-900/40 to-zinc-950/80 p-5"
            >
              <div className="flex items-center gap-3">
                <div className="premium-shimmer size-10 rounded-xl" />
                <div className="premium-shimmer h-3 w-16 rounded" />
              </div>
              <div className="premium-shimmer h-6 w-24 rounded" />
            </div>
          ))}
        </div>

        {/* Control Bar */}
        <div className="flex gap-4">
          <div className="premium-shimmer h-11 flex-1 rounded-2xl" />
          <div className="premium-shimmer size-11 rounded-2xl" />
        </div>

        {/* Grid of Items */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex h-[220px] flex-col justify-between space-y-4 rounded-[2rem] border border-white/[0.04] bg-zinc-950 p-6"
            >
              <div className="flex items-center gap-4">
                <div className="premium-shimmer size-16 rounded-2xl" />
                <div className="flex-1 space-y-2">
                  <div className="premium-shimmer h-4.5 w-3/4 animate-pulse rounded" />
                  <div className="premium-shimmer h-3.5 w-1/2 animate-pulse rounded" />
                </div>
              </div>
              <div className="premium-shimmer h-3.5 w-full animate-pulse rounded" />
              <div className="flex items-center justify-between border-t border-white/5 pt-2">
                <div className="premium-shimmer h-4 w-16 animate-pulse rounded" />
                <div className="premium-shimmer size-8 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdminAccessDenied({
  onNavigate,
}: {
  readonly onNavigate: (view: View) => void;
}) {
  const { isAdmin, loading } = useAuth();

  useEffect(() => {
    // If auth is still loading, wait.
    if (loading) return;

    // If not admin, redirect immediately to home with a message.
    if (!isAdmin) {
      console.warn("[App] Admin access denied. Redirecting to home.");
      toast.error("Acesso restrito a administradores.");
      onNavigate("home");
    }
  }, [onNavigate, isAdmin, loading]);

  return <AdminRouteLoading />;
}
import { UpdateNotification } from "@/components/pwa/UpdateNotification";
import { CartProvider } from "@/contexts/CartContext";
import { FavoritesProvider } from "@/contexts/FavoritesContext";
import { StoreProvider } from "@/contexts/StoreContext";
import { useCartActions, useCartState } from "@/hooks/useCart";
import { useRealtimeUpdate } from "@/hooks/useRealtimeUpdate";
import type { Product, SortOption, View } from "@/types";
import { haptic } from "@/utils/haptic";

export default function App() {
  // Global check for session-based splash skip
  useEffect(() => {
    if (
      globalThis.window !== undefined &&
      sessionStorage.getItem("splash_shown")
    ) {
      const loader = document.getElementById("silent-guardian-loader");
      if (loader) loader.remove();
    }
  }, []);

  return (
    <StoreProvider>
      <CartProvider>
        <FavoritesProvider>
          <AppContent />
          <PWAUpdateManager />
        </FavoritesProvider>
      </CartProvider>
    </StoreProvider>
  );
}

const getProductById = (products: Product[], id: string) =>
  products.find((p) => p.id === id);

const getNavigationDirection = (
  from: View,
  to: View,
): "forward" | "back" | "none" => {
  // Mapeamento hierárquico com pesos de navegação para todas as telas do admin
  const adminViewIndices: Record<string, number> = {
    admin: 0,
    "admin-dashboard": 0,
    "admin-push": 0.5,
    "admin-orders": 1,
    "admin-reviews": 1.4,
    "admin-qa": 1.6,
    "admin-products": 2,
    "admin-product-form": 2.4,
    "admin-coupons": 2.5,
    "admin-banners": 2.6,
    "admin-customers": 3,
    "admin-user-detail": 3.5,
    "admin-settings": 4,
  };

  if (from in adminViewIndices && to in adminViewIndices) {
    return adminViewIndices[to] >= adminViewIndices[from] ? "forward" : "back";
  }

  // Default behaviors for main customer pages
  const mainTabs: Record<string, number> = {
    home: 0,
    favorites: 1,
    cart: 2,
    profile: 3,
  };
  if (from in mainTabs && to in mainTabs) {
    return mainTabs[to] >= mainTabs[from] ? "forward" : "back";
  }

  // Going back to main views from detail views
  if (
    from === "product-detail" &&
    (to === "home" ||
      to === "favorites" ||
      to === "cart" ||
      to === "profile" ||
      to === "search" ||
      to === "recently-viewed")
  )
    return "back";
  if (from === "checkout" && to === "cart") return "back";
  if (from === "order-details" && to === "orders") return "back";
  if (from === "orders" && to === "profile") return "back";
  if (from === "address-form" && to === "profile") return "back";
  if (from === "account-settings" && to === "profile") return "back";
  if (from === "user-profile" && to === "profile") return "back";
  if (from === "recently-viewed" && to === "profile") return "back";
  if (from === "auth" && (to === "home" || to === "profile")) return "back";
  if (from === "admin" && to === "profile") return "back";
  if (from.startsWith("admin") && to === "profile") return "back";

  return "forward";
};

const pageVariants = {
  initial: (custom: any) => {
    const direction =
      typeof custom === "string" ? custom : custom?.direction || "forward";
    if (direction === "none") return { opacity: 0 };
    return {
      x: direction === "forward" ? "100%" : "-30%",
      opacity: direction === "forward" ? 1 : 0.5,
      y: 0,
      willChange: "transform, opacity",
    };
  },
  animate: {
    x: 0,
    opacity: 1,
    y: 0,
    transitionEnd: {
      willChange: "auto",
    },
  },
  exit: (custom: any) => {
    const direction =
      typeof custom === "string" ? custom : custom?.direction || "forward";
    const oldScroll = typeof custom === "string" ? 0 : custom?.oldScroll || 0;
    const newScroll = typeof custom === "string" ? 0 : custom?.newScroll || 0;
    if (direction === "none") return { opacity: 0 };
    const offset = newScroll - oldScroll;
    return {
      x: direction === "forward" ? "-30%" : "100%",
      opacity: direction === "forward" ? 0.5 : 0,
      y: offset,
      position: "absolute" as const,
      width: "100%",
      top: 0,
      left: 0,
      willChange: "transform, opacity",
    };
  },
};

const ADMIN_TABS_SET = new Set([
  "admin-dashboard",
  "admin",
  "admin-products",
  "admin-orders",
  "admin-customers",
  "admin-settings",
]);

const AppBadgeSynchronizer = React.memo(function AppBadgeSynchronizer() {
  const { cartCount } = useCartState();
  const { setBadge, clearBadge } = useAppBadge();

  useEffect(() => {
    if (cartCount > 0) {
      setBadge(cartCount);
    } else {
      clearBadge();
    }
  }, [cartCount, setBadge, clearBadge]);

  return null;
});

const AppContent = () => {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const { products, loading: productsLoading } = useProducts();
  const { navigate: startTransition, isSupported: isTransitionSupported } =
    useViewTransition();
  const { addToCart } = useCartActions();
  const {
    favorites,
    toggleFavorite,
    loading: favoritesLoading,
  } = useFavorites();
  const { config } = useStore();

  const [currentView, setCurrentView] = useState<View>("home");
  const [transitionScroll, setTransitionScroll] = useState({
    oldScroll: 0,
    newScroll: 0,
  });
  const [transitionSpacerHeight, setTransitionSpacerHeight] = useState(0);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    null,
  );
  const [isAdminDirty, setIsAdminDirty] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<{
    view: View;
    id?: string;
  } | null>(null);

  const isAdminDirtyRef = useRef(false);
  useEffect(() => {
    isAdminDirtyRef.current = isAdminDirty;
  }, [isAdminDirty]);

  useEffect(() => {
    if (!isAdminDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isAdminDirty]);

  useEffect(() => {
    const root = document.documentElement;
    if (currentView.startsWith("admin")) {
      root.classList.add("dark");
      root.removeAttribute("data-theme-mode");
    } else if (config?.themeMode) {
      if (config.themeMode === "dark") {
        root.classList.add("dark");
        root.removeAttribute("data-theme-mode");
      } else if (config.themeMode === "glass") {
        root.classList.add("dark");
        root.setAttribute("data-theme-mode", "glass");
      } else {
        root.classList.remove("dark");
        root.removeAttribute("data-theme-mode");
      }
    }
  }, [currentView, config?.themeMode]);

  const currentViewRef = useRef<View>(currentView);
  const selectedProductIdRef = useRef<string | null>(selectedProductId);
  const userRef = useRef(user);
  const authLoadingRef = useRef(authLoading);
  const isInitialMountRef = useRef(true);
  const isInitialAuthCheckedRef = useRef(false);

  useEffect(() => {
    currentViewRef.current = currentView;
    setIsHeaderDocked(false);
  }, [currentView]);

  useEffect(() => {
    selectedProductIdRef.current = selectedProductId;
  }, [selectedProductId]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    authLoadingRef.current = authLoading;
  }, [authLoading]);

  const [searchQuery, setSearchQuery] = useState("");
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [isHeaderDocked, setIsHeaderDocked] = useState(false);
  const [isRouteLoading, setIsRouteLoading] = useState(false);
  const [backOverride, setBackOverride] = useState<(() => void) | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("Todas");
  const [sortBy, setSortBy] = useState<SortOption>("default");
  const mainRef = useRef<HTMLElement>(null);
  const scrollSentinelRef = useRef<HTMLDivElement>(null);
  const backOverrideRef = useRef<(() => void) | null>(null);
  const isTransitioningRef = useRef(false);
  const lastTransitionStartTimeRef = useRef(0);
  const latestTargetViewRef = useRef<{ view: View; id?: string } | null>(null);
  const activeTransitionRef = useRef<any>(null);
  const scrollPositionsRef = useRef<Record<string, number>>({});
  const loaderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationDirectionRef = useRef<"forward" | "back" | "none">("forward");
  const swipeBackActiveRef = useRef(false);
  const [navigationDirection, setNavigationDirection] = useState<
    "forward" | "back" | "none"
  >("forward");

  // useAppBadge is now consumed in AppBadgeSynchronizer to avoid root re-renders

  const { prefetchView, prefetchAll, prefetchViewPromise } =
    usePrefetchOnHover();

  const saveCurrentScroll = useCallback(() => {
    const currView = currentViewRef.current;
    const selProdId = selectedProductIdRef.current;
    const viewKey =
      currView === "product-detail" && selProdId
        ? `product-detail-${selProdId}`
        : currView;

    if (currView.startsWith("admin")) {
      const activeScrollContainer = document.querySelector(
        ".active-scroll-container",
      );
      if (activeScrollContainer) {
        scrollPositionsRef.current[viewKey] = activeScrollContainer.scrollTop;
        return;
      }
    }

    if (mainRef.current) {
      scrollPositionsRef.current[viewKey] = mainRef.current.scrollTop;
    }
  }, []);

  const handleNavigate = useCallback(
    async (view: View, id?: string, bypassDirtyCheck = false) => {
      if (isAdminDirtyRef.current && !bypassDirtyCheck) {
        setPendingNavigation({ view, id });
        return;
      }

      // Cancel pending timers from any previous transition
      if (loaderTimeoutRef.current) {
        clearTimeout(loaderTimeoutRef.current);
        loaderTimeoutRef.current = null;
      }
      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current);
        safetyTimeoutRef.current = null;
      }

      saveCurrentScroll();
      const currView = currentViewRef.current;
      const isAuthL = authLoadingRef.current;
      const usr = userRef.current;

      const isMainTabNav = [
        "home",
        "favorites",
        "cart",
        "profile",
        "admin-dashboard",
        "admin",
        "admin-products",
        "admin-orders",
        "admin-customers",
        "admin-settings",
      ].includes(view);

      if (
        isTransitioningRef.current &&
        (currView !== view || selectedProductIdRef.current !== (id || null)) &&
        !isMainTabNav
      ) {
        if (Date.now() - lastTransitionStartTimeRef.current > 400) {
          console.warn(
            "[App] Forcing transition unlock due to long-running transition",
          );
          isTransitioningRef.current = false;
          setIsRouteLoading(false);
        } else if (
          !["auth", "login", "home", "profile", "admin"].includes(view)
        ) {
          console.warn(
            `[App] Navigation to ${view} throttled to prevent animation race conditions`,
          );
          return;
        }
      }

      let targetView = view;
      if (
        (view === "profile" ||
          view === "account-settings" ||
          view === "address-form") &&
        !isAuthL &&
        !usr
      ) {
        targetView = "auth";
      }

      const isDifferentView = currView !== targetView;
      const isDifferentProduct = selectedProductIdRef.current !== (id || null);
      const isReallyDifferent = isDifferentView || isDifferentProduct;

      // Handle click on same active tab/view (Scroll to Top)
      if (!isReallyDifferent) {
        const scrollContainer = targetView.startsWith("admin")
          ? document.querySelector(".active-scroll-container")
          : mainRef.current;
        if (scrollContainer) {
          scrollContainer.scrollTo({ top: 0, behavior: "smooth" });
        }
        return;
      }

      const fromView = currView;
      const dir = getNavigationDirection(currView, targetView);
      navigationDirectionRef.current = dir;
      setNavigationDirection(dir);

      const isCartOrdersTransition =
        (currView === "cart" && targetView === "orders") ||
        (currView === "orders" && targetView === "cart");

      // Check if we are navigating between main admin tabs (which are already mounted)
      const isFromAdminTab = ADMIN_TABS_SET.has(currView);
      const isToAdminTab = ADMIN_TABS_SET.has(targetView);
      const isTabToTabAdmin = isFromAdminTab && isToAdminTab;

      if (isCartOrdersTransition) {
        setSelectedProductId(id || null);
        setCurrentView(targetView);
        setBackOverride(null);
        isTransitioningRef.current = false;
        setIsRouteLoading(false);

        // Sync URL without full reload
        const path = targetView === "home" ? "/" : `/${targetView}`;
        const currentPathAndSearch =
          globalThis.location.pathname + globalThis.location.search;
        if (currentPathAndSearch !== path) {
          globalThis.history.pushState(
            { view: targetView, id, from: fromView },
            "",
            path,
          );
        }
        return;
      }

      const performTransition = () => {
        // If a transition is already in progress, skip it to allow snappy interruptible navigation
        if (
          activeTransitionRef.current &&
          typeof activeTransitionRef.current.skip === "function"
        ) {
          try {
            activeTransitionRef.current.skip();
          } catch (e) {
            console.warn("[App] Failed to skip active transition:", e);
          }
        }

        if (isTabToTabAdmin) {
          // Direct instant update for admin tab switches - avoids capturing screenshots of charts/KPIs
          setSelectedProductId(id || null);
          setCurrentView(targetView);
          setBackOverride(null);
          isTransitioningRef.current = false;
          setIsRouteLoading(false);
        } else {
          const oldView = currentViewRef.current;
          const oldScroll =
            scrollPositionsRef.current[
              oldView === "product-detail" && selectedProductIdRef.current
                ? `product-detail-${selectedProductIdRef.current}`
                : oldView
            ] || 0;

          const newView = targetView;
          const newScroll =
            scrollPositionsRef.current[
              newView === "product-detail" && id
                ? `product-detail-${id}`
                : newView
            ] || 0;

          setTransitionScroll({ oldScroll, newScroll });

          // Expand main container scroll area during transition to prevent scroll clamping
          setTransitionSpacerHeight(
            Math.max(oldScroll, newScroll) + window.innerHeight,
          );

          const transition = startTransition(() => {
            setSelectedProductId(id || null);
            setCurrentView(targetView);
            setBackOverride(null); // Reset override on navigation
          }, dir);

          activeTransitionRef.current = transition;

          const onTransitionEnd = () => {
            if (activeTransitionRef.current === transition) {
              activeTransitionRef.current = null;
            }
            isTransitioningRef.current = false;
            setTransitionSpacerHeight(0);
          };

          if (transition && typeof transition.finished?.then === "function") {
            transition.finished.then(onTransitionEnd).catch(onTransitionEnd);
          } else {
            // Align fallback timeout with transition animation length (340ms + padding)
            setTimeout(onTransitionEnd, 350);
          }
        }

        // Sync URL without full reload
        let path = targetView === "home" ? "/" : `/${targetView}`;
        if (
          [
            "product-detail",
            "user-profile",
            "order-details",
            "admin-product-form",
            "admin-user-detail",
            "admin-orders",
            "admin-push",
          ].includes(targetView) &&
          id
        ) {
          path = `/${targetView}?id=${id}`;
        }
        const currentPathAndSearch =
          globalThis.location.pathname + globalThis.location.search;
        if (currentPathAndSearch !== path) {
          globalThis.history.pushState(
            { view: targetView, id, from: fromView },
            "",
            path,
          );
        }
      };

      latestTargetViewRef.current = { view: targetView, id };

      if (isDifferentView) {
        if (isTabToTabAdmin) {
          // Direct transition to avoid isRouteLoading flickers and chunk waiting
          performTransition();
        } else {
          isTransitioningRef.current = true;
          lastTransitionStartTimeRef.current = Date.now();

          // Defer showing the loading bar to prevent micro-flickers on instant cache hits
          loaderTimeoutRef.current = setTimeout(() => {
            setIsRouteLoading(true);
            loaderTimeoutRef.current = null;
          }, 120);

          safetyTimeoutRef.current = setTimeout(() => {
            if (isTransitioningRef.current) {
              console.warn(
                "[App] View prefetch/transition safety timeout reached. Unlocking navigation.",
              );
              isTransitioningRef.current = false;
              setIsRouteLoading(false);
            }
            safetyTimeoutRef.current = null;
          }, 800);

          const prefetchPromise = prefetchViewPromise(targetView);
          const preloadPromise = (async () => {
            const comp =
              VIEW_COMPONENTS[targetView as keyof typeof VIEW_COMPONENTS];
            if (comp && "preload" in comp) {
              await (comp as any).preload();
            }
          })();

          Promise.all([prefetchPromise, preloadPromise])
            .then(() => {
              if (safetyTimeoutRef.current) {
                clearTimeout(safetyTimeoutRef.current);
                safetyTimeoutRef.current = null;
              }
              if (loaderTimeoutRef.current) {
                clearTimeout(loaderTimeoutRef.current);
                loaderTimeoutRef.current = null;
              }
              if (
                latestTargetViewRef.current?.view === targetView &&
                latestTargetViewRef.current?.id === id
              ) {
                performTransition();
              } else {
                console.log(
                  `[App] Throttling outdated transition to: ${targetView} in favor of: ${latestTargetViewRef.current?.view}`,
                );
              }
            })
            .catch((err) => {
              if (safetyTimeoutRef.current) {
                clearTimeout(safetyTimeoutRef.current);
                safetyTimeoutRef.current = null;
              }
              if (loaderTimeoutRef.current) {
                clearTimeout(loaderTimeoutRef.current);
                loaderTimeoutRef.current = null;
              }
              console.error("[App] Failed to prefetch route chunk:", err);
              if (
                latestTargetViewRef.current?.view === targetView &&
                latestTargetViewRef.current?.id === id
              ) {
                performTransition();
              }
            })
            .finally(() => {
              setIsRouteLoading(false);
            });
        }
      } else {
        performTransition();
      }
    },
    [
      startTransition,
      isTransitionSupported,
      prefetchViewPromise,
      saveCurrentScroll,
    ],
  );

  useCacheWarmer();
  const { isSlow } = useNetworkAdaptive();
  const getFramerMotionDuration = useCallback(() => {
    return isSlow() ? 0.22 : 0.34;
  }, [isSlow]);
  usePredictiveNavigation(currentView);
  useBehavioralPrefetch(currentView, prefetchView);
  useWebVitals();

  // Eagerly prefetch all admin views in the background to ensure instantaneous tab switches
  useEffect(() => {
    if (isAdmin) {
      const adminViews = [
        "admin-dashboard",
        "admin-products",
        "admin-orders",
        "admin-customers",
        "admin-settings",
        "admin-coupons",
        "admin-banners",
        "admin-reviews",
        "admin-qa",
        "admin-user-detail",
        "admin-push",
      ];
      const timeoutId = setTimeout(() => {
        adminViews.forEach((view) => prefetchView(view));
      }, 1000);
      return () => clearTimeout(timeoutId);
    }
  }, [isAdmin, prefetchView]);

  const favoriteIds = React.useMemo(
    () => favorites.map((p) => p.id),
    [favorites],
  );

  // Sync ref with state to avoid listener closure issues
  useEffect(() => {
    backOverrideRef.current = backOverride;
  }, [backOverride]);

  // Keyboard Shortcuts for Admin Navigation
  useEffect(() => {
    if (!isAdmin) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Ctrl + Alt + Key
      if (e.ctrlKey && e.altKey) {
        let targetView: View | null = null;
        switch (e.key.toLowerCase()) {
          case "d":
            targetView = "admin-dashboard";
            break;
          case "o":
            targetView = "admin-orders";
            break;
          case "p":
            targetView = "admin-products";
            break;
          case "c":
            targetView = "admin-customers";
            break;
          case "s":
            targetView = "admin-settings";
            break;
          default:
            break;
        }

        if (targetView) {
          e.preventDefault();
          handleNavigate(targetView);
          toast.success(
            `Navegando para o painel de ${targetView.replace("admin-", "").toUpperCase()}...`,
            {
              duration: 1000,
              icon: "⌨️",
            },
          );
        }
      }
    };

    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [isAdmin, handleNavigate]);

  const handleProductClick = useCallback(
    (productId: string) => {
      handleNavigate("product-detail", productId);
      haptic.light();
    },
    [handleNavigate],
  );

  const handleScroll = useCallback(() => {
    if (!mainRef.current || isTransitioningRef.current) return;
    const currView = currentViewRef.current;
    const selProdId = selectedProductIdRef.current;
    const viewKey =
      currView === "product-detail" && selProdId
        ? `product-detail-${selProdId}`
        : currView;
    scrollPositionsRef.current[viewKey] = mainRef.current.scrollTop;
  }, []);

  useLayoutEffect(() => {
    const mainEl = mainRef.current;
    if (!mainEl) return;

    // Skip scroll restoration if we are on an admin view, as AdminLayout handles it internally
    if (currentView.startsWith("admin")) return;

    const viewKey =
      currentView === "product-detail" && selectedProductId
        ? `product-detail-${selectedProductId}`
        : currentView;

    const savedScroll = scrollPositionsRef.current[viewKey] || 0;

    const restoreScroll = () => {
      if (mainRef.current) {
        mainRef.current.scrollTop = savedScroll;
      }
    };

    restoreScroll();

    let rafId2: number;

    const rafId1 = requestAnimationFrame(() => {
      restoreScroll();
      rafId2 = requestAnimationFrame(() => {
        restoreScroll();
      });
    });

    return () => {
      cancelAnimationFrame(rafId1);
      if (rafId2) {
        cancelAnimationFrame(rafId2);
      }
    };
  }, [currentView, selectedProductId]);

  const handleBack = useCallback(() => {
    haptic.light();
    navigationDirectionRef.current = swipeBackActiveRef.current
      ? "none"
      : "back";

    const state = globalThis.history.state;
    if (state?.from) {
      globalThis.history.back();
    } else {
      if (currentViewRef.current === "order-details") {
        handleNavigate("orders");
      } else if (currentViewRef.current === "product-detail") {
        handleNavigate("home");
      } else {
        handleNavigate("home");
      }
    }
    globalThis.scrollTo(0, 0);
  }, [handleNavigate]);

  const handleSwipeBack = useCallback(() => {
    swipeBackActiveRef.current = true;
    handleBack();
  }, [handleBack]);

  const canSwipeBack =
    currentView !== "home" &&
    currentView !== "favorites" &&
    currentView !== "cart" &&
    currentView !== "orders" &&
    currentView !== "profile" &&
    currentView !== "auth" &&
    currentView !== "login" &&
    !currentView.startsWith("admin");

  useSwipeBack({
    onBack: handleSwipeBack,
    active: canSwipeBack,
    mainRef,
  });

  const handleOpenNotifications = useCallback(() => {
    handleNavigate("notifications");
  }, [handleNavigate]);

  const handleAuthSuccess = useCallback(() => {
    handleNavigate("profile");
  }, [handleNavigate]);

  const handleAdminLoginSuccess = useCallback(() => {
    handleNavigate("admin");
  }, [handleNavigate]);

  const handleAdminUserDetailBack = useCallback(() => {
    handleNavigate("admin-customers");
  }, [handleNavigate]);

  const handleOrderDetailsBack = useCallback(() => {
    handleNavigate("orders");
  }, [handleNavigate]);

  // ==============================
  // PWA Reload Reason Consumption
  // ==============================
  useEffect(() => {
    const reason = localStorage.getItem("pwa_reload_reason");
    if (reason) {
      console.log(`[PWA] Consuming reload reason: ${reason}`);
      import("sonner").then(({ toast }) => {
        toast.success("Sistema Atualizado", {
          description: reason,
          duration: 5000,
        });
      });
      localStorage.removeItem("pwa_reload_reason");
    }
  }, []);

  // Scroll tracking for animations

  // Freeze safe areas to prevent mobile shrinking/expanding on scroll
  useEffect(() => {
    if (globalThis.window === undefined) return;
    const lockSafeAreas = () => {
      const div = document.createElement("div");
      div.style.paddingTop = "env(safe-area-inset-top, 0px)";
      div.style.paddingBottom = "env(safe-area-inset-bottom, 0px)";
      div.style.position = "absolute";
      div.style.visibility = "hidden";
      document.body.appendChild(div);

      const computed = getComputedStyle(div);
      const sat = computed.paddingTop;
      const sab = computed.paddingBottom;

      const root = document.documentElement;
      if (sat && sat !== "0px")
        root.style.setProperty("--safe-area-top-fixed", sat);
      if (sab && sab !== "0px")
        root.style.setProperty("--safe-area-bottom-fixed", sab);

      div.remove();
    };

    // Delay slightly to ensure browser has applied env()
    const timer = setTimeout(lockSafeAreas, 150);
    const handleOrientation = () => {
      document.documentElement.style.removeProperty("--safe-area-top-fixed");
      document.documentElement.style.removeProperty("--safe-area-bottom-fixed");
      setTimeout(lockSafeAreas, 300);
    };

    // IntersectionObserver scroll tracking for HomeView and header components
    const mainElement = mainRef.current;
    const sentinel = scrollSentinelRef.current;
    let observer: IntersectionObserver | undefined;

    if (mainElement && sentinel) {
      observer = new IntersectionObserver(
        ([entry]) => {
          // If intersecting is true, the sentinel (at 20px) is visible, meaning scrollTop <= 20px.
          // If intersecting is false, the sentinel is scrolled out of view, meaning scrollTop > 20px.
          setScrollProgress(entry.isIntersecting ? 0 : 21);
        },
        {
          root: mainElement,
          threshold: 0,
        },
      );
      observer.observe(sentinel);
    }

    globalThis.addEventListener("orientationchange", handleOrientation);
    return () => {
      clearTimeout(timer);
      globalThis.removeEventListener("orientationchange", handleOrientation);
      if (observer) {
        observer.disconnect();
      }
    };
  }, []);

  // Sync view with URL on initial load and back/forward buttons
  const { isPasswordRecovery } = useAuth();

  useEffect(() => {
    if (isPasswordRecovery) {
      console.log("[App] Recovery mode detected. Forcing AuthView.");
      setCurrentView("auth");
    }
  }, [isPasswordRecovery]);

  useEffect(() => {
    const syncWithUrl = () => {
      saveCurrentScroll();
      let path = globalThis.location.pathname.slice(1) || "home";
      // Normalize path (remove trailing slashes)
      path = path.replace(/\/$/, "");

      // Convert slash-based admin sub-routes to hyphenated view names (e.g., admin/orders -> admin-orders)
      if (path.startsWith("admin/")) {
        path = path.replace("admin/", "admin-");
      }

      if (!path) path = "home";

      // Basic validation of view name
      const validViews: View[] = [
        "home",
        "cart",
        "product-detail",
        "checkout",
        "profile",
        "admin",
        "search",
        "auth",
        "login",
        "favorites",
        "notifications",
        "order-success",
        "orders",
        "order-details",
        "recently-viewed",
        "compare",
        "account-settings",
        "admin-dashboard",
        "admin-products",
        "admin-product-form",
        "admin-orders",
        "admin-coupons",
        "admin-banners",
        "admin-settings",
        "admin-reviews",
        "admin-qa",
        "admin-customers",
        "admin-user-detail",
        "admin-push",
        "address-form",
        "admin-login",
        "user-profile",
      ];
      if (validViews.includes(path as View)) {
        let targetView = path as View;

        // Intercept popstate exit from sub-admin views to non-admin views, routing them back to parent admin views instead
        const currView = currentViewRef.current;
        const subAdminViews = [
          "admin-product-form",
          "admin-user-detail",
          "admin-push",
        ];
        if (
          subAdminViews.includes(currView) &&
          !targetView.startsWith("admin")
        ) {
          console.log(
            `[App] Intercepted popstate exit from sub-admin: ${currView} to ${targetView}. Rerouting to parent admin view.`,
          );
          if (currView === "admin-product-form") {
            targetView = "admin-products";
            globalThis.history.replaceState(
              { view: "admin-products" },
              "",
              "/admin-products",
            );
          } else if (currView === "admin-user-detail") {
            targetView = "admin-customers";
            globalThis.history.replaceState(
              { view: "admin-customers" },
              "",
              "/admin-customers",
            );
          } else if (currView === "admin-push") {
            targetView = "admin-dashboard";
            globalThis.history.replaceState(
              { view: "admin-dashboard" },
              "",
              "/admin-dashboard",
            );
          }
        }

        if (
          (targetView === "profile" ||
            targetView === "account-settings" ||
            targetView === "address-form") &&
          !authLoading &&
          !user
        ) {
          targetView = "auth";
          if (globalThis.location.pathname !== "/auth") {
            globalThis.history.replaceState({ view: "auth" }, "", "/auth");
          }
        }

        if (targetView === "admin-login" && !authLoading && isAdmin) {
          targetView = "admin";
          if (globalThis.location.pathname !== "/admin") {
            globalThis.history.replaceState({ view: "admin" }, "", "/admin");
          }
        }

        const urlParams = new URLSearchParams(globalThis.location.search);
        const queryId = urlParams.get("id");
        const stateId = globalThis.history.state?.id;
        const nextSelectedProductId =
          queryId ||
          stateId ||
          (targetView !== "product-detail" &&
          targetView !== "user-profile" &&
          targetView !== "order-details" &&
          targetView !== "admin-product-form" &&
          targetView !== "admin-user-detail" &&
          targetView !== "admin-orders" &&
          targetView !== "admin-push"
            ? null
            : selectedProductId);
        console.log("[App] syncWithUrl parsed:", {
          path,
          targetView,
          queryId,
          stateId,
          nextSelectedProductId,
        });

        const isGoingBackToHomeFromProduct =
          (targetView === "home" ||
            targetView === "favorites" ||
            targetView === "search") &&
          currentViewRef.current === "product-detail";
        const finalSelectedProductId = isGoingBackToHomeFromProduct
          ? null
          : nextSelectedProductId;

        if (
          currentViewRef.current === targetView &&
          selectedProductIdRef.current === finalSelectedProductId
        ) {
          // Já estamos no mesmo destino. Evitar transições e renderizações redundantes.
          isTransitioningRef.current = false;
          return;
        }

        const isCartOrdersTransition =
          (currentViewRef.current === "cart" && targetView === "orders") ||
          (currentViewRef.current === "orders" && targetView === "cart");

        if (isCartOrdersTransition) {
          setCurrentView(targetView);
          if (!isGoingBackToHomeFromProduct) {
            setSelectedProductId(nextSelectedProductId);
          }
          isTransitioningRef.current = false;
          setIsRouteLoading(false);
          return;
        }

        const shouldTransition =
          !isInitialMountRef.current && isInitialAuthCheckedRef.current;

        if (!authLoading && !isInitialAuthCheckedRef.current) {
          isInitialAuthCheckedRef.current = true;
        }

        const currentDir = navigationDirectionRef.current;
        setNavigationDirection(currentDir);

        if (!shouldTransition) {
          setCurrentView(targetView);
          if (!isGoingBackToHomeFromProduct) {
            setSelectedProductId(nextSelectedProductId);
          }
          isInitialMountRef.current = false;
          isTransitioningRef.current = false;
        } else {
          const oldView = currentViewRef.current;
          const oldScroll =
            scrollPositionsRef.current[
              oldView === "product-detail" && selectedProductIdRef.current
                ? `product-detail-${selectedProductIdRef.current}`
                : oldView
            ] || 0;

          const newView = targetView;
          const newScroll =
            scrollPositionsRef.current[
              newView === "product-detail" && nextSelectedProductId
                ? `product-detail-${nextSelectedProductId}`
                : newView
            ] || 0;

          setTransitionScroll({ oldScroll, newScroll });

          // Expand main container scroll area during back/popstate transitions
          setTransitionSpacerHeight(
            Math.max(oldScroll, newScroll) + window.innerHeight,
          );

          startTransition(
            () => {
              setCurrentView(targetView);
              if (!isGoingBackToHomeFromProduct) {
                setSelectedProductId(nextSelectedProductId);
              }
            },
            currentDir,
            () => {
              if (isGoingBackToHomeFromProduct) {
                setSelectedProductId(null);
              }
              swipeBackActiveRef.current = false;
              if (isTransitionSupported) {
                setTransitionSpacerHeight(0);
                isTransitioningRef.current = false;
              } else {
                // Delay reset for Framer Motion fallback to match transition duration (340ms)
                setTimeout(() => {
                  setTransitionSpacerHeight(0);
                  isTransitioningRef.current = false;
                }, 350);
              }
            },
          );
        }

        // History Trap for Home: If we are on home and this is the last entry,
        // push a fake one to prevent closing the app on back button
        if (targetView === "home" && !globalThis.history.state?.trap) {
          globalThis.history.replaceState(
            { view: "home", trap: true, isBase: true },
            "",
            "/",
          );
          globalThis.history.pushState({ view: "home", trap: true }, "", "/");
        }
      } else {
        isTransitioningRef.current = false;
      }
    };

    syncWithUrl();
    const handlePopState = (e: PopStateEvent) => {
      if (isAdminDirtyRef.current) {
        console.warn("[App] Popstate blocked by unsaved changes.");
        const path =
          currentViewRef.current === "home"
            ? "/"
            : [
                  "product-detail",
                  "user-profile",
                  "order-details",
                  "admin-product-form",
                  "admin-user-detail",
                  "admin-orders",
                  "admin-push",
                ].includes(currentViewRef.current) &&
                selectedProductIdRef.current
              ? `/${currentViewRef.current}?id=${selectedProductIdRef.current}`
              : `/${currentViewRef.current}`;
        globalThis.history.pushState(
          globalThis.history.state || { view: currentViewRef.current },
          "",
          path,
        );

        const targetState = e.state;
        let targetView: View = "home";
        let targetId: string | undefined;
        if (targetState?.view) {
          targetView = targetState.view;
          targetId = targetState.id;
        }
        setPendingNavigation({ view: targetView, id: targetId });
        return;
      }

      if (isTransitioningRef.current) {
        console.warn(
          "[App] Popstate blocked by transition lock. Reverting history to maintain sync.",
        );
        // Re-push the state to prevent URL getting out of sync with current locked view
        const path =
          currentView === "home"
            ? "/"
            : [
                  "product-detail",
                  "user-profile",
                  "order-details",
                  "admin-product-form",
                  "admin-user-detail",
                  "admin-orders",
                  "admin-push",
                ].includes(currentView) && selectedProductId
              ? `/${currentView}?id=${selectedProductId}`
              : `/${currentView}`;
        globalThis.history.pushState(
          globalThis.history.state || { view: currentView },
          "",
          path,
        );
        return;
      }

      isTransitioningRef.current = true;
      lastTransitionStartTimeRef.current = Date.now();

      // 1. PRIORITY: Execute any registered override (e.g., closing a modal)
      // We use the Ref to ensure we always have the latest function without re-adding the listener
      if (backOverrideRef.current) {
        console.log("[App] Intercepting popstate via backOverrideRef");
        backOverrideRef.current();
        // Fall through to syncWithUrl to handle any potential URL changes
      }

      // 2. Home Trap logic
      if (e.state?.isBase && currentView === "home") {
        globalThis.history.pushState({ view: "home", trap: true }, "", "/");
      }

      // Detect direction for popstate (default to back)
      if (
        navigationDirectionRef.current !== "back" &&
        !swipeBackActiveRef.current
      ) {
        navigationDirectionRef.current = "back";
      } else if (swipeBackActiveRef.current) {
        navigationDirectionRef.current = "none";
      }

      // 3. Sync state with current URL
      syncWithUrl();

      // Reset to forward for next transitions
      setTimeout(() => {
        navigationDirectionRef.current = "forward";
        setNavigationDirection("forward");
      }, 150);
    };

    globalThis.addEventListener("popstate", handlePopState);

    return () => {
      globalThis.removeEventListener("popstate", handlePopState);
    };
  }, [
    currentView,
    authLoading,
    user,
    isAdmin,
    startTransition,
    isTransitionSupported,
    selectedProductId,
    saveCurrentScroll,
  ]);

  // Clear search query when navigating to non-search views
  useEffect(() => {
    if (currentView !== "search" && currentView !== "home" && searchQuery) {
      setSearchQuery("");
    }
  }, [currentView, searchQuery]);

  // Handle missing product or invalid product detail view
  useEffect(() => {
    let active = true;
    console.log(
      "[App] Redirect check: currentView =",
      currentView,
      "selectedProductId =",
      selectedProductId,
      "productsLoading =",
      productsLoading,
      "products.length =",
      products.length,
    );
    if (currentView === "product-detail" && !authLoading && !productsLoading) {
      const product = selectedProductId
        ? getProductById(products, selectedProductId)
        : null;
      if (!product) {
        const verifyProduct = async () => {
          try {
            console.log("[App] verifyProduct checking id =", selectedProductId);
            if (!selectedProductId) throw new Error("No product ID");
            const { data, error } = await supabase
              .from("vw_produtos_public")
              .select("id")
              .eq("id", selectedProductId)
              .single();
            if (error) {
              console.error("[App] verifyProduct query error:", error);
              throw error;
            }
            if (!data) {
              console.error("[App] verifyProduct query returned no data");
              throw new Error("Product not active or not found");
            }
            // Product exists in database, do not redirect!
            console.log("[App] Product exists on network, avoiding redirect.");
          } catch (err: any) {
            console.error(
              "[App] verifyProduct caught error:",
              err?.message || err,
            );
            if (active) {
              console.warn(
                "[App] Product detail view requested but product not found on network. Redirecting to home.",
              );
              setCurrentView("home");
              // Sync URL back to home
              if (globalThis.location.pathname !== "/") {
                globalThis.history.replaceState({ view: "home" }, "", "/");
              }
            }
          }
        };
        verifyProduct();
      }
    }
    return () => {
      active = false;
    };
  }, [currentView, selectedProductId, products, authLoading, productsLoading]);

  // Unified scroll restoration is handled in the consolidated useLayoutEffect hook above

  // Sync PWA Badge is now handled by AppBadgeSynchronizer

  // Force loader removal once data is ready
  // Force loader removal once data is ready or after a safe timeout
  useEffect(() => {
    const removeLoader = () => {
      if ((globalThis as any).removeSilentGuardianLoader) {
        (globalThis as any).removeSilentGuardianLoader();
      }
      // Fallback: manually find and remove if the global function fails
      const loader = document.getElementById("silent-guardian-loader");
      if (loader) loader.remove();
    };

    if (!authLoading && !productsLoading) {
      removeLoader();
      // Mark splash as shown for the session to prevent it on every nav
      if (globalThis.window !== undefined) {
        sessionStorage.setItem("splash_shown", "true");
      }
    }

    // Absolute safety fallback (2s max loading for better UX)
    const safetyTimer = setTimeout(removeLoader, 2000);
    return () => clearTimeout(safetyTimer);
  }, [authLoading, productsLoading]);

  // Preemptively prefetch all view chunks in background when network is idle
  useEffect(() => {
    if (!authLoading && !productsLoading) {
      const timer = setTimeout(() => {
        prefetchAll();
      }, 800); // 800ms delay to ensure first paint is completely done
      return () => clearTimeout(timer);
    }
  }, [authLoading, productsLoading, prefetchAll]);

  const handleToggleFavorite = useCallback(
    (product: Product) => {
      toggleFavorite(product);
    },
    [toggleFavorite],
  );

  const handleAddToCart = useCallback(
    (
      product: Product,
      quantity = 1,
      variantId?: string,
      variantNames?: string,
    ) => {
      console.log("[App-Trace] handleAddToCart Attempt");
      addToCart(product, quantity, variantId, variantNames);
      haptic.success();
    },
    [addToCart],
  );

  const handleQuickBuy = useCallback(
    (product: Product, variantId?: string) => {
      addToCart(product, 1, variantId);
      handleNavigate("checkout");
      haptic.success();
    },
    [addToCart, handleNavigate],
  );

  const renderCustomerSecondaryView = () => {
    switch (currentView) {
      case "product-detail": {
        const product = selectedProductId
          ? getProductById(products, selectedProductId)
          : null;
        if (!product) return null;
        return (
          <PreloadedOrLazy
            component={ProductView}
            props={{
              product: product,
              isFavorite: favorites.some((f) => f.id === product.id),
              onToggleFavorite: () => handleToggleFavorite(product),
              onBack: handleBack,
              onAddToCart: (q: number, vId?: string, vNames?: string) =>
                handleAddToCart(product, q, vId, vNames),
              onProductClick: handleProductClick,
              onAddToCartProduct: handleAddToCart,
              onQuickBuy: handleQuickBuy,
              onNavigate: handleNavigate,
            }}
          />
        );
      }
      case "checkout": {
        return (
          <PreloadedOrLazy
            component={CheckoutView}
            props={{
              key: user?.id ? `checkout-${user.id}` : "checkout-guest",
              onNavigate: handleNavigate,
              onSetBackOverride: setBackOverride,
            }}
          />
        );
      }
      case "user-profile":
        return (
          <PreloadedOrLazy
            component={UserProfileView}
            props={{
              key: selectedProductId
                ? `user-profile-${selectedProductId}`
                : "user-profile-empty",
              userId: selectedProductId || "",
              onNavigate: handleNavigate,
            }}
          />
        );
      case "notifications":
        return (
          <PreloadedOrLazy
            component={NotificationsView}
            props={{ onNavigate: handleNavigate }}
          />
        );

      case "order-success":
        return (
          <PreloadedOrLazy
            component={OrderSuccessView}
            props={{ onNavigate: handleNavigate }}
          />
        );

      case "login":
      case "auth":
        return (
          <PreloadedOrLazy
            component={AuthView}
            props={{ onNavigate: handleNavigate, onSuccess: handleAuthSuccess }}
          />
        );

      case "admin-login":
        return (
          <PreloadedOrLazy
            component={AdminLogin}
            props={{
              onLogin: handleAdminLoginSuccess,
              onNavigate: handleNavigate,
            }}
          />
        );

      case "account-settings":
        return (
          <PreloadedOrLazy
            component={AccountSettings}
            props={{
              key: user?.id
                ? `account-settings-${user.id}`
                : "account-settings-guest",
            }}
          />
        );

      case "order-details":
        return (
          <PreloadedOrLazy
            component={OrderDetailsView}
            props={{
              key: user?.id
                ? `order-details-${user.id}`
                : "order-details-guest",
              orderId: selectedProductId || "",
              onBack: handleOrderDetailsBack,
              onNavigate: handleNavigate,
            }}
          />
        );

      case "address-form":
        return (
          <PreloadedOrLazy
            component={AddressFormView}
            props={{
              key: user?.id ? `address-form-${user.id}` : "address-form-guest",
              addressId: selectedProductId,
              onBack: handleBack,
            }}
          />
        );

      case "compare":
        return (
          <PreloadedOrLazy
            component={CompareView}
            props={{
              products: [],
              onNavigate: handleNavigate,
              onRemoveProduct: () => {},
              onClearAll: () => {},
              onProductClick: handleProductClick,
            }}
          />
        );

      case "search":
        return (
          <PreloadedOrLazy
            component={SearchView}
            props={{
              onNavigate: handleNavigate,
              initialQuery: searchQuery,
              onBack: () => handleNavigate("home"),
              selectedProductId: selectedProductId || undefined,
            }}
          />
        );
      default:
        return null;
    }
  };

  const renderCustomerContent = () => {
    const isMaintenanceMode = import.meta.env.VITE_MAINTENANCE_MODE === "true";
    if (isMaintenanceMode) {
      return <MaintenanceView />;
    }

    const adminViews: View[] = [
      "admin",
      "admin-dashboard",
      "admin-products",
      "admin-product-form",
      "admin-orders",
      "admin-coupons",
      "admin-banners",
      "admin-settings",
      "admin-reviews",
      "admin-qa",
      "admin-customers",
      "admin-user-detail",
      "admin-push",
    ];

    const privateViews: View[] = [
      "profile",
      "account-settings",
      "address-form",
      "checkout",
      "orders",
      "order-details",
      ...adminViews,
    ];

    const isPrivateView = privateViews.includes(currentView);

    if (authLoading && isPrivateView) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-4">
          <div className="size-12 animate-spin rounded-full border-4 border-zinc-900 border-t-transparent" />
          <p className="animate-pulse font-medium text-muted-foreground">
            Carregando marketplace...
          </p>
        </div>
      );
    }

    const isMainTab = [
      "home",
      "favorites",
      "cart",
      "orders",
      "profile",
    ].includes(currentView);

    let activeTabIdx = -1;
    if (currentView === "home") activeTabIdx = 0;
    else if (currentView === "favorites") activeTabIdx = 1;
    else if (currentView === "cart" || currentView === "orders")
      activeTabIdx = 2;
    else if (currentView === "profile") activeTabIdx = 3;

    return (
      <div className="relative flex flex-1 flex-col w-full h-full min-h-full">
        {/* Main Tabs Container - Kept mounted in the DOM to preserve loaded states & scroll positions */}
        {isTransitionSupported ? (
          <div
            className="absolute left-0 top-0 size-full overflow-hidden"
            style={{
              opacity: isMainTab ? 1 : 0,
              pointerEvents: isMainTab ? "auto" : "none",
              visibility: isMainTab ? "visible" : "hidden",
            }}
          >
            <TabWrapper
              active={currentView === "home"}
              isTransitionSupported={isTransitionSupported}
              index={0}
              activeIndex={activeTabIdx}
            >
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === "home"}>
                  <PreloadedOrLazy
                    component={HomeView}
                    props={{
                      products: products,
                      favorites: favoriteIds,
                      onToggleFavorite: handleToggleFavorite,
                      onProductClick: handleProductClick,
                      onNavigate: handleNavigate,
                      searchQuery: searchQuery,
                      onAddToCart: handleAddToCart,
                      onQuickBuy: handleQuickBuy,
                      scrollProgress: scrollProgress,
                      isLoading: productsLoading,
                      selectedProductId: selectedProductId || undefined,
                      selectedCategory: selectedCategory,
                      onCategoryChange: setSelectedCategory,
                      sortBy: sortBy,
                      onSortByChange: setSortBy,
                      onHeaderDockChange: setIsHeaderDocked,
                    }}
                  />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>

            <TabWrapper
              active={currentView === "favorites"}
              isTransitionSupported={isTransitionSupported}
              index={1}
              activeIndex={activeTabIdx}
            >
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === "favorites"}>
                  <PreloadedOrLazy
                    component={FavoritesView}
                    props={{
                      key: user?.id
                        ? `favorites-${user.id}`
                        : "favorites-guest",
                      favorites: favorites,
                      loading: favoritesLoading,
                      onToggleFavorite: handleToggleFavorite,
                      onProductClick: handleProductClick,
                      onNavigate: handleNavigate,
                      selectedProductId: selectedProductId || undefined,
                      isActive: currentView === "favorites",
                    }}
                  />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>

            <TabWrapper
              active={currentView === "cart" || currentView === "orders"}
              isTransitionSupported={isTransitionSupported}
              index={2}
              activeIndex={activeTabIdx}
            >
              <LocalErrorBoundary>
                <DeferredTabContent
                  active={currentView === "cart" || currentView === "orders"}
                >
                  <PreloadedOrLazy
                    component={CartView}
                    props={{
                      key: user?.id
                        ? `cart-orders-${user.id}`
                        : "cart-orders-guest",
                      onNavigate: handleNavigate,
                      onAddToCart: handleAddToCart,
                      initialTab: currentView === "orders" ? "orders" : "cart",
                      isActive:
                        currentView === "cart" || currentView === "orders",
                    }}
                  />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>

            <TabWrapper
              active={currentView === "profile"}
              isTransitionSupported={isTransitionSupported}
              index={3}
              activeIndex={activeTabIdx}
            >
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === "profile"}>
                  <PreloadedOrLazy
                    component={ProfileView}
                    props={{
                      key: user?.id ? `profile-${user.id}` : "profile-guest",
                      onNavigate: handleNavigate,
                    }}
                  />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
          </div>
        ) : (
          <motion.div
            className="absolute left-0 top-0 size-full overflow-hidden"
            initial={false}
            animate={
              isMainTab
                ? {
                    opacity: 1,
                    y: 0,
                    pointerEvents: "auto",
                    visibility: "visible",
                  }
                : {
                    opacity: 0,
                    y: -8,
                    pointerEvents: "none",
                    transitionEnd: { visibility: "hidden" },
                  }
            }
            transition={{
              duration: getFramerMotionDuration(),
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            <TabWrapper
              active={currentView === "home"}
              isTransitionSupported={isTransitionSupported}
              index={0}
              activeIndex={activeTabIdx}
            >
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === "home"}>
                  <PreloadedOrLazy
                    component={HomeView}
                    props={{
                      products: products,
                      favorites: favoriteIds,
                      onToggleFavorite: handleToggleFavorite,
                      onProductClick: handleProductClick,
                      onNavigate: handleNavigate,
                      searchQuery: searchQuery,
                      onAddToCart: handleAddToCart,
                      onQuickBuy: handleQuickBuy,
                      scrollProgress: scrollProgress,
                      isLoading: productsLoading,
                      selectedProductId: selectedProductId || undefined,
                      selectedCategory: selectedCategory,
                      onCategoryChange: setSelectedCategory,
                      sortBy: sortBy,
                      onSortByChange: setSortBy,
                      onHeaderDockChange: setIsHeaderDocked,
                    }}
                  />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>

            <TabWrapper
              active={currentView === "favorites"}
              isTransitionSupported={isTransitionSupported}
              index={1}
              activeIndex={activeTabIdx}
            >
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === "favorites"}>
                  <PreloadedOrLazy
                    component={FavoritesView}
                    props={{
                      key: user?.id
                        ? `favorites-${user.id}`
                        : "favorites-guest",
                      favorites: favorites,
                      loading: favoritesLoading,
                      onToggleFavorite: handleToggleFavorite,
                      onProductClick: handleProductClick,
                      onNavigate: handleNavigate,
                      selectedProductId: selectedProductId || undefined,
                      isActive: currentView === "favorites",
                    }}
                  />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>

            <TabWrapper
              active={currentView === "cart" || currentView === "orders"}
              isTransitionSupported={isTransitionSupported}
              index={2}
              activeIndex={activeTabIdx}
            >
              <LocalErrorBoundary>
                <DeferredTabContent
                  active={currentView === "cart" || currentView === "orders"}
                >
                  <PreloadedOrLazy
                    component={CartView}
                    props={{
                      key: user?.id
                        ? `cart-orders-${user.id}`
                        : "cart-orders-guest",
                      onNavigate: handleNavigate,
                      onAddToCart: handleAddToCart,
                      initialTab: currentView === "orders" ? "orders" : "cart",
                      isActive:
                        currentView === "cart" || currentView === "orders",
                    }}
                  />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>

            <TabWrapper
              active={currentView === "profile"}
              isTransitionSupported={isTransitionSupported}
              index={3}
              activeIndex={activeTabIdx}
            >
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === "profile"}>
                  <PreloadedOrLazy
                    component={ProfileView}
                    props={{
                      key: user?.id ? `profile-${user.id}` : "profile-guest",
                      onNavigate: handleNavigate,
                    }}
                  />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
          </motion.div>
        )}

        {/* Secondary Views (Rendered on demand with View Transitions or Framer Motion) */}
        {isTransitionSupported ? (
          !isMainTab && (
            <div
              className="flex flex-1 flex-col w-full min-h-full !outline-none focus:!outline-none"
              style={{ viewTransitionName: "main-content" }}
            >
              {renderCustomerSecondaryView()}
            </div>
          )
        ) : (
          <AnimatePresence
            mode="popLayout"
            custom={{ direction: navigationDirection, ...transitionScroll }}
          >
            {!isMainTab && (
              <motion.div
                key={currentView}
                custom={{ direction: navigationDirection, ...transitionScroll }}
                variants={pageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  type: "tween",
                  ease: [0.16, 1, 0.3, 1],
                  duration: getFramerMotionDuration(),
                  y: { duration: 0 },
                }}
                className="flex flex-1 flex-col w-full min-h-full !outline-none focus:!outline-none"
              >
                {renderCustomerSecondaryView()}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    );
  };

  const renderAdminContent = () => {
    const isMainTab = [
      "admin-dashboard",
      "admin",
      "admin-products",
      "admin-orders",
      "admin-customers",
      "admin-settings",
    ].includes(currentView);

    let activeTabIdx = -1;
    if (currentView === "admin" || currentView === "admin-dashboard")
      activeTabIdx = 0;
    else if (currentView === "admin-orders") activeTabIdx = 1;
    else if (currentView === "admin-products") activeTabIdx = 2;
    else if (currentView === "admin-customers") activeTabIdx = 3;
    else if (currentView === "admin-settings") activeTabIdx = 4;

    return (
      <div className="relative size-full overflow-hidden">
        {/* Main Tabs Container - Kept mounted in the DOM to preserve loaded states & scroll positions */}
        {isTransitionSupported ? (
          <div
            className="absolute left-0 top-0 size-full overflow-hidden"
            style={{
              opacity: isMainTab ? 1 : 0,
              pointerEvents: isMainTab ? "auto" : "none",
              visibility: isMainTab ? "visible" : "hidden",
            }}
          >
            <TabWrapper
              active={
                currentView === "admin-dashboard" || currentView === "admin"
              }
              isTransitionSupported={isTransitionSupported}
              index={0}
              activeIndex={activeTabIdx}
            >
              <LocalErrorBoundary>
                <DeferredTabContent
                  active={
                    currentView === "admin-dashboard" || currentView === "admin"
                  }
                >
                  <PreloadedOrLazy
                    component={AdminDashboard}
                    props={{
                      onNavigate: handleNavigate,
                      active:
                        currentView === "admin-dashboard" ||
                        currentView === "admin",
                    }}
                  />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
            <TabWrapper
              active={currentView === "admin-products"}
              isTransitionSupported={isTransitionSupported}
              index={2}
              activeIndex={activeTabIdx}
            >
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === "admin-products"}>
                  <PreloadedOrLazy
                    component={AdminProducts}
                    props={{
                      onNavigate: handleNavigate,
                      active: currentView === "admin-products",
                    }}
                  />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
            <TabWrapper
              active={currentView === "admin-orders"}
              isTransitionSupported={isTransitionSupported}
              index={1}
              activeIndex={activeTabIdx}
            >
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === "admin-orders"}>
                  <PreloadedOrLazy
                    component={AdminOrders}
                    props={{
                      onNavigate: handleNavigate,
                      active: currentView === "admin-orders",
                      selectedOrderId: selectedProductId,
                      onSetBackOverride: setBackOverride,
                    }}
                  />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
            <TabWrapper
              active={currentView === "admin-customers"}
              isTransitionSupported={isTransitionSupported}
              index={3}
              activeIndex={activeTabIdx}
            >
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === "admin-customers"}>
                  <PreloadedOrLazy
                    component={AdminCustomers}
                    props={{
                      onNavigate: handleNavigate,
                      active: currentView === "admin-customers",
                    }}
                  />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
            <TabWrapper
              active={currentView === "admin-settings"}
              isTransitionSupported={isTransitionSupported}
              index={4}
              activeIndex={activeTabIdx}
            >
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === "admin-settings"}>
                  <PreloadedOrLazy
                    component={AdminSettings}
                    props={{
                      onNavigate: handleNavigate,
                      active: currentView === "admin-settings",
                      onSetDirty: setIsAdminDirty,
                    }}
                  />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
          </div>
        ) : (
          <motion.div
            className="absolute left-0 top-0 size-full overflow-hidden"
            initial={false}
            animate={
              isMainTab
                ? {
                    opacity: 1,
                    y: 0,
                    pointerEvents: "auto",
                    visibility: "visible",
                  }
                : {
                    opacity: 0,
                    y: -8,
                    pointerEvents: "none",
                    transitionEnd: { visibility: "hidden" },
                  }
            }
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <TabWrapper
              active={
                currentView === "admin-dashboard" || currentView === "admin"
              }
              isTransitionSupported={isTransitionSupported}
              index={0}
              activeIndex={activeTabIdx}
            >
              <LocalErrorBoundary>
                <DeferredTabContent
                  active={
                    currentView === "admin-dashboard" || currentView === "admin"
                  }
                >
                  <PreloadedOrLazy
                    component={AdminDashboard}
                    props={{
                      onNavigate: handleNavigate,
                      active:
                        currentView === "admin-dashboard" ||
                        currentView === "admin",
                    }}
                  />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
            <TabWrapper
              active={currentView === "admin-products"}
              isTransitionSupported={isTransitionSupported}
              index={2}
              activeIndex={activeTabIdx}
            >
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === "admin-products"}>
                  <PreloadedOrLazy
                    component={AdminProducts}
                    props={{
                      onNavigate: handleNavigate,
                      active: currentView === "admin-products",
                    }}
                  />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
            <TabWrapper
              active={currentView === "admin-orders"}
              isTransitionSupported={isTransitionSupported}
              index={1}
              activeIndex={activeTabIdx}
            >
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === "admin-orders"}>
                  <PreloadedOrLazy
                    component={AdminOrders}
                    props={{
                      onNavigate: handleNavigate,
                      active: currentView === "admin-orders",
                      selectedOrderId: selectedProductId,
                      onSetBackOverride: setBackOverride,
                    }}
                  />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
            <TabWrapper
              active={currentView === "admin-customers"}
              isTransitionSupported={isTransitionSupported}
              index={3}
              activeIndex={activeTabIdx}
            >
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === "admin-customers"}>
                  <PreloadedOrLazy
                    component={AdminCustomers}
                    props={{
                      onNavigate: handleNavigate,
                      active: currentView === "admin-customers",
                    }}
                  />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
            <TabWrapper
              active={currentView === "admin-settings"}
              isTransitionSupported={isTransitionSupported}
              index={4}
              activeIndex={activeTabIdx}
            >
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === "admin-settings"}>
                  <PreloadedOrLazy
                    component={AdminSettings}
                    props={{
                      onNavigate: handleNavigate,
                      active: currentView === "admin-settings",
                      onSetDirty: setIsAdminDirty,
                    }}
                  />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
          </motion.div>
        )}

        {/* Secondary Views (Rendered on demand) */}
        <AnimatePresence mode="wait">
          {!isMainTab && (
            <motion.div
              key={currentView}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{
                duration: isTransitionSupported ? 0 : 0.22,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="admin-scroll-container active-scroll-container absolute left-0 top-0 size-full overflow-y-auto scroll-smooth pb-12 lg:pb-6"
            >
              {(() => {
                switch (currentView) {
                  case "admin-product-form":
                    return (
                      <LocalErrorBoundary key="admin-product-form">
                        <PreloadedOrLazy
                          component={AdminProductForm}
                          props={{
                            productId: selectedProductId || undefined,
                            onNavigate: handleNavigate,
                            onSetDirty: setIsAdminDirty,
                          }}
                        />
                      </LocalErrorBoundary>
                    );
                  case "admin-coupons":
                    return (
                      <LocalErrorBoundary key="admin-coupons">
                        <PreloadedOrLazy
                          component={AdminCoupons}
                          props={{
                            onNavigate: handleNavigate,
                            active: currentView === "admin-coupons",
                            onSetDirty: setIsAdminDirty,
                          }}
                        />
                      </LocalErrorBoundary>
                    );
                  case "admin-banners":
                    return (
                      <LocalErrorBoundary key="admin-banners">
                        <PreloadedOrLazy
                          component={AdminBanners}
                          props={{
                            onNavigate: handleNavigate,
                            active: currentView === "admin-banners",
                            onSetDirty: setIsAdminDirty,
                            onSetBackOverride: setBackOverride,
                          }}
                        />
                      </LocalErrorBoundary>
                    );
                  case "admin-reviews":
                    return (
                      <LocalErrorBoundary key="admin-reviews">
                        <PreloadedOrLazy
                          component={AdminReviews}
                          props={{
                            onNavigate: handleNavigate,
                            active: currentView === "admin-reviews",
                            onSetDirty: setIsAdminDirty,
                          }}
                        />
                      </LocalErrorBoundary>
                    );
                  case "admin-qa":
                    return (
                      <LocalErrorBoundary key="admin-qa">
                        <PreloadedOrLazy
                          component={AdminQA}
                          props={{
                            onNavigate: handleNavigate,
                            active: true,
                            onSetDirty: setIsAdminDirty,
                          }}
                        />
                      </LocalErrorBoundary>
                    );
                  case "admin-user-detail":
                    return (
                      <LocalErrorBoundary key="admin-user-detail">
                        <PreloadedOrLazy
                          component={AdminUserDetail}
                          props={{
                            userId: selectedProductId || "",
                            onBack: handleAdminUserDetailBack,
                            onNavigate: handleNavigate,
                          }}
                        />
                      </LocalErrorBoundary>
                    );
                  case "admin-push":
                    return (
                      <LocalErrorBoundary key="admin-push">
                        <PreloadedOrLazy
                          component={AdminPush}
                          props={{
                            onNavigate: handleNavigate,
                            targetUserId: selectedProductId || undefined,
                            onSetDirty: setIsAdminDirty,
                          }}
                        />
                      </LocalErrorBoundary>
                    );
                  default:
                    return null;
                }
              })()}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const MaintenanceView = () => {
    return (
      <div className="flex min-h-[75vh] select-none flex-col items-center justify-center px-6 text-center">
        <div className="relative mb-8">
          {/* Glowing background effect */}
          <div className="absolute -inset-1 animate-pulse rounded-full bg-gradient-to-r from-amber-500 to-yellow-400 opacity-20 blur-xl" />

          {/* Animated gear or icon */}
          <div className="relative flex size-24 items-center justify-center rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl">
            <svg
              className="size-12 animate-spin text-amber-400"
              style={{ animationDuration: "8s" }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.43l-1.003.828c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.43l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.991l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.645-.869l.214-1.28Z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
              />
            </svg>
          </div>
        </div>

        <h1 className="mb-3 text-2xl font-black uppercase tracking-tighter text-white md:text-3xl">
          Servidor em Manutenção
        </h1>

        <p className="mb-8 max-w-sm text-sm leading-relaxed text-zinc-400">
          Estamos otimizando nossa infraestrutura para melhorar a velocidade e
          estabilidade da sua experiência. Voltamos em alguns minutos!
        </p>

        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2">
          <span className="size-2 animate-ping rounded-full bg-amber-400" />
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
            Atualizando Banco de Dados
          </span>
        </div>
      </div>
    );
  };

  const renderView = () => {
    const isMaintenanceMode = import.meta.env.VITE_MAINTENANCE_MODE === "true";
    if (isMaintenanceMode && !currentView.startsWith("admin")) {
      return <MaintenanceView />;
    }

    if (!isAdmin) return <AdminAccessDenied onNavigate={handleNavigate} />;

    return (
      <AdminLayout
        currentView={currentView}
        onNavigate={handleNavigate}
        onBack={backOverride || undefined}
      >
        <React.Suspense
          fallback={<AdminViewLoadingFallback view={currentView} />}
        >
          {renderAdminContent()}
        </React.Suspense>
      </AdminLayout>
    );
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <AppBadgeSynchronizer />
      <AnimatePresence>
        {isRouteLoading && (
          <motion.div
            initial={{ width: "0%", opacity: 1 }}
            animate={{
              width: ["0%", "35%", "70%", "90%"],
              transition: {
                times: [0, 0.2, 0.6, 0.9],
                duration: 1.5,
                ease: "easeOut",
              },
            }}
            exit={{
              width: "100%",
              opacity: 0,
              transition: { duration: 0.25, ease: "easeOut" },
            }}
            className="fixed left-0 top-0 z-[99999] h-[3px] bg-gradient-to-r from-admin-gold via-amber-400 to-yellow-300 shadow-[0_1px_10px_rgba(212,175,55,0.6)]"
          />
        )}
      </AnimatePresence>
      {!currentView.startsWith("admin") && (
        <div className="gpu-accelerated flex-shrink-0">
          <Header
            onNavigate={handleNavigate}
            showBackButton={
              currentView !== "home" &&
              currentView !== "favorites" &&
              currentView !== "cart" &&
              currentView !== "orders" &&
              currentView !== "profile" &&
              currentView !== "auth" &&
              currentView !== "login"
            }
            onBack={handleBack}
            onOpenNotifications={handleOpenNotifications}
            hideSearch={["address-form"].includes(currentView)}
            searchQuery={searchQuery}
            onSearch={setSearchQuery}
            scrollProgress={scrollProgress}
          />
        </div>
      )}

      <main
        ref={mainRef}
        onScroll={handleScroll}
        className={cn(
          "relative flex-1 flex flex-col overflow-y-auto overflow-x-hidden [-webkit-overflow-scrolling:touch] gpu-accelerated",
          currentView.startsWith("admin") && "h-full pt-0 overflow-y-hidden",
        )}
      >
        {/* Scroll Sentinel for header visual transitions */}
        <div
          ref={scrollSentinelRef}
          style={{
            position: "absolute",
            top: "20px",
            left: 0,
            width: "1px",
            height: "1px",
            pointerEvents: "none",
            opacity: 0,
          }}
        />

        {/* Dynamic transition spacer to prevent scroll clamping */}
        {transitionSpacerHeight > 0 && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "1px",
              height: `${transitionSpacerHeight}px`,
              pointerEvents: "none",
              visibility: "hidden",
            }}
          />
        )}

        {currentView.startsWith("admin") ? (
          <div key="admin-layout" className="h-full pt-0">
            <React.Suspense
              fallback={<AdminViewLoadingFallback view={currentView} />}
            >
              {renderView()}
            </React.Suspense>
          </div>
        ) : (
          <React.Suspense fallback={<ViewLoadingFallback />}>
            {renderCustomerContent()}
          </React.Suspense>
        )}
      </main>

      {currentView === "home" && (
        <CartReminder
          onAction={() => handleNavigate("cart")}
          docked={isHeaderDocked}
        />
      )}

      {!currentView.startsWith("admin") && currentView !== "order-success" && (
        <BottomNav currentView={currentView} onNavigate={handleNavigate} />
      )}

      <React.Suspense fallback={null}>
        <DebugPanel
          isOpen={isDebugOpen}
          onClose={() => setIsDebugOpen(false)}
        />
      </React.Suspense>

      <AlertDialog
        open={!!pendingNavigation}
        onOpenChange={(open) => !open && setPendingNavigation(null)}
      >
        <AlertDialogContent className="max-w-md rounded-[2rem] border border-white/10 bg-zinc-950 shadow-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-white">
              <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
              Alterações Não Salvas
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2 text-xs leading-relaxed text-zinc-400">
              Você tem modificações pendentes que serão perdidas permanentemente
              se você sair desta tela. Deseja sair mesmo assim?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-6 flex justify-end gap-3">
            <AlertDialogCancel className="rounded-xl border-white/5 bg-zinc-900 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:bg-zinc-800 hover:text-white">
              Permanecer
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setIsAdminDirty(false);
                if (pendingNavigation) {
                  handleNavigate(
                    pendingNavigation.view,
                    pendingNavigation.id,
                    true,
                  );
                }
                setPendingNavigation(null);
              }}
              className="rounded-xl bg-red-500 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-black hover:bg-red-600"
            >
              Descartar e Sair
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Toaster />
    </div>
  );
};

declare const __APP_VERSION__: string;

function PWAUpdateManager() {
  const { user } = useAuth();
  const { checkUpdate, updateAvailable, newVersion, performNuclearPurge } =
    useUpdateCheck();

  const handleUpdate = useCallback(
    (newVer?: string) => {
      console.log(
        `[RealtimeUpdate] Update ping detected (${newVer || "sem versão"}). Triggering deep checkUpdate...`,
      );
      checkUpdate(newVer);
    },
    [checkUpdate],
  );

  useRealtimeUpdate(handleUpdate, user?.id);

  return (
    <UpdateNotification
      show={updateAvailable}
      onUpdate={() => performNuclearPurge(true)}
      currentVersion={__APP_VERSION__}
      newVersion={newVersion}
    />
  );
}
