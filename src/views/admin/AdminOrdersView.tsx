import { LazyImage } from "@/components/LazyImage";
import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import {
  AdminKpiCarousel,
  type KpiCardConfig,
} from "@/components/admin/AdminKpiCarousel";
import { DebouncedSearchInput } from "@/components/admin/DebouncedSearchInput";
import { SupportBanners } from "@/components/admin/dashboard/SupportBanners";
import { OrderDetail } from "@/components/admin/orders/OrderDetail";
import {
  OrderStatusBadge,
  statusConfig,
} from "@/components/admin/orders/OrderStatusBadge";
import { Button } from "@/components/ui/button";
import { LocalErrorBoundary } from "@/components/ui/custom/LocalErrorBoundary";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { branding } from "@/config/branding";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useOrders } from "@/hooks/useOrders";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { useViewTransition } from "@/hooks/useViewTransition";
import { mapOrderFromDB } from "@/lib/mappers";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Order, OrderStatus, View } from "@/types";
import { haptic } from "@/utils/haptic";
import { motion } from "framer-motion";
import {
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  Filter,
  HelpCircle,
  LayoutGrid,
  List,
  Loader2,
  MessageCircle,
  Package,
  Search,
  TrendingUp,
  User,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: "PIX Instantâneo",
  card: "Crédito Seguro",
  cash: "Dinheiro",
};

const STATUS_ORDER_COLORS: Record<string, string> = {
  pending: "bg-blue-500",
  processing: "bg-amber-500",
  shipping: "bg-indigo-500",
  delivered: "bg-emerald-500",
  cancelled: "bg-zinc-500",
};

interface AdminOrdersViewProps {
  onNavigate: (view: View, id?: string) => void;
  active?: boolean;
  selectedOrderId?: string | null;
  onSetBackOverride?: (fn: (() => void) | null) => void;
}

