import { AdminLayout } from "@/components/layouts/AdminLayout";
import { LocalErrorBoundary } from "@/components/ui/custom/LocalErrorBoundary";
import { useDeferredRender } from "@/hooks/useDeferredRender";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import { PreloadedOrLazy, lazyWithPreload } from "@/utils/lazyWithPreload";
import { AnimatePresence, motion } from "framer-motion";
import React, { useState, useEffect } from "react";

// --- LAZY LOADED ADMIN VIEWS ---
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
const AdminCouponForm = lazyWithPreload(() =>
  import("@/views/admin/AdminCouponFormView").then((m) => ({
    default: m.AdminCouponFormView,
  })),
);
const AdminBanners = lazyWithPreload(() =>
  import("@/views/admin/AdminBannersView").then((m) => ({
    default: m.AdminBannersView,
  })),
);
const AdminCarousels = lazyWithPreload(() =>
  import("@/views/admin/AdminCarouselsView").then((m) => ({
    default: m.AdminCarouselsView,
  })),
);
const AdminShipping = lazyWithPreload(() =>
  import("@/views/admin/AdminShippingView").then((m) => ({
    default: m.AdminShippingView,
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
const AdminWhatsAppConfig = lazyWithPreload(() =>
  import("@/views/admin/AdminWhatsAppConfigView").then((m) => ({
    default: m.AdminWhatsAppConfigView,
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
        "w-full h-full overflow-y-auto overflow-x-hidden admin-scroll-container scroll-smooth absolute top-0 left-0 admin-tab-pane",
        positionClass,
        active ? "active-scroll-container" : "",
      )}
    >
      {children}
    </div>
  );
}

export function AdminViewLoadingFallback({ view }: { readonly view?: string }) {
  const isReady = useDeferredRender(150);
  const isDashboard = view === "admin-dashboard" || view === "admin";

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
  else if (view === "admin-coupon-form") title = "Campanha";
  else if (view === "admin-banners") title = "Banners";
  else if (view === "admin-carousels") title = "Vitrines";
  else if (view === "admin-shipping") title = "Frete";
  else if (view === "admin-reviews") title = "Avaliações";
  else if (view === "admin-qa") title = "Suporte Q&A";
  else if (view === "admin-push") title = "Notificações";
  else if (view === "admin-product-form") title = "Produto";
  else if (view === "admin-user-detail") title = "Detalhes";

  if (isDashboard) {
    return (
      <div className="size-full select-none bg-[#09090b] pb-28 text-white lg:pb-10">
        <div className="flex items-center justify-between gap-4 px-6 pb-2 pt-6">
          <h1 className="flex shrink-0 select-none items-center gap-3 text-2xl font-black uppercase leading-none tracking-tighter md:text-3xl">
            <span className="flex flex-nowrap items-baseline whitespace-nowrap">
              <span className="italic text-white">{title}</span>
            </span>
          </h1>
          <div className="premium-shimmer h-10 w-32 rounded-2xl" />
        </div>
        <div className="mt-6 space-y-6 px-4 sm:space-y-12">
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
          <div className="px-0 sm:px-6">
            <div className="grid h-[220px] grid-cols-1 gap-6 md:grid-cols-2">
              <div className="premium-shimmer rounded-[2rem] border border-white/[0.04] bg-zinc-950 p-6" />
              <div className="premium-shimmer rounded-[2rem] border border-white/[0.04] bg-zinc-950 p-6" />
            </div>
          </div>
          <div className="h-[350px] rounded-[2rem] border border-white/[0.04] bg-zinc-950 p-6">
            <div className="premium-shimmer mb-6 h-6 w-48 rounded-lg" />
            <div className="premium-shimmer h-4/5 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="size-full select-none bg-[#09090b] pb-28 text-white lg:pb-10">
      <div className="flex items-center justify-between gap-4 px-6 pb-2 pt-6">
        <h1 className="flex shrink-0 select-none items-center gap-3 text-2xl font-black uppercase leading-none tracking-tighter md:text-3xl">
          <span className="flex flex-nowrap items-baseline whitespace-nowrap">
            <span className="italic text-white">{title}</span>
          </span>
        </h1>
        <div className="premium-shimmer h-10 w-32 rounded-2xl" />
      </div>
      <div className="mt-6 px-6">
        <div className="h-[400px] rounded-[2rem] border border-white/[0.04] bg-zinc-950 p-6">
          <div className="premium-shimmer mb-6 h-6 w-48 rounded-lg" />
          <div className="premium-shimmer h-4/5 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

interface AdminAreaProps {
  readonly currentView: View;
  readonly onNavigate: (
    view: View,
    id?: string,
    bypassDirtyCheck?: boolean,
  ) => void;
  readonly selectedProductId: string | null;
  readonly setIsAdminDirty: (dirty: boolean) => void;
  readonly setBackOverride: (fn: (() => void) | null) => void;
  readonly handleAdminUserDetailBack: () => void;
  readonly backOverride: (() => void) | null;
  readonly isTransitionSupported: boolean;
}

export function AdminArea({
  currentView,
  onNavigate,
  selectedProductId,
  setIsAdminDirty,
  setBackOverride,
  handleAdminUserDetailBack,
  backOverride,
  isTransitionSupported,
}: AdminAreaProps) {
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

  const renderAdminContent = () => {
    return (
      <div className="admin-area relative size-full overflow-hidden">
        {/* Main Tabs Container */}
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
                      onNavigate: onNavigate,
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
                      onNavigate: onNavigate,
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
                      onNavigate: onNavigate,
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
                      onNavigate: onNavigate,
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
                      onNavigate: onNavigate,
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
                      onNavigate: onNavigate,
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
                      onNavigate: onNavigate,
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
                      onNavigate: onNavigate,
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
                      onNavigate: onNavigate,
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
                      onNavigate: onNavigate,
                      active: currentView === "admin-settings",
                      onSetDirty: setIsAdminDirty,
                    }}
                  />
                </DeferredTabContent>
              </LocalErrorBoundary>
            </TabWrapper>
          </motion.div>
        )}

        {/* Secondary Views */}
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
              className="admin-scroll-container active-scroll-container absolute left-0 top-0 size-full overflow-y-auto scroll-smooth"
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
                            onNavigate: onNavigate,
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
                            onNavigate: onNavigate,
                            active: currentView === "admin-coupons",
                          }}
                        />
                      </LocalErrorBoundary>
                    );
                  case "admin-coupon-form":
                    return (
                      <LocalErrorBoundary key="admin-coupon-form">
                        <PreloadedOrLazy
                          component={AdminCouponForm}
                          props={{
                            couponId: selectedProductId || undefined,
                            onNavigate: onNavigate,
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
                            onNavigate: onNavigate,
                            active: currentView === "admin-banners",
                            onSetDirty: setIsAdminDirty,
                            onSetBackOverride: setBackOverride,
                          }}
                        />
                      </LocalErrorBoundary>
                    );
                  case "admin-carousels":
                    return (
                      <LocalErrorBoundary key="admin-carousels">
                        <PreloadedOrLazy
                          component={AdminCarousels}
                          props={{
                            onNavigate: onNavigate,
                            active: currentView === "admin-carousels",
                            onSetDirty: setIsAdminDirty,
                          }}
                        />
                      </LocalErrorBoundary>
                    );
                  case "admin-shipping":
                    return (
                      <LocalErrorBoundary key="admin-shipping">
                        <PreloadedOrLazy
                          component={AdminShipping}
                          props={{
                            onNavigate: onNavigate,
                            active: currentView === "admin-shipping",
                            onSetDirty: setIsAdminDirty,
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
                            onNavigate: onNavigate,
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
                            onNavigate: onNavigate,
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
                            onNavigate: onNavigate,
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
                            onNavigate: onNavigate,
                            targetUserId: selectedProductId || undefined,
                            onSetDirty: setIsAdminDirty,
                          }}
                        />
                      </LocalErrorBoundary>
                    );
                  case "admin-whatsapp-config":
                    return (
                      <LocalErrorBoundary key="admin-whatsapp-config">
                        <PreloadedOrLazy
                          component={AdminWhatsAppConfig}
                          props={{
                            active: currentView === "admin-whatsapp-config",
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

  return (
    <AdminLayout
      currentView={currentView}
      onNavigate={onNavigate}
      onBack={backOverride || undefined}
    >
      <React.Suspense
        fallback={<AdminViewLoadingFallback view={currentView} />}
      >
        {renderAdminContent()}
      </React.Suspense>
    </AdminLayout>
  );
}

export default AdminArea;
