import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from '@/components/ui/custom/Header';
import { BottomNav } from '@/components/ui/custom/BottomNav';
import { CartReminder } from '@/components/ui/custom/CartReminder';
const HomeView = React.lazy(() => import('@/views/customer/HomeView').then(m => ({ default: m.HomeView })));
const CartView = React.lazy(() => import('@/views/customer/CartView').then(m => ({ default: m.CartView })));
const ProductView = React.lazy(() => import('@/views/customer/ProductView').then(m => ({ default: m.ProductView })));
const CheckoutView = React.lazy(() => import('@/views/customer/CheckoutView').then(m => ({ default: m.CheckoutView })));
const NotificationsView = React.lazy(() => import('@/views/customer/NotificationsView').then(m => ({ default: m.NotificationsView })));
const OrderSuccessView = React.lazy(() => import('@/views/customer/OrderSuccessView').then(m => ({ default: m.OrderSuccessView })));
const ProfileView = React.lazy(() => import('@/views/customer/ProfileView').then(m => ({ default: m.ProfileView })));

// --- LAZY LOADED ADMIN VIEWS ---
import { cn } from '@/lib/utils';
const AdminDashboard = React.lazy(() => import('@/views/admin/AdminDashboardView').then(m => ({ default: m.AdminDashboardView })));
const AdminProducts = React.lazy(() => import('@/views/admin/AdminProductsView').then(m => ({ default: m.AdminProductsView })));
const AdminProductForm = React.lazy(() => import('@/views/admin/AdminProductFormView').then(m => ({ default: m.AdminProductFormView })));
const AdminOrders = React.lazy(() => import('@/views/admin/AdminOrdersView').then(m => ({ default: m.AdminOrdersView })));
const AdminCoupons = React.lazy(() => import('@/views/admin/AdminCouponsView').then(m => ({ default: m.AdminCouponsView })));
const AdminBanners = React.lazy(() => import('@/views/admin/AdminBannersView').then(m => ({ default: m.AdminBannersView })));
const AdminSettings = React.lazy(() => import('@/views/admin/AdminSettingsView').then(m => ({ default: m.AdminSettingsView })));
const AdminReviews = React.lazy(() => import('@/views/admin/AdminReviewsView').then(m => ({ default: m.AdminReviewsView })));
const AdminQA = React.lazy(() => import('@/views/admin/AdminQAView').then(m => ({ default: m.AdminQAView })));
const AdminCustomers = React.lazy(() => import('@/views/admin/AdminCustomersView').then(m => ({ default: m.AdminCustomersView })));
const AdminUserDetail = React.lazy(() => import('@/views/admin/AdminUserDetailView').then(m => ({ default: m.AdminUserDetailView })));
const AdminPush = React.lazy(() => import('@/views/admin/AdminPushView').then(m => ({ default: m.AdminPushView })));
const AdminLogin = React.lazy(() => import('@/views/admin/AdminLoginView').then(m => ({ default: m.AdminLoginView })));

// --- LAZY LOADED CUSTOMER VIEWS ---
const AuthView = React.lazy(() => import('@/views/shared/AuthView').then(m => ({ default: m.AuthView })));
const AddressFormView = React.lazy(() => import('@/views/customer/AddressFormView').then(m => ({ default: m.AddressFormView })));
const AccountSettings = React.lazy(() => import('@/views/customer/AccountSettingsView').then(m => ({ default: m.AccountSettingsView })));
const OrderDetailsView = React.lazy(() => import('@/views/customer/OrderDetailsView').then(m => ({ default: m.OrderDetailsView })));
const SearchView = React.lazy(() => import('@/views/customer/SearchView').then(m => ({ default: m.SearchView })));
const RecentlyViewedView = React.lazy(() => import('@/views/customer/RecentlyViewedView').then(m => ({ default: m.RecentlyViewedView })));
const CompareView = React.lazy(() => import('@/views/customer/CompareView').then(m => ({ default: m.CompareView })));
const FavoritesView = React.lazy(() => import('@/views/customer/FavoritesView').then(m => ({ default: m.FavoritesView })));

const AdminLayout = React.lazy(() => import('@/components/layouts/AdminLayout').then(m => ({ default: m.AdminLayout })));
const DebugPanel = React.lazy(() => import('@/components/debug/DebugPanel').then(m => ({ default: m.DebugPanel })));
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { LocalErrorBoundary } from '@/components/ui/custom/LocalErrorBoundary';

declare global {
  interface Window {
    removeSilentGuardianLoader?: () => void;
  }
}

import { useAuth } from '@/hooks/useAuth';
import { useProducts } from '@/hooks/useProducts';

import { useFavorites } from '@/hooks/useFavorites';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useAppBadge } from '@/hooks/useAppBadge';
import { useUpdateCheck } from '@/hooks/useUpdateCheck';
import { useCacheWarmer } from '@/hooks/useCacheWarmer';
import { useNetworkAdaptive } from '@/hooks/useNetworkAdaptive';
import { usePredictiveNavigation } from '@/hooks/usePredictiveNavigation';
import { useBehavioralPrefetch } from '@/hooks/useBehavioralPrefetch';
import { usePrefetchOnHover } from '@/hooks/usePrefetchOnHover';
import { useViewTransition } from '@/hooks/useViewTransition';
import { useSwipeBack } from '@/hooks/useSwipeBack';
import { useWebVitals } from '@/hooks/useWebVitals';

function DeferredTabContent({ active, children }: { readonly active: boolean; readonly children: React.ReactNode }) {
  const [hasBeenActive, setHasBeenActive] = useState(active);

  if (active && !hasBeenActive) {
    setHasBeenActive(true);
  }

  if (!hasBeenActive) return null;
  return <>{children}</>;
}

interface TabWrapperProps {
  readonly active: boolean;
  readonly isTransitionSupported: boolean;
  readonly children: React.ReactNode;
}

