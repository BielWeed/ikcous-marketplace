import { LazyImage } from "@/components/LazyImage";
import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import {
  AdminKpiCarousel,
  type KpiCardConfig,
} from "@/components/admin/AdminKpiCarousel";
import { DebouncedSearchInput } from "@/components/admin/DebouncedSearchInput";
import { PaginacaoAdmin } from "@/components/admin/PaginacaoAdmin";
import { PontoDeOperacao } from "@/components/admin/PontoDeOperacao";
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
import { podeRegistrarPagamento } from "@/components/admin/orders/podeRegistrarPagamento";
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
import { useStore } from "@/contexts/StoreContext";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  mensagemAmigavelErroAtualizacaoStatus,
  useOrders,
} from "@/hooks/useOrders";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { useViewTransition } from "@/hooks/useViewTransition";
import { horarioRelativo } from "@/lib/horario-relativo";
import { mapOrderFromDB } from "@/lib/mappers";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { linkWhatsappDoCliente } from "@/lib/whatsapp-do-cliente";
import type { Order, OrderStatus, PaymentStatus, View } from "@/types";
import { haptic } from "@/utils/haptic";
import { AlertasCancelados } from "@/views/admin/AlertasCancelados";
import { motion } from "framer-motion";
import {
  Calendar,
  CheckCircle2,
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

/**
 * Valores do filtro de pagamento, na ordem em que aparecem no dropdown.
 * Exportada para o teste não montar a tela inteira (mesmo motivo de
 * `filterOrdersByPaymentStatus`, abaixo).
 *
 * `recebido_na_entrega` acrescentado na Task 3b do plano
 * docs/superpowers/plans/2026-08-27-recebimento-na-entrega.md — lacuna de
 * funcionalidade (não é um dos sete pontos de dinheiro daquele plano, mas
 * foi medida junto): sem esta linha o lojista não tinha como filtrar a
 * lista por "recebido na entrega".
 */
export const PAYMENT_STATUS_FILTER_VALUES: PaymentStatusKey[] = [
  "aguardando",
  "pago",
  "recusado",
  "expirado",
  "estornado",
  "pago_apos_expirar",
  "recebido_na_entrega",
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

/**
 * Balde de estorno devido — Task 5 do plano de cancelamento-com-estorno
 * (docs/superpowers/plans/2026-08-24-cancelamento-com-estorno.md).
 *
 * A LISTA É DERIVADA, NUNCA GRAVADA: nenhuma coluna nova, nenhuma escrita.
 * `null` cobre os DOIS casos que impedem esta lista de virar ruído
 * permanente: pedido que nunca recebeu pagamento (nada a estornar) e
 * pedido com `payment_status = 'estornado'` (a lojista já resolveu pelo
 * painel do Mercado Pago — é assim que o item sai do balde de DINHEIRO
 * sozinho, quando o webhook atualiza esse campo).
 *
 * ⚠️ Isso não quer dizer que o pedido some da TELA inteira: o balde de
 * MERCADORIA (`precisaConfirmarRetornoDoProduto`, abaixo) é independente e
 * pode continuar mostrando o mesmo pedido — em outro container, com outro
 * título — até o produto voltar de verdade, pago, estornado ou nunca
 * cobrado (achado da revisão de 26/08/2026: a versão anterior deste
 * comentário lia "é assim que o item SAI da lista sozinho" sem dizer DE
 * QUAL lista, e isso deixou de ser verdade para a de mercadoria).
 */
export type BaldeDeEstorno = "devolver_agora" | "esperando_o_produto" | null;

/**
 * `pedido.cancelledAfterShipping && !pedido.returnedToSellerAt` é a mesma
 * regra que a migration `20260970000000` (ainda não aplicada — ver o
 * plano) grava no servidor: só espera o produto voltar quando ele
 * realmente SAIU e ainda não voltou. Fora disso (não enviado, ou já
 * enviado e devolvido), a lojista já pode devolver o dinheiro.
 *
 * ⚠️ Item 3 da revisão de 27/08/2026: uma versão anterior deste comentário
 * dizia que o ramo `"esperando_o_produto"` abaixo "NÃO tem consumidor em
 * produção" e sobrevivia só como "resíduo… fora do escopo". Isso é falso, e
 * foi medido por mutação: trocar aquele `return` por `"devolver_agora"` põe
 * o pedido cancelado-após-envio, pago, com a mercadoria ainda fora, DENTRO
 * de `pedidosParaDevolverAgora` (o balde "Devolver agora" da tela) — porque
 * esse balde filtra exatamente por `baldeDeEstorno(o) === "devolver_agora"`.
 * O VALOR da string `"esperando_o_produto"` não é lido em lugar nenhum fora
 * dos testes; o RAMO é a guarda que impede esse pedido de cair no balde de
 * dinheiro antes da hora — é ele quem sustenta a regra do Gabriel de
 * 24/08/2026 (só se estorna depois do produto voltar). Quem decide se o
 * CARD de mercadoria aparece continua sendo `precisaConfirmarRetornoDoProduto`,
 * abaixo — as duas funções coexistem de propósito: uma guarda dinheiro, a
 * outra guarda mercadoria. Apagar o ramo sem entender isso move pedidos para
 * o balde errado.
 */
export function baldeDeEstorno(pedido: Order): BaldeDeEstorno {
  if (pedido.status !== "cancelled") return null;
  // Terceira porta do balde, acrescentada na Task 3b do plano
  // docs/superpowers/plans/2026-08-27-recebimento-na-entrega.md: dinheiro
  // recebido na entrega e depois cancelado é dinheiro que entrou, igual a
  // `pago`/`pago_apos_expirar` — sem esta porta, o aviso âmbar do servidor
  // ("N pedidos receberam pagamento e estão cancelados") contava o pedido e
  // esta lista não mostrava nenhum cartão para ele.
  const entrou =
    pedido.paymentStatus === "pago" ||
    pedido.paymentStatus === "pago_apos_expirar" ||
    pedido.paymentStatus === "recebido_na_entrega";
  if (!entrou) return null;
  if (pedido.cancelledAfterShipping && !pedido.returnedToSellerAt) {
    return "esperando_o_produto";
  }
  return "devolver_agora";
}

/**
 * Achado da revisão (26/08/2026): a alavanca de MERCADORIA — o botão "O
 * produto voltou" que devolve o item ao estoque — estava embutida dentro
 * de `baldeDeEstorno`, atrás do `entrou` (pagamento). Pedido fechado "na
 * entrega" (PIX/cartão/dinheiro na mão) usa a RPC v23, que decrementa
 * estoque na criação e NUNCA grava `payment_status` — fica NULL. Cancelado
 * depois de enviado, esse pedido tinha `entrou = false` e `baldeDeEstorno`
 * devolvia `null`: a peça saía do catálogo para sempre, sem nenhum sinal
 * na tela e sem chamador nenhum de `confirmarRetornoDoProduto` além deste.
 *
 * "Onde está a minha mercadoria?" é uma pergunta independente de "quanto
 * eu devo de dinheiro?" — a primeira não depende de pagamento nenhum, só
 * de o produto ter SAÍDO (`cancelledAfterShipping`) e ainda não ter
 * voltado (`!returnedToSellerAt`). Pago ou não.
 */
export function precisaConfirmarRetornoDoProduto(pedido: Order): boolean {
  return (
    pedido.status === "cancelled" &&
    Boolean(pedido.cancelledAfterShipping) &&
    !pedido.returnedToSellerAt
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
  // A-3 (laudo varredura 01/09): o nome da LOJA para o recibo impresso.
  // Este é o ancestral mais alto da cadeia do recibo (AdminOrdersView ->
  // OrderDetail -> OrderReceipt) — o nome oficial nas telas é
  // `config.storeName?.trim() || branding.appName`, e é ele que vai para o
  // papel, não o branding do build.
  const { config } = useStore();
  const storeNameDaLoja = config.storeName?.trim() || branding.appName;
  const [recentOrderChanges, setRecentOrderChanges] = useState<
    Record<string, "INSERT" | "UPDATE">
  >({});
  const onRealtimeEventRef = useRef<(payload: any) => void>(() => {});
  const {
    orders,
    loadOrders,
    updateOrderStatus,
    confirmarRetornoDoProduto,
    registrarPagamentoRecebido,
    totalOrders,
    isLoaded,
    loading,
    // Defaults: vários testes existentes (fora do escopo desta tarefa)
    // mocam `useOrders` com um retorno menor, anterior a estes campos —
    // sem o default, `pedidosCancelados.filter(...)` explode com
    // "Cannot read properties of undefined" para quem não sabe que este
    // campo passou a existir. O hook real (useOrders.ts) nunca devolve
    // `undefined` aqui; isto só protege dublê incompleto de teste.
    pedidosCancelados = [],
    fetchPedidosCancelados = async () => [],
    // Achados B/D da revisão de 26/08/2026 (rodada 4) — mesma razão do
    // default acima, campo mais novo ainda.
    pedidosCanceladosIncompleto = false,
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
  // Filtro de payment_status: filtra NO BANCO (migration 20261028000000 —
  // p_payment_status na get_admin_orders_paged): a lista inteira e o total
  // da paginação respeitam o filtro. O recorte em memória
  // (filterOrdersByPaymentStatus, abaixo) é defesa, não a regra.
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
  // B1 da 2a revisao: inferir erro de !selectedOrder mostrava a tela de
  // erro NO PRIMEIRO QUADRO de toda abertura de pedido (efeito passivo
  // roda depois do paint). detailError so e true quando o catch rodou.
  const [detailError, setDetailError] = useState(false);
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
    // PAINEL-05: `?? null` + "—" na exibição — `|| 0` afirma "R$ 0,00"
    // quando a RPC falhou; o travessão não afirma nada (mesma razão do
    // `completed` abaixo, que já fazia certo).
    revenueDay: analyticsStats?.today?.revenue ?? null,
    pending: analyticsStats?.today?.pending ?? null,
    avgTicket:
      analyticsStats?.averageTicket ??
      analyticsStats?.executive?.avgTicket ??
      null,
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
        revenueDay: analyticsStats.today?.revenue ?? null,
        pending: analyticsStats.today?.pending ?? null,
        avgTicket:
          analyticsStats.averageTicket ??
          analyticsStats.executive?.avgTicket ??
          null,
        completed: analyticsStats.deliveredTotal ?? null,
      });
    }
  }, [analyticsStats]);

  // Pedidos com dinheiro recebido em pedido cancelado. A migration que
  // alimenta este contador conta TRÊS portas desde a `20261021000000`
  // (Task 2 do plano docs/superpowers/plans/2026-08-27-recebimento-na-entrega.md):
  //   payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
  //   AND status = 'cancelled'
  // O texto precisa valer para as três — "pago depois de cancelado" só é
  // verdade na segunda, e "recebido na entrega" é a loja confirmando na
  // mão, sem gateway nenhum (achado 1 da revisão original, achado 2 da
  // Task 3c). O único sinal disso antes era a etiqueta no cartão da lista,
  // que rola para fora de vista conforme chegam pedidos novos — daqui vem
  // o aviso fixo logo abaixo dos cartões de métrica.
  const paidOnCancelledCount = analyticsStats?.paidOnCancelled ?? 0;
  const avisoPagoAposCancelado =
    paidOnCancelledCount === 1
      ? "1 pedido recebeu pagamento e está cancelado"
      : `${paidOnCancelledCount} pedidos receberam pagamento e estão cancelados`;

  // Os dois baldes de mercadoria/estorno devido (Task 5). Achado BLOQUEIA 1
  // da revisão de 26/08/2026: antes derivavam de `orders` — a página já
  // FILTRADA/paginada da tela principal — e com o filtro padrão "Em
  // Aberto" (que exclui `cancelled` no servidor, ver `filter` acima), os
  // dois baldes ficavam SEMPRE vazios, mesmo com pedido cancelado esperando
  // confirmação de retorno. Agora derivam de `pedidosCancelados`: uma
  // consulta PRÓPRIA do hook (`useOrders.fetchPedidosCancelados`), com
  // filtro fixo em `cancelled`, sem busca e sem período — carregada uma vez
  // quando a tela fica ativa (ver o efeito logo abaixo, junto de
  // `loadAllData`) e imune a filtro, busca, período e paginação da tela.
  //
  // `pedidosEsperandoRetorno` usa `precisaConfirmarRetornoDoProduto`, NÃO
  // `baldeDeEstorno`: a alavanca de mercadoria tem que aparecer para todo
  // pedido cancelado-após-envio sem retorno confirmado, pago ou não (achado
  // da revisão de 26/08/2026 — ver o comentário da função). O balde de
  // DINHEIRO (`pedidosParaDevolverAgora`, abaixo) continua exigindo
  // pagamento: `baldeDeEstorno` só devolve `"devolver_agora"` quando
  // `entrou` é verdadeiro, então um pedido nunca pago nunca entra nele.
  const pedidosEsperandoRetorno = useMemo(
    () => pedidosCancelados.filter((o) => precisaConfirmarRetornoDoProduto(o)),
    [pedidosCancelados],
  );
  const pedidosParaDevolverAgora = useMemo(
    () =>
      pedidosCancelados.filter((o) => baldeDeEstorno(o) === "devolver_agora"),
    [pedidosCancelados],
  );
  const [confirmandoRetornoId, setConfirmandoRetornoId] = useState<
    string | null
  >(null);
  const handleConfirmarRetorno = useCallback(
    async (orderId: string) => {
      setConfirmandoRetornoId(orderId);
      try {
        await confirmarRetornoDoProduto(orderId);
      } catch (err) {
        // O hook (`useOrders.confirmarRetornoDoProduto`) já mostra o
        // próprio toast de erro traduzido — não duplicar aviso aqui (mesmo
        // motivo do catch de `handleStatusChange`, acima).
        console.error(
          "[handleConfirmarRetorno] Erro ao confirmar retorno:",
          err,
        );
      } finally {
        setConfirmandoRetornoId(null);
      }
    },
    [confirmarRetornoDoProduto],
  );

  /**
   * Task 4 do plano docs/superpowers/plans/2026-08-27-recebimento-na-entrega.md
   * — botão no cartão do pedido. Mesmo molde de `handleConfirmarRetorno`
   * acima: `try/catch/finally` com um estado próprio para desabilitar o
   * botão durante a chamada. O hook (`useOrders.registrarPagamentoRecebido`)
   * já mostra o próprio toast de erro traduzido — não duplicar aviso aqui
   * (mesmo motivo do catch de `handleConfirmarRetorno`, acima).
   */
  const [registrandoPagamentoId, setRegistrandoPagamentoId] = useState<
    string | null
  >(null);
  const handleRegistrarPagamento = useCallback(
    async (orderId: string, recebido: boolean) => {
      setRegistrandoPagamentoId(orderId);
      try {
        await registrarPagamentoRecebido(orderId, recebido);
      } catch (err) {
        console.error(
          "[handleRegistrarPagamento] Erro ao registrar pagamento recebido:",
          err,
        );
      } finally {
        setRegistrandoPagamentoId(null);
      }
    },
    [registrarPagamentoRecebido],
  );

  const kpiCards = useMemo<readonly KpiCardConfig[]>(
    () => [
      {
        label: "Receita Hoje",
        value:
          stats.revenueDay !== null
            ? `R$ ${stats.revenueDay.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
            : "—",
        icon: DollarSign,
        accent: "text-emerald-500",
        subValue: "Finanças",
      },
      {
        label: "Ações Pendentes",
        value: stats.pending !== null ? stats.pending.toString() : "—",
        icon: Clock,
        accent: "text-amber-500",
        subValue: ACOES_PENDENTES_SUBTITULO,
      },
      {
        label: "Ticket Médio",
        value:
          stats.avgTicket !== null
            ? `R$ ${stats.avgTicket.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
            : "—",
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

    // B1+B2 da 3a revisao: limpar AMBOS os estados de detalhe no TOPO do
    // efeito, ANTES dos retornos rapidos — senao "Voltar aos pedidos" e
    // "clicar noutro pedido da lista" deixavam detailError=true e o painel
    // morria ate o F5 (a view nunca desmonta por causa do DeferredTabContent).
    setDetailError(false);
    setLoadingDetail(false);

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
      setDetailError(false);
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
        if (isCurrent) {
          toast.error("Erro ao carregar detalhes do pedido");
          setDetailError(true);
        }
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
        // Achado 10 do laudo (29/08): o filtro de pagamento filtra NO BANCO
        // (migration 20261028000000) — a lista inteira e o total da
        // paginação passam a respeitar o filtro, não só a página aberta. O
        // recorte em memória (filterOrdersByPaymentStatus, abaixo) fica
        // como defesa.
        paymentFilter,
      );
      loadStats();
    },
    [
      loadOrders,
      itemsPerPage,
      filter,
      searchQuery,
      dateRange,
      loadStats,
      paymentFilter,
    ],
  );

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      loadAllData(currentPage, false);
    }, 320);
    return () => clearTimeout(timer);
  }, [currentPage, filter, searchQuery, dateRange, active, loadAllData]);

  // Carrega o painel de mercadoria/estorno (`pedidosCancelados`, acima) UMA
  // VEZ quando a tela fica ativa. As dependências são só `active` e a
  // referência (estável, ver `useOrders.fetchPedidosCancelados`) da própria
  // função — NUNCA `filter`/`searchQuery`/`dateRange`/`currentPage`, que são
  // exatamente as quatro coisas que faziam o painel sumir sozinho (BLOQUEIA
  // 1 da revisão de 26/08/2026). `.catch(() => {})` é defesa redundante: o
  // hook já engole o próprio erro e nunca rejeita esta Promise, mas uma
  // falha aqui não pode, em hipótese nenhuma, derrubar a lista principal de
  // pedidos — o trabalho do dia da lojista.
  useEffect(() => {
    if (!active) return;
    fetchPedidosCancelados().catch(() => {});
  }, [active, fetchPedidosCancelados]);

  // Laudo #2 (L-2): a saída MANUAL do balde de estorno. O item some sozinho
  // só quando o webhook do Mercado Pago atualiza `payment_status` — e o
  // próprio webhook documenta que ninguém jamais observou essa notificação
  // chegar (issue #212). Sem uma porta manual, o card ficava na tela para
  // sempre. A RPC no servidor é guarda de admin; o confirm aqui evita
  // registrar por engano um estorno que ainda não aconteceu.
  const [estornandoId, setEstornandoId] = useState<string | null>(null);
  const registrarEstornoFeito = async (pedido: {
    id: string;
    total?: number | null;
    customer?: { name?: string | null } | null;
  }) => {
    const valor = (pedido.total || 0).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
    });
    const cliente = pedido.customer?.name || "o cliente";
    if (
      !globalThis.confirm(
        `Confirma que você JÁ devolveu R$ ${valor} para ${cliente} no painel do Mercado Pago?\n\nIsso marca o pedido como estornado e o remove da lista "Devolver agora".`,
      )
    ) {
      return;
    }
    setEstornandoId(pedido.id);
    try {
      const { error } = await supabase.rpc("registrar_estorno_manual", {
        p_order_id: pedido.id,
      });
      if (error) throw error;
      toast.success("Estorno registrado — o pedido saiu da lista.");
      await fetchPedidosCancelados().catch(() => {});
    } catch (e) {
      console.error("Erro ao registrar estorno manual:", e);
      toast.error("Não consegui registrar o estorno. Tente de novo.");
    } finally {
      setEstornandoId(null);
    }
  };

  /**
   * O botão "Ver pedidos" da pílula de alertas. O botão leva aos
   * CANCELADOS, não a um payment_status específico: a contagem larga cobre
   * as TRÊS portas do contrato ampliado ('pago', 'pago_apos_expirar' e,
   * desde a `20261021000000`, 'recebido_na_entrega' — com status=
   * 'cancelled'), e filtrar por um valor só deixava parte dos pedidos
   * "presos" fora da lista — a etiqueta de cada cartão já marca qual porta é
   * cada um (achado 1 da revisão). Busca e período também são zerados: sem
   * isso um filtro de uma sessão anterior sobrevivia e a lista vinha vazia
   * sem o lojista perceber por quê (achado 2 da revisão).
   *
   * E rola até a lista: sem o scroll, o clique mudava filtros invisíveis e
   * o lojista lia "botão que não funciona" (relato do Gabriel, 02/09).
   */
  const irParaPedidosCancelados = () => {
    setFilter("cancelled");
    setPaymentFilter("all");
    setSearchQuery("");
    setDateRange({ start: "", end: "" });
    setCurrentPage(0);
    setTimeout(() => {
      document
        .getElementById("admin-pedidos-lista")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

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
          `Pedido #${updatedId ? updatedId.slice(-6) : ""} atualizado para ${statusConfig[newStatus]?.label ?? `Status: ${newStatus}`}`,
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

  // Achado 2 do lote 1 (caça-defeitos): `currentPage` vem do localStorage e
  // sobrevive entre sessões. Se a lojista fechou o painel na página 2 e, até
  // reabrir, os pedidos que a preenchiam saíram do filtro (entregues,
  // cancelados, separados), `totalPages` encolhe e a página salva fica fora
  // do intervalo — como o bloco de paginação só existe quando
  // `totalPages > 1`, não sobra nenhum botão para voltar. Este é o ÚNICO dos
  // `setCurrentPage(0)` deste arquivo que roda sem clique nenhum da lojista.
  // Espera `isLoaded` (carregamento assentado) antes de agir: durante a
  // busca, `totalPages` pode valer 0 ou 1 momentaneamente com o valor
  // provisório do cache, e resetar ali derrubaria uma navegação legítima.
  useEffect(() => {
    if (!isLoaded) return;
    if (currentPage > 0 && currentPage >= totalPages) {
      setCurrentPage(0);
    }
  }, [isLoaded, currentPage, totalPages, setCurrentPage]);

  // ── A loja tem pedido NENHUM, ou o filtro é que está vazio? ─────────────
  // `totalOrders` do hook é o total da consulta FILTRADA — numa loja vazia
  // com o filtro padrão "Em Aberto" ele é 0, mas o MESMO 0 acontece numa
  // loja cheia de pedidos antigos cujo "Em Aberto" está vazio. Sem essa
  // distinção, o lojista da loja nova recebia "pode ser o filtro..." para
  // uma loja que sequer tem venda (relato do Gabriel, 02/09). Quando a
  // lista aparece vazia, medimos o ABSOLUTO: um COUNT sem filtro nenhum
  // (head count: não baixa linha nenhuma), uma vez por vida do card.
  const [totalAbsolutoNaLoja, setTotalAbsolutoNaLoja] = useState<number | null>(
    null,
  );
  const listaVazia = active && isLoaded && paginatedOrders.length === 0;
  useEffect(() => {
    if (!listaVazia || totalAbsolutoNaLoja !== null) return;
    // Best-effort de verdade: se a consulta não puder existir/rodar (dublês
    // de teste com builder parcial, ambiente sem a tabela), a tela continua
    // com as mensagens de sempre — a medição só ADICIONA o caso "loja vazia
    // de verdade", nunca remove nada.
    try {
      let cancelado = false;
      const consulta = supabase
        .from("marketplace_orders")
        .select("*", { count: "exact", head: true });
      void (
        consulta as unknown as {
          then?: (
            ok: (r: { count: number | null; error: unknown }) => void,
          ) => void;
        }
      ).then?.(({ count, error }) => {
        if (!cancelado && !error && count !== null) {
          setTotalAbsolutoNaLoja(count);
        }
      });
      return () => {
        cancelado = true;
      };
    } catch {
      // Sem medição, as mensagens existentes seguem valendo.
    }
  }, [listaVazia, totalAbsolutoNaLoja]);

  // `silent` é código morto HOJE: o único chamador real é `OrderDetail`
  // (`onStatusChange={handleStatusChange}` logo abaixo), e `OrderDetailProps.
  // onStatusChange` (OrderDetail.tsx) tem assinatura de 2 argumentos, sem
  // `silent` — nenhum clique de verdade passa `true` aqui. Mantido mesmo
  // assim (não removido) porque `updateOrderStatus` do hook já aceita e usa
  // esse parâmetro para outros chamadores (ex.: CheckoutView, no cancelamento
  // automático) — se um dia esta view ganhar um caminho silencioso próprio
  // (ex.: sincronização em lote), o guard do catch abaixo já cobre o caso sem
  // precisar lembrar de adicioná-lo depois.
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

      // Achado 1 (caça-defeitos, Task 4c) — `handleStatusChange` é função
      // comum, não `useCallback`: fecha sobre o `selectedOrder` do render em
      // que foi criada. Desde a Task 4b, `onRegistrarPagamento` (chamado
      // ANTES desta função pelo `OrderDetail.confirmarRecebimentoEAvancar`,
      // com um `await` real de RPC no meio) já pode ter atualizado
      // `pagamentoRecebidoEm` no estado por fora deste fecho; reescrever o
      // objeto a partir do `selectedOrder` CAPTURADO (o de antes daquele
      // `await`) apagava de volta o recebimento que acabou de ser gravado —
      // a ficha voltava a oferecer "Marcar como recebido" como se o
      // dinheiro não tivesse entrado, mesmo com o banco certo. Atualização
      // funcional lê o estado CORRENTE, nunca o capturado, e imuniza este
      // ponto contra qualquer `await` que venha a ser inserido antes dele
      // no futuro.
      setSelectedOrder((prev) =>
        prev?.id === orderId ? { ...prev, status: newStatus } : prev,
      );

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

      // Laudo 0109 (A-7): número sem DDD+numero não abre conversa válida.
      // O util decide: sem link, o toque não abre janela nenhuma.
      const link = linkWhatsappDoCliente(order.customer?.whatsapp);
      if (!link) return;
      const url = `${link}?text=${encodeURIComponent(message)}`;
      globalThis.open(url, "_blank");
    },
    [isOffline],
  );

  // Removed early return loading block to prevent visual layout shifts

  // PAINEL-03: a guarda antiga `(loadingDetail || !selectedOrder)` mantinha o
  // spinner PARA SEMPRE quando o fetch falhava — `selectedOrder` ficava null e
  // `loadingDetail` já tinha voltado a false. Agora: loading = spinner; fetch
  // concluído sem resultado = tela de erro com botão de voltar.
  if (selectedOrderId && loadingDetail) {
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

  if (selectedOrderId && !loadingDetail && detailError) {
    // PAINEL-03: fetch concluiu sem resultado — erro de rede, id inválido,
    // ou sessão expirou. Antes: spinner eterno; agora: erro + voltar.
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center bg-[#09090b] text-white">
        <div className="flex size-16 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10">
          <svg
            className="size-8 text-red-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        </div>
        <div className="mt-6 flex flex-col items-center gap-1.5 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-400">
            Não foi possível carregar
          </p>
          <p className="max-w-[240px] text-[9px] font-bold uppercase leading-none tracking-widest text-zinc-500">
            Verifique a conexão e tente novamente
          </p>
          <button
            onClick={() => onNavigate("admin-orders")}
            className="mt-4 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-white transition-colors hover:border-amber-500/30 hover:bg-amber-500/10"
          >
            Voltar aos pedidos
          </button>
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
            onRegistrarPagamento={registrarPagamentoRecebido}
            storeName={storeNameDaLoja}
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
          {/* Missão 06 (C3): a tag "Operações ao Vivo" mentia — ficava verde
              depois da carga mesmo com o tempo real morto. O ponto mostra o
              estado REAL de conexão (medido no AdminLayout e compartilhado);
              o âmbar da carga inicial é o único "sincronizando" honesto. */}
          <PontoDeOperacao sincronizando={!isLoaded} className="mr-2" />
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

        {/* Alertas de pedidos cancelados colapsados numa pílula (pedido do
            Gabriel, 02/09: os três blocos gigantes ficavam abertos o tempo
            todo e empurravam a lista real de pedidos para fora da tela).
            Conteúdo, textos e handlers intactos — o espaço é que mudou. */}
        <AlertasCancelados
          pagoCanceladoCount={paidOnCancelledCount}
          avisoPagoAposCancelado={avisoPagoAposCancelado}
          pedidosEsperandoRetorno={pedidosEsperandoRetorno}
          pedidosParaDevolverAgora={pedidosParaDevolverAgora}
          incompleto={pedidosCanceladosIncompleto}
          confirmandoRetornoId={confirmandoRetornoId}
          onConfirmarRetorno={handleConfirmarRetorno}
          estornandoId={estornandoId}
          onRegistrarEstorno={registrarEstornoFeito}
          onVerPedidos={irParaPedidosCancelados}
        />

        {/* Unified Control Bar Compacta — âncora do scroll do botão "Ver
            pedidos" da pílula de alertas (id lido por
            `irParaPedidosCancelados`). */}
        <div
          id="admin-pedidos-lista"
          className="relative mb-8 mt-4 flex flex-col border-t border-white/5 pt-8"
        >
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
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                {totalAbsolutoNaLoja === 0 ? (
                  // O COUNT sem filtro nenhum voltou ZERO: a loja não tem
                  // venda nenhuma. Falar de filtro/busca para quem ainda
                  // não tem o primeiro pedido é receita de confusão (relato
                  // do Gabriel, 02/09 — a foto mostrava a loja vazia com a
                  // orientação de "limpar o filtro").
                  <>
                    <h3 className="relative z-10 text-xs font-black uppercase tracking-widest text-zinc-400">
                      Ainda não tem nenhum pedido
                    </h3>
                    <p className="relative z-10 mt-2 max-w-xs text-[10px] font-bold uppercase leading-relaxed tracking-widest text-zinc-600">
                      Quando a primeira venda acontecer, o pedido aparece aqui —
                      com status, valor e o atalho de WhatsApp para o cliente.
                    </p>
                  </>
                ) : paymentFilter !== "all" ? (
                  // O filtro de payment_status roda NO BANCO (lista E
                  // contagem). Lista vazia aqui é "não existe nenhum pedido
                  // com este status" — a saída honesta é limpar o filtro.
                  // Laudo 0109 (A-5): o texto antigo mandava paginar por um
                  // filtro client-side que morreu.
                  <>
                    <h3 className="relative z-10 text-xs font-black uppercase tracking-widest text-zinc-400">
                      Nenhum pedido com esse filtro de pagamento
                    </h3>
                    <p className="relative z-10 mt-2 max-w-xs text-[10px] font-bold uppercase leading-relaxed tracking-widest text-zinc-600">
                      Nenhum pedido com esse status de pagamento. Limpe o filtro
                      para ver todos os pedidos.
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
                    onRegistrarPagamento={handleRegistrarPagamento}
                    registrandoPagamento={registrandoPagamentoId === order.id}
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {paginatedOrders.map((order) => (
                  <AdminOrderCard
                    key={order.id}
                    order={order}
                    viewMode="compact"
                    onSelect={handleSelectOrder}
                    onWhatsApp={handleWhatsApp}
                    changeType={recentOrderChanges[order.id]}
                    onRegistrarPagamento={handleRegistrarPagamento}
                    registrandoPagamento={registrandoPagamentoId === order.id}
                  />
                ))}
              </div>
            )}
          </div>
        </LocalErrorBoundary>

        {/* Missão 06 (C2): paginação única do painel. "Perfil do Setor" morre;
            o contador "Exibindo X - Y de Z" é o retorno de total que faltava
            (com 8 pedidos a tela nunca dizia quantos existem). */}
        <PaginacaoAdmin
          pagina={currentPage}
          totalPaginas={totalPages}
          totalItens={totalOrders}
          itensPorPagina={itemsPerPage}
          aoMudar={(nova) => {
            setCurrentPage(nova);
            const mainEl =
              document.querySelector(".admin-scroll-container") ||
              document.querySelector(".active-scroll-container") ||
              document.querySelector("main");
            if (mainEl) mainEl.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="pt-12"
        />
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
  /** Task 4 — chama `registrarPagamentoRecebido(orderId, recebido)` do hook. */
  readonly onRegistrarPagamento: (orderId: string, recebido: boolean) => void;
  /** Task 4 — true enquanto ESTE pedido está em voo na RPC (desabilita o botão). */
  readonly registrandoPagamento: boolean;
}

const AdminOrderCard = memo(function AdminOrderCard({
  order,
  viewMode,
  onSelect,
  onWhatsApp,
  changeType,
  onRegistrarPagamento,
  registrandoPagamento,
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
              {/* "Valor": o termo antigo "Valor Capital" não dizia nada para
                  o lojista leigo (relato do Gabriel, 02/09). */}
              <span className="text-[9px] font-black uppercase tracking-[0.3em] text-zinc-600 ">
                Valor
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
              {/* Laudo 0109 (A-7, ressalva da revisão): sem número válido o
                  toque não tinha efeito — botão mudo. Some como na ficha. */}
              {linkWhatsappDoCliente(order.customer?.whatsapp) && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onWhatsApp(order);
                  }}
                  className="relative z-10 flex size-12 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-500 shadow-xl transition-all hover:bg-emerald-500 hover:text-black"
                >
                  <MessageCircle className="size-5" />
                </button>
              )}
              <div className="flex size-12 items-center justify-center text-zinc-500 transition-all duration-300 group-hover:text-admin-gold">
                <ChevronRight className="size-6 transform filter transition-transform duration-300 group-hover:translate-x-1 group-hover:drop-shadow-[0_0_8px_rgba(212,175,55,0.5)]" />
              </div>
            </div>
          </div>

          {/* Task 4 do plano recebimento-na-entrega — botão de pagamento
              recebido na mão. `podeRegistrarPagamento` é a MESMA condição
              (definida uma vez, acima) que decide se este bloco existe e
              qual dos dois ramos aparece dentro dele. */}
          {podeRegistrarPagamento(order) && (
            <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-4">
              {order.pagamentoRecebidoEm ? (
                <>
                  <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400">
                    Recebido em{" "}
                    {new Date(order.pagamentoRecebidoEm).toLocaleDateString(
                      "pt-BR",
                      { day: "2-digit", month: "short" },
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRegistrarPagamento(order.id, false);
                    }}
                    disabled={registrandoPagamento}
                    className="relative z-10 shrink-0 rounded-xl border border-zinc-700/50 bg-zinc-800/50 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-400 transition-all hover:bg-zinc-700 hover:text-white disabled:opacity-50"
                  >
                    Desfazer
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRegistrarPagamento(order.id, true);
                  }}
                  disabled={registrandoPagamento}
                  className="relative z-10 w-full rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-emerald-500 transition-all hover:bg-emerald-500 hover:text-black disabled:opacity-50"
                >
                  {registrandoPagamento
                    ? "Registrando..."
                    : "Marcar como recebido"}
                </button>
              )}
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  // compact mode — REDESENHO (relato do Gabriel, 02/09: card com visual
  // mal acabado — id e data truncados, badge de pagamento estourando a
  // coluna ("PAGÃO FORA DO FLUXO — PRECIS..."), hierarquia invertida).
  // Hierarquia nova, por pergunta do lojista: QUEM comprou (destaque) e O
  // QUÊ (apoio) no topo, com id/data como metadado; badges com rótulo CURTO
  // e truncamento limpo (a frase inteira vai no title); dinheiro e ações no
  // rodapé, sem elemento dominando o card.
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
        "group relative flex flex-col rounded-[1.5rem] border bg-zinc-950/40 p-4 backdrop-blur-md transition-all duration-300 hover:border-admin-gold/30 hover:shadow-[0_15px_40px_rgba(212,175,55,0.05)] active:scale-[0.98] cursor-pointer focus:outline-none focus:ring-2 focus:ring-admin-gold focus:ring-offset-2 focus:ring-offset-zinc-950 animate-in fade-in slide-in-from-bottom-2 duration-300 transform-gpu",
        changeType === "INSERT" &&
          "border-admin-gold shadow-[0_0_20px_rgba(212,175,55,0.3)] animate-pulse",
        changeType === "UPDATE" &&
          "border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.3)] animate-pulse",
        !changeType && "border-white/10",
      )}
    >
      {/* Topo — hierarquia da direção A (Missão 06): VALOR dominante no canto
          superior direito; nome e produto na coluna do meio, protegida com
          min-w-0. Sem badges aqui: em card de ~250px a coluna direita com
          badge largo esmagava o nome até sumir (achado do Gabriel no ao-vivo,
          02/09) — os badges ganham faixa própria logo abaixo. */}
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          {order.items?.[0]?.image ? (
            <LazyImage
              src={order.items[0].image}
              alt="Produto"
              className="size-11 shrink-0 rounded-xl border border-white/10 object-cover"
            />
          ) : (
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-zinc-900">
              <Package className="size-5 text-zinc-600" />
            </div>
          )}
          {order.items?.length > 1 && (
            <div className="absolute -right-1.5 -top-1.5 flex size-4.5 items-center justify-center rounded-full border border-zinc-900 bg-admin-gold text-[8px] font-black text-black shadow-lg">
              +{order.items.length - 1}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h4
            title={order.customer?.name || "Cliente"}
            className="line-clamp-2 text-[13px] font-bold leading-tight text-white transition-colors group-hover:text-admin-gold"
          >
            {order.customer?.name || "Cliente"}
          </h4>
          <p
            title={(() => {
              if (!order.items || order.items.length === 0)
                return "Pedido vazio";
              if (order.items.length === 1) return order.items[0].name;
              return `${order.items[0].name} e mais ${order.items.length - 1}`;
            })()}
            className="mt-0.5 truncate text-[11px] font-medium text-zinc-400"
          >
            {(() => {
              if (!order.items || order.items.length === 0)
                return "Pedido vazio";
              if (order.items.length === 1) return order.items[0].name;
              return `${order.items[0].name} e mais ${order.items.length - 1}`;
            })()}
          </p>
        </div>

        <p className="shrink-0 text-xl font-black tabular-nums leading-none text-white">
          <span className="mr-1 text-[10px] font-bold uppercase text-zinc-500">
            R$
          </span>
          {(order.total || 0).toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
          })}
        </p>
      </div>

      {/* Faixa de identificação: id · horário relativo (quem opera pensa em
          "há 5 min", não em "23/08") e os badges com largura de card inteira
          — wrap honesto: nunca estouram a borda nem esmagam vizinho. */}
      <div className="relative z-10 mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="text-[10px] font-semibold tabular-nums text-zinc-500">
          #{order.id.slice(-6).toUpperCase()} ·{" "}
          {horarioRelativo(order.createdAt)}
        </span>
        <div className="flex flex-wrap items-center gap-1">
          <OrderStatusBadge status={order.status} />
          <PaymentStatusBadge
            paymentStatus={order.paymentStatus}
            orderStatus={order.status}
            compact
          />
        </div>
      </div>

      {/* Rodapé — Missão 06 (direção A): o dinheiro subiu para o topo do card;
          sobram as ações, com o WhatsApp discreto (fim da fileira de botões
          verdes grandes) e o chevron de abertura. */}
      <div className="relative z-10 mt-3 flex items-center justify-between gap-2 border-t border-white/10 pt-3">
        {linkWhatsappDoCliente(order.customer?.whatsapp) ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onWhatsApp(order);
            }}
            className="relative z-10 flex size-8 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-500 transition-all hover:bg-emerald-500 hover:text-black active:scale-90"
            title="WhatsApp"
          >
            <MessageCircle className="size-4" />
          </button>
        ) : (
          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600">
            Ver detalhes
          </span>
        )}
        <ChevronRight className="size-4.5 shrink-0 text-zinc-500 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-admin-gold" />
      </div>

      {/* Task 4 do plano recebimento-na-entrega — mesmo bloco do modo
          "detailed", ver o comentário lá. */}
      {podeRegistrarPagamento(order) && (
        <div className="relative z-10 mt-3 flex items-center justify-between gap-1.5 border-t border-white/10 pt-3">
          {order.pagamentoRecebidoEm ? (
            <>
              <span className="truncate text-[8px] font-black uppercase tracking-widest text-emerald-400">
                Recebido em{" "}
                {new Date(order.pagamentoRecebidoEm).toLocaleDateString(
                  "pt-BR",
                  { day: "2-digit", month: "short" },
                )}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRegistrarPagamento(order.id, false);
                }}
                disabled={registrandoPagamento}
                className="relative z-10 shrink-0 rounded-lg border border-zinc-700/50 bg-zinc-800/50 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-zinc-400 transition-all hover:bg-zinc-700 hover:text-white disabled:opacity-50"
              >
                Desfazer
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRegistrarPagamento(order.id, true);
              }}
              disabled={registrandoPagamento}
              className="relative z-10 w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[8px] font-black uppercase tracking-widest text-emerald-500 transition-all hover:bg-emerald-500 hover:text-black disabled:opacity-50"
            >
              {registrandoPagamento ? "Registrando..." : "Marcar como recebido"}
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
});
