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
  PaymentStatusBadge,
  type PaymentStatusKey,
  getPaymentStatusConfig,
  paymentStatusKey,
  statusConfig,
} from "@/components/admin/orders/OrderStatusBadge";
import { STATUS_PEDIDOS_COM_ACAO_PENDENTE } from "@/components/layouts/AdminLayout";
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
import {
  mensagemAmigavelErroAtualizacaoStatus,
  useOrders,
} from "@/hooks/useOrders";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { useViewTransition } from "@/hooks/useViewTransition";
import { mapOrderFromDB } from "@/lib/mappers";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Order, OrderStatus, PaymentStatus, View } from "@/types";
import { haptic } from "@/utils/haptic";
import { motion } from "framer-motion";
import {
  AlertTriangle,
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

/**
 * Subtítulo do cartão "Ações Pendentes" — achado 10 da auditoria de
 * 20/08/2026. Antes alternava entre "Urgente" e "Limpo" conforme
 * `stats.pending`, e um pedido parado em "Em Separação" desde 24/03/2026
 * deixou "Urgente" aceso por cinco meses seguidos: um alarme que nunca
 * apaga deixa de ser lido no dia em que significar alguma coisa.
 *
 * Em vez de julgar o número, o subtítulo descreve o que ele conta — e isso
 * é verdade sempre, então não precisa mudar. Derivado de
 * `STATUS_PEDIDOS_COM_ACAO_PENDENTE` (mesma lista que o crachá de Pedidos
 * usa em `AdminLayout.tsx`) para as duas contagens nunca voltarem a
 * divergir. `"new"` não tem rótulo em `statusConfig` (valor histórico do
 * banco, nunca modelado no front) e é descartado aqui.
 */
const ACOES_PENDENTES_SUBTITULO = STATUS_PEDIDOS_COM_ACAO_PENDENTE.map(
  (status) => statusConfig[status as OrderStatus]?.label,
)
  .filter((label): label is string => Boolean(label))
  .join(" · ");

/**
 * `mapOrderFromDB` (src/lib/mappers.ts) já copia `payment_status` para
 * `Order.paymentStatus` — `null` nos 64 pedidos históricos, tratado pelo
 * filtro/badge exatamente como "Sem cobrança online".
 */
type PaymentStatusFilter = PaymentStatusKey | "all";

/** Valores do filtro de pagamento, na ordem em que aparecem no dropdown. */
const PAYMENT_STATUS_FILTER_VALUES: PaymentStatusKey[] = [
  "aguardando",
  "pago",
  "recusado",
  "expirado",
  "estornado",
  "pago_apos_expirar",
  "sem_cobranca",
];

/**
 * Restringe uma lista de pedidos por `payment_status`, seguindo o mesmo
 * tratamento de `NULL`/`undefined` do badge: caem em "sem_cobranca", nunca
 * quebram o filtro. Exportada para o teste exercitar a regra sem montar a
 * tela inteira (que arrasta useAuth, useOrders, canal realtime etc.).
 */
export function filterOrdersByPaymentStatus<
  T extends { paymentStatus?: PaymentStatus | null },
>(orders: readonly T[], paymentFilter: PaymentStatusFilter): T[] {
  if (paymentFilter === "all") return [...orders];
  // paymentStatusKey() é o único lugar que decide "null/undefined vira
  // sem_cobranca" (ver OrderStatusBadge.tsx) — reusar aqui em vez de
  // reescrever a regra evita a mesma divergência silenciosa do #53.
  return orders.filter(
    (order) => paymentStatusKey(order.paymentStatus) === paymentFilter,
  );
}

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
  // Chave NOVA (v2): quem já tinha "all" salvo da versão antiga
  // ("admin_orders_filter") não fica preso nele — a chave antiga é ignorada
  // e o novo padrão ("open") vale uma vez para todo mundo, sem código de
  // migração de dado. Aprovado pelo Gabriel em 20/08/2026: 83 pedidos, 72
  // cancelados (86,7%); "Todos Ativos" não filtrava nada.
  const [filter, setFilter] = useLocalStorage<OrderStatus | "all" | "open">(
    "admin_orders_filter_v2",
    "open",
  );
  // Filtro de payment_status: client-side, sobre a página já carregada — a
  // RPC get_admin_orders_paged não tem parâmetro pra isso (mudar a RPC é
  // migration, fora do escopo desta tarefa). Por isso não reduz totalOrders
  // nem totalPages, só a lista visível na página atual.
  const [paymentFilter, setPaymentFilter] =
    useLocalStorage<PaymentStatusFilter>("admin_orders_payment_filter", "all");
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
    // `deliveredTotal` (status='delivered') veio pra substituir
    // `month.count`, que contava TODOS os pedidos não cancelados dos
    // últimos 30 dias — inclusive os que nunca saíram de "Novo Pedido".
    // `null`, não `?? 0`: um `0` visível AFIRMA um fato falso ("zero
    // entregues") quando o dado simplesmente não chegou (RPC ainda não
    // migrada); o travessão não afirma nada. É essa a razão — e NÃO que o
    // travessão sirva de aviso de "dado velho": este é o 4º de 4 cartões
    // de um carrossel com autoplay, então no celular ele aparece ~4 s a
    // cada 16 s, e sinal que passa voando não guarda nada (achado da
    // 2ª revisão, que derrubou a justificativa da 1ª).
    completed: analyticsStats?.deliveredTotal ?? null,
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
        completed: analyticsStats.deliveredTotal ?? null,
      });
    }
  }, [analyticsStats]);

  // Pedidos com dinheiro recebido em pedido cancelado. A migration que
  // alimenta este contador conta as DUAS portas:
  //   payment_status IN ('pago', 'pago_apos_expirar') AND status = 'cancelled'
  // O texto precisa valer para as duas — "pago depois de cancelado" só é
  // verdade na segunda (achado 1 da revisão). O único sinal disso antes
  // era a etiqueta no cartão da lista, que rola para fora de vista
  // conforme chegam pedidos novos — daqui vem o aviso fixo logo abaixo dos
  // cartões de métrica.
  const paidOnCancelledCount = analyticsStats?.paidOnCancelled ?? 0;
  const avisoPagoAposCancelado =
    paidOnCancelledCount === 1
      ? "1 pedido recebeu pagamento e está cancelado"
      : `${paidOnCancelledCount} pedidos receberam pagamento e estão cancelados`;

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
        subValue: ACOES_PENDENTES_SUBTITULO,
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
        value: stats.completed === null ? "—" : stats.completed.toString(),
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
  const paginatedOrders = useMemo(
    () => filterOrdersByPaymentStatus(orders, paymentFilter),
    [orders, paymentFilter],
  );

  const handleStatusChange = async (
    orderId: string,
    newStatus: OrderStatus,
    silent = false,
  ) => {
    // A RPC VEM PRIMEIRO (PEDIDO-090, #87).
    //
    // Até aqui o push saía ANTES da gravação. Se a RPC falhasse — 401, sessão
    // expirada, pedido já cancelado — o cliente já tinha recebido "seu pedido
    // agora está: Em Trânsito" de uma mudança que não aconteceu, e a tela do
    // admin fazia rollback. Notificação não tem desfazer.
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
      // `useOrders.updateOrderStatus` (catch de useOrders.ts, por volta da
      // linha 1115) já mostra o PRÓPRIO toast traduzido via
      // `mensagemAmigavelErroAtualizacaoStatus` sempre que `!silent` — mostrar
      // de novo aqui, mesmo traduzido, empilharia um SEGUNDO aviso para o
      // mesmo clique. Antes deste conserto o segundo aviso lia `err?.message`
      // cru (achado 1 da revisão do commit ec4cbdd): a lojista via a frase
      // amigável e, por cima, o texto bruto do Postgres/RPC (ex.:
      // "duplicate key value violates unique constraint
      // \"marketplace_order_history_pkey\"").
      //
      // O toast AQUI só dispara quando `silent` é `true` — a única situação
      // em que o hook ficou CALADO de propósito, e por isso este seria o
      // ÚNICO aviso visível. Sem esta ressalva, o caminho `silent` ficaria
      // sem nenhum aviso de erro.
      if (silent) {
        toast.error("Erro ao atualizar status do pedido", {
          description: mensagemAmigavelErroAtualizacaoStatus(err),
        });
      }
      throw err;
    }

    if (silent || isOffline) return;

    // O pedido pode não estar na página carregada: quando o admin chega por
    // deep link, `orders` traz só a página atual e o `find` devolve undefined.
    // Antes disso significava "nenhum push, sem aviso nenhum" — o lojista
    // achava que o cliente tinha sido avisado.
    const alvo =
      orders?.find((o) => o.id === orderId) ??
      (selectedOrder?.id === orderId ? selectedOrder : undefined);

    if (!alvo) {
      toast.warning("Status atualizado, mas o cliente não foi avisado", {
        description:
          "Não foi possível identificar o dono deste pedido nesta tela. Abra o pedido pela lista e avise pelo WhatsApp.",
      });
      return;
    }

    // Pedido de convidado não tem para quem mandar push, e isso é esperado —
    // o canal dele é o WhatsApp. Não é caso de aviso.
    if (!alvo.userId) return;

    try {
      const title = "Status do Pedido Atualizado";
      const body = `Seu pedido #${orderId.slice(-6)} agora está: ${statusConfig[newStatus].label}`;

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      const { data: envio, error: erroDoInvoke } =
        await supabase.functions.invoke("send-push", {
          body: {
            targetUserId: alvo.userId,
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

      if (erroDoInvoke) throw erroDoInvoke;

      // `enviados` só existe na send-push depois da PUSH-010 (#80). O teste de
      // tipo é de propósito: contra a versão antiga da função, que respondia
      // `{ success: true }` sem contagem, isto não faz nada — em vez de acusar
      // falha em todo envio.
      if (typeof envio?.enviados === "number" && envio.enviados === 0) {
        toast.warning("Status atualizado, mas o push não chegou", {
          description:
            envio?.falhas?.[0]?.motivo ??
            "Nenhum dispositivo deste cliente recebeu a notificação.",
        });
      }
    } catch (err) {
      console.error("Error sending status push:", err);
      toast.warning("Status atualizado, mas o push falhou", {
        description: "O cliente não foi notificado da mudança.",
      });
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
      // O CHECK do banco aceita SEIS status (inclui 'new', histórico —
      // migrado para 'pending' pela 20260327000003, 0 pedidos hoje), o
      // `statusConfig` (OrderStatusBadge.tsx) só conhece os CINCO do type
      // `OrderStatus`. Sem o `|| statusConfig.pending` (mesma guarda de
      // OrderStatusBadge.tsx:68 e OrderList.tsx:209) o botão quebra. E
      // NUNCA `?.label || newStatus` aqui (como a linha 520 acima): isso
      // botaria o valor cru do banco, em inglês, dentro da mensagem que a
      // lojista manda para a cliente.
      const statusMsg = statusConfig[order.status] || statusConfig.pending;
      const message = `Olá ${order.customer?.name || "Cliente"}!\n\nSeu pedido #${order.id.slice(-6)} foi atualizado.\nStatus: ${statusMsg.label}\n\nObrigado por comprar na ${branding.appName}!`;

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
      className="h-auto bg-admin-bg pb-admin lg:pb-12 font-sans text-white duration-200 animate-in fade-in selection:bg-admin-gold/30"
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
              "inline-flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full transition-all duration-300",
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
            <span className="text-[9px] font-black uppercase tracking-widest sm:text-[10px]">
              {!isLoaded ? "Sincronizando..." : "Operações ao Vivo"}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-8 p-4 sm:p-6 lg:p-8">
        {/* Support Section */}
        <div className="duration-300 animate-in fade-in slide-in-from-bottom-2">
          <SupportBanners onNavigate={onNavigate} />
        </div>

        {active && (
          <div className="space-y-4">
            <LocalErrorBoundary>
              <AdminKpiCarousel
                cards={kpiCards}
                loading={(!isLoaded || loading) && !analyticsStats}
                active={active}
                title="Métricas de Pedidos"
              />
            </LocalErrorBoundary>
          </div>
        )}

        {/* Aviso fixo: dinheiro recebido em pedido cancelado. Não some
            sozinho (sem botão de dispensar) — foi exatamente isso que fez
            o defeito passar despercebido antes, escondido só numa
            etiqueta do cartão que rola para fora de vista. */}
        {paidOnCancelledCount > 0 && (
          <div className="admin-glass relative overflow-hidden rounded-[2rem] border-amber-500/30 bg-amber-500/5 p-6">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-500/10 to-transparent" />
            <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-500">
                  <AlertTriangle className="size-5" />
                </div>
                <div>
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-amber-500">
                    {avisoPagoAposCancelado}
                  </h3>
                  <p className="mt-1.5 text-[10px] font-bold uppercase leading-relaxed tracking-widest text-zinc-400">
                    O dinheiro entrou e o pedido está cancelado. Entregue o
                    pedido, ou estorne pelo painel do Mercado Pago — esta tela
                    não registra estorno.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  // O botão leva aos CANCELADOS, não a um payment_status
                  // específico: a contagem larga cobre as duas portas do
                  // contrato ampliado ('pago' e 'pago_apos_expirar' com
                  // status='cancelled'), e filtrar por um valor só deixava
                  // metade dos pedidos "presos" fora da lista — a etiqueta
                  // de cada cartão já marca qual porta é cada um (achado 1
                  // da revisão). Busca e período também são zerados: sem
                  // isso um filtro de uma sessão anterior sobrevivia e a
                  // lista vinha vazia sem o lojista perceber por quê
                  // (achado 2 da revisão).
                  setFilter("cancelled");
                  setPaymentFilter("all");
                  setSearchQuery("");
                  setDateRange({ start: "", end: "" });
                  setCurrentPage(0);
                }}
                className="h-11 shrink-0 rounded-xl border-amber-500/30 bg-amber-500/10 px-5 text-[10px] font-black uppercase tracking-widest text-amber-500 transition-all hover:bg-amber-500 hover:text-black"
              >
                Ver pedidos
              </Button>
            </div>
          </div>
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
                <label htmlFor="orders-search" className="sr-only">
                  Buscar pedidos
                </label>
                <DebouncedSearchInput
                  id="orders-search"
                  name="search"
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
                    className="group relative size-14 shrink-0 rounded-2xl border-zinc-800 bg-zinc-900/60 transition-all hover:border-admin-gold/50 hover:bg-zinc-800 focus-visible:ring-0 focus-visible:ring-offset-0"
                  >
                    <Filter className="size-5 text-zinc-500 transition-colors group-hover:text-admin-gold" />
                    {paymentFilter !== "all" && (
                      // O filtro persiste em localStorage: sem isto, o admin
                      // reabre a tela já filtrada sem nenhuma pista visível
                      // (achado da revisão da Task 9).
                      <span
                        aria-hidden="true"
                        className="absolute right-2.5 top-2.5 size-2 rounded-full bg-admin-gold shadow-[0_0_6px_rgba(212,175,55,0.6)]"
                      />
                    )}
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
                          autoComplete="off"
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
                          autoComplete="off"
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

                    <h4 className="mt-6 px-1 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                      Status de Pagamento
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPaymentFilter("all");
                          setCurrentPage(0);
                        }}
                        className={cn(
                          "px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all border",
                          paymentFilter === "all"
                            ? "bg-admin-gold border-admin-gold text-black"
                            : "bg-zinc-900/60 border-zinc-800 text-zinc-500 hover:bg-zinc-800 hover:text-white",
                        )}
                      >
                        Todos
                      </button>
                      {PAYMENT_STATUS_FILTER_VALUES.map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => {
                            setPaymentFilter(value);
                            setCurrentPage(0);
                          }}
                          className={cn(
                            "px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all border",
                            paymentFilter === value
                              ? "bg-admin-gold border-admin-gold text-black"
                              : "bg-zinc-900/60 border-zinc-800 text-zinc-500 hover:bg-zinc-800 hover:text-white",
                          )}
                        >
                          {getPaymentStatusConfig(value).label}
                        </button>
                      ))}
                    </div>
                    {paymentFilter !== "all" && (
                      <Button
                        variant="ghost"
                        className="mt-2 h-10 w-full rounded-xl border border-zinc-800 text-[10px] font-black uppercase tracking-widest text-rose-500 transition-all hover:bg-rose-500 hover:text-white"
                        onClick={() => {
                          setPaymentFilter("all");
                          setCurrentPage(0);
                        }}
                      >
                        Limpar Status de Pagamento
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
                setFilter("open");
                setCurrentPage(0);
              }}
              className={cn(
                "px-5 h-11 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border shrink-0 snap-center",
                filter === "open"
                  ? "bg-admin-gold border-admin-gold text-black shadow-[0_0_20px_rgba(212,175,55,0.2)]"
                  : "bg-zinc-900/60 border-zinc-800 text-zinc-500 hover:bg-zinc-800 hover:text-white",
              )}
            >
              Em Aberto
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
            {/* Saída honesta para ver tudo — inclusive cancelado e
                entregue, que "Em Aberto" tira. Fica no FIM da fileira, não
                perto do topo, porque não é o caminho recomendado. */}
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
              Todos
            </button>
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
              <div className="admin-glass relative flex flex-col items-center justify-center overflow-hidden rounded-[2rem] border border-white/5 px-6 py-12 text-center">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-admin-gold/[0.02] to-transparent" />
                <div className="relative z-10 mb-3 rounded-full border border-white/5 bg-zinc-900/60 p-4 shadow-xl">
                  <Package className="size-6 text-zinc-600" />
                </div>
                {paymentFilter !== "all" ? (
                  // O filtro de payment_status é client-side sobre a página já
                  // carregada (12 pedidos), não sobre os 64+ pedidos do banco —
                  // "nenhum pedido" aqui é "nenhum NESTA página", nunca "não
                  // existe nenhum pedido com este status". Ver Item 1 da
                  // revisão da Task 9.
                  <>
                    <h3 className="relative z-10 text-xs font-black uppercase tracking-widest text-zinc-400">
                      Nenhum pedido desta página tem este status de pagamento
                    </h3>
                    <p className="relative z-10 mt-2 max-w-xs text-[10px] font-bold uppercase leading-relaxed tracking-widest text-zinc-600">
                      O filtro só olha a página atual. Navegue pelas páginas ou
                      limpe o filtro para ver todos os pedidos.
                    </p>
                  </>
                ) : filter !== "all" ||
                  searchQuery.trim() !== "" ||
                  dateRange.start ||
                  dateRange.end ? (
                  // O padrão da tela virou "Em Aberto" — um resultado já
                  // FILTRADO no servidor — e a busca/período são ANDados com
                  // esse filtro. Lista vazia aqui não prova "loja sem
                  // pedido nenhum", só que nada bate com o que está sendo
                  // pedido agora. Achado da revisão desta tarefa: 75 dos 83
                  // pedidos do banco caem aqui se buscados pelo número na
                  // tela padrão — dizer o absoluto manda a lojista desistir
                  // de um pedido que existe.
                  <>
                    <h3 className="relative z-10 text-xs font-black uppercase tracking-widest text-zinc-400">
                      Nenhum pedido corresponde ao que está sendo mostrado agora
                    </h3>
                    <p className="relative z-10 mt-2 max-w-xs text-[10px] font-bold uppercase leading-relaxed tracking-widest text-zinc-600">
                      Pode ser o filtro de status, a busca ou o período
                      aplicado. Toque em "Todos", no fim da fileira de filtros,
                      ou limpe a busca e o período para ver todos os pedidos.
                    </p>
                  </>
                ) : (
                  // Sem filtro de status, sem busca e sem período: aqui a
                  // lista vazia é mesmo "loja sem pedido nenhum".
                  <h3 className="relative z-10 text-xs font-black uppercase tracking-widest text-zinc-400">
                    Ainda não tem nenhum pedido
                  </h3>
                )}
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
          <div className="flex flex-col items-end gap-1.5">
            <OrderStatusBadge status={order.status} />
            <PaymentStatusBadge
              paymentStatus={order.paymentStatus}
              orderStatus={order.status}
            />
          </div>
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
        <div className="flex shrink-0 flex-col items-end gap-1">
          <OrderStatusBadge status={order.status} />
          <PaymentStatusBadge
            paymentStatus={order.paymentStatus}
            orderStatus={order.status}
          />
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