function TabWrapper({ active, children, isTransitionSupported }: TabWrapperProps) {
  if (isTransitionSupported) {
    return (
      <div
        className="w-full top-0 left-0"
        style={{
          display: active ? "block" : "none",
          position: active ? "relative" : "absolute",
          opacity: active ? 1 : 0,
          pointerEvents: active ? "auto" : "none",
        }}
      >
        {children}
      </div>
    );
  }

  return (
    <motion.div
      initial={false}
      animate={
        active
          ? { opacity: 1, y: 0, scale: 1, display: "block", position: "relative", visibility: "visible", pointerEvents: "auto" }
          : { opacity: 0, y: 8, scale: 0.99, position: "absolute", pointerEvents: "none", transitionEnd: { display: "none", visibility: "hidden" } }
      }
      transition={{ duration: 0.20, ease: [0.16, 1, 0.3, 1] }}
      className="w-full top-0 left-0"
    >
      {children}
    </motion.div>
  );
}

function ViewLoadingFallback() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] space-y-4">
      <div className="w-10 h-10 border-3 border-zinc-900/10 border-t-zinc-900 rounded-full animate-spin"></div>
      <p className="text-zinc-500 animate-pulse text-sm font-medium">Carregando...</p>
    </div>
  );
}

function AdminRouteLoading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
      <div className="w-12 h-12 border-4 border-zinc-900 border-t-transparent rounded-full animate-spin"></div>
      <p className="text-muted-foreground animate-pulse font-medium">Verificando permissões...</p>
    </div>
  );
}

function AdminViewLoadingFallback() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6 bg-[#09090b] text-white">
      <div className="relative w-16 h-16">
        {/* Outer glowing ring */}
        <div className="absolute inset-0 rounded-full border-2 border-amber-500/10 animate-ping duration-1000"></div>
        {/* Spinner */}
        <div className="w-16 h-16 border-2 border-amber-500/10 border-t-amber-500 rounded-full animate-spin"></div>
        {/* Center hub */}
        <div className="absolute inset-4 rounded-full bg-zinc-900 border border-white/5 flex items-center justify-center">
          <span className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.8)]" />
        </div>
      </div>
      <div className="flex flex-col items-center gap-1.5 text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-500 animate-pulse">
          Carregando Módulos
        </p>
        <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest leading-none">
          Painel Administrativo
        </p>
      </div>
    </div>
  );
}

function AdminAccessDenied({ onNavigate }: { readonly onNavigate: (view: View) => void }) {
  const { isAdmin, loading } = useAuth();

  useEffect(() => {
    // If auth is still loading, wait.
    if (loading) return;

    // If not admin, redirect immediately to home with a message.
    if (!isAdmin) {
      console.warn('[App] Admin access denied. Redirecting to home.');
      toast.error('Acesso restrito a administradores.');
      onNavigate('home');
    }
  }, [onNavigate, isAdmin, loading]);

  return <AdminRouteLoading />;
}
import { useRealtimeUpdate } from '@/hooks/useRealtimeUpdate';
import { StoreProvider } from '@/contexts/StoreContext';
import { CartProvider } from '@/contexts/CartContext';
import { FavoritesProvider } from '@/contexts/FavoritesContext';
import { useCart } from '@/hooks/useCart';
import { haptic } from '@/utils/haptic';
import type { View, Product, SortOption } from '@/types';
import { UpdateNotification } from '@/components/pwa/UpdateNotification';

export default function App() {
  // Global check for session-based splash skip
  useEffect(() => {
    if (globalThis.window !== undefined && sessionStorage.getItem('splash_shown')) {
      const loader = document.getElementById('silent-guardian-loader');
      if (loader) loader.remove();
    }
  }, []);

  return (
    <StoreProvider>
      <CartProvider>
        <FavoritesProvider>
          <AppContent />
        </FavoritesProvider>
      </CartProvider>
    </StoreProvider>
  );
}

const getProductById = (products: Product[], id: string) => products.find(p => p.id === id);

const getNavigationDirection = (from: View, to: View): 'forward' | 'back' | 'none' => {
  // Admin tabs index checking
  const adminTabs: Record<string, number> = {
    'admin': 0,
    'admin-dashboard': 0,
    'admin-orders': 1,
    'admin-products': 2,
    'admin-customers': 3,
    'admin-settings': 4
  };
  
  if (from in adminTabs && to in adminTabs) {
    return adminTabs[to] >= adminTabs[from] ? 'forward' : 'back';
  }
  
  // Going from sub-page back to list
  if (from === 'admin-product-form' && to === 'admin-products') return 'back';
  if (from === 'admin-user-detail' && to === 'admin-customers') return 'back';
  if (from === 'admin-push' && (to === 'admin-customers' || to === 'admin' || to === 'admin-dashboard')) return 'back';
  
  // Default behaviors for main customer pages
  const mainTabs: Record<string, number> = {
    'home': 0,
    'favorites': 1,
    'cart': 2,
    'profile': 3
  };
  if (from in mainTabs && to in mainTabs) {
    return mainTabs[to] >= mainTabs[from] ? 'forward' : 'back';
  }
  
  // Going back to main views from detail views
  if (from === 'product-detail' && (to === 'home' || to === 'favorites' || to === 'search' || to === 'recently-viewed')) return 'back';
  if (from === 'checkout' && to === 'cart') return 'back';
  if (from === 'order-details' && to === 'orders') return 'back';
  if (from === 'address-form' && to === 'profile') return 'back';
  if (from === 'account-settings' && to === 'profile') return 'back';
  if (from === 'auth' && (to === 'home' || to === 'profile')) return 'back';
  if (from === 'admin' && to === 'profile') return 'back';
  if (from.startsWith('admin') && to === 'profile') return 'back';
  
  return 'forward';
};