export const AdminOrdersView = memo(function AdminOrdersView({
  onNavigate,
  active,
  selectedOrderId,
  onSetBackOverride,
}: Readonly<AdminOrdersViewProps>) {
  const { isSupported: isTransitionSupported } = useViewTransition();
  const isOffline = useOnlineStatus();
  const [recentOrderChanges, setRecentOrderChanges] = useState<
    Record<string, "INSERT" | "UPDATE">
  >({});
  const onRealtimeEventRef = useRef<(payload: any) => void>(() => {});
  const {
    orders,
    loadOrders,
    updateOrderStatus,
    totalOrders,
    isLoaded,
    loading,
  } = useOrders(active ?? false, true, {
    onRealtimeEvent: (payload) => onRealtimeEventRef.current(payload),
  });
  const { stats: analyticsStats, fetchExecutiveSummary } = useAnalytics();

  const [searchQuery, setSearchQuery] = useLocalStorage<string>(
    "admin_orders_search_query",
    "",
  );
  const [isTyping, setIsTyping] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);

  const [showVisualLoading, setShowVisualLoading] = useState(false);
  useEffect(() => {
    if (loading) {
      const timer = setTimeout(() => setShowVisualLoading(true), 180);
      return () => clearTimeout(timer);
    }
    setShowVisualLoading(false);
  }, [loading]);
  const [dateRange, setDateRange] = useLocalStorage<{
    start: string;
    end: string;
  }>("admin_orders_date_range", {
    start: "",
    end: "",
  });
  const [filter, setFilter] = useLocalStorage<OrderStatus | "all">(
    "admin_orders_filter",
    "all",
  );
  const [viewMode, setViewMode] = useState<"detailed" | "compact">(() => {
    const saved = localStorage.getItem("admin_orders_view_mode");
    return saved === "detailed" || saved === "compact" ? saved : "compact";
  });

  useEffect(() => {
    localStorage.setItem("admin_orders_view_mode", viewMode);
  }, [viewMode]);

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const prevSelectedOrderRef = useRef<Order | null>(null);
  const {
    ref: viewRef,
    saveScroll,
    resetRestored,
  } = useScrollRestoration(
    "admin-orders",
    active ?? false,
    !selectedOrder && orders.length > 0,
  );
  const [currentPage, setCurrentPage] = useLocalStorage<number>(
    "admin_orders_current_page",
    0,
  );
  const itemsPerPage = 12;

  const ordersLengthRef = useRef(orders.length);
  useEffect(() => {
    ordersLengthRef.current = orders.length;
  }, [orders.length]);

  // Removed ref tracking for filter changes in favor of direct state resets

  const [stats, setStats] = useState(() => ({
    revenueDay: analyticsStats?.today?.revenue || 0,
    pending: analyticsStats?.today?.pending || 0,
    avgTicket:
      analyticsStats?.averageTicket ||
      analyticsStats?.executive?.avgTicket ||
      0,
    completed: analyticsStats?.month?.count || 0,
  }));

  useEffect(() => {
    if (analyticsStats) {
      setStats({
        revenueDay: analyticsStats.today?.revenue || 0,
        pending: analyticsStats.today?.pending || 0,
        avgTicket:
          analyticsStats.averageTicket ||
          analyticsStats.executive?.avgTicket ||
          0,
        completed: analyticsStats.month?.count || 0,
      });
    }
  }, [analyticsStats]);

  const kpiCards = useMemo<readonly KpiCardConfig[]>(
    () => [
      {
        label: "Receita Hoje",
        value: `R$ ${stats.revenueDay.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
        icon: DollarSign,
        accent: "text-emerald-500",
        subValue: "Finanças",
      },
      {
        label: "Ações Pendentes",
        value: stats.pending.toString(),
        icon: Clock,
        accent: "text-amber-500",
        subValue: stats.pending > 0 ? "Urgente" : "Limpo",
      },
      {
        label: "Ticket Médio",
        value: `R$ ${stats.avgTicket.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
        icon: TrendingUp,
        accent: "text-admin-gold",
        subValue: "Rendimento",
      },
      {
        label: "Total Concluído",
        value: stats.completed.toString(),
        icon: CheckCircle2,
        accent: "text-sky-500",
        subValue: "Concluído",
      },
    ],
    [stats],
  );

  const loadStats = useCallback(async () => {
    await fetchExecutiveSummary(true);
  }, [fetchExecutiveSummary]);

  const handleSelectOrder = useCallback(
    (order: Order) => {
      saveScroll();
      resetRestored();
      onNavigate("admin-orders", order.id);
    },
    [onNavigate, saveScroll, resetRestored],
  );

  // Clean back override on order detail to prevent intercepting url popstates
  useEffect(() => {
    if (onSetBackOverride) {
      onSetBackOverride(null);
    }
    return () => {
      if (onSetBackOverride) {
        onSetBackOverride(null);
      }
    };
  }, [onSetBackOverride]);

  // Sync selectedOrder with selectedOrderId prop driven by URL
  const lastSelectedOrderIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!active) return;

    const nextOrder = selectedOrderId
      ? orders.find((o) => o.id === selectedOrderId) || null
      : null;
    const isIdChanged = lastSelectedOrderIdRef.current !== selectedOrderId;
    lastSelectedOrderIdRef.current = selectedOrderId;

    const updateState = (order: Order | null) => {
      setSelectedOrder(order);
    };

    const triggerUpdate = (order: Order | null) => {
      if (
        isIdChanged &&
        isTransitionSupported &&
        typeof document !== "undefined" &&
        "startViewTransition" in document
      ) {
        document.startViewTransition(() => {
          flushSync(() => {
            updateState(order);
          });
        });
      } else {
        updateState(order);
      }
    };

    if (!selectedOrderId) {
      triggerUpdate(null);
      return;
    }

    if (nextOrder) {
      triggerUpdate(nextOrder);
      return;
    }

    // Fetch from Supabase if not found locally (e.g., deep link or pagination)
    let isCurrent = true;
    const fetchSingleOrder = async () => {
      setLoadingDetail(true);
      try {
        const { data, error } = await supabase
          .from("marketplace_orders")
          .select(`
            *,
            items:marketplace_order_items(*, product:produtos(imagem_url, imagem_urls)),
            address:user_addresses(*)
          `)
          .eq("id", selectedOrderId)
          .single();

        if (error) throw error;
        if (data && isCurrent) {
          const mapped = mapOrderFromDB(data as any);
          triggerUpdate(mapped);
        }
      } catch (err) {
        console.error("Error fetching single order:", err);
        toast.error("Erro ao carregar detalhes do pedido");
      } finally {
        if (isCurrent) setLoadingDetail(false);
      }
    };

    fetchSingleOrder();
    return () => {
      isCurrent = false;
    };
  }, [selectedOrderId, orders, active]);

  useEffect(() => {
    const container =
      viewRef.current?.closest(".admin-scroll-container") ||
      document.querySelector(".active-scroll-container") ||
      document.querySelector("main");
    if (!container) return;

    const prev = prevSelectedOrderRef.current;
    prevSelectedOrderRef.current = selectedOrder;

    if (selectedOrder && !prev) {
      // Opened details page: scroll container to top
      container.scrollTo({ top: 0, behavior: "smooth" });
      resetRestored();
    }
  }, [selectedOrder, viewRef, resetRestored]);

  // Scroll position is handled by useScrollRestoration hook

  // Removidas funções bulk status e toggle selecionados para evitar erros de compilação.

  const loadAllData = useCallback(
    (pageToFetch: number, silent = false) => {
      loadOrders(
        pageToFetch,
        itemsPerPage,
        filter,
        searchQuery,
        dateRange.start || undefined,
        dateRange.end || undefined,
        silent,
      );
      loadStats();
    },
    [loadOrders, itemsPerPage, filter, searchQuery, dateRange, loadStats],
  );

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      loadAllData(currentPage, false);
    }, 320);
    return () => clearTimeout(timer);
  }, [currentPage, filter, searchQuery, dateRange, active, loadAllData]);

  // Reset dialog/modals when view becomes inactive
  useEffect(() => {
    if (!active) {
      setShowHelpModal(false);
      setIsTyping(false);
      setShowVisualLoading(false);
    }
  }, [active]);

  // Auto-refresh when coming back online
  const wasOfflineRef = useRef(isOffline);
  useEffect(() => {
    if (wasOfflineRef.current && !isOffline && active) {
      toast.success("Conexão restabelecida. Atualizando pedidos...", {
        icon: "⚡",
      });
      loadAllData(currentPage);
    }
    wasOfflineRef.current = isOffline;
  }, [isOffline, active, currentPage, loadAllData]);

  useEffect(() => {
    onRealtimeEventRef.current = (payload) => {
      const targetId = payload.new?.id;
      if (
        targetId &&
        (payload.eventType === "INSERT" || payload.eventType === "UPDATE")
      ) {
        setRecentOrderChanges((prev) => ({
          ...prev,
          [targetId]: payload.eventType,
        }));
        setTimeout(() => {
          setRecentOrderChanges((prev) => {
            const next = { ...prev };
            delete next[targetId];
            return next;
          });
        }, 3000);
      }

      // Dispara aviso Toast
      if (payload.eventType === "INSERT") {
        const newId = payload.new?.id;
        toast.info(`Novo pedido recebido! #${newId ? newId.slice(-6) : ""}`, {
          action: {
            label: "Ver",
            onClick: () => {
              if (payload.new) handleSelectOrder(payload.new as Order);
            },
          },
        });
      } else if (payload.eventType === "UPDATE") {
        const updatedId = payload.new?.id;
        const newStatus = payload.new?.status as OrderStatus;
        toast.info(
          `Pedido #${updatedId ? updatedId.slice(-6) : ""} atualizado para ${statusConfig[newStatus]?.label || newStatus}`,
        );
      }

      // Atualiza apenas os KPIs (listagem já é atualizada reativamente em memória)
      loadStats();
    };
  }, [loadStats, handleSelectOrder]);

  const totalPages = Math.ceil(totalOrders / itemsPerPage);
  const paginatedOrders = orders;

  const handleStatusChange = async (
    orderId: string,
    newStatus: OrderStatus,
    silent = false,
  ) => {
    const order = orders?.find((o) => o.id === orderId);

    if (order?.userId && !silent && !isOffline) {
      try {
        const title = "Status do Pedido Atualizado";
        const body = `Seu pedido #${orderId.slice(-6)} agora está: ${statusConfig[newStatus].label}`;

        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token;

        await supabase.functions.invoke("send-push", {
          body: {
            targetUserId: order.userId,
            title,
            body,
            data: { orderId, type: "order_status" },
          },
          headers: token
            ? {
                Authorization: `Bearer ${token}`,
              }
            : {},
        });
      } catch (err) {
        console.error("Error sending status push:", err);
      }
    }

    try {
      await updateOrderStatus(orderId, newStatus, undefined, silent);
      haptic.success();

      if (selectedOrder?.id === orderId) {
        setSelectedOrder({ ...selectedOrder, status: newStatus });
      }

      loadStats();
    } catch (err: any) {
      haptic.error();
      console.error("[handleStatusChange] Erro ao avançar status:", err);
      toast.error("Erro ao atualizar status do pedido", {
        description:
          err?.message ||
          "Verifique sua conexão ou se possui permissões de administrador.",
      });
      throw err;
    }
  };

  const handleWhatsApp = useCallback(
    (order: Order) => {
      if (isOffline) {
        toast.error("Operação não permitida offline.", {
          description: "Contatos via WhatsApp exigem conexão com a internet.",
        });
        return;
      }
      const message = `Olá ${order.customer?.name || "Cliente"}!\n\nSeu pedido #${order.id.slice(-6)} foi atualizado.\nStatus: ${statusConfig[order.status].label}\n\nObrigado por comprar na ${branding.appName}!`;

      let phone = (order.customer?.whatsapp || "").replace(/\D/g, "");
      if (phone.length === 11 || phone.length === 10) {
        phone = `55${phone}`;
      }
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      globalThis.open(url, "_blank");
    },
    [isOffline],
  );

  // Removed early return loading block to prevent visual layout shifts

  if (selectedOrderId && (loadingDetail || !selectedOrder)) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center bg-[#09090b] text-white">
        <div className="relative size-16">
          <div className="absolute inset-0 animate-ping rounded-full border-2 border-amber-500/10 duration-1000" />
          <div className="size-16 animate-spin rounded-full border-2 border-amber-500/10 border-t-amber-500" />
          <div className="absolute inset-4 flex items-center justify-center rounded-full border border-white/5 bg-zinc-900">
            <span className="size-2.5 animate-pulse rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]" />
          </div>
        </div>
        <div className="mt-6 flex flex-col items-center gap-1.5 text-center">
          <p className="animate-pulse text-[10px] font-black uppercase tracking-[0.2em] text-amber-500">
            Carregando Pedido
          </p>
          <p className="text-[9px] font-bold uppercase leading-none tracking-widest text-zinc-500">
            Aguarde um instante
          </p>
        </div>
      </div>
    );
  }

  if (selectedOrder) {
    return (
      <LocalErrorBoundary>
        <div className="duration-300 animate-in fade-in slide-in-from-bottom-2">
          <OrderDetail
            order={selectedOrder}
            onStatusChange={handleStatusChange}
            isOffline={isOffline}
          />
        </div>
      </LocalErrorBoundary>
    );
  }

  return (
    <div
      ref={viewRef}
      className="h-auto bg-admin-bg pb-0 font-sans text-white duration-200 animate-in fade-in selection:bg-admin-gold/30 lg:pb-0"
    >
      {/* Header Elite */}
      <div className="flex items-center justify-between gap-4 px-6 pb-2 pt-6">
        <h1 className="flex shrink-0 select-none items-center gap-3 text-2xl font-black uppercase leading-none tracking-tighter md:text-3xl">
          <span className="flex flex-nowrap items-baseline whitespace-nowrap">
            <span className="italic text-white">Pedidos</span>
          </span>
          <button
            type="button"
            onClick={() => setShowHelpModal(true)}
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/5 bg-zinc-900/60 text-zinc-500 transition-all duration-300 hover:border-white/10 hover:text-white active:scale-95"
            title="Guia de Ajuda e Explicações"
          >
            <HelpCircle className="size-4.5" />
          </button>
        </h1>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-300",
              !isLoaded
                ? "bg-amber-500/10 border-amber-500/20 text-amber-500"
                : "bg-emerald-500/10 border-emerald-500/20 text-emerald-500",
            )}
          >
            <div
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                !isLoaded
                  ? "bg-amber-500 animate-pulse"
                  : "bg-emerald-500 animate-pulse",
              )}
            />
            <span className="text-[10px] font-black uppercase tracking-widest">
              {!isLoaded ? "Sincronizando..." : "Operações ao Vivo"}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-12 p-4 sm:p-6 lg:p-8">
        {/* Support Section */}
        <div className="duration-300 animate-in fade-in slide-in-from-bottom-2">
          <SupportBanners onNavigate={onNavigate} />
        </div>

        {active && (
          <LocalErrorBoundary>
            <AdminKpiCarousel
              cards={kpiCards}
              loading={(!isLoaded || loading) && !analyticsStats}
              active={active}
              title="Métricas de Pedidos"
            />
          </LocalErrorBoundary>
        )}

        {/* Unified Control Bar Compacta */}
        <div className="relative mb-8 mt-4 flex flex-col border-t border-white/5 pt-8">
          <div className="relative z-20 flex flex-col gap-6 md:flex-row md:items-center">
            <div className="flex w-full flex-1 items-center gap-4">
              <div className="group relative w-full">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-5">
                  {!isLoaded || isTyping ? (
                    <Loader2 className="size-5 animate-spin text-admin-gold" />
                  ) : (
                    <Search className="size-5 text-zinc-600 transition-colors group-focus-within:text-admin-gold" />
                  )}
                </div>
                <DebouncedSearchInput
                  placeholder="Buscar pedidos..."
                  className="h-14 w-full rounded-2xl border-zinc-800 bg-black/40 pl-14 text-sm font-bold text-white transition-all placeholder:text-zinc-600 focus:border-admin-gold/50 focus:ring-admin-gold/20"
                  value={searchQuery}
                  onChange={(val) => {
                    setSearchQuery(val);
                    setCurrentPage(0);
                  }}
                  onTyping={setIsTyping}
                  delay={300}
                />
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="group size-14 shrink-0 rounded-2xl border-zinc-800 bg-zinc-900/60 transition-all hover:border-admin-gold/50 hover:bg-zinc-800 focus-visible:ring-0 focus-visible:ring-offset-0"
                  >
                    <Filter className="size-5 text-zinc-500 transition-colors group-hover:text-admin-gold" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="mt-2 w-80 rounded-3xl border-zinc-800/50 bg-zinc-950 p-4 shadow-2xl backdrop-blur-3xl"
                >
                  <div className="space-y-4">
                    <h4 className="px-1 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                      Filtro Temporal
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="group relative">
                        <Input
                          id="filter-date-start"
                          name="start-date"
                          type="date"
                          className="h-14 w-full rounded-2xl border-zinc-800 bg-black/40 px-4 pb-1 pt-5 text-xs font-bold text-white transition-all [color-scheme:dark] focus:border-admin-gold/50 focus:ring-admin-gold/20"
                          value={dateRange.start}
                          onChange={(e) => {
                            setDateRange((prev) => ({
                              ...prev,
                              start: e.target.value,
                            }));
                            setCurrentPage(0);
                          }}
                        />
                        <label
                          htmlFor="filter-date-start"
                          className="pointer-events-none absolute left-4 top-2 text-[7px] font-black uppercase tracking-widest text-zinc-600 transition-colors group-focus-within:text-admin-gold"
                        >
                          Início
                        </label>
                      </div>
                      <div className="group relative">
                        <Input
                          id="filter-date-end"
                          name="end-date"
                          type="date"
                          className="h-14 w-full rounded-2xl border-zinc-800 bg-black/40 px-4 pb-1 pt-5 text-xs font-bold text-white transition-all [color-scheme:dark] focus:border-admin-gold/50 focus:ring-admin-gold/20"
                          value={dateRange.end}
                          onChange={(e) => {
                            setDateRange((prev) => ({
                              ...prev,
                              end: e.target.value,
                            }));
                            setCurrentPage(0);
                          }}
                        />
                        <label
                          htmlFor="filter-date-end"
                          className="pointer-events-none absolute left-4 top-2 text-[7px] font-black uppercase tracking-widest text-zinc-600 transition-colors group-focus-within:text-admin-gold"
                        >
                          Fim
                        </label>
                      </div>
                    </div>
                    {(dateRange.start || dateRange.end) && (
                      <Button
                        variant="ghost"
                        className="mt-2 h-10 w-full rounded-xl border border-zinc-800 text-[10px] font-black uppercase tracking-widest text-rose-500 transition-all hover:bg-rose-500 hover:text-white"
                        onClick={() => {
                          setDateRange({ start: "", end: "" });
                          setCurrentPage(0);
                        }}
                      >
                        Limpar Datas
                      </Button>
                    )}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  setViewMode((prev) =>
                    prev === "detailed" ? "compact" : "detailed",
                  )
                }
                className="group size-14 shrink-0 rounded-2xl border-zinc-800 bg-zinc-900/60 transition-all hover:border-admin-gold/50 hover:bg-zinc-800 focus-visible:ring-0 focus-visible:ring-offset-0"
                title={
                  viewMode === "detailed"
                    ? "Visualização Compacta"
                    : "Visualização Detalhada"
                }
              >
                {viewMode === "detailed" ? (
                  <LayoutGrid className="size-5 text-zinc-500 transition-colors group-hover:text-admin-gold" />
                ) : (
                  <List className="size-5 text-zinc-500 transition-colors group-hover:text-admin-gold" />
                )}
              </Button>
            </div>
          </div>

          <div className="custom-scrollbar-hidden relative z-10 flex w-full snap-x gap-3 overflow-x-auto pt-6">
            <button
              onClick={() => {
                setFilter("all");
                setCurrentPage(0);
              }}
              className={cn(
                "px-5 h-11 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border shrink-0 snap-center",
                filter === "all"
                  ? "bg-admin-gold border-admin-gold text-black shadow-[0_0_20px_rgba(212,175,55,0.2)]"
                  : "bg-zinc-900/60 border-zinc-800 text-zinc-500 hover:bg-zinc-800 hover:text-white",
              )}
            >
              Todos Ativos
            </button>
            {Object.entries(statusConfig).map(([status, cfg]) => (
              <button
                key={status}
                onClick={() => {
                  setFilter(status as OrderStatus);
                  setCurrentPage(0);
                }}
                className={cn(
                  "px-5 h-11 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border flex items-center gap-3 shrink-0 snap-center",
                  filter === status
                    ? "bg-admin-gold border-admin-gold text-black shadow-[0_0_20px_rgba(212,175,55,0.2)]"
                    : "bg-zinc-900/60 border-zinc-800 text-zinc-500 hover:bg-zinc-800 hover:text-white",
                )}
              >
                <div
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    STATUS_ORDER_COLORS[status] || "bg-gray-500",
                  )}
                />
                {cfg.label}
              </button>
            ))}
          </div>
        </div>

        {/* Orders List */}
        <LocalErrorBoundary>
          <div
            className={cn(
              "space-y-8 relative transition-opacity duration-300 min-h-[400px]",
              !isLoaded && "opacity-50 pointer-events-none",
            )}
          >
            {isLoaded && showVisualLoading && (
              <div className="admin-sync-progress-bar" />
            )}
            {!isLoaded && paginatedOrders.length === 0 ? (
              viewMode === "detailed" ? (
                <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex h-[278px] animate-pulse flex-col justify-between space-y-6 rounded-[3rem] border border-white/5 bg-zinc-950/40 p-8 shadow-[0_20px_60px_rgba(0,0,0,0.3)] backdrop-blur-md"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Skeleton className="size-10 rounded-xl bg-white/5" />
                          <div className="space-y-2">
                            <Skeleton className="h-3 w-16 bg-white/5" />
                            <Skeleton className="h-2.5 w-12 bg-white/5" />
                          </div>
                        </div>
                        <Skeleton className="h-5 w-16 rounded-full bg-white/5" />
                      </div>
                      <div className="space-y-2">
                        <Skeleton className="h-6 w-3/4 bg-white/5" />
                        <Skeleton className="h-3 w-1/2 bg-white/5" />
                      </div>
                      <div className="flex items-end justify-between border-t border-white/5 pt-4">
                        <div className="space-y-1">
                          <Skeleton className="h-2.5 w-12 bg-white/5" />
                          <Skeleton className="h-6 w-24 bg-white/5" />
                        </div>
                        <Skeleton className="size-12 rounded-2xl bg-white/5" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex h-[164px] animate-pulse flex-col justify-between rounded-[2rem] border border-white/5 bg-zinc-950/40 p-4 shadow-lg backdrop-blur-md sm:p-5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Skeleton className="size-8 rounded-lg bg-white/5" />
                          <div className="space-y-1">
                            <Skeleton className="h-2.5 w-12 bg-white/5" />
                            <Skeleton className="h-2 w-8 bg-white/5" />
                          </div>
                        </div>
                        <Skeleton className="h-4.5 w-12 rounded-full bg-white/5" />
                      </div>
                      <div className="space-y-1">
                        <Skeleton className="h-4 w-3/4 bg-white/5" />
                        <Skeleton className="h-2.5 w-1/2 bg-white/5" />
                      </div>
                      <div className="flex items-center justify-between border-t border-white/5 pt-3">
                        <div className="space-y-1">
                          <Skeleton className="h-2 w-8 bg-white/5" />
                          <Skeleton className="h-4 w-16 bg-white/5" />
                        </div>
                        <Skeleton className="size-9 rounded-xl bg-white/5" />
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : paginatedOrders.length === 0 ? (
              <div className="admin-glass relative flex flex-col items-center justify-center overflow-hidden rounded-[2rem] border border-white/5 py-12 px-6 text-center">
                <div className="absolute inset-0 bg-gradient-to-b from-admin-gold/[0.02] to-transparent pointer-events-none" />
                <div className="relative z-10 mb-3 rounded-full border border-white/5 bg-zinc-900/60 p-4 shadow-xl">
                  <Package className="size-6 text-zinc-600" />
                </div>
                <h3 className="relative z-10 text-xs font-black uppercase tracking-widest text-zinc-400">
                  Ainda não tem nenhum pedido
                </h3>
              </div>
            ) : viewMode === "detailed" ? (
              <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
                {paginatedOrders.map((order) => (
                  <AdminOrderCard
                    key={order.id}
                    order={order}
                    viewMode="detailed"
                    onSelect={handleSelectOrder}
                    onWhatsApp={handleWhatsApp}
                    changeType={recentOrderChanges[order.id]}
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {paginatedOrders.map((order) => (
                  <AdminOrderCard
                    key={order.id}
                    order={order}
                    viewMode="compact"
                    onSelect={handleSelectOrder}
                    onWhatsApp={handleWhatsApp}
                    changeType={recentOrderChanges[order.id]}
                  />
                ))}
              </div>
            )}
          </div>
        </LocalErrorBoundary>

        {/* Elite Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-10 pt-12">
            <Button
              variant="ghost"
              onClick={(e) => {
                setCurrentPage((p) => Math.max(0, p - 1));
                const mainEl =
                  e.currentTarget.closest(".admin-scroll-container") ||
                  document.querySelector(".active-scroll-container") ||
                  document.querySelector("main");
                if (mainEl) mainEl.scrollTo({ top: 0, behavior: "smooth" });
              }}
              disabled={currentPage === 0}
              className="group size-16 rounded-3xl border border-white/5 bg-zinc-950/50 text-zinc-500 transition-all hover:bg-admin-gold hover:text-black disabled:opacity-20"
            >
              <ChevronLeft className="size-6 transition-transform group-hover:-translate-x-1" />
            </Button>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] font-black uppercase tracking-[0.4em] text-white">
                Perfil do Setor
              </span>
              <span className="text-[11px] font-bold uppercase tabular-nums tracking-widest text-admin-gold">
                {currentPage + 1} <span className="text-zinc-700">/</span>{" "}
                {totalPages}
              </span>
            </div>
            <Button
              variant="ghost"
              onClick={(e) => {
                setCurrentPage((p) => Math.min(totalPages - 1, p + 1));
                const mainEl =
                  e.currentTarget.closest(".admin-scroll-container") ||
                  document.querySelector(".active-scroll-container") ||
                  document.querySelector("main");
                if (mainEl) mainEl.scrollTo({ top: 0, behavior: "smooth" });
              }}
              disabled={currentPage === totalPages - 1}
              className="group size-16 rounded-3xl border border-white/5 bg-zinc-950/50 text-zinc-500 transition-all hover:bg-admin-gold hover:text-black disabled:opacity-20"
            >
              <ChevronRight className="size-6 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>
        )}
      </div>

      {/* Modal de Ajuda */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Guia de Controle de Pedidos"
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-zinc-400">
            Esta tela exibe a Central de Transmissões e Pedidos em tempo real.
            Aqui você pode gerenciar, auditar e atualizar o ciclo de vida dos
            pedidos efetuados no aplicativo.
          </p>

          <div className="space-y-3">
            <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Ciclo de Vida do Pedido
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <span className="size-2.5 rounded-full bg-blue-500" />
                  Pendente
                </div>
                <p className="text-xs text-zinc-400">
                  A transação foi criada pelo cliente, mas o pagamento ainda não
                  foi processado ou verificado (aguardando aprovação).
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <span className="size-2.5 rounded-full bg-amber-500" />
                  Pago / Em Processamento
                </div>
                <p className="text-xs text-zinc-400">
                  O pagamento foi validado com sucesso. O pedido está pronto
                  para separação de estoque e embalagem.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <span className="size-2.5 rounded-full bg-indigo-500" />
                  Enviado
                </div>
                <p className="text-xs text-zinc-400">
                  A mercadoria já foi despachada ou entregue ao portador/motoboy
                  para transporte até o endereço do cliente.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <span className="size-2.5 rounded-full bg-emerald-500" />
                  Entregue
                </div>
                <p className="text-xs text-zinc-400">
                  O pedido foi entregue com sucesso ao destinatário. O fluxo
                  operacional desta compra foi finalizado.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Recursos e Ações Rápidas
            </h4>
            <ul className="list-inside list-disc space-y-2 text-xs text-zinc-400">
              <li>
                <strong className="text-white">Busca Dinâmica:</strong> Pesquise
                pedidos instantaneamente por ID, nome do cliente ou telefone.
              </li>
              <li>
                <strong className="text-white">Filtro por Status:</strong>{" "}
                Filtre a lista principal de acordo com o estado do pedido.
              </li>
              <li>
                <strong className="text-white">Detalhes do Pedido:</strong>{" "}
                Clique em qualquer linha para abrir a ficha completa do pedido
                com lista de itens, valores, meio de pagamento e endereço de
                entrega.
              </li>
              <li>
                <strong className="text-white">
                  Contato Direto (WhatsApp):
                </strong>{" "}
                Clique no botão do WhatsApp nos detalhes do pedido para iniciar
                uma conversa direta com o cliente já com mensagem pré-formatada.
              </li>
            </ul>
          </div>
        </div>
      </AdminHelpModal>
    </div>
  );
});

interface AdminOrderCardProps {
  readonly order: Order;
  readonly viewMode: "detailed" | "compact";
  readonly onSelect: (order: Order) => void;
  readonly onWhatsApp: (order: Order) => void;
  readonly changeType?: "INSERT" | "UPDATE";
}

const AdminOrderCard = memo(function AdminOrderCard({
  order,
  viewMode,
  onSelect,
  onWhatsApp,
  changeType,
}: AdminOrderCardProps) {
  if (viewMode === "detailed") {
    return (
      <motion.div
        layout
        onClick={() => onSelect(order)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(order);
          }
        }}
        className={cn(
          "group relative bg-zinc-950/40 backdrop-blur-md border rounded-[3rem] p-8 transition-all duration-500 hover:scale-[1.01] hover:shadow-[0_20px_60px_rgba(212,175,55,0.05)] hover:border-admin-gold/30 active:scale-[0.98] cursor-pointer focus:outline-none focus:ring-2 focus:ring-admin-gold focus:ring-offset-2 focus:ring-offset-zinc-950 content-visibility-auto animate-in fade-in slide-in-from-bottom-2 duration-300 min-h-[278px] flex flex-col justify-between transform-gpu",
          changeType === "INSERT" &&
            "border-admin-gold shadow-[0_0_25px_rgba(212,175,55,0.3)] animate-pulse",
          changeType === "UPDATE" &&
            "border-blue-500 shadow-[0_0_25px_rgba(59,130,246,0.3)] animate-pulse",
          !changeType && "border-white/5",
        )}
      >
        {/* Glow Background */}
        <div className="pointer-events-none absolute inset-0 z-0 rounded-[3rem] bg-gradient-to-br from-admin-gold/0 via-transparent to-admin-gold/0 transition-all duration-700 group-hover:from-admin-gold/5 group-hover:to-transparent" />

        <div className="relative z-10 mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative shrink-0">
              {order.items?.[0]?.image ? (
                <LazyImage
                  src={order.items[0].image}
                  alt="Produto"
                  className="size-10 shrink-0 rounded-xl border border-white/10 object-cover"
                />
              ) : (
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-zinc-900">
                  <Package className="size-5 text-zinc-600" />
                </div>
              )}
              {order.items?.length > 1 && (
                <div className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full border border-zinc-900 bg-admin-gold text-[9px] font-black text-black shadow-lg">
                  +{order.items.length - 1}
                </div>
              )}
            </div>
            <div>
              <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 transition-colors group-hover:text-admin-gold">
                #{order.id.slice(-6).toUpperCase()}
              </span>
              <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                <Calendar className="size-3" />
                {new Date(order.createdAt).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "short",
                })}
              </span>
            </div>
          </div>
          <OrderStatusBadge status={order.status} />
        </div>

        <div className="relative z-10 space-y-6">
          <div>
            <h4 className="mb-2 truncate text-lg font-black text-white transition-colors group-hover:text-admin-gold sm:text-xl">
              {(() => {
                if (!order.items || order.items.length === 0)
                  return "Pedido Vazio";
                if (order.items.length === 1) return order.items[0].name;
                return `${order.items[0].name} e mais ${order.items.length - 1}`;
              })()}
            </h4>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-md border border-white/5 bg-white/5 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-zinc-400">
                <User className="size-3" />
                {(() => {
                  const nameParts = (order.customer?.name || "Cliente").split(
                    " ",
                  );
                  return nameParts.length > 1
                    ? `${nameParts[0][0]}. ${nameParts.at(-1)}`
                    : nameParts[0];
                })()}
              </div>
              <span className="rounded-md border border-white/5 bg-white/5 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">
                {order.items?.length || 0} Prod.
              </span>
              <div className="size-1 rounded-full bg-zinc-800" />
              <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400">
                {PAYMENT_METHOD_LABELS[order.paymentMethod] || "Outro"}
              </span>
            </div>
          </div>

          <div className="flex items-end justify-between border-t border-white/5 pt-6">
            <div className="space-y-1">
              <span className="text-[9px] font-black uppercase tracking-[0.3em] text-zinc-600 ">
                Valor Capital
              </span>
              <p className="text-2xl font-black tabular-nums tracking-widest text-white">
                <span className="mr-1 text-[10px] font-black uppercase text-zinc-500">
                  R$
                </span>
                {(order.total || 0).toLocaleString("pt-BR", {
                  minimumFractionDigits: 2,
                })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onWhatsApp(order);
                }}
                className="relative z-10 flex size-12 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-500 shadow-xl transition-all hover:bg-emerald-500 hover:text-black"
              >
                <MessageCircle className="size-5" />
              </button>
              <div className="flex size-12 items-center justify-center text-zinc-500 transition-all duration-300 group-hover:text-admin-gold">
                <ChevronRight className="size-6 transform filter transition-transform duration-300 group-hover:translate-x-1 group-hover:drop-shadow-[0_0_8px_rgba(212,175,55,0.5)]" />
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  // compact mode
  return (
    <motion.div
      layout
      onClick={() => onSelect(order)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(order);
        }
      }}
      className={cn(
        "group relative bg-zinc-950/40 backdrop-blur-md border rounded-[2rem] p-4 sm:p-5 transition-all duration-500 hover:scale-[1.01] hover:shadow-[0_15px_40px_rgba(212,175,55,0.05)] hover:border-admin-gold/30 active:scale-[0.98] cursor-pointer focus:outline-none focus:ring-2 focus:ring-admin-gold focus:ring-offset-2 focus:ring-offset-zinc-950 content-visibility-auto animate-in fade-in slide-in-from-bottom-2 duration-300 min-h-[164px] flex flex-col justify-between transform-gpu",
        changeType === "INSERT" &&
          "border-admin-gold shadow-[0_0_20px_rgba(212,175,55,0.3)] animate-pulse",
        changeType === "UPDATE" &&
          "border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.3)] animate-pulse",
        !changeType && "border-white/5",
      )}
    >
      {/* Glow Background */}
      <div className="pointer-events-none absolute inset-0 z-0 rounded-[2rem] bg-gradient-to-br from-admin-gold/0 via-transparent to-admin-gold/0 transition-all duration-700 group-hover:from-admin-gold/5 group-hover:to-transparent" />

      {/* Header Row: Image/ID and Status */}
      <div className="relative z-10 mb-4 flex flex-col justify-between gap-2 min-[400px]:flex-row min-[400px]:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <div className="relative shrink-0">
            {order.items?.[0]?.image ? (
              <LazyImage
                src={order.items[0].image}
                alt="Produto"
                className="size-8 shrink-0 rounded-lg border border-white/10 object-cover"
              />
            ) : (
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-zinc-900">
                <Package className="size-4 text-zinc-600" />
              </div>
            )}
            {order.items?.length > 1 && (
              <div className="absolute -right-1.5 -top-1.5 flex size-4.5 items-center justify-center rounded-full border border-zinc-900 bg-admin-gold text-[8px] font-black text-black shadow-lg">
                +{order.items.length - 1}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <span className="block truncate text-[9px] font-black uppercase tracking-widest text-zinc-500 transition-colors group-hover:text-admin-gold">
              #{order.id.slice(-6).toUpperCase()}
            </span>
            <span className="block truncate text-[8px] font-bold uppercase tracking-tight text-zinc-600">
              {new Date(order.createdAt).toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "short",
              })}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 justify-start min-[400px]:justify-end">
          <OrderStatusBadge status={order.status} className="px-1.5 py-0.5" />
        </div>
      </div>

      {/* Customer & Product description */}
      <div className="relative z-10 mb-4 space-y-1">
        <h4 className="truncate text-sm font-black text-white transition-colors group-hover:text-admin-gold">
          {order.customer?.name || "Cliente"}
        </h4>
        <p className="truncate text-[9px] font-bold uppercase text-zinc-500">
          {(() => {
            if (!order.items || order.items.length === 0) return "Pedido Vazio";
            if (order.items.length === 1) return order.items[0].name;
            return `${order.items[0].name} e mais ${order.items.length - 1}`;
          })()}
        </p>
      </div>

      {/* Footer Row: Price and Quick WhatsApp button */}
      <div className="relative z-10 flex items-center justify-between border-t border-white/5 pt-3">
        <div className="space-y-0.5">
          <span className="block text-[8px] font-black uppercase tracking-wider text-zinc-600">
            Valor
          </span>
          <p className="text-base font-black tabular-nums tracking-tight text-white">
            <span className="mr-0.5 text-[9px] font-black uppercase text-zinc-500">
              R$
            </span>
            {(order.total || 0).toLocaleString("pt-BR", {
              minimumFractionDigits: 2,
            })}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onWhatsApp(order);
            }}
            className="relative z-10 flex size-11 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-500 shadow-lg transition-all hover:bg-emerald-500 hover:text-black active:scale-90"
            title="WhatsApp"
          >
            <MessageCircle className="size-5" />
          </button>
          <ChevronRight className="size-4.5 transform text-zinc-500 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-admin-gold" />
        </div>
      </div>
    </motion.div>
  );
});

export default AdminOrdersView;
