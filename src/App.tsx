import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from '@/components/ui/custom/Header';
import { BottomNav } from '@/components/ui/custom/BottomNav';
import { HomeView } from '@/views/customer/HomeView';
const CartView = React.lazy(() => import('@/views/customer/CartView').then(m => ({ default: m.CartView })));
const ProductView = React.lazy(() => import('@/views/customer/ProductView').then(m => ({ default: m.ProductView })));
const CheckoutView = React.lazy(() => import('@/views/customer/CheckoutView').then(m => ({ default: m.CheckoutView })));
const NotificationsView = React.lazy(() => import('@/views/customer/NotificationsView').then(m => ({ default: m.NotificationsView })));
const OrderSuccessView = React.lazy(() => import('@/views/customer/OrderSuccessView').then(m => ({ default: m.OrderSuccessView })));
const ProfileView = React.lazy(() => import('@/views/customer/ProfileView').then(m => ({ default: m.ProfileView })));

// --- LAZY LOADED ADMIN VIEWS ---
import { cn } from '@/lib/utils';
const AdminDashboard = React.lazy(() => import('@/views/admin/AdminDashboardView').then(m => ({ default: m.AdminDashboardView })));
const AdminProducts = React.lazy(() => import('@/views/admin/AdminProductsView').then(m => ({ default: m.default })));
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
import { StoreProvider, useStore } from '@/contexts/StoreContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { CartProvider } from '@/contexts/CartContext';
import { useCart } from '@/hooks/useCart';
import { HelmetProvider } from 'react-helmet-async';
import { haptic } from '@/utils/haptic';
import type { View, Product } from '@/types';
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
    <HelmetProvider>
      <StoreProvider>
        <AuthProvider>
          <NotificationProvider>
            <CartProvider>
              <AppContent />
            </CartProvider>
          </NotificationProvider>
        </AuthProvider>
      </StoreProvider>
    </HelmetProvider>
  );
}

const getProductById = (products: Product[], id: string) => products.find(p => p.id === id);