const pageVariants = {
  initial: (direction: 'forward' | 'back' | 'none') => {
    if (direction === 'none') return { opacity: 0 };
    return {
      x: direction === 'forward' ? '100%' : '-30%',
      opacity: direction === 'forward' ? 1 : 0.5,
    };
  },
  animate: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: 'forward' | 'back' | 'none') => {
    if (direction === 'none') return { opacity: 0 };
    return {
      x: direction === 'forward' ? '-30%' : '100%',
      opacity: direction === 'forward' ? 0.5 : 0,
    };
  },
};

const AppContent = () => {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const { products, loading: productsLoading } = useProducts();
  const { navigate: startTransition, isSupported: isTransitionSupported } = useViewTransition();
  const { cart, addToCart, cartCount, cartTotal, shippingFee, clearCart, updateQuantity, removeFromCart } = useCart();
  const { favorites, toggleFavorite } = useFavorites();
  const { addToRecentlyViewed, getRecentlyViewedProducts, clearRecentlyViewed } = useRecentlyViewed();
  const recentlyViewedProducts = React.useMemo(() => getRecentlyViewedProducts(products), [getRecentlyViewedProducts, products]);

  const [currentView, setCurrentView] = useState<View>('home');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  const currentViewRef = useRef<View>(currentView);
  const selectedProductIdRef = useRef<string | null>(selectedProductId);
  const userRef = useRef(user);
  const authLoadingRef = useRef(authLoading);

  useEffect(() => {
    currentViewRef.current = currentView;
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

  const [searchQuery, setSearchQuery] = useState('');
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [isRouteLoading, setIsRouteLoading] = useState(false);
  const [backOverride, setBackOverride] = useState<(() => void) | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [sortBy, setSortBy] = useState<SortOption>('default');
  const mainRef = useRef<HTMLElement>(null);
  const scrollSentinelRef = useRef<HTMLDivElement>(null);
  const backOverrideRef = useRef<(() => void) | null>(null);
  const isTransitioningRef = useRef(false);
  const activeTransitionRef = useRef<any>(null);
  const scrollPositionsRef = useRef<Record<string, number>>({});
  const navigationDirectionRef = useRef<'forward' | 'back' | 'none'>('forward');
  const swipeBackActiveRef = useRef(false);
  const [navigationDirection, setNavigationDirection] = useState<'forward' | 'back' | 'none'>('forward');

  const { setBadge, clearBadge } = useAppBadge();
  const { checkUpdate, updateAvailable, newVersion, performNuclearPurge } = useUpdateCheck();

  const { prefetchView, prefetchAll, prefetchViewPromise } = usePrefetchOnHover();
  useCacheWarmer();
  useNetworkAdaptive();
  usePredictiveNavigation(currentView);
  useBehavioralPrefetch(currentView, prefetchView);
  useWebVitals();

  // Eagerly prefetch all admin views in the background to ensure instantaneous tab switches
  useEffect(() => {
    if (isAdmin) {
      const adminViews = [
        'admin-dashboard', 'admin-products', 'admin-orders', 'admin-customers',
        'admin-settings', 'admin-coupons', 'admin-banners', 'admin-reviews',
        'admin-qa', 'admin-user-detail', 'admin-push'
      ];
      const timeoutId = setTimeout(() => {
        adminViews.forEach(view => prefetchView(view));
      }, 1000);
      return () => clearTimeout(timeoutId);
    }
  }, [isAdmin, prefetchView]);

  const favoriteIds = React.useMemo(() => favorites.map(p => p.id), [favorites]);

  const saveCurrentScroll = useCallback(() => {
    if (!mainRef.current) return;
    const currView = currentViewRef.current;
    const selProdId = selectedProductIdRef.current;
    const viewKey = currView === 'product-detail' && selProdId
      ? `product-detail-${selProdId}`
      : currView;
    scrollPositionsRef.current[viewKey] = mainRef.current.scrollTop;
  }, []);

  // Sync ref with state to avoid listener closure issues
  useEffect(() => {
    backOverrideRef.current = backOverride;
  }, [backOverride]);

  const handleNavigate = useCallback(async (view: View, id?: string) => {
    saveCurrentScroll();
    const currView = currentViewRef.current;
    const isAuthL = authLoadingRef.current;
    const usr = userRef.current;

    const isMainTabNav = ['home', 'favorites', 'cart', 'profile', 'admin-dashboard', 'admin', 'admin-products', 'admin-orders', 'admin-customers', 'admin-settings'].includes(view);

    if (isTransitioningRef.current && currView !== view && !isMainTabNav) {
      // Exceções para redirecionamentos programáticos críticos (Auth, Login, Home, Profile, Admin)
      if (!['auth', 'login', 'home', 'profile', 'admin'].includes(view)) {
        console.warn(`[App] Navigation to ${view} throttled to prevent animation race conditions`);
        return;
      }
    }

    let targetView = view;
    if ((view === 'profile' || view === 'account-settings' || view === 'address-form') && !isAuthL && !usr) {
      targetView = 'auth';
    }

    const isDifferentView = currView !== targetView;
    const fromView = currView;
    const dir = getNavigationDirection(currView, targetView);
    navigationDirectionRef.current = dir;
    setNavigationDirection(dir);

    const performTransition = () => {
      // If a transition is already in progress, skip it to allow snappy interruptible navigation
      if (activeTransitionRef.current && typeof activeTransitionRef.current.skip === 'function') {
        try {
          activeTransitionRef.current.skip();
        } catch (e) {
          console.warn('[App] Failed to skip active transition:', e);
        }
      }

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
      };

      if (transition && typeof transition.finished?.then === 'function') {
        transition.finished.then(onTransitionEnd).catch(onTransitionEnd);
      } else {
        setTimeout(onTransitionEnd, isTransitionSupported ? 80 : 220);
      }

      // Sync URL without full reload
      let path = targetView === 'home' ? '/' : `/${targetView}`;
      if (targetView === 'product-detail' && id) {
        path = `/product-detail?id=${id}`;
      }
      const currentPathAndSearch = globalThis.location.pathname + globalThis.location.search;
      if (currentPathAndSearch !== path) {
        globalThis.history.pushState({ view: targetView, id, from: fromView }, '', path);
      }
    };

    if (isDifferentView) {
      isTransitioningRef.current = true;
      setIsRouteLoading(true);
      prefetchViewPromise(targetView)
        .then(() => {
          performTransition();
        })
        .catch((err) => {
          console.error('[App] Failed to prefetch route chunk:', err);
          // Fallback to navigate anyway if prefetch fails
          performTransition();
        })
        .finally(() => {
          setIsRouteLoading(false);
        });
    } else {
      performTransition();
    }
  }, [startTransition, isTransitionSupported, prefetchViewPromise, saveCurrentScroll]);


  const handleProductClick = useCallback((productId: string) => {
    handleNavigate('product-detail', productId);
    addToRecentlyViewed(productId);
    haptic.light();
  }, [handleNavigate, addToRecentlyViewed]);

  const handleScroll = useCallback(() => {
    if (!mainRef.current || isTransitioningRef.current) return;
    const currView = currentViewRef.current;
    const selProdId = selectedProductIdRef.current;
    const viewKey = currView === 'product-detail' && selProdId
      ? `product-detail-${selProdId}`
      : currView;
    scrollPositionsRef.current[viewKey] = mainRef.current.scrollTop;
  }, []);

  useLayoutEffect(() => {
    const mainEl = mainRef.current;
    if (!mainEl) return;

    // Skip scroll restoration if we are on an admin view, as AdminLayout handles it internally
    if (currentView.startsWith('admin')) return;

    const viewKey = currentView === 'product-detail' && selectedProductId
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
    navigationDirectionRef.current = swipeBackActiveRef.current ? 'none' : 'back';

    // Standard behavior: just trigger browser back.
    // This fires the 'popstate' event which is handled centraly in syncWithUrl useEffect.
    // This ensures UI buttons and browser buttons stay perfectly in sync.
    globalThis.history.back();
    globalThis.scrollTo(0, 0);
  }, []);

  const handleSwipeBack = useCallback(() => {
    swipeBackActiveRef.current = true;
    handleBack();
  }, [handleBack]);

  // Swipe back gesture integration (iOS/Android native feel)
  const canSwipeBack = currentView !== 'home' && 
                       currentView !== 'favorites' && 
                       currentView !== 'cart' && 
                       currentView !== 'profile' && 
                       currentView !== 'auth' && 
                       currentView !== 'login' && 
                       !currentView.startsWith('admin');

  useSwipeBack({
    onBack: handleSwipeBack,
    active: canSwipeBack,
    mainRef
  });

  const handleOpenNotifications = useCallback(() => {
    handleNavigate('notifications');
  }, [handleNavigate]);

  const handleAuthSuccess = useCallback(() => {
    handleNavigate('profile');
  }, [handleNavigate]);

  const handleAdminLoginSuccess = useCallback(() => {
    handleNavigate('admin');
  }, [handleNavigate]);

  const handleAdminUserDetailBack = useCallback(() => {
    handleNavigate('admin-customers');
  }, [handleNavigate]);

  const handleOrderDetailsBack = useCallback(() => {
    handleNavigate('orders');
  }, [handleNavigate]);


  // ==============================
  // PWA Reload Reason Consumption
  // ==============================
  useEffect(() => {
    const reason = localStorage.getItem('pwa_reload_reason');
    if (reason) {
      console.log(`[PWA] Consuming reload reason: ${reason}`);
      import('sonner').then(({ toast }) => {
        toast.success('Sistema Atualizado', {
          description: reason,
          duration: 5000,
        });
      });
      localStorage.removeItem('pwa_reload_reason');
    }
  }, []);



  // Scroll tracking for animations

  // Freeze safe areas to prevent mobile shrinking/expanding on scroll
  useEffect(() => {
    if (globalThis.window === undefined) return;
    const lockSafeAreas = () => {
      const div = document.createElement('div');
      div.style.paddingTop = 'env(safe-area-inset-top, 0px)';
      div.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
      div.style.position = 'absolute';
      div.style.visibility = 'hidden';
      document.body.appendChild(div);

      const computed = getComputedStyle(div);
      const sat = computed.paddingTop;
      const sab = computed.paddingBottom;

      const root = document.documentElement;
      if (sat && sat !== '0px') root.style.setProperty('--safe-area-top-fixed', sat);
      if (sab && sab !== '0px') root.style.setProperty('--safe-area-bottom-fixed', sab);

      div.remove();
    };

    // Delay slightly to ensure browser has applied env()
    const timer = setTimeout(lockSafeAreas, 150);
    const handleOrientation = () => {
      document.documentElement.style.removeProperty('--safe-area-top-fixed');
      document.documentElement.style.removeProperty('--safe-area-bottom-fixed');
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
        }
      );
      observer.observe(sentinel);
    }

    globalThis.addEventListener('orientationchange', handleOrientation);
    return () => {
      clearTimeout(timer);
      globalThis.removeEventListener('orientationchange', handleOrientation);
      if (observer) {
        observer.disconnect();
      }
    };
  }, []);


  // Sync view with URL on initial load and back/forward bottons
  const { isPasswordRecovery } = useAuth();

  useEffect(() => {
    if (isPasswordRecovery) {
      console.log('[App] Recovery mode detected. Forcing AuthView.');
      setCurrentView('auth');
    }
  }, [isPasswordRecovery]);

  useEffect(() => {
    const syncWithUrl = () => {
      saveCurrentScroll();
      let path = globalThis.location.pathname.slice(1) || 'home';
      // Normalize path (remove trailing slashes)
      path = path.replace(/\/$/, '');
      if (!path) path = 'home';

      // Basic validation of view name
      const validViews: View[] = [
        'home', 'cart', 'product-detail', 'checkout', 'profile', 'admin', 'search', 'auth', 'login', 'favorites',
        'notifications', 'order-success', 'orders', 'order-details', 'recently-viewed', 'compare', 'account-settings',
        'admin-dashboard', 'admin-products', 'admin-product-form', 'admin-orders', 'admin-coupons', 'admin-banners',
        'admin-settings', 'admin-reviews', 'admin-qa', 'admin-customers', 'admin-user-detail', 'admin-push', 'address-form',
        'admin-login'
      ];
      if (validViews.includes(path as View)) {
        let targetView = path as View;
        
        // Intercept popstate exit from sub-admin views to non-admin views, routing them back to parent admin views instead
        const currView = currentViewRef.current;
        const subAdminViews = ['admin-product-form', 'admin-user-detail', 'admin-push'];
        if (subAdminViews.includes(currView) && !targetView.startsWith('admin')) {
          console.log(`[App] Intercepted popstate exit from sub-admin: ${currView} to ${targetView}. Rerouting to parent admin view.`);
          if (currView === 'admin-product-form') {
            targetView = 'admin-products';
            globalThis.history.replaceState({ view: 'admin-products' }, '', '/admin-products');
          } else if (currView === 'admin-user-detail') {
            targetView = 'admin-customers';
            globalThis.history.replaceState({ view: 'admin-customers' }, '', '/admin-customers');
          } else if (currView === 'admin-push') {
            targetView = 'admin-dashboard';
            globalThis.history.replaceState({ view: 'admin-dashboard' }, '', '/admin-dashboard');
          }
        }

        if ((targetView === 'profile' || targetView === 'account-settings' || targetView === 'address-form') && !authLoading && !user) {
          targetView = 'auth';
          if (globalThis.location.pathname !== '/auth') {
            globalThis.history.replaceState({ view: 'auth' }, '', '/auth');
          }
        }

        if (targetView === 'admin-login' && !authLoading && isAdmin) {
          targetView = 'admin';
          if (globalThis.location.pathname !== '/admin') {
            globalThis.history.replaceState({ view: 'admin' }, '', '/admin');
          }
        }

        const urlParams = new URLSearchParams(globalThis.location.search);
        const queryId = urlParams.get('id');
        const stateId = globalThis.history.state?.id;
        const nextSelectedProductId = queryId || stateId || (
          (targetView !== 'product-detail' && targetView !== 'order-details' && targetView !== 'admin-product-form' && targetView !== 'admin-user-detail' && targetView !== 'admin-orders')
            ? null
            : selectedProductId
        );

        const isGoingBackToHomeFromProduct = (targetView === 'home' || targetView === 'favorites' || targetView === 'search') && currentViewRef.current === 'product-detail';
        const finalSelectedProductId = isGoingBackToHomeFromProduct ? null : nextSelectedProductId;

        if (currentViewRef.current === targetView && selectedProductIdRef.current === finalSelectedProductId) {
          // Já estamos no mesmo destino. Evitar transições e renderizações redundantes.
          return;
        }

        const currentDir = navigationDirectionRef.current;
        setNavigationDirection(currentDir);

        startTransition(() => {
          setCurrentView(targetView);
          if (!isGoingBackToHomeFromProduct) {
            setSelectedProductId(nextSelectedProductId);
          }
        }, currentDir, () => {
          if (isGoingBackToHomeFromProduct) {
            setSelectedProductId(null);
          }
          swipeBackActiveRef.current = false;
        });

        // History Trap for Home: If we are on home and this is the last entry, 
        // push a fake one to prevent closing the app on back button
        if (targetView === 'home' && !globalThis.history.state?.trap) {
          globalThis.history.replaceState({ view: 'home', trap: true, isBase: true }, '', '/');
          globalThis.history.pushState({ view: 'home', trap: true }, '', '/');
        }
      }
    };

    syncWithUrl();
    const handlePopState = (e: PopStateEvent) => {
      if (isTransitioningRef.current) {
        console.warn('[App] Popstate blocked by transition lock. Reverting history to maintain sync.');
        // Re-push the state to prevent URL getting out of sync with current locked view
        const path = currentView === 'home' 
          ? '/' 
          : (currentView === 'product-detail' && selectedProductId 
              ? `/product-detail?id=${selectedProductId}` 
              : `/${currentView}`);
        globalThis.history.pushState(globalThis.history.state || { view: currentView }, '', path);
        return;
      }
      
      isTransitioningRef.current = true;
      setTimeout(() => {
        isTransitioningRef.current = false;
      }, isTransitionSupported ? 50 : 150);

      // 1. PRIORITY: Execute any registered override (e.g., closing a modal)
      // We use the Ref to ensure we always have the latest function without re-adding the listener
      if (backOverrideRef.current) {
        console.log('[App] Intercepting popstate via backOverrideRef');
        backOverrideRef.current();
        // Fall through to syncWithUrl to handle any potential URL changes
      }

      // 2. Home Trap logic
      if (e.state?.isBase && currentView === 'home') {
        globalThis.history.pushState({ view: 'home', trap: true }, '', '/');
      }

      // Detect direction for popstate (default to back)
      if (navigationDirectionRef.current !== 'back' && !swipeBackActiveRef.current) {
        navigationDirectionRef.current = 'back';
      } else if (swipeBackActiveRef.current) {
        navigationDirectionRef.current = 'none';
      }

      // 3. Sync state with current URL
      syncWithUrl();

      // Reset to forward for next transitions
      setTimeout(() => {
        navigationDirectionRef.current = 'forward';
        setNavigationDirection('forward');
      }, 150);
    };

    globalThis.addEventListener('popstate', handlePopState);
    
    return () => {
      globalThis.removeEventListener('popstate', handlePopState);
    };
  }, [currentView, authLoading, user, isAdmin, startTransition, isTransitionSupported, selectedProductId, saveCurrentScroll]);

  // Clear search query when navigating to non-search views
  useEffect(() => {
    if (currentView !== 'search' && currentView !== 'home' && searchQuery) {
      setSearchQuery('');
    }
  }, [currentView, searchQuery]);

  // Handle missing product or invalid product detail view
  useEffect(() => {
    if (currentView === 'product-detail' && !authLoading && !productsLoading) {
      const product = selectedProductId ? getProductById(products, selectedProductId) : null;
      if (!product) {
        console.warn('[App] Product detail view requested but product not found. Redirecting to home.');
        setCurrentView('home');
        // Sync URL back to home
        if (globalThis.location.pathname !== '/') {
          globalThis.history.replaceState({ view: 'home' }, '', '/');
        }
      }
    }
  }, [currentView, selectedProductId, products, authLoading, productsLoading]);

  // Unified scroll restoration is handled in the consolidated useLayoutEffect hook above


  // Sync PWA Badge with cart count
  useEffect(() => {
    if (cartCount > 0) {
      setBadge(cartCount);
    } else {
      clearBadge();
    }
  }, [cartCount, setBadge, clearBadge]);

  // Real-time updates for deployment
  const handleUpdate = useCallback(() => {
    // Force version re-check
    console.log('[RealtimeUpdate] Update ping detected. Triggering deep checkUpdate...');
    checkUpdate();
  }, [checkUpdate]);

  useRealtimeUpdate(handleUpdate, user?.id);

  // Force loader removal once data is ready
  // Force loader removal once data is ready or after a safe timeout
  useEffect(() => {
    const removeLoader = () => {
      if ((globalThis as any).removeSilentGuardianLoader) {
        (globalThis as any).removeSilentGuardianLoader();
      }
      // Fallback: manually find and remove if the global function fails
      const loader = document.getElementById('silent-guardian-loader');
      if (loader) loader.remove();
    };

    if (!authLoading && !productsLoading) {
      removeLoader();
      // Mark splash as shown for the session to prevent it on every nav
      if (globalThis.window !== undefined) {
        sessionStorage.setItem('splash_shown', 'true');
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


  const handleToggleFavorite = useCallback((product: Product) => {
    toggleFavorite(product);
  }, [toggleFavorite]);

  const handleAddToCart = useCallback((product: Product, quantity: number = 1, variantId?: string, variantNames?: string) => {
    console.log('[App-Trace] handleAddToCart Attempt');
    addToCart(product, quantity, variantId, variantNames);
    haptic.success();
  }, [addToCart]);


  const handleQuickBuy = useCallback((product: Product, variantId?: string) => {
    addToCart(product, 1, variantId);
    setCurrentView('checkout');
    const path = '/checkout';
    if (globalThis.location.pathname !== path) {
      globalThis.history.pushState({ view: 'checkout' }, '', path);
    }
    haptic.success();
  }, [addToCart]);

  const renderAdminContent = () => {
    const isMainTab = ['admin-dashboard', 'admin', 'admin-products', 'admin-orders', 'admin-customers', 'admin-settings'].includes(currentView);

    return (
      <div className="relative w-full min-h-[60vh] overflow-x-hidden">
        {/* Main Tabs Container - Kept mounted in the DOM to preserve loaded states & scroll positions */}
        {isTransitionSupported ? (
          <div
            className="w-full h-full"
            style={{
              display: isMainTab ? "block" : "none",
              position: isMainTab ? "relative" : "absolute",
              opacity: isMainTab ? 1 : 0,
            }}
          >
            <TabWrapper active={currentView === 'admin-dashboard' || currentView === 'admin'} isTransitionSupported={isTransitionSupported}>
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === 'admin-dashboard' || currentView === 'admin'}>
                  <AdminDashboard onNavigate={handleNavigate} active={currentView === 'admin-dashboard' || currentView === 'admin'} />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
            <TabWrapper active={currentView === 'admin-products'} isTransitionSupported={isTransitionSupported}>
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === 'admin-products'}>
                  <AdminProducts onNavigate={handleNavigate} active={currentView === 'admin-products'} />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
            <TabWrapper active={currentView === 'admin-orders'} isTransitionSupported={isTransitionSupported}>
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === 'admin-orders'}>
                  <AdminOrders onNavigate={handleNavigate} active={currentView === 'admin-orders'} selectedOrderId={selectedProductId} onSetBackOverride={setBackOverride} />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
            <TabWrapper active={currentView === 'admin-customers'} isTransitionSupported={isTransitionSupported}>
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === 'admin-customers'}>
                  <AdminCustomers onNavigate={handleNavigate} active={currentView === 'admin-customers'} />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
            <TabWrapper active={currentView === 'admin-settings'} isTransitionSupported={isTransitionSupported}>
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === 'admin-settings'}>
                  <AdminSettings onNavigate={handleNavigate} active={currentView === 'admin-settings'} />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
          </div>
        ) : (
          <motion.div
            className="w-full h-full"
            initial={false}
            animate={isMainTab
              ? { opacity: 1, y: 0, display: "block", position: "relative" }
              : { opacity: 0, y: -8, position: "absolute", transitionEnd: { display: "none" } }
            }
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <TabWrapper active={currentView === 'admin-dashboard' || currentView === 'admin'} isTransitionSupported={isTransitionSupported}>
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === 'admin-dashboard' || currentView === 'admin'}>
                  <AdminDashboard onNavigate={handleNavigate} active={currentView === 'admin-dashboard' || currentView === 'admin'} />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
            <TabWrapper active={currentView === 'admin-products'} isTransitionSupported={isTransitionSupported}>
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === 'admin-products'}>
                  <AdminProducts onNavigate={handleNavigate} active={currentView === 'admin-products'} />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
            <TabWrapper active={currentView === 'admin-orders'} isTransitionSupported={isTransitionSupported}>
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === 'admin-orders'}>
                  <AdminOrders onNavigate={handleNavigate} active={currentView === 'admin-orders'} selectedOrderId={selectedProductId} onSetBackOverride={setBackOverride} />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
            <TabWrapper active={currentView === 'admin-customers'} isTransitionSupported={isTransitionSupported}>
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === 'admin-customers'}>
                  <AdminCustomers onNavigate={handleNavigate} active={currentView === 'admin-customers'} />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
            <TabWrapper active={currentView === 'admin-settings'} isTransitionSupported={isTransitionSupported}>
              <LocalErrorBoundary>
                <DeferredTabContent active={currentView === 'admin-settings'}>
                  <AdminSettings onNavigate={handleNavigate} active={currentView === 'admin-settings'} />
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
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: isTransitionSupported ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="w-full"
            >
              <LocalErrorBoundary>
                {(() => {
                  switch (currentView) {
                    case 'admin-product-form':
                      return (
                        <AdminProductForm
                          productId={selectedProductId || undefined}
                          onNavigate={handleNavigate}
                        />
                      );
                    case 'admin-coupons':
                      return <AdminCoupons onNavigate={handleNavigate} />;
                    case 'admin-banners':
                      return <AdminBanners onNavigate={handleNavigate} />;
                    case 'admin-reviews':
                      return <AdminReviews onNavigate={handleNavigate} active={true} />;
                    case 'admin-qa':
                      return <AdminQA onNavigate={handleNavigate} active={true} />;
                    case 'admin-user-detail':
                      return (
                        <AdminUserDetail
                          userId={selectedProductId || ''}
                          onBack={handleAdminUserDetailBack}
                          onNavigate={handleNavigate}
                        />
                      );
                    case 'admin-push':
                      return (
                        <AdminPush
                          onNavigate={handleNavigate}
                          targetUserId={selectedProductId || undefined}
                        />
                      );
                    default:
                      return null;
                  }
                })()}
              </LocalErrorBoundary>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const renderView = () => {
    const adminViews: View[] = [
      'admin', 'admin-dashboard', 'admin-products', 'admin-product-form',
      'admin-orders', 'admin-coupons', 'admin-banners', 'admin-settings',
      'admin-reviews', 'admin-qa', 'admin-customers', 'admin-user-detail', 'admin-push'
    ];

    const privateViews: View[] = [
      'profile', 'account-settings', 'address-form', 'checkout', 'orders', 'order-details',
      ...adminViews
    ];

    const isPrivateView = privateViews.includes(currentView);

    if (authLoading && isPrivateView) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
          <div className="w-12 h-12 border-4 border-zinc-900 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-muted-foreground animate-pulse font-medium">Carregando marketplace...</p>
        </div>
      );
    }

    if (adminViews.includes(currentView)) {
      if (!isAdmin) return <AdminAccessDenied onNavigate={handleNavigate} />;

      return (
        <AdminLayout currentView={currentView} onNavigate={handleNavigate}>
          <React.Suspense fallback={<AdminViewLoadingFallback />}>
            {renderAdminContent()}
          </React.Suspense>
        </AdminLayout>
      );
    }

    switch (currentView) {
      case 'cart':
        return (
          <CartView
            key={user?.id ? `cart-${user.id}` : 'cart-guest'}
            cart={cart}
            onUpdateQuantity={updateQuantity}
            onRemove={removeFromCart}
            onNavigate={handleNavigate}
            onAddToCart={handleAddToCart}
          />
        );

      case 'product-detail': {
        const product = selectedProductId ? getProductById(products, selectedProductId) : null;
        if (!product) return null;
        return (
          <ProductView
            product={product}
            isFavorite={favorites.some(f => f.id === product.id)}
            onToggleFavorite={() => handleToggleFavorite(product)}
            onBack={handleBack}
            onAddToCart={(q, vId, vNames) => handleAddToCart(product, q, vId, vNames)}
            onProductClick={handleProductClick}
            onAddToCartProduct={handleAddToCart}
            onQuickBuy={handleQuickBuy}
          />
        );
      }
      case 'checkout': {
        return (
          <CheckoutView
            key={user?.id ? `checkout-${user.id}` : 'checkout-guest'}
            cart={cart}
            subtotal={cartTotal}
            shipping={shippingFee}
            total={cartTotal + shippingFee}
            onClearCart={clearCart}
            onNavigate={handleNavigate}
            onSetBackOverride={setBackOverride}
          />
        );
      }
      case 'profile':
        return (
          <ProfileView
            key={user?.id ? `profile-${user.id}` : 'profile-guest'}
            onNavigate={handleNavigate}
            onProductClick={handleProductClick}
            recentlyViewedProducts={recentlyViewedProducts}
          />
        );
      case 'notifications':
        return <NotificationsView />;

      case 'order-success':
        return <OrderSuccessView onNavigate={handleNavigate} />;

      case 'login':
      case 'auth':
        return (
          <AuthView
            onNavigate={handleNavigate}
            onSuccess={handleAuthSuccess}
          />
        );

      case 'admin-login':
        return (
          <AdminLogin
            onLogin={handleAdminLoginSuccess}
            onNavigate={handleNavigate}
          />
        );

      case 'account-settings':
        return <AccountSettings key={user?.id ? `account-settings-${user.id}` : 'account-settings-guest'} />;

      case 'orders':
        return (
          <CartView
            key={user?.id ? `orders-${user.id}` : 'orders-guest'}
            cart={cart}
            onUpdateQuantity={updateQuantity}
            onRemove={removeFromCart}
            onNavigate={handleNavigate}
            onAddToCart={handleAddToCart}
            initialTab="orders"
          />
        );

      case 'order-details':
        return (
          <OrderDetailsView
            key={user?.id ? `order-details-${user.id}` : 'order-details-guest'}
            orderId={selectedProductId || ''}
            onBack={handleOrderDetailsBack}
            onNavigate={handleNavigate}
          />
        );

      case 'favorites':
        return (
          <FavoritesView
            key={user?.id ? `favorites-${user.id}` : 'favorites-guest'}
            favorites={favorites}
            onToggleFavorite={handleToggleFavorite}
            onProductClick={handleProductClick}
            onNavigate={handleNavigate}
            selectedProductId={selectedProductId || undefined}
          />
        );

      case 'recently-viewed':
        return (
          <RecentlyViewedView
            key={user?.id ? `recently-viewed-${user.id}` : 'recently-viewed-guest'}
            products={recentlyViewedProducts}
            favorites={favoriteIds}
            onToggleFavorite={handleToggleFavorite}
            onProductClick={handleProductClick}
            onNavigate={handleNavigate}
            onClear={clearRecentlyViewed}
          />
        );

      case 'address-form':
        return <AddressFormView key={user?.id ? `address-form-${user.id}` : 'address-form-guest'} addressId={selectedProductId} onBack={handleBack} />;

      case 'compare':
        return (
          <CompareView
            products={[]}
            onNavigate={handleNavigate}
            onRemoveProduct={() => { }}
            onClearAll={() => { }}
            onProductClick={handleProductClick}
          />
        );

      case 'search':
        return (
          <SearchView
            onNavigate={handleNavigate}
            initialQuery={searchQuery}
            onBack={() => handleNavigate('home')}
            selectedProductId={selectedProductId || undefined}
          />
        );
      case 'home':
      default:
        return (
          <HomeView
            products={products}
            favorites={favoriteIds}
            recentlyViewedProducts={recentlyViewedProducts}
            onToggleFavorite={handleToggleFavorite}
            onProductClick={handleProductClick}
            onNavigate={handleNavigate}
            searchQuery={searchQuery}
            onAddToCart={handleAddToCart}
            onQuickBuy={handleQuickBuy}
            scrollProgress={scrollProgress}
            isLoading={productsLoading}
            selectedProductId={selectedProductId || undefined}
            selectedCategory={selectedCategory}
            onCategoryChange={setSelectedCategory}
            sortBy={sortBy}
            onSortByChange={setSortBy}
          />
        );

    }
  };

  return (
    <div className="flex flex-col h-[100dvh] w-screen overflow-hidden bg-background text-foreground">
      {isRouteLoading && <div className="route-loading-bar" />}
      {!currentView.startsWith('admin') && (
        <div className="flex-shrink-0 gpu-accelerated">
          <Header
            onNavigate={handleNavigate}
            showBackButton={
              currentView !== 'home' &&
              currentView !== 'favorites' &&
              currentView !== 'cart' &&
              currentView !== 'profile' &&
              currentView !== 'auth' &&
              currentView !== 'login'
            }
            onBack={handleBack}
            onOpenNotifications={handleOpenNotifications}
            hideSearch={['address-form', 'account-settings', 'order-details', 'checkout'].includes(currentView)}
            searchQuery={searchQuery}
            onSearch={setSearchQuery}
            scrollProgress={scrollProgress}
            cartCount={cartCount}
          />
        </div>
      )}

      <main
        ref={mainRef}
        onScroll={handleScroll}
        className={cn(
          "relative flex-1 flex flex-col overflow-y-auto overflow-x-hidden [-webkit-overflow-scrolling:touch] gpu-accelerated",
          currentView.startsWith('admin') && "h-full pt-0 overflow-y-hidden"
        )}
      >
        {/* Scroll Sentinel for header visual transitions */}
        <div
          ref={scrollSentinelRef}
          style={{
            position: 'absolute',
            top: '20px',
            left: 0,
            width: '1px',
            height: '1px',
            pointerEvents: 'none',
            opacity: 0,
          }}
        />

        {currentView.startsWith('admin') ? (
          <div 
            key="admin-layout"
            className="h-full pt-0"
          >
            <React.Suspense fallback={<AdminViewLoadingFallback />}>
              {renderView()}
            </React.Suspense>
          </div>
        ) : isTransitionSupported ? (
          <div
            className="flex-1 flex flex-col !outline-none focus:!outline-none"
            tabIndex={-1}
            style={{ WebkitTapHighlightColor: 'transparent', outline: 'none' }}
          >
            <React.Suspense fallback={<ViewLoadingFallback />}>
              {renderView()}
            </React.Suspense>
          </div>
        ) : (
          <AnimatePresence mode="popLayout" custom={navigationDirection}>
            <motion.div
              key={currentView}
              custom={navigationDirection}
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ type: 'tween', ease: [0.16, 1, 0.3, 1], duration: 0.34 }}
              className="flex-1 flex flex-col !outline-none focus:!outline-none"
              tabIndex={-1}
              style={{ WebkitTapHighlightColor: 'transparent', outline: 'none' }}
            >
              <React.Suspense fallback={<ViewLoadingFallback />}>
                {renderView()}
              </React.Suspense>
            </motion.div>
          </AnimatePresence>
        )}
      </main>

      {currentView === 'home' && (
        <CartReminder onAction={() => handleNavigate('cart')} />
      )}

      {!currentView.startsWith('admin') && currentView !== 'order-success' && (
        <div className="flex-shrink-0 gpu-accelerated">
          <BottomNav
            currentView={currentView}
            onNavigate={handleNavigate}
            cartCount={cartCount}
          />
        </div>
      )}

      <React.Suspense fallback={null}>
        <DebugPanel
          isOpen={isDebugOpen}
          onClose={() => setIsDebugOpen(false)}
        />
      </React.Suspense>

      <UpdateNotification
        show={updateAvailable}
        onUpdate={() => performNuclearPurge(true)}
        newVersion={newVersion}
      />
      <Toaster />
    </div>
  );
};


