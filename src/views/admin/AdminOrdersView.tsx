import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import {
  AdminKpiCarousel,
  type KpiCardConfig,
} from "@/components/admin/AdminKpiCarousel";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DebouncedSearchInput } from "@/components/admin/DebouncedSearchInput";
import { PaginacaoAdmin } from "@/components/admin/PaginacaoAdmin";
import { PontoDeOperacao } from "@/components/admin/PontoDeOperacao";
import { SupportBanners } from "@/components/admin/dashboard/SupportBanners";
import { BotaoDevolucoes } from "@/components/admin/devolucoes/BotaoDevolucoes";
import {
  AdminOrderCard,
  AdminOrderCardSkeleton,
} from "@/components/admin/orders/AdminOrderCard";
import { GuiaDoPagamentoQueNaoFechou } from "@/components/admin/orders/GuiaDoPagamentoQueNaoFechou";
import { OrderDetail } from "@/components/admin/orders/OrderDetail";
import {
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
import { branding } from "@/config/branding";
import { useStore } from "@/contexts/StoreContext";
import { useAnalytics } from "@/hooks/useAnalytics";
import {
  type EstornoEmCurso,
  useEstornosEmCursoDosPedidos,
} from "@/hooks/useEstornosEmCursoDosPedidos";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  ErroCancelamentoNaoConcluido,
  ErroPedidoMudou,
  mensagemAmigavelErroAtualizacaoStatus,
  useOrders,
} from "@/hooks/useOrders";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { useViewTransition } from "@/hooks/useViewTransition";
import { mapOrderFromDB } from "@/lib/mappers";
import { numeroDoPedido } from "@/lib/numero-do-pedido";
import { pedidosParaCsv } from "@/lib/pedidos-csv";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  valorDevolverAgora,
  valorDevolverAgoraDescontandoLedger,
} from "@/lib/valor-devolver-agora";
import { linkWhatsappDoCliente } from "@/lib/whatsapp-do-cliente";
import type {
  CanalDaVenda,
  Order,
  OrderStatus,
  PaymentStatus,
  View,
} from "@/types";
import { haptic } from "@/utils/haptic";
import { AlertasCancelados } from "@/views/admin/AlertasCancelados";
import {
  CheckCircle2,
  Clock,
  DollarSign,
  Download,
  Filter,
  HelpCircle,
  LayoutGrid,
  List,
  Loader2,
  Package,
  Search,
  TrendingUp,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

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
  // Achado 1 (rodada 2): nada resta para devolver — uma devolução deste
  // pedido já devolveu tudo por fora (reembolso manual concluído). O pedido
  // some do balde de dinheiro sem precisar de nenhum clique.
  if (valorDevolverAgora(pedido) <= 0) return null;
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
    buscarPedidosDoFiltroParaExportar,
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
    // pedidos-4 (20261164000000) — mesma razão dos defaults acima: quem
    // mocou o hook antes deste campo não o conhece; 0 = nada fora da janela.
    canceladosForaDaJanela = 0,
    buscarTambemCanceladosAntigos = async () => [],
  } = useOrders(active ?? false, true, {
    onRealtimeEvent: (payload) => onRealtimeEventRef.current(payload),
  });
  const { stats: analyticsStats, fetchExecutiveSummary } = useAnalytics();

  const [searchQuery, setSearchQuery] = useLocalStorage<string>(
    "admin_orders_search_query",
    "",
  );
  const [isTyping, setIsTyping] = useState(false);
  const [gerandoCsv, setGerandoCsv] = useState(false);
  const exportacaoCsvEmCursoRef = useRef(false);
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
  // Filtro de canal (C4.4): filtra NO BANCO (`p_canal` em
  // `get_admin_orders_paged`, migration 20261163000000 — C1.4), mesmo
  // contrato do filtro de pagamento acima. A chave começa com "admin_" e por
  // isso FICA FORA da whitelist do purge de localStorage (src/lib/
  // localStoragePurgeWhitelist.ts) de propósito: é conveniência de tela, não
  // escrita pendente — a purga pode levá-la sem perda nenhuma.
  const [canalFilter, setCanalFilter] = useLocalStorage<
    "all" | "online" | "presencial"
  >("admin_orders_canal_filter", "all");
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
  // L3e' (lacunas de pagamento, 02/10/2026): o estorno que o Mercado Pago
  // JÁ está fazendo em cada pedido do balde (linhas solicitado/
  // em_processamento de order_refunds). Sem isto, "Devolver agora" pedia o
  // total enquanto o app já devolvia — e quem devolvia por fora pagava duas
  // vezes. Só leitura; ver o hook. Rodada 4: o hook recebe os PEDIDOS (id
  // + valorEstornado) — a leitura vale só para o retrato da lista em que foi
  // feita, e expõe `recarregar` (abrir o painel) e `conferirAgora` (o
  // "Já estornei" decide com leitura fresca).
  const estornos = useEstornosEmCursoDosPedidos(pedidosParaDevolverAgora, {
    // G1 (rodada 2): a releitura periódica só com a tela de pedidos ativa.
    ativo: Boolean(active),
  });
  const estornosEmCurso = estornos.porPedido;
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
  // AdminOrdersView-648: guarda o id do pedido já RESOLVIDO (achado em
  // `orders` OU trazido por `fetchSingleOrder`, abaixo). Antes, este efeito
  // reentrava em `fetchSingleOrder` — e acendia o spinner de tela cheia por
  // cima da ficha — toda vez que `orders` ganhava NOVA REFERÊNCIA (recarga
  // silenciosa por visibilidade/reconexão, realtime INSERT/UPDATE de OUTRO
  // pedido), mesmo com `selectedOrderId` intacto. Como a ficha aberta por
  // deep link (pedido fora da página/filtro carregado) nunca aparece em
  // `orders`, isso remontava `<OrderDetail>` do zero a cada mudança alheia,
  // apagando anotação em edição e o diálogo "Recebeu?" (useState local de
  // OrderDetail.tsx). Comparando contra este ref, só refazemos a busca de
  // rede quando o ID realmente muda — `orders` continua na dependência para
  // pegar o pedido assim que ele aparecer na página carregada.
  const resolvedOrderIdRef = useRef<string | null | undefined>(undefined);
  // Revalidação SILENCIOSA da ficha de deep link (ressalva da revisão de
  // 648): como esse pedido não está em `orders`, um UPDATE de realtime
  // sobre ele não chega pela lista — sem isto a ficha congelaria no retrato
  // da primeira busca. O handler de realtime (abaixo) bumpa o contador; o
  // efeito refaz a busca SEM acender o spinner (a ficha continua montada).
  const [revalidacaoDaFicha, setRevalidacaoDaFicha] = useState(0);
  const revalidacaoSilenciosaRef = useRef(false);
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
    // efeito, ANTES dos retornos rapidos — senao "Voltar aos pedidos",
    // "clicar noutro pedido da lista" e o retorno antecipado de um id ja
    // resolvido (linha abaixo) deixavam detailError=true ou loadingDetail=true
    // presos de uma busca ANTERIOR de OUTRO id, e o painel morria ate o F5
    // (a view nunca desmonta por causa do DeferredTabContent).
    setDetailError(false);
    setLoadingDetail(false);

    if (!selectedOrderId) {
      resolvedOrderIdRef.current = null;
      triggerUpdate(null);
      return;
    }

    if (nextOrder) {
      resolvedOrderIdRef.current = selectedOrderId;
      triggerUpdate(nextOrder);
      return;
    }

    // Pedido fora da página/filtro carregado (deep link, vindo do sino ou
    // da ficha do cliente). Se ESTE MESMO id já foi resolvido antes (por
    // uma busca anterior que teve sucesso), não refaz a busca nem acende o
    // spinner só porque `orders` mudou de referência por causa de OUTRO
    // pedido — é exatamente isso que desmontava a ficha em edição.
    const revalidar = revalidacaoSilenciosaRef.current;
    revalidacaoSilenciosaRef.current = false;
    if (resolvedOrderIdRef.current === selectedOrderId && !revalidar) return;

    // Fetch from Supabase if not found locally (e.g., deep link or pagination)
    let isCurrent = true;
    const fetchSingleOrder = async () => {
      // Na revalidação a ficha já está na tela: nada de spinner de tela
      // cheia (era ele que desmontava o OrderDetail em edição).
      if (!revalidar) setLoadingDetail(true);
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
          resolvedOrderIdRef.current = selectedOrderId;
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
  }, [selectedOrderId, orders, active, revalidacaoDaFicha]);

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
        // C4.4: o chip "Balcão" também filtra NO BANCO — mesmo contrato do
        // filtro de pagamento acima.
        canalFilter,
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
      canalFilter,
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
  // Rodada 4 (F2c): enquanto a leitura FRESCA do pedido não volta, o botão
  // mostra "Conferindo…" e fica desligado. O ref barra o clique duplo no
  // mesmo tick (o estado só chega ao DOM no próximo render).
  const [conferindoEstornoId, setConferindoEstornoId] = useState<string | null>(
    null,
  );
  const conferindoEstornoRef = useRef(false);
  // B1c (revisão do front): quantas vezes a tela DEIXOU de estar ativa (ou
  // desmontou). O "Já estornei" guarda o número no clique; se mudou durante
  // a leitura fresca, a pergunta não abre — o lojista saiu da tela, e um
  // `confirm` sobre outra tela registraria às cegas. Ele toca de novo.
  const desativacoesDaTelaRef = useRef(0);
  useEffect(() => {
    if (!active) desativacoesDaTelaRef.current += 1;
  }, [active]);
  useEffect(
    () => () => {
      desativacoesDaTelaRef.current += 1;
    },
    [],
  );
  const registrarEstornoFeito = async (pedido: {
    id: string;
    total?: number | null;
    customer?: { name?: string | null } | null;
    // D1 (lote C4): venda de balcão nunca passou por gateway nenhum — o
    // `confirm` não pode mandar o lojista abrir o painel do Mercado Pago
    // para um dinheiro que ele recebeu na mão. Opcional: os chamadores de
    // hoje (pedido de canal online) continuam sem passar o campo.
    canal?: CanalDaVenda;
    // Achado A4 (revisão 26/09/2026, rodada 3): o confirm mostrava o TOTAL
    // do pedido, mesmo com parte já devolvida (manual ou pelo ledger do MP)
    // — o lojista confirmava um valor maior do que o que realmente falta.
    valorDevolvidoPorDevolucao?: number;
    valorEstornado?: number;
  }) => {
    if (conferindoEstornoRef.current) return;
    const reais = (v: number) =>
      v.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
    // Rodada 4 (F2c): o ponto de DECISÃO nunca usa a leitura da lista —
    // uma devolução que começou depois dela (card "Devolver", outro admin)
    // não muda marketplace_orders e não teria como aparecer. Leitura fresca
    // deste pedido; falha ou prazo estourado = "não conferido", que cai na
    // pergunta do estado desconhecido (rodada 3).
    conferindoEstornoRef.current = true;
    setConferindoEstornoId(pedido.id);
    const desativacoesNoClique = desativacoesDaTelaRef.current;
    let ledger: EstornoEmCurso;
    try {
      ledger = await estornos.conferirAgora(pedido.id);
    } finally {
      conferindoEstornoRef.current = false;
      setConferindoEstornoId(null);
    }
    // B1c: a tela deixou de estar ativa durante a leitura — abandona sem
    // perguntar e sem registrar. B2b: e AVISA — o toque não pode sumir em
    // silêncio. O <Toaster /> é global (App.tsx), então o aviso aparece na
    // tela para onde ele foi; por isso nomeia "Pedidos". 10 s porque ele
    // está lendo outra coisa; o sonner pausa o tempo com a aba do navegador
    // escondida.
    if (desativacoesDaTelaRef.current !== desativacoesNoClique) {
      toast.info(
        "Conferência interrompida: nada foi registrado. Para registrar o estorno, volte em “Pedidos” e toque de novo em “Já estornei no Mercado Pago”.",
        { duration: 10_000 },
      );
      return;
    }
    // A lista acompanha o que acabou de ser lido.
    estornos.recarregar();
    const conferido = ledger.tipo === "conferido" ? ledger : null;
    // O que falta devolver SEM descontar o que está em curso (mas já sem o
    // que o MP concluiu depois do retrato da lista, rodada 2/R2): é o valor
    // que o lojista precisa ter devolvido por fora para "Já estornei" ser
    // verdade, porque o registro marca o pedido INTEIRO como devolvido.
    const devidoSemDescontarEmCurso = conferido
      ? valorDevolverAgoraDescontandoLedger(pedido, {
          emCurso: 0,
          concluido: conferido.concluido,
        })
      : valorDevolverAgora(pedido);
    const valor = reais(devidoSemDescontarEmCurso);
    const cliente = pedido.customer?.name || "o cliente";
    // L3e' rodada 2 (R1, revisão do front): com devolução em curso pelo MP,
    // "Já estornei" marca o pedido INTEIRO como estornado. Antes da
    // migration C-S (20261189) o servidor aceita e a linha `solicitado` é
    // recusada pela guarda do executor — um pedido de R$100 com R$30 em
    // curso, confirmado por quem só devolveu R$70 por fora, deixava o
    // cliente com R$70. Depois da C-S, `solicitado` vira `recusado` e
    // `em_processamento` faz o servidor RECUSAR o registro. O texto abaixo é
    // verdadeiro nos dois mundos: "pode ser cancelada", "pode recusar", "ou o
    // cliente pode receber as duas" (POST já saído antes da C-S).
    let pergunta: string;
    if (conferido && conferido.emCurso > 0) {
      const emCurso = reais(conferido.emCurso);
      const descontado = valorDevolverAgoraDescontandoLedger(pedido, conferido);
      // "o app pediu" só quando nenhuma parte veio do próprio MP
      // (`solicitado_por = 'sistema'`, contestação): aí só o genérico é
      // verdade.
      const quemPediu =
        conferido.sistema > 0
          ? `O Mercado Pago tem uma devolução ou disputa em andamento de R$ ${emCurso} neste pedido.`
          : `O app já pediu ao Mercado Pago a devolução de R$ ${emCurso} deste pedido.`;
      // Rodada 4 (F1, revisão financeira): linha TRAVADA (5+ tentativas) não
      // é "dinheiro voltando" — o próprio cron grava "não consegui confirmar
      // … confira no painel do MP". Mandar "esperar terminar" deixava o
      // cliente sem nada quando o MP nunca recebeu o pedido.
      const seDevolveuMenos =
        conferido.semConfirmacao > 0
          ? `Não consegui confirmar a devolução de R$ ${reais(conferido.semConfirmacao)} pelo Mercado Pago. Confira no painel do Mercado Pago antes de confirmar ou de devolver por outro meio.`
          : descontado > 0
            ? `Se você devolveu só R$ ${reais(descontado)} (ou nada), toque em Cancelar e espere a devolução do Mercado Pago terminar; depois confirme.`
            : "Se você não devolveu nada por fora, toque em Cancelar: o dinheiro já está voltando pelo Mercado Pago.";
      pergunta = `ATENÇÃO: ${quemPediu}\n\nSe você confirmar e o registro for aceito, o pedido inteiro passa a contar como devolvido, e essa devolução do Mercado Pago pode ser cancelada. Se ela já estiver saindo, o app pode recusar o registro — ou o cliente pode receber as duas.\n\nConfirme só se você já devolveu a ${cliente}, por fora (PIX, dinheiro ou painel do Mercado Pago), o valor TOTAL de R$ ${valor}. ${seDevolveuMenos}`;
    } else if (!conferido) {
      // Rodada 3: estado DESCONHECIDO (leitura pendente ou falha) — é
      // exatamente quando o lojista não tem como saber se o MP já está
      // devolvendo. Nada de promessa: só o que não deu para conferir, onde
      // conferir, e o valor TOTAL que o registro marca como devolvido.
      pergunta = `ATENÇÃO: Não consegui conferir agora se o Mercado Pago já está devolvendo parte deste pedido. Antes de confirmar, abra o painel do Mercado Pago e veja se há devolução em andamento — se houver, toque em Cancelar.\n\nConfirme só se você já devolveu a ${cliente}, por fora (PIX, dinheiro ou painel do Mercado Pago), o valor TOTAL de R$ ${valor}.\n\nIsso marca o pedido como estornado e o remove da lista "Devolver agora".`;
    } else {
      pergunta =
        pedido.canal === "presencial"
          ? `Confirma que você JÁ devolveu R$ ${valor} para ${cliente} no balcão?\n\nIsso marca o pedido como estornado e o remove da lista "Devolver agora".`
          : `Confirma que você JÁ devolveu R$ ${valor} para ${cliente} no painel do Mercado Pago?\n\nIsso marca o pedido como estornado e o remove da lista "Devolver agora".`;
    }
    if (!globalThis.confirm(pergunta)) {
      return;
    }
    setEstornandoId(pedido.id);
    try {
      const { error } = await supabase.rpc("registrar_estorno_manual", {
        p_order_id: pedido.id,
      });
      if (error) {
        // R4 (B1b): a recusa de NEGÓCIO do servidor (SQLSTATE 22023) chega
        // com texto leigo escrito para o lojista — "o Mercado Pago já está
        // devolvendo… faça-a pelo painel do Mercado Pago, nunca por outro
        // caminho" (C-S, 20261189) ou "não tem mais nada a devolver"
        // (20261176). Trocar isso por "Tente de novo" empurrava o lojista
        // a pagar por fora. O resto (rede, permissão) segue genérico.
        if (
          (error as { code?: string }).code === "22023" &&
          typeof error.message === "string" &&
          error.message.trim() !== ""
        ) {
          console.error("Estorno manual recusado pelo servidor:", error);
          toast.error(error.message);
          await fetchPedidosCancelados().catch(() => {});
          return;
        }
        throw error;
      }
      toast.success("Estorno registrado — o pedido saiu da lista.");
      await fetchPedidosCancelados().catch(() => {});
    } catch (e) {
      console.error("Erro ao registrar estorno manual:", e);
      toast.error("Não consegui registrar o estorno. Tente de novo.");
    } finally {
      setEstornandoId(null);
    }
  };

  // Estável de propósito: vai para o `<OrderDetail>` (memo) e para o botão
  // do cabeçalho — a tela de Devoluções (filha de Pedidos no roteador).
  const abrirDevolucoes = useCallback(
    (id?: string) => onNavigate("admin-devolucoes", id),
    [onNavigate],
  );

  /**
   * O botão "Ver pedidos" do dropdown de alertas (na pílula antiga era
   * igual — só o contêiner mudou). O botão leva aos
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
    // C4.4: o canal também precisa voltar a "all" aqui — senão um chip
    // "Balcão" deixado ligado numa sessão anterior filtra no banco e some
    // com o pedido de estorno do SITE, recriando o mesmo achado 2 acima
    // (lista vazia sem pista visível do porquê).
    setCanalFilter("all");
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
        toast.info(`Novo pedido recebido! #${numeroDoPedido(newId)}`, {
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
        // Ficha de deep link aberta para ESTE pedido: revalida em silêncio
        // (ver revalidacaoDaFicha, acima).
        if (
          updatedId &&
          updatedId === selectedOrderId &&
          resolvedOrderIdRef.current === selectedOrderId
        ) {
          revalidacaoSilenciosaRef.current = true;
          setRevalidacaoDaFicha((n) => n + 1);
        }
        toast.info(
          `Pedido #${numeroDoPedido(updatedId)} atualizado para ${statusConfig[newStatus]?.label ?? `Status: ${newStatus}`}`,
        );
      }

      // Atualiza apenas os KPIs (listagem já é atualizada reativamente em memória)
      loadStats();
    };
  }, [loadStats, handleSelectOrder, selectedOrderId]);

  const totalPages = Math.ceil(totalOrders / itemsPerPage);
  const paginatedOrders = useMemo(
    () => filterOrdersByPaymentStatus(orders, paymentFilter),
    [orders, paymentFilter],
  );

  /** Nome do botão de exportar. O CSV consulta o FILTRO INTEIRO, e a contagem
   *  acompanha esse recorte — nunca o total da página. Desde 12/09/2026 este
   *  texto é o nome ACESSÍVEL do botão (o visível é só "CSV", para o controle
   *  caber na linha da busca), então ele é a única coisa que diz ao lojista
   *  quantos pedidos o arquivo vai trazer. */
  const rotuloExportarCsv = gerandoCsv
    ? "Gerando CSV..."
    : totalOrders > 0
      ? `Exportar CSV (${totalOrders} no filtro)`
      : "Exportar CSV";

  const exportarCsv = async () => {
    if (totalOrders === 0 || exportacaoCsvEmCursoRef.current) return;
    exportacaoCsvEmCursoRef.current = true;
    setGerandoCsv(true);
    try {
      const pedidosDoFiltro = await buscarPedidosDoFiltroParaExportar({
        statusFilter: filter,
        searchQuery,
        startDate: dateRange.start || undefined,
        endDate: dateRange.end || undefined,
        paymentStatus: paymentFilter,
        // C4.4: sem isto, o CSV exportaria um filtro diferente do que está
        // na tela quando o chip "Balcão" está ligado.
        canal: canalFilter,
      });
      const agora = new Date();
      const doisDigitos = (numero: number) => String(numero).padStart(2, "0");
      const data = `${agora.getFullYear()}-${doisDigitos(agora.getMonth() + 1)}-${doisDigitos(agora.getDate())}`;
      const hora = `${doisDigitos(agora.getHours())}-${doisDigitos(agora.getMinutes())}`;
      const arquivo = new Blob([pedidosParaCsv(pedidosDoFiltro)], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(arquivo);
      const link = document.createElement("a");
      link.href = url;
      link.download = `pedidos-${data}-${hora}.csv`;
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
        // Aguarda o navegador iniciar o download antes de liberar o endereço.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      toast.error("Não foi possível gerar o CSV. Tente de novo.");
    } finally {
      exportacaoCsvEmCursoRef.current = false;
      setGerandoCsv(false);
    }
  };

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
  // automático). Rodada 3 (achado 2 do laudo): a frase antiga aqui prometia
  // que "o guard do catch abaixo já cobre o caso sem precisar lembrar de
  // adicioná-lo depois" — deixou de ser verdade com o `return` do
  // tratamento de `ErroPedidoMudou` (abaixo): quando esse erro tipado é
  // lançado, o `catch` relança ANTES de chegar no `if (silent)
  // toast.error(...)`, então um eventual caminho silencioso próprio que
  // colidisse com `ErroPedidoMudou` NÃO geraria aviso nenhum ali. Isso está
  // certo por desenho (silent = "não incomode a pessoa") e não muda nada
  // hoje — o caminho é código morto, como já dito acima —, mas fica
  // registrado para quem for ligar um caminho silencioso de verdade: não
  // dá pra contar com este guard sem checar o `catch` inteiro primeiro.
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
      // Rodada 2 (achado 1 do laudo): o `statusEsperado` só importa quando
      // o pedido não está em `orders` (deep link/paginação) — o hook usa
      // `order.status` quando o pedido está carregado e só cai para este
      // argumento na ausência dele (ver `esperado` em useOrders.ts). Nunca
      // passar `selectedOrder.status` sem conferir o id: comparar contra o
      // status de OUTRO pedido seria pior que não comparar nada.
      await updateOrderStatus(
        orderId,
        newStatus,
        undefined,
        silent,
        selectedOrder?.id === orderId ? selectedOrder.status : undefined,
      );
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
      // Rodada 2 (achado 1/3 do laudo, deep link): quando o pedido não
      // está em `orders` (deep link/paginação), a correção que o hook faz
      // em `orders`/`cachedAdminOrders` é um no-op — a ficha aberta é
      // `selectedOrder`, um estado À PARTE que não vem de `orders` nesse
      // caminho. `ErroPedidoMudou` já carrega o status VERDADEIRO
      // (`err.statusVerdadeiro`) e o hook já mostrou o ÚNICO toast — aqui
      // só corrigimos a ficha, SEM toast nenhum (existe teste na casa
      // contra o segundo aviso: admin-orders-status-erro-cru-nao-duplica-
      // toast.test.tsx). Continua relançando o erro, como antes.
      if (err instanceof ErroPedidoMudou) {
        setSelectedOrder((prev) =>
          prev?.id === orderId
            ? { ...prev, status: err.statusVerdadeiro }
            : prev,
        );
        throw err;
      }
      // S1 (04/10/2026): o cancelamento pela edge NÃO aconteceu (o hook já
      // mostrou o desfecho). Quando a edge relê o pedido (pago no meio, a
      // cobrança mudou), a ficha passa a mostrar o estado de verdade — sem
      // toast extra. Nunca marca cancelado: isso só vem da resposta da edge.
      if (err instanceof ErroCancelamentoNaoConcluido && err.pedido) {
        const relido = err.pedido;
        setSelectedOrder((prev) =>
          prev?.id === orderId
            ? {
                ...prev,
                ...(typeof relido.status === "string"
                  ? { status: relido.status as OrderStatus }
                  : {}),
                ...(typeof relido.paymentStatus === "string"
                  ? {
                      paymentStatus:
                        relido.paymentStatus as Order["paymentStatus"],
                    }
                  : {}),
              }
            : prev,
        );
      }
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
      const body = `Seu pedido #${numeroDoPedido(orderId)} agora está: ${statusConfig[newStatus].label}`;

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
      const message = `Olá ${order.customer?.name || "Cliente"}!\n\nSeu pedido #${numeroDoPedido(order.id)} foi atualizado.\nStatus: ${statusMsg.label}\n\nObrigado por comprar na ${branding.appName}!`;

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
            onAbrirDevolucoes={abrirDevolucoes}
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
        <AdminPageHeader
          titulo="Pedidos"
          acoes={
            // Botão de alerta + dropdown (pedido do Gabriel, 02/09 à tarde:
            // a pílula amarela virou botão com ícone de alerta no canto
            // direito da linha do título; os detalhes descem dele). Sem
            // pendência e lista completa, ele nem nasce. (1.19.0 — só trocou
            // de container: a marcação interna é a mesma de antes.)
            // Devoluções (plano 2026-09-26): a porta da tela de devolução de
            // produto mora ao lado, com quantas estão em andamento.
            <>
              <BotaoDevolucoes
                onAbrir={() => abrirDevolucoes()}
                ativo={active}
              />
              <AlertasCancelados
                pagoCanceladoCount={paidOnCancelledCount}
                avisoPagoAposCancelado={avisoPagoAposCancelado}
                pedidosEsperandoRetorno={pedidosEsperandoRetorno}
                pedidosParaDevolverAgora={pedidosParaDevolverAgora}
                estornosEmCurso={estornosEmCurso}
                incompleto={pedidosCanceladosIncompleto}
                foraDaJanela={canceladosForaDaJanela}
                onIncluirAntigos={() => {
                  void buscarTambemCanceladosAntigos();
                }}
                confirmandoRetornoId={confirmandoRetornoId}
                onConfirmarRetorno={handleConfirmarRetorno}
                estornandoId={estornandoId}
                conferindoEstornoId={conferindoEstornoId}
                onAbrir={estornos.recarregar}
                onRegistrarEstorno={registrarEstornoFeito}
                onVerPedidos={irParaPedidosCancelados}
              />
            </>
          }
        >
          <button
            type="button"
            onClick={() => setShowHelpModal(true)}
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/5 bg-zinc-900/60 text-zinc-500 transition-all duration-300 hover:border-white/10 hover:text-white active:scale-95"
            title="Guia de Ajuda e Explicações"
          >
            <HelpCircle className="size-4.5" />
          </button>
          {/* Missão 06 (C3): a tag "Operações ao Vivo" mentia — ficava verde
              depois da carga mesmo com o tempo real morto. O ponto mostra o
              estado REAL de conexão (medido no AdminLayout e compartilhado);
              o âmbar da carga inicial é o único "sincronizando" honesto.
              Desde o pedido do Gabriel de 02/09 à tarde ele vive AQUI, ao
              lado direito do título, para liberar o canto para o botão de
              alertas (igual nas telas de Produtos e Clientes). */}
          <PontoDeOperacao sincronizando={!isLoaded} />
        </AdminPageHeader>
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
                active={active}
                cards={kpiCards}
                loading={(!isLoaded || loading) && !analyticsStats}
                title="Métricas de Pedidos"
              />
            </LocalErrorBoundary>
          </div>
        )}

        {/* Unified Control Bar Compacta — âncora do scroll do botão "Ver
            pedidos" do dropdown de alertas (id lido por
            `irParaPedidosCancelados`). */}
        {/* Barra de busca + chips de filtro ancorados (pedido do Gabriel,
            02/09: os chips fazem parte da mesma âncora). Filha DIRETA do
            container que rola — sticky só anda dentro do próprio containing
            block. O id="admin-pedidos-lista" (âncora do scroll do botão
            "Ver pedidos") fica no bloco da lista, mais abaixo. */}
        <div className="sticky top-0 z-30 -mx-4 border-b border-white/5 bg-[#09090b]/95 px-4 py-2.5 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex w-full items-center gap-3">
            <div className="group relative w-full flex-1">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                {!isLoaded || isTyping ? (
                  <Loader2 className="size-4 animate-spin text-admin-gold" />
                ) : (
                  <Search className="size-4 text-zinc-600 transition-colors group-focus-within:text-admin-gold" />
                )}
              </div>
              <label htmlFor="orders-search" className="sr-only">
                Buscar pedidos
              </label>
              <DebouncedSearchInput
                id="orders-search"
                name="search"
                placeholder="Buscar pedidos..."
                className="h-11 w-full rounded-xl border-zinc-800 bg-black/40 pl-10 text-xs font-bold text-white transition-all placeholder:text-zinc-600 focus:border-admin-gold/50 focus:ring-admin-gold/20"
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
                  className="group relative size-11 shrink-0 rounded-xl border-zinc-800 bg-zinc-900/60 transition-all hover:border-admin-gold/50 hover:bg-zinc-800 focus-visible:ring-0 focus-visible:ring-offset-0"
                >
                  <Filter className="size-4 text-zinc-500 transition-colors group-hover:text-admin-gold" />
                  {(paymentFilter !== "all" || canalFilter !== "all") && (
                    // O filtro persiste em localStorage: sem isto, o admin
                    // reabre a tela já filtrada sem nenhuma pista visível
                    // (achado da revisão da Task 9). C4.4: canalFilter
                    // persiste do mesmo jeito e precisa da mesma bolinha.
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

                  {/* C4.4: chip de canal — molde literal do grupo "Status de
                      Pagamento" acima. Filtra NO BANCO (p_canal na RPC), não
                      em memória. */}
                  <h4 className="mt-6 px-1 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                    Canal da venda
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCanalFilter("all");
                        setCurrentPage(0);
                      }}
                      className={cn(
                        "px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all border",
                        canalFilter === "all"
                          ? "bg-admin-gold border-admin-gold text-black"
                          : "bg-zinc-900/60 border-zinc-800 text-zinc-500 hover:bg-zinc-800 hover:text-white",
                      )}
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCanalFilter("online");
                        setCurrentPage(0);
                      }}
                      className={cn(
                        "px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all border",
                        canalFilter === "online"
                          ? "bg-admin-gold border-admin-gold text-black"
                          : "bg-zinc-900/60 border-zinc-800 text-zinc-500 hover:bg-zinc-800 hover:text-white",
                      )}
                    >
                      Site
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCanalFilter("presencial");
                        setCurrentPage(0);
                      }}
                      className={cn(
                        "px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all border",
                        canalFilter === "presencial"
                          ? "bg-admin-gold border-admin-gold text-black"
                          : "bg-zinc-900/60 border-zinc-800 text-zinc-500 hover:bg-zinc-800 hover:text-white",
                      )}
                    >
                      Balcão
                    </button>
                  </div>
                  {canalFilter !== "all" && (
                    <Button
                      variant="ghost"
                      className="mt-2 h-10 w-full rounded-xl border border-zinc-800 text-[10px] font-black uppercase tracking-widest text-rose-500 transition-all hover:bg-rose-500 hover:text-white"
                      onClick={() => {
                        setCanalFilter("all");
                        setCurrentPage(0);
                      }}
                    >
                      Limpar Canal da Venda
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
              className="group size-11 shrink-0 rounded-xl border-zinc-800 bg-zinc-900/60 transition-all hover:border-admin-gold/50 hover:bg-zinc-800 focus-visible:ring-0 focus-visible:ring-offset-0"
              title={
                viewMode === "detailed"
                  ? "Visualização Compacta"
                  : "Visualização Detalhada"
              }
            >
              {viewMode === "detailed" ? (
                <LayoutGrid className="size-4 text-zinc-500 transition-colors group-hover:text-admin-gold" />
              ) : (
                <List className="size-4 text-zinc-500 transition-colors group-hover:text-admin-gold" />
              )}
            </Button>

            {/* Exportar CSV COMPACTO (pedido do Gabriel, 12/09/2026: "essa
                opção está ocupando muito espaço (...) até ficar do lado do
                campo de pesquisa"). Antes ocupava uma FILEIRA INTEIRA acima
                da busca; agora é o terceiro controle da mesma linha.
                🔴 O rótulo por extenso — com a contagem do FILTRO INTEIRO, não
                a da página — não sumiu: virou o nome acessível do botão
                (`aria-label`/`title`). Essa contagem é conserto deliberado de
                uma mentira antiga na tela (o rótulo mostrava o total da página
                e o CSV exportava o filtro inteiro) e está guardada por
                tests/front/admin-orders-exportar-csv-rotulo-da-pagina.test.tsx
                — que agora lê o nome acessível em vez do texto visível.
                A palavra "CSV" fica visível de propósito: baixar um arquivo é
                mais consequente que filtrar, e uma seta sozinha não diz o que
                o toque vai fazer. */}
            <Button
              type="button"
              variant="outline"
              onClick={exportarCsv}
              disabled={totalOrders === 0 || gerandoCsv}
              aria-label={rotuloExportarCsv}
              title={rotuloExportarCsv}
              className="group h-11 shrink-0 gap-1.5 rounded-xl border-zinc-800 bg-zinc-900/60 px-3 text-[10px] font-black uppercase tracking-widest text-zinc-500 transition-all hover:border-admin-gold/50 hover:bg-zinc-800 hover:text-white focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-40"
            >
              {gerandoCsv ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-admin-gold" />
              ) : (
                <Download className="size-4 shrink-0 text-zinc-500 transition-colors group-hover:text-admin-gold" />
              )}
              <span>CSV</span>
            </Button>
          </div>

          {/* Fileira de filtros de status — parte da MESMA âncora da busca
                (pedido do Gabriel, 02/09): gruda junto com ela. Chips
                COMPACTOS (pedido do Gabriel, 02/09 — fileira grande demais):
                o botão mantém h-11 (alvo de toque de 44px, WCAG 2.5.8) e o
                VISUAL desenha 32px via pseudo-elemento; o pseudo vive dentro
                do botão, então o overflow-x-auto da fileira não o corta. */}
          <div className="custom-scrollbar-hidden flex w-full snap-x gap-1.5 overflow-x-auto pt-2">
            {" "}
            <button
              onClick={() => {
                setFilter("open");
                setCurrentPage(0);
              }}
              className={cn(
                "relative isolate h-11 shrink-0 snap-center rounded-lg px-3 text-[9px] font-black uppercase tracking-widest transition-all before:absolute before:-z-10 before:inset-x-0 before:inset-y-[6px] before:rounded-lg before:border before:transition-all before:content-['']",
                filter === "open"
                  ? "text-black before:border-admin-gold before:bg-admin-gold before:shadow-[0_0_20px_rgba(212,175,55,0.2)]"
                  : "text-zinc-500 before:border-zinc-800 before:bg-zinc-900/60 hover:text-white hover:before:bg-zinc-800",
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
                  "relative isolate flex h-11 shrink-0 snap-center items-center gap-1.5 rounded-lg px-3 text-[9px] font-black uppercase tracking-widest transition-all before:absolute before:-z-10 before:inset-x-0 before:inset-y-[6px] before:rounded-lg before:border before:transition-all before:content-['']",
                  filter === status
                    ? "text-black before:border-admin-gold before:bg-admin-gold before:shadow-[0_0_20px_rgba(212,175,55,0.2)]"
                    : "text-zinc-500 before:border-zinc-800 before:bg-zinc-900/60 hover:text-white hover:before:bg-zinc-800",
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
                "relative isolate h-11 shrink-0 snap-center rounded-lg px-3 text-[9px] font-black uppercase tracking-widest transition-all before:absolute before:-z-10 before:inset-x-0 before:inset-y-[6px] before:rounded-lg before:border before:transition-all before:content-['']",
                filter === "all"
                  ? "text-black before:border-admin-gold before:bg-admin-gold before:shadow-[0_0_20px_rgba(212,175,55,0.2)]"
                  : "text-zinc-500 before:border-zinc-800 before:bg-zinc-900/60 hover:text-white hover:before:bg-zinc-800",
              )}
            >
              Todos
            </button>
          </div>
        </div>

        {/* Orders List */}
        <div
          id="admin-pedidos-lista"
          className="relative border-t border-white/5 pt-6"
        >
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
                  <div className="grid grid-cols-1 gap-5 sm:[grid-template-columns:repeat(auto-fill,minmax(22rem,1fr))]">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <AdminOrderCardSkeleton key={i} viewMode="detailed" />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:[grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]">
                    {Array.from({ length: 10 }).map((_, i) => (
                      <AdminOrderCardSkeleton key={i} viewMode="compact" />
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
                        Quando a primeira venda acontecer, o pedido aparece aqui
                        — com status, valor e o atalho de WhatsApp para o
                        cliente.
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
                        Nenhum pedido com esse status de pagamento. Limpe o
                        filtro para ver todos os pedidos.
                      </p>
                    </>
                  ) : canalFilter !== "all" ? (
                    // Mesmo contrato do ramo de pagamento acima: o filtro de
                    // canal também roda NO BANCO (lista E contagem), então
                    // lista vazia aqui é "não existe pedido nesse canal" —
                    // não "loja sem pedido nenhum" (achado 4 da rodada de
                    // correção: sem este ramo, uma loja com dezenas de
                    // pedidos ouvia "ainda não tem nenhum pedido" só por ter
                    // ligado o chip "Balcão").
                    <>
                      <h3 className="relative z-10 text-xs font-black uppercase tracking-widest text-zinc-400">
                        Nenhum pedido nesse canal
                      </h3>
                      <p className="relative z-10 mt-2 max-w-xs text-[10px] font-bold uppercase leading-relaxed tracking-widest text-zinc-600">
                        Limpe o filtro de canal da venda para ver todos os
                        pedidos.
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
                        Nenhum pedido corresponde ao que está sendo mostrado
                        agora
                      </h3>
                      <p className="relative z-10 mt-2 max-w-xs text-[10px] font-bold uppercase leading-relaxed tracking-widest text-zinc-600">
                        Pode ser o filtro de status, a busca ou o período
                        aplicado. Toque em "Todos", no fim da fileira de
                        filtros, ou limpe a busca e o período para ver todos os
                        pedidos.
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
                <div className="grid grid-cols-1 gap-5 sm:[grid-template-columns:repeat(auto-fill,minmax(22rem,1fr))]">
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
                <div className="grid grid-cols-1 gap-4 sm:[grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]">
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
        </div>

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
        />
      </div>
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

          <GuiaDoPagamentoQueNaoFechou />
        </div>
      </AdminHelpModal>
    </div>
  );
});