const AppContent = () => {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const { products, loading: productsLoading } = useProducts();
  const { cart, addToCart, getCartCount, getCartTotal, clearCart, updateQuantity, removeFromCart } = useCart();
  const { favorites, toggleFavorite } = useFavorites();
  const { calculateShipping } = useStore();
  const { addToRecentlyViewed, getRecentlyViewedProducts } = useRecentlyViewed();
  const recentlyViewedProducts = React.useMemo(() => getRecentlyViewedProducts(products), [getRecentlyViewedProducts, products]);

  const { setBadge, clearBadge } = useAppBadge();
  const { checkUpdate, updateAvailable, newVersion, performNuclearPurge } = useUpdateCheck();

  const [currentView, setCurrentView] = useState<View>('home');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [backOverride, setBackOverride] = useState<(() => void) | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const backOverrideRef = useRef<(() => void) | null>(null);
  const isTransitioningRef = useRef(false);

  // Sync ref with state to avoid listener closure issues
  useEffect(() => {
    backOverrideRef.current = backOverride;
  }, [backOverride]);

  const handleNavigate = useCallback((view: View, id?: string) => {
    if (isTransitioningRef.current && currentView !== view) {
      // Exceções para redirecionamentos programáticos críticos (Auth e Fallbacks)
      if (!['auth', 'login', 'home'].includes(view)) {
        console.warn(`[App] Navigation to ${view} throttled to prevent animation race conditions`);
        return;
      }
    }

    if (currentView !== view) {
      isTransitioningRef.current = true;
      setTimeout(() => {
        isTransitioningRef.current = false;
      }, 300); // 200ms framer duration + 100ms safe buffer
    }

    const fromView = currentView;
    setSelectedProductId(id || null);
    setCurrentView(view);
    setBackOverride(null); // Reset override on navigation


    // Sync URL without full reload
    const path = view === 'home' ? '/' : `/${view}`;
    if (globalThis.location.pathname !== path) {
      globalThis.history.pushState({ view, id, from: fromView }, '', path);
    }

    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [currentView]);


  const handleProductClick = useCallback((productId: string) => {
    handleNavigate('product-detail', productId);
    addToRecentlyViewed(productId);
    haptic.light();
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [handleNavigate, addToRecentlyViewed]);

  const handleBack = useCallback(() => {
    haptic.light();

    // Standard behavior: just trigger browser back.
    // This fires the 'popstate' event which is handled centraly in syncWithUrl useEffect.
    // This ensures UI buttons and browser buttons stay perfectly in sync.
    globalThis.history.back();
    globalThis.scrollTo(0, 0);
  }, []);


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

    // Scroll tracking for HomeView and header components
    const mainElement = document.querySelector('main');
    const handleScroll = () => {
      if (!mainElement) return;
      const progress = mainElement.scrollTop;
      setScrollProgress(prev => {
        // Optimize: Only re-render if crossing the 20px threshold!
        const currentlyScrolled = progress > 20;
        const prevScrolled = prev > 20;
        
        if (currentlyScrolled && !prevScrolled) return 21; // Any number > 20
        if (!currentlyScrolled && prevScrolled) return 0;  // Any number <= 20
        return prev; // No rendering triggering
      });
    };

    if (mainElement) {
      mainElement.addEventListener('scroll', handleScroll, { passive: true });
    }

    globalThis.addEventListener('orientationchange', handleOrientation);
    return () => {
      clearTimeout(timer);
      globalThis.removeEventListener('orientationchange', handleOrientation);
      if (mainElement) {
        mainElement.removeEventListener('scroll', handleScroll);
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
      let path = globalThis.location.pathname.slice(1) || 'home';
      // Normalize path (remove trailing slashes)
      path = path.replace(/\/$/, '');
      if (!path) path = 'home';

      // Basic validation of view name
      const validViews: View[] = [
        'home', 'cart', 'product-detail', 'checkout', 'profile', 'admin', 'search', 'auth', 'login', 'favorites',
        'notifications', 'order-success', 'orders', 'order-details', 'recently-viewed', 'compare', 'account-settings',
        'admin-dashboard', 'admin-products', 'admin-product-form', 'admin-orders', 'admin-coupons', 'admin-banners',
        'admin-settings', 'admin-reviews', 'admin-qa', 'admin-customers', 'admin-user-detail', 'admin-push', 'address-form'
      ];
      if (validViews.includes(path as View)) {
        setCurrentView(path as View);
        // Restore selected product ID if it's in the history state
        const stateId = globalThis.history.state?.id;
        if (stateId) {
          setSelectedProductId(stateId);
        } else if (path !== 'product-detail' && path !== 'order-details' && path !== 'admin-product-form' && path !== 'admin-user-detail') {
          // Clear selected product if we moved away from a detail view and have no state
          setSelectedProductId(null);
        }

        // History Trap for Home: If we are on home and this is the last entry, 
        // push a fake one to prevent closing the app on back button
        if (path === 'home' && !globalThis.history.state?.trap) {
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
        const path = currentView === 'home' ? '/' : `/${currentView}`;
        globalThis.history.pushState(globalThis.history.state || { view: currentView }, '', path);
        return;
      }
      
      isTransitioningRef.current = true;
      setTimeout(() => {
        isTransitioningRef.current = false;
      }, 300);

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

      // 3. Sync state with current URL
      syncWithUrl();
    };

    globalThis.addEventListener('popstate', handlePopState);
    
    return () => {
      globalThis.removeEventListener('popstate', handlePopState);
    };
  }, [currentView]);

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

  // Reset scroll on view change
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTop = 0;
    }
  }, [currentView]);


  // Sync PWA Badge with cart count
  useEffect(() => {
    const count = getCartCount();
    if (count > 0) {
      setBadge(count);
    } else {
      clearBadge();
    }
  }, [getCartCount, setBadge, clearBadge]);

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
    switch (currentView) {
      case 'admin-dashboard':
      case 'admin':
        return <AdminDashboard onNavigate={handleNavigate} />;
      case 'admin-products':
        return <AdminProducts onNavigate={handleNavigate} />;
      case 'admin-product-form':
        return (
          <AdminProductForm
            productId={selectedProductId || undefined}
            onNavigate={handleNavigate}
          />
        );
      case 'admin-orders':
        return <AdminOrders onNavigate={handleNavigate} />;
      case 'admin-coupons':
        return <AdminCoupons onNavigate={handleNavigate} />;
      case 'admin-banners':
        return <AdminBanners onNavigate={handleNavigate} />;
      case 'admin-settings':
        return <AdminSettings onNavigate={handleNavigate} />;
      case 'admin-reviews':
        return <AdminReviews onNavigate={handleNavigate} />;
      case 'admin-qa':
        return <AdminQA onNavigate={handleNavigate} />;
      case 'admin-customers':
        return <AdminCustomers onNavigate={handleNavigate} />;
      case 'admin-user-detail':
        return (
          <AdminUserDetail
            userId={selectedProductId || ''}
            onBack={() => handleNavigate('admin-customers')}
            onNavigate={handleNavigate}
          />
        );
      default:
        return <AdminPush onNavigate={handleNavigate} />;
    }
  };

  const renderView = () => {
    if (authLoading) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
          <div className="w-12 h-12 border-4 border-zinc-900 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-muted-foreground animate-pulse font-medium">Carregando marketplace...</p>
        </div>
      );
    }

    const adminViews: View[] = [
      'admin', 'admin-dashboard', 'admin-products', 'admin-product-form',
      'admin-orders', 'admin-coupons', 'admin-banners', 'admin-settings',
      'admin-reviews', 'admin-qa', 'admin-customers', 'admin-user-detail', 'admin-push'
    ];

    if (adminViews.includes(currentView)) {
      if (!isAdmin) return <AdminAccessDenied onNavigate={handleNavigate} />;

      return (
        <AdminLayout currentView={currentView} onNavigate={handleNavigate}>
          {renderAdminContent()}
        </AdminLayout>
      );
    }

    switch (currentView) {
      case 'cart':
        return (
          <CartView
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
          />
        );
      }
      case 'checkout': {
        const shipping = calculateShipping(cart);
        const subtotal = getCartTotal();
        return (
          <CheckoutView
            cart={cart}
            subtotal={subtotal}
            shipping={shipping}
            total={subtotal + shipping}
            onClearCart={clearCart}
            onNavigate={handleNavigate}
            onSetBackOverride={setBackOverride}
          />
        );
      }
      case 'profile':
        return (
          <ProfileView
            onNavigate={handleNavigate}
            onProductClick={handleProductClick}
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
            onSuccess={() => handleNavigate('profile')}
          />
        );

      case 'admin-login':
        return (
          <AdminLogin
            onLogin={() => handleNavigate('admin')}
            onNavigate={handleNavigate}
          />
        );

      case 'account-settings':
        return <AccountSettings />;

      case 'orders':
        return (
          <CartView
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
            orderId={selectedProductId || ''}
            onBack={() => handleNavigate('orders')}
            onNavigate={handleNavigate}
          />
        );

      case 'favorites':
        return (
          <FavoritesView
            favorites={favorites}
            onToggleFavorite={handleToggleFavorite}
            onProductClick={handleProductClick}
            onNavigate={handleNavigate}
          />
        );

      case 'recently-viewed':
        return (
          <RecentlyViewedView
            products={recentlyViewedProducts}
            favorites={favorites.map(f => f.id)}
            onToggleFavorite={handleToggleFavorite}
            onProductClick={handleProductClick}
            onNavigate={handleNavigate}
            onClear={() => { }}
          />
        );

      case 'address-form':
        return <AddressFormView addressId={selectedProductId} onBack={handleBack} />;

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
          />
        );
      case 'home':
      default:
        return (
          <HomeView
            products={products}
            favorites={favorites.map(p => p.id)}
            recentlyViewedProducts={recentlyViewedProducts}
            onToggleFavorite={handleToggleFavorite}
            onProductClick={handleProductClick}
            onNavigate={handleNavigate}
            searchQuery={searchQuery}
            onAddToCart={handleAddToCart}
            onQuickBuy={handleQuickBuy}
            scrollProgress={scrollProgress}
            isLoading={productsLoading}
          />
        );

    }
  };

  return (
    <div className="flex flex-col h-[100dvh] w-screen overflow-hidden bg-white">
      {!currentView.startsWith('admin') && (
        <div className="flex-shrink-0">
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
            onOpenNotifications={() => handleNavigate('notifications')}
            hideSearch={['address-form', 'account-settings', 'order-details', 'checkout'].includes(currentView)}
            searchQuery={searchQuery}
            onSearch={setSearchQuery}
            scrollProgress={scrollProgress}
          />
        </div>
      )}

      <main
        ref={mainRef}
        className={cn(
          "flex-1 flex flex-col overflow-y-auto overflow-x-hidden overscroll-behavior-y-contain [-webkit-overflow-scrolling:touch]",
          currentView.startsWith('admin') && "h-full pt-0"
        )}
      >
        <AnimatePresence mode="wait">
          <div 
            key={currentView.startsWith('admin') ? 'admin-layout' : currentView}
            className={cn(!currentView.startsWith('admin') && "h-full", "!outline-none focus:!outline-none")}
            tabIndex={-1}
            style={{ WebkitTapHighlightColor: 'transparent', outline: 'none' }}
          >
            <React.Suspense fallback={<ViewLoadingFallback />}>
              {currentView.startsWith('admin') ? (
                <div>
                  {renderView()}
                </div>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="min-h-full flex flex-col"
                >
                  {renderView()}
                </motion.div>
              )}
            </React.Suspense>
          </div>
        </AnimatePresence>
      </main>

      {!currentView.startsWith('admin') && currentView !== 'order-success' && (
        <div className="flex-shrink-0">
          <BottomNav
            currentView={currentView}
            onNavigate={handleNavigate}
            cartCount={getCartCount()}
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
    </div>
  );
};


