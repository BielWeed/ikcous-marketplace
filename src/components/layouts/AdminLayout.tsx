import { Button } from "@/components/ui/button";
import { branding } from "@/config/branding";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useLeaderElection } from "@/hooks/useLeaderElection";
import { useConnectionDiagnostics } from "@/hooks/useOnlineStatus";
import { useOrders } from "@/hooks/useOrders";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { useProducts } from "@/hooks/useProducts";
import {
  isViewTransitionSupported,
  useViewTransition,
} from "@/hooks/useViewTransition";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import {
  prefetchBannersData,
  prefetchCouponsData,
  prefetchCustomersData,
  prefetchQAData,
  prefetchReviewsData,
} from "@/utils/admin_cache";
import { haptic } from "@/utils/haptic";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  ArrowLeft,
  Bell,
  Package,
  Settings,
  ShoppingBag,
  Users,
} from "lucide-react";
import React from "react";
import { Helmet } from "react-helmet-async";

interface AdminLayoutProps {
  children: React.ReactNode;
  currentView: View;
  onNavigate: (view: View) => void;
  onBack?: () => void;
}

export function AdminLayout({
  children,
  currentView,
  onNavigate,
  onBack,
}: AdminLayoutProps) {
  const { isSupported: isTransitionSupported } = useViewTransition();
  const { prefetchView } = usePrefetchOnHover();
  const { fetchExecutiveSummary, fetchCategoryAnalytics } = useAnalytics();
  const { loadProducts } = useProducts({ autoFetch: false });
  const { loadOrders } = useOrders(false, true);
  const { isLeader } = useLeaderElection();

  React.useEffect(() => {
    document.documentElement.classList.add("admin-mode");
    return () => {
      document.documentElement.classList.remove("admin-mode");
    };
  }, []);

  const [pendingOrdersCount, setPendingOrdersCount] = React.useState(0);
  const [pendingQuestionsCount, setPendingQuestionsCount] = React.useState(0);

  React.useEffect(() => {
    let isMounted = true;
    let ordersChannel: any = null;
    let questionsChannel: any = null;
    const bc =
      typeof window !== "undefined"
        ? new BroadcastChannel("ikcous_admin_layout_badges")
        : null;
    let bcListener: ((event: MessageEvent) => void) | null = null;

    const fetchInitialCounts = async () => {
      try {
        // Fetch pending orders count
        const { count: ordersCount, error: ordersErr } = await supabase
          .from("marketplace_orders")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending");

        if (!ordersErr && ordersCount !== null && isMounted) {
          setPendingOrdersCount(ordersCount);
        }

        // Fetch pending questions count
        const { data: qData, error: qErr } = await (supabase.rpc as any)(
          "get_admin_questions_paged",
          {
            p_search: "",
            p_filter: "pending",
            p_page: 0,
            p_page_size: 1,
          },
        );

        if (!qErr && qData && isMounted) {
          setPendingQuestionsCount(qData.total_count || 0);
        }
      } catch (err) {
        console.error("[AdminLayout] Error fetching initial counts:", err);
      }
    };

    const subscribe = () => {
      if (ordersChannel || questionsChannel) return; // already subscribed

      if (isLeader) {
        console.log("[AdminLayout] Leader tab subscribing to badge updates...");
        ordersChannel = supabase
          .channel("admin-layout-orders-badge")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "marketplace_orders" },
            () => {
              fetchInitialCounts();
              bc?.postMessage({ type: "badge_update" });
            },
          )
          .subscribe((status: any, err?: any) => {
            if (status === "CHANNEL_ERROR") {
              const isNormalClose =
                err?.message?.includes("1000") ||
                err?.message?.includes("normal") ||
                (typeof err === "string" &&
                  (err.includes("1000") || err.includes("normal")));
              if (isNormalClose) {
                console.log(
                  "[AdminLayout] Orders badge channel closed normally (socket closed: 1000)",
                );
              } else {
                console.error(
                  "[AdminLayout] Orders badge channel error:",
                  err?.message || err,
                );
              }
            }
          });

        questionsChannel = supabase
          .channel("admin-layout-questions-badge")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "questions" },
            () => {
              fetchInitialCounts();
              bc?.postMessage({ type: "badge_update" });
            },
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "answers" },
            () => {
              fetchInitialCounts();
              bc?.postMessage({ type: "badge_update" });
            },
          )
          .subscribe((status: any, err?: any) => {
            if (status === "CHANNEL_ERROR") {
              const isNormalClose =
                err?.message?.includes("1000") ||
                err?.message?.includes("normal") ||
                (typeof err === "string" &&
                  (err.includes("1000") || err.includes("normal")));
              if (isNormalClose) {
                console.log(
                  "[AdminLayout] Questions badge channel closed normally (socket closed: 1000)",
                );
              } else {
                console.error(
                  "[AdminLayout] Questions badge channel error:",
                  err?.message || err,
                );
              }
            }
          });
      } else {
        console.log(
          "[AdminLayout] Secondary tab listening to badge updates via BroadcastChannel...",
        );
        if (bc) {
          bcListener = (event: MessageEvent) => {
            if (event.data?.type === "badge_update") {
              console.log(
                "[AdminLayout-Secondary] Badge update received via BroadcastChannel",
              );
              fetchInitialCounts();
            }
          };
          bc.addEventListener("message", bcListener);
        }
      }
    };

    const unsubscribe = () => {
      if (ordersChannel) {
        supabase.removeChannel(ordersChannel);
        ordersChannel = null;
      }
      if (questionsChannel) {
        supabase.removeChannel(questionsChannel);
        questionsChannel = null;
      }
      if (bcListener && bc) {
        bc.removeEventListener("message", bcListener);
        bcListener = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchInitialCounts();
        subscribe();
      } else {
        unsubscribe();
      }
    };

    // Initial fetch and subscribe if visible
    if (document.visibilityState === "visible") {
      fetchInitialCounts();
      subscribe();
    }

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      isMounted = false;
      document.removeEventListener("visibilitychange", handleVisibility);
      unsubscribe();
      bc?.close();
    };
  }, [isLeader]);

  const handleHoverTab = React.useCallback(
    (view: string) => {
      if (
        view === currentView ||
        (view === "admin-dashboard" && currentView === "admin") ||
        (view === "admin" && currentView === "admin-dashboard")
      ) {
        return;
      }
      prefetchView(view);
      if (view === "admin-dashboard" || view === "admin") {
        fetchExecutiveSummary(false).catch(() => {});
        fetchCategoryAnalytics(
          "2020-01-01T00:00:00.000Z",
          new Date().toISOString(),
          false,
        ).catch(() => {});
      } else if (view === "admin-products") {
        loadProducts(0, 12, { silent: true }).catch(() => {});
        prefetchView("admin-coupons");
        prefetchView("admin-banners");
        prefetchCouponsData().catch(() => {});
        prefetchBannersData().catch(() => {});
      } else if (view === "admin-orders") {
        loadOrders(0, 12, "all", "", "", "", true).catch(() => {});
        prefetchView("admin-reviews");
        prefetchView("admin-qa");
        prefetchReviewsData().catch(() => {});
        prefetchQAData().catch(() => {});
      } else if (view === "admin-customers") {
        prefetchCustomersData().catch(() => {});
      } else if (view === "admin-settings") {
        // No longer prefetch coupons, banners, reviews, or QA from settings view
      }
    },
    [
      currentView,
      prefetchView,
      fetchExecutiveSummary,
      fetchCategoryAnalytics,
      loadProducts,
      loadOrders,
    ],
  );

  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const handleMouseEnter = React.useCallback(
    (view: string, isImmediate = false) => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }

      if (isImmediate) {
        handleHoverTab(view);
        return;
      }

      hoverTimerRef.current = setTimeout(() => {
        handleHoverTab(view);
        hoverTimerRef.current = null;
      }, 250);
    },
    [handleHoverTab],
  );

  const handleMouseLeave = React.useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    // Close any open Radix UI dropdowns/popovers/dialogs on view transitions
    // by dispatching Escape key event to window/document/activeElement.
    // We use a small timeout to let the view transition and focus change settle.
    const timer = setTimeout(() => {
      console.debug(
        `[AdminLayout] currentView changed to: ${currentView}. Dispatching Escape events after timeout...`,
      );
      const dispatchEscape = (target: any, name: string) => {
        if (!target) return;
        const escapeEvent = new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(escapeEvent);
        console.debug(`[AdminLayout] Dispatched Escape to: ${name}`);
      };

      dispatchEscape(document.activeElement, "activeElement");
      dispatchEscape(document, "document");
      dispatchEscape(window, "window");
    }, 50);

    return () => clearTimeout(timer);
  }, [currentView]);

  const isMainTab = [
    "admin-dashboard",
    "admin",
    "admin-products",
    "admin-orders",
    "admin-customers",
    "admin-settings",
  ].includes(currentView);

  const navItems = [
    { icon: Activity, label: "Geral", view: "admin-dashboard" },
    { icon: Package, label: "Pedidos", view: "admin-orders" },
    { icon: ShoppingBag, label: "Produtos", view: "admin-products" },
    { icon: Users, label: "Clientes", view: "admin-customers" },
    { icon: Settings, label: "Ajustes", view: "admin-settings" },
  ];

  const { isOffline, latency, quality } = useConnectionDiagnostics();
  const [showSyncFlash, setShowSyncFlash] = React.useState(false);
  const prevOfflineRef = React.useRef(isOffline);

  React.useEffect(() => {
    if (prevOfflineRef.current && !isOffline) {
      setShowSyncFlash(true);
      const timer = setTimeout(() => {
        setShowSyncFlash(false);
      }, 4000);
      return () => clearTimeout(timer);
    }
    prevOfflineRef.current = isOffline;
  }, [isOffline]);

  const [isKeyboardOpen, setIsKeyboardOpen] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const viewport = window.visualViewport;
    if (!viewport) return;

    let rafId: number;
    const handleResize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const activeEl = document.activeElement;
        const isInputActive =
          activeEl &&
          ((activeEl.tagName === "INPUT" &&
            ![
              "button",
              "submit",
              "checkbox",
              "radio",
              "file",
              "image",
              "range",
              "hidden",
            ].includes(activeEl.getAttribute("type") || "")) ||
            activeEl.tagName === "TEXTAREA" ||
            activeEl.getAttribute("contenteditable") === "true");
        const keyboardActive =
          isInputActive && viewport.height < window.innerHeight * 0.85;
        setIsKeyboardOpen(!!keyboardActive);
      });
    };

    viewport.addEventListener("resize", handleResize);
    return () => {
      cancelAnimationFrame(rafId);
      viewport.removeEventListener("resize", handleResize);
    };
  }, []);

  const isOrderDetailsSubView =
    currentView === "admin-orders" &&
    typeof globalThis !== "undefined" &&
    globalThis.location &&
    new URLSearchParams(globalThis.location.search).has("id");

  const getParentView = (view: View): View | "profile" => {
    if (isOrderDetailsSubView) {
      return "admin-orders";
    }
    switch (view) {
      case "admin-product-form":
      case "admin-coupons":
      case "admin-banners":
        return "admin-products";
      case "admin-user-detail":
        return "admin-customers";
      case "admin-push":
        return "admin-dashboard";
      case "admin-reviews":
      case "admin-qa":
        return "admin-orders";
      default:
        return "profile";
    }
  };

  const parentView = getParentView(currentView);
  const isSubView = parentView !== "profile" || isOrderDetailsSubView;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#09090b] font-sans text-zinc-50 lg:flex-row">
      <Helmet>
        <title>{branding.appName} | Admin Dashboard</title>
        <meta
          name="description"
          content="Sistema de navegação unificada e operação."
        />
        <meta property="og:title" content={`${branding.appName} Admin`} />
      </Helmet>

      {/* Desktop Sidebar */}
      <aside
        className="z-50 hidden w-64 flex-shrink-0 flex-col justify-between border-r border-white/5 bg-[#09090b]/80 p-6 backdrop-blur-xl lg:flex"
        style={
          {
            viewTransitionName: isViewTransitionSupported
              ? "admin-sidebar"
              : undefined,
          } as React.CSSProperties
        }
      >
        <div className="space-y-8">
          <div className="flex select-none flex-col">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-xl font-black leading-none tracking-tight text-white">
                IKCOUS <span className="text-admin-gold">Admin</span>
              </h1>
              <div
                className={cn(
                  "flex items-center gap-1.5 px-2 py-0.5 rounded-full border bg-zinc-950/80 border-white/5 select-none shrink-0 cursor-help transition-all duration-500",
                  showSyncFlash
                    ? "border-emerald-500/50 bg-emerald-500/10 shadow-[0_0_15px_rgba(16,185,129,0.2)] scale-105"
                    : "border-white/5",
                )}
                title={
                  isOffline
                    ? "Sem conexão com o servidor"
                    : showSyncFlash
                      ? "Sincronização concluída!"
                      : `Latência: ${latency}ms`
                }
              >
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full relative flex transition-colors duration-300",
                    isOffline
                      ? "bg-red-500"
                      : showSyncFlash
                        ? "bg-emerald-500"
                        : quality === "slow"
                          ? "bg-amber-500"
                          : quality === "good"
                            ? "bg-sky-500"
                            : "bg-emerald-500",
                  )}
                >
                  {!isOffline && (
                    <span
                      className={cn(
                        "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                        showSyncFlash
                          ? "bg-emerald-400"
                          : quality === "slow"
                            ? "bg-amber-400"
                            : quality === "good"
                              ? "bg-sky-400"
                              : "bg-emerald-400",
                      )}
                    />
                  )}
                </span>
                <span
                  className={cn(
                    "text-[7px] font-black uppercase tracking-widest transition-colors",
                    showSyncFlash ? "text-emerald-400" : "text-zinc-400",
                  )}
                >
                  {isOffline
                    ? "Offline"
                    : showSyncFlash
                      ? "Sincronizado"
                      : quality === "slow"
                        ? "Lento"
                        : "Online"}
                </span>
              </div>
            </div>
            <p className="mt-1.5 text-[9px] font-medium uppercase leading-none tracking-widest text-zinc-500">
              Navegação Unificada
            </p>
          </div>

          <nav className="flex flex-col gap-1.5">
            {navItems.map((item, idx) => {
              const Icon = item.icon;
              const isActive =
                currentView === item.view ||
                (item.view === "admin-dashboard" && currentView === "admin");

              return (
                <button
                  key={idx}
                  onClick={() => {
                    haptic.light();
                    onNavigate(item.view as View);
                  }}
                  onMouseEnter={() => handleMouseEnter(item.view)}
                  onMouseLeave={handleMouseLeave}
                  onTouchStart={() => handleMouseEnter(item.view, true)}
                  className={cn(
                    "flex items-center gap-3.5 px-4 py-3.5 rounded-2xl relative transition-[color,transform] duration-200 active:scale-95 group z-10 text-left font-black uppercase text-[10px] tracking-widest transform-gpu w-full",
                    isActive
                      ? "text-admin-gold"
                      : "text-zinc-500 hover:text-zinc-300",
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="admin-active-pill-desktop"
                      className="absolute inset-0 -z-10 rounded-2xl border border-white/5 bg-zinc-800/40 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_8px_16px_rgba(0,0,0,0.3)]"
                      style={
                        {
                          viewTransitionName: isViewTransitionSupported
                            ? "admin-active-pill-desktop"
                            : undefined,
                        } as React.CSSProperties
                      }
                      transition={{
                        type: "spring",
                        stiffness: 380,
                        damping: 30,
                      }}
                    />
                  )}
                  <Icon
                    className={cn(
                      "w-4.5 h-4.5 transition-transform group-hover:scale-105",
                      isActive && "scale-110",
                    )}
                  />
                  <span className="flex-grow">{item.label}</span>
                  {item.view === "admin-orders" && pendingOrdersCount > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[9px] font-black text-white shadow-[0_0_12px_rgba(239,68,68,0.4)] duration-200 animate-in zoom-in-95">
                      {pendingOrdersCount}
                    </span>
                  )}
                  {item.view === "admin-settings" &&
                    pendingQuestionsCount > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-admin-gold px-1.5 text-[9px] font-black text-black shadow-[0_0_12px_rgba(212,175,55,0.4)] duration-200 animate-in zoom-in-95">
                        {pendingQuestionsCount}
                      </span>
                    )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col gap-2 space-y-4 border-t border-white/5 pt-4">
          <Button
            variant="ghost"
            onClick={() => {
              haptic.light();
              if (onBack) {
                onBack();
              } else {
                onNavigate(parentView as View);
              }
            }}
            onMouseEnter={() => handleMouseEnter(parentView as any)}
            onMouseLeave={handleMouseLeave}
            className="flex h-11 w-full transform-gpu items-center justify-start gap-3 rounded-2xl border border-white/5 bg-zinc-900/60 px-4 py-3.5 text-[10px] font-bold uppercase tracking-widest text-white transition-[background-color,transform] duration-200 hover:bg-zinc-800 hover:text-white active:scale-95"
          >
            <ArrowLeft className="size-4 text-zinc-400" />{" "}
            <span>{isSubView ? "Voltar" : "Perfil"}</span>
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              haptic.light();
              onNavigate("admin-push");
            }}
            onMouseEnter={() => handleMouseEnter("admin-push")}
            onMouseLeave={handleMouseLeave}
            className="flex h-11 w-full transform-gpu items-center justify-start gap-3 rounded-2xl border border-white/5 bg-zinc-900/60 px-4 py-3.5 text-[10px] font-bold uppercase tracking-widest text-white transition-[background-color,transform] duration-200 hover:bg-zinc-800 hover:text-white active:scale-95"
          >
            <Bell className="size-4 text-admin-gold" /> <span>Push</span>
          </Button>
        </div>
      </aside>

      {/* Main Area Wrapper */}
      <div className="relative flex h-full flex-1 flex-col overflow-hidden">
        {/* Offline Alert Banner */}
        {isOffline && (
          <div className="relative z-[70] flex shrink-0 select-none items-center justify-center gap-2 border-b border-red-500/20 bg-red-500/10 px-6 py-2.5 text-center text-[10px] font-black uppercase tracking-widest text-red-400 duration-300 animate-in fade-in slide-in-from-top">
            <span className="size-1.5 animate-pulse rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
            <span>
              Conexão perdida. Criação, edição e exclusão de dados estão
              temporariamente bloqueadas.
            </span>
          </div>
        )}

        {/* Premium Header - Mobile Only */}
        <header
          className="relative top-0 z-50 flex-shrink-0 border-b border-white/5 bg-[#09090b]/80 px-6 py-4 backdrop-blur-xl md:py-6 lg:hidden"
          style={
            {
              viewTransitionName: isViewTransitionSupported
                ? "admin-header"
                : undefined,
            } as React.CSSProperties
          }
        >
          <div className="relative mx-auto flex h-10 max-w-7xl items-center justify-between md:h-12">
            {/* Left: Profile or Back Button */}
            <div className="absolute left-0">
              <Button
                variant="ghost"
                onClick={() => {
                  haptic.light();
                  if (onBack) {
                    onBack();
                  } else {
                    onNavigate(parentView as View);
                  }
                }}
                onMouseEnter={() => handleMouseEnter(parentView as any)}
                onMouseLeave={handleMouseLeave}
                className="flex transform-gpu items-center gap-2 rounded-full border border-white/5 bg-zinc-900 px-3 text-[10px] font-bold uppercase tracking-widest text-white transition-[background-color,transform] duration-200 hover:bg-zinc-800 active:scale-95 md:px-4 md:text-xs"
              >
                <ArrowLeft className="size-4" />{" "}
                <span className="inline">
                  {isSubView ? "Voltar" : "Perfil"}
                </span>
              </Button>
            </div>

            {/* Center: Logo */}
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <div className="flex items-center justify-center gap-1.5">
                <h1 className="text-xl font-black leading-none tracking-tight text-white md:text-2xl">
                  IKCOUS <span className="text-admin-gold">Admin</span>
                </h1>
                <div
                  className={cn(
                    "flex items-center gap-1 px-1.5 py-0.5 rounded-full border bg-zinc-950/80 border-white/5 select-none shrink-0 cursor-help transition-all duration-500",
                    showSyncFlash
                      ? "border-emerald-500/50 bg-emerald-500/10 shadow-[0_0_12px_rgba(16,185,129,0.2)] scale-105"
                      : "border-white/5",
                  )}
                  title={
                    isOffline
                      ? "Offline"
                      : showSyncFlash
                        ? "Sincronizado"
                        : `Latência: ${latency}ms`
                  }
                >
                  <span
                    className={cn(
                      "w-1 h-1 rounded-full relative flex transition-colors duration-300",
                      isOffline
                        ? "bg-red-500"
                        : showSyncFlash
                          ? "bg-emerald-500"
                          : quality === "slow"
                            ? "bg-amber-500"
                            : quality === "good"
                              ? "bg-sky-500"
                              : "bg-emerald-500",
                    )}
                  >
                    {!isOffline && (
                      <span
                        className={cn(
                          "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                          showSyncFlash
                            ? "bg-emerald-400"
                            : quality === "slow"
                              ? "bg-amber-400"
                              : quality === "good"
                                ? "bg-sky-400"
                                : "bg-emerald-400",
                        )}
                      />
                    )}
                  </span>
                  <span
                    className={cn(
                      "text-[6.5px] font-black uppercase tracking-widest transition-colors",
                      showSyncFlash ? "text-emerald-400" : "text-zinc-400",
                    )}
                  >
                    {isOffline
                      ? "Off"
                      : showSyncFlash
                        ? "Sync"
                        : quality === "slow"
                          ? "Slow"
                          : "On"}
                  </span>
                </div>
              </div>
              <p className="mt-1 text-[9px] font-medium uppercase leading-none tracking-widest text-zinc-500 md:text-xs">
                Navegação Unificada
              </p>
            </div>

            {/* Right: Notifications */}
            <div className="absolute right-0">
              <Button
                variant="ghost"
                size="icon"
                className="relative transform-gpu rounded-full border border-white/5 bg-zinc-900 hover:bg-zinc-800 active:scale-95"
                onClick={() => {
                  haptic.light();
                  onNavigate("admin-push");
                }}
                onMouseEnter={() => handleMouseEnter("admin-push")}
                onMouseLeave={handleMouseLeave}
              >
                <Bell className="size-5 text-admin-gold" />
                {(pendingOrdersCount > 0 || pendingQuestionsCount > 0) && (
                  <span className="absolute right-1.5 top-1.5 size-2 animate-pulse rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
                )}
              </Button>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main
          className="gpu-accelerated w-full flex-1 overflow-hidden bg-[#09090b]"
          style={
            {
              viewTransitionName: isViewTransitionSupported
                ? "admin-content"
                : undefined,
            } as React.CSSProperties
          }
        >
          <div
            className="relative mx-auto flex size-full max-w-7xl flex-col overflow-hidden py-0"
            style={{ contain: "layout paint style" } as React.CSSProperties}
          >
            {(() => {
              // Using isTransitionSupported from parent scope

              if (isTransitionSupported) {
                return (
                  <div key="admin-content-wrapper" className="size-full">
                    {children}
                  </div>
                );
              }
              return (
                <AnimatePresence mode="wait">
                  <motion.div
                    key="admin-content-wrapper-motion"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    className="size-full"
                  >
                    {children}
                  </motion.div>
                </AnimatePresence>
              );
            })()}
          </div>
        </main>

        {/* Floating Bottom Navigation - Mobile Only */}
        <div className="relative z-[60] flex-shrink-0 lg:hidden">
          <AnimatePresence>
            {isMainTab && !isKeyboardOpen && (
              <motion.nav
                initial={{ y: 120, x: "-50%", opacity: 0 }}
                animate={{ y: 0, x: "-50%", opacity: 1 }}
                exit={{ y: 120, x: "-50%", opacity: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 28 }}
                className="admin-glass fixed left-1/2 flex w-[90%] max-w-lg items-center justify-between rounded-[2rem] border border-white/10 bg-zinc-900/80 p-2 shadow-[0_20px_40px_rgba(0,0,0,0.8)] backdrop-blur-2xl"
                style={
                  {
                    bottom:
                      "calc(0.75rem + var(--safe-area-bottom-fixed, env(safe-area-inset-bottom, 0px)) * 0.5)",
                    viewTransitionName: isViewTransitionSupported
                      ? "admin-bottom-nav"
                      : undefined,
                  } as React.CSSProperties
                }
              >
                {navItems.map((item, idx) => {
                  const Icon = item.icon;
                  const isActive =
                    currentView === item.view ||
                    (item.view === "admin-dashboard" &&
                      currentView === "admin");

                  return (
                    <button
                      key={idx}
                      onClick={() => {
                        haptic.light();
                        onNavigate(item.view as View);
                      }}
                      onMouseEnter={() => handleMouseEnter(item.view)}
                      onMouseLeave={handleMouseLeave}
                      onTouchStart={() => handleMouseEnter(item.view, true)}
                      className={cn(
                        "flex flex-col items-center gap-0.5 sm:gap-1 flex-1 py-2.5 rounded-2xl relative transition-[color,transform] duration-200 active:scale-95 group z-10 transform-gpu",
                        isActive
                          ? "text-admin-gold"
                          : "text-zinc-500 hover:text-zinc-300",
                      )}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="admin-active-pill-mobile"
                          className="absolute inset-0 rounded-2xl border border-white/10 bg-zinc-800/60 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_8px_16px_rgba(0,0,0,0.4)]"
                          style={
                            {
                              zIndex: -1,
                              viewTransitionName: isViewTransitionSupported
                                ? "admin-active-pill-mobile"
                                : undefined,
                            } as React.CSSProperties
                          }
                          transition={{
                            type: "spring",
                            stiffness: 380,
                            damping: 30,
                          }}
                        />
                      )}
                      <Icon
                        className={cn(
                          "w-5 h-5 transition-transform group-hover:-translate-y-0.5",
                          isActive && "scale-110",
                        )}
                      />
                      {item.view === "admin-orders" &&
                        pendingOrdersCount > 0 && (
                          <span className="absolute right-2 top-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-black text-white shadow-[0_0_8px_rgba(239,68,68,0.5)]">
                            {pendingOrdersCount}
                          </span>
                        )}
                      {item.view === "admin-settings" &&
                        pendingQuestionsCount > 0 && (
                          <span className="absolute right-2 top-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-admin-gold px-1 text-[8px] font-black text-black shadow-[0_0_8px_rgba(212,175,55,0.5)]">
                            {pendingQuestionsCount}
                          </span>
                        )}
                      <span
                        className={cn(
                          "text-[9px] font-black uppercase tracking-tighter transition-all hidden sm:inline-block",
                          isActive ? "opacity-100" : "opacity-60",
                        )}
                      >
                        {item.label}
                      </span>
                      {isActive && (
                        <span
                          className="mt-0.5 size-1.5 rounded-full bg-admin-gold duration-300 animate-in zoom-in sm:hidden"
                          style={
                            {
                              viewTransitionName: isViewTransitionSupported
                                ? "admin-active-dot-mobile"
                                : undefined,
                            } as React.CSSProperties
                          }
                        />
                      )}
                    </button>
                  );
                })}
              </motion.nav>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
