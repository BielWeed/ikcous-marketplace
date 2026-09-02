import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import {
  AdminKpiCarousel,
  type KpiCardConfig,
} from "@/components/admin/AdminKpiCarousel";
import { DebouncedSearchInput } from "@/components/admin/DebouncedSearchInput";
import { PaginacaoAdmin } from "@/components/admin/PaginacaoAdmin";
import { PontoDeOperacao } from "@/components/admin/PontoDeOperacao";
import { CustomerBanners } from "@/components/admin/dashboard/CustomerBanners";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocalErrorBoundary } from "@/components/ui/custom/LocalErrorBoundary";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import {
  ArrowUpDown,
  Calendar,
  HelpCircle,
  LayoutGrid,
  List,
  Loader2,
  Mail,
  MoreHorizontal,
  Phone,
  Search,
  Shield,
  ShoppingBag,
  TrendingUp,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  type Customer,
  cachedCustomersData,
  setCachedCustomersData,
} from "@/utils/admin_cache";

/** Ordenações da fileira de chips abaixo da busca (o funil dropdown virou
 * chips — pedido do Gabriel de 02/09; mesmos pares campo/direção de antes). */
const ORDENACOES_CLIENTES = [
  { campo: "total_spent", direcao: "desc", rotulo: "Maior LTV" },
  { campo: "orders_count", direcao: "desc", rotulo: "Mais Pedidos" },
  { campo: "full_name", direcao: "asc", rotulo: "Alfabética" },
] as const;

interface AdminCustomersViewProps {
  onNavigate: (view: View, id?: string) => void;
  active?: boolean;
}

export const AdminCustomersView = memo(function AdminCustomersView({
  onNavigate,
  active,
}: Readonly<AdminCustomersViewProps>) {
  const isOffline = useOnlineStatus();
  const [customers, setCustomers] = useState<Customer[]>(
    () => cachedCustomersData?.customers || [],
  );
  // Fonte compartilhada do Ticket Médio — a mesma que o Dashboard
  // (AdminDashboardView) e a tela de Pedidos (AdminOrdersView) já leem.
  // Ver o comentário no card "Ticket Médio" logo abaixo.
  const { stats: analyticsStats, fetchExecutiveSummary } = useAnalytics();
  const { prefetchView } = usePrefetchOnHover();

  const handlePrefetchUserDetail = useCallback(() => {
    prefetchView("admin-user-detail");
  }, [prefetchView]);

  const {
    ref: viewRef,
    saveScroll,
    resetRestored,
  } = useScrollRestoration(
    "admin-customers",
    active ?? false,
    customers.length > 0,
  );

  const handleLocalNavigate = useCallback(
    (view: View, id?: string) => {
      saveScroll();
      resetRestored();
      onNavigate(view, id);
    },
    [onNavigate, saveScroll, resetRestored],
  );

  const [loading, setLoading] = useState(() => !cachedCustomersData);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [sortField, setSortField] = useState<keyof Customer>("total_spent");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [totalCustomers, setTotalCustomers] = useState(
    () => cachedCustomersData?.total || 0,
  );
  const [globalStats, setGlobalStats] = useState<{
    total_customers: number;
    global_ltv: number;
    global_orders: number;
    new_customers_30d: number;
  } | null>(() => cachedCustomersData?.stats || null);
  const [page, setPage] = useState(0);
  // Missão 06 (C2): alinhado com pedidos/produtos (era 10 — terceiro tamanho
  // de página que não existia por desenho nenhum).
  const PAGE_SIZE = 12;

  const [viewMode, setViewMode] = useState<"detailed" | "compact">(() => {
    const saved = localStorage.getItem("admin_customers_view_mode");
    return saved === "detailed" || saved === "compact" ? saved : "compact";
  });

  useEffect(() => {
    localStorage.setItem("admin_customers_view_mode", viewMode);
  }, [viewMode]);

  // Scroll position is handled by useScrollRestoration hook

  // Laudo 0109 (A13): guarda de corrida por número de rodada — trocar de
  // página/busca rápido pode fazer a resposta ANTIGA chegar DEPOIS da nova
  // e gravar por cima (tela e cache de módulo). O padrão da casa é o
  // rodadaRef do useAvisosDoLojista.ts.
  const rodadaRef = useRef(0);

  const fetchCustomers = useCallback(
    async (pageToFetch: number) => {
      const rodada = ++rodadaRef.current;
      try {
        setLoading(true);

        const { data, error } = await (supabase.rpc as any)(
          "get_admin_customers_paged",
          {
            p_search: searchTerm,
            p_sort_field: sortField,
            p_sort_direction: sortDirection,
            p_page: pageToFetch,
            p_page_size: PAGE_SIZE,
          },
        );

        if (error) throw error;

        // Resposta de rodada velha (o lojista já pediu outra página/busca):
        // descarta sem gravar nada — nem na tela, nem no cache, nem no
        // loading (a rodada nova é quem manda no loading).
        if (rodada !== rodadaRef.current) return;

        if (data) {
          const customersList = data.data || [];
          const totalCount = data.total_count || 0;
          const stats = data.stats;

          setCachedCustomersData({
            customers: customersList,
            total: totalCount,
            stats,
          });

          setCustomers(customersList);
          setTotalCustomers(totalCount);
          setGlobalStats(stats);
        }
      } catch (error) {
        console.error("Error fetching customers:", error);
        if (rodada === rodadaRef.current) {
          toast.error("Erro ao carregar clientes");
        }
      } finally {
        if (rodada === rodadaRef.current) {
          setLoading(false);
        }
      }
    },
    [searchTerm, sortField, sortDirection, PAGE_SIZE],
  );

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      fetchCustomers(page);
    }, 320);
    return () => clearTimeout(timer);
  }, [searchTerm, sortField, sortDirection, page, active, fetchCustomers]);

  // Mesmo gatilho de AdminProductsView.tsx: só busca se ainda não tem o
  // resumo executivo em cache (o hook já resolve isso em memória — um
  // quarto consumidor de useAnalytics() não é uma quarta ida à rede).
  useEffect(() => {
    if (active && !analyticsStats) {
      fetchExecutiveSummary(false);
    }
  }, [active, analyticsStats, fetchExecutiveSummary]);

  // Auto-refresh when coming back online
  const wasOfflineRef = useRef(isOffline);
  const shouldScrollToTop = useRef(false);

  useEffect(() => {
    if (wasOfflineRef.current && !isOffline && active) {
      toast.success("Conexão restabelecida. Atualizando clientes...", {
        icon: "⚡",
      });
      fetchCustomers(page);
    }
    wasOfflineRef.current = isOffline;
  }, [isOffline, active, page, fetchCustomers]);

  useEffect(() => {
    if (shouldScrollToTop.current) {
      const mainEl =
        viewRef.current?.closest(".admin-scroll-container") ||
        document.querySelector(".active-scroll-container") ||
        document.querySelector("main");
      if (mainEl) {
        mainEl.scrollTo({ top: 0, behavior: "instant" });
      }
      shouldScrollToTop.current = false;
    }
  }, [customers, viewRef]);

  const kpiCards = useMemo<readonly KpiCardConfig[]>(
    () => [
      {
        label: "Total Clientes",
        // PAINEL-14: `?? null` + "—" — `|| 0` diz "zero clientes" quando a
        // RPC falhou; o travessão não afirma nada. Os cartões vizinhos
        // ("Ticket Médio") já usam este padrão.
        value: globalStats?.total_customers ?? "—",
        icon: Users,
        accent: "text-admin-gold",
        subValue: "Base de Clientes",
      },
      {
        label: "Novos (30d)",
        value: globalStats?.new_customers_30d ?? "—",
        icon: TrendingUp,
        accent: "text-emerald-500",
        subValue: "Crescimento",
      },
      {
        label: "Ticket Médio",
        // Até 21/08/2026 este card CALCULAVA `global_ltv / global_orders`
        // a partir de `get_admin_customers_paged` — que, NAQUELA ÉPOCA,
        // filtrava pedidos só por status (`NOT IN ('cancelled','returned')`),
        // sem olhar cobrança. O Dashboard, via `get_admin_analytics_v2`,
        // filtra TAMBÉM por `payment_status`. As duas contas só batiam
        // quando não existia nenhum pedido aguardando pagamento no banco —
        // no primeiro PIX pendente, os dois cards do mesmo painel, com o
        // mesmo rótulo "Ticket Médio", voltavam a divergir (achado 4 da
        // auditoria de 20/08/2026; a troca de divisor do commit 402c669
        // corrigiu só metade do defeito).
        //
        // ⚠️ Esse "sem olhar cobrança" já não é a foto de hoje, e a regra
        // mudou DUAS vezes. Conferido na fonte, não de memória:
        //
        //   `20260823000000` (linha 99) passou a filtrar
        //   `get_admin_customers_paged` também por `payment_status`, mas com
        //   `payment_status IS NULL OR payment_status IN ('pago',
        //   'pago_apos_expirar')` — ou seja, **`NULL` CONTA**, e a linha 18
        //   daquela migration diz isso por extenso: "payment_status IS NULL
        //   CONTA, de propósito". Ela tirou da soma só o `aguardando`, que
        //   era o PIX gerado e não pago do achado 17.
        //
        //   `20261021000000` (linhas 351 e 385, Task 2 de
        //   docs/superpowers/plans/2026-08-27-recebimento-na-entrega.md) é a
        //   que **tira o `NULL`**: vira `payment_status IN ('pago',
        //   'pago_apos_expirar', 'recebido_na_entrega')`, sem `IS NULL`.
        //
        // 🔴 A segunda é a que move dinheiro, e por muito: `NULL` são 53 dos
        // 84 pedidos deste banco, R$ 2.977,09 (medido em 27/08/2026). Quando
        // esta tela cair depois de aplicar a `20261021000000`, a causa é o
        // `NULL` ter saído — NÃO o `recebido_na_entrega` ter entrado, que na
        // mesma medição tem 0 pedidos. Procurar a queda no valor novo é
        // procurar no lugar errado do número inteiro.
        //
        // O parágrafo acima descreve só o histórico do achado 4; não leia
        // como o comportamento atual da função.
        //
        // A correção: este card para de ter a própria conta. Passa a LER
        // `executive.avgTicket`, a mesma fonte que o Dashboard e a tela de
        // Pedidos já leem (ver AdminOrdersView.tsx) — não existe mais uma
        // segunda calculadora para desalinhar.
        //
        // Enquanto o número não chegou, o card NÃO mostra "R$ 0,00" — isso
        // afirmaria um fato que ninguém mediu. Mostra um espaço reservado.
        //
        // `??` e não `||`, de propósito: com `||`, um ticket médio MEDIDO
        // como zero (loja sem pedido nenhum) cairia no ramo seguinte e
        // acabaria indistinguível de "não sei". Com `??`, zero medido é
        // zero e ausência é ausência. E a cadeia termina em `null`, não em
        // `0`: `analyticsStats` pode existir sem `executive` — o hook
        // também restaura resumo do cache em disco, que pode ser de uma
        // versão anterior do payload.
        value: (() => {
          const medido =
            analyticsStats?.averageTicket ??
            analyticsStats?.executive?.avgTicket ??
            null;
          return medido == null
            ? "—"
            : `R$ ${medido.toLocaleString("pt-BR", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}`;
        })(),
        icon: Wallet,
        accent: "text-blue-500",
        subValue: "Média por pedido",
      },
      {
        label: "Pedidos Totais",
        // Mesma história do card acima, no vizinho: `global_orders` vem de
        // `get_admin_customers_paged`, que conta pedido sem olhar cobrança.
        // O Dashboard conta "Total de Pedidos" com o filtro de dinheiro
        // reconhecido. Com um PIX de R$ 89,90 aguardando, o Dashboard diz 11
        // e esta tela dizia 12 — duas abas do mesmo painel, rótulos quase
        // iguais, contagens diferentes.
        //
        // `executive.totalOrders` sai do MESMO `SELECT` que o `avgTicket` do
        // card acima (migration 20260822000100), então os dois passam a
        // concordar por construção, não por coincidência dos dados.
        //
        // Traço enquanto não chegou, pelo mesmo motivo do card acima: zero
        // afirmaria que a loja nunca vendeu. A cadeia termina no traço, e não
        // em `0`, para cobrir também o resumo restaurado do cache em disco sem
        // o bloco `executive` — que existe, mas não traz contagem nenhuma.
        value: analyticsStats?.executive?.totalOrders ?? "—",
        icon: ShoppingBag,
        accent: "text-amber-500",
        subValue: "Pedidos",
      },
    ],
    [globalStats, analyticsStats],
  );

  const totalPages = Math.ceil(totalCustomers / PAGE_SIZE);
  const paginatedCustomers = customers; // Already paginated from server

  const handleSort = (field: keyof Customer) => {
    setPage(0);
    shouldScrollToTop.current = true;
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };
  const renderDetailedSkeletons = () => {
    return (
      <div className="flex flex-col gap-4 divide-y-0 divide-zinc-800/30 md:gap-0 md:divide-y">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="group relative flex min-h-[120px] animate-pulse flex-col gap-5 rounded-3xl border border-zinc-800/50 bg-zinc-900/30 p-5 md:grid md:grid-cols-12 md:items-center md:gap-4 md:rounded-none md:border-transparent md:bg-transparent md:px-8 md:py-6"
          >
            <div className="flex items-center gap-4 pr-10 md:col-span-4 md:pr-0">
              <div className="size-12 shrink-0 rounded-full bg-zinc-850 sm:size-14" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="h-4 w-2/3 rounded bg-zinc-850" />
                <div className="h-3 w-1/3 rounded bg-zinc-850" />
              </div>
            </div>
            <div className="flex flex-col gap-2 md:col-span-3">
              <div className="h-3.5 w-3/4 rounded bg-zinc-850" />
              <div className="h-3.5 w-1/2 rounded bg-zinc-850" />
            </div>
            <div className="grid grid-cols-2 justify-between gap-4 md:col-span-3 md:flex md:items-center md:justify-end">
              <div className="h-9 w-24 rounded-xl bg-zinc-850" />
              <div className="size-10 rounded-[0.8rem] bg-zinc-850" />
            </div>
            <div className="hidden flex-col items-end gap-1.5 md:col-span-1 md:flex">
              <div className="h-8 w-20 rounded-lg bg-zinc-850" />
            </div>
            <div className="absolute right-4 top-4 flex justify-end md:relative md:right-auto md:top-auto md:col-span-1">
              <div className="size-10 rounded-[0.8rem] bg-zinc-850" />
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderCompactSkeletons = () => {
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-6 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="group relative flex min-h-[170px] animate-pulse flex-col justify-between rounded-3xl border border-white/5 bg-zinc-950/40 p-3.5 backdrop-blur-md sm:p-5"
          >
            <div className="flex size-full flex-col">
              <div className="relative flex w-full items-start justify-between">
                <div className="size-10 shrink-0 rounded-full bg-zinc-850 sm:size-12" />
                <div className="size-11 rounded-xl bg-zinc-850" />
              </div>
              <div className="mt-3 space-y-2">
                <div className="h-4 w-3/4 rounded bg-zinc-850" />
                <div className="h-3 w-1/2 rounded bg-zinc-850" />
              </div>
              <div className="mt-3 space-y-1">
                <div className="h-3 w-5/6 rounded bg-zinc-850" />
                <div className="h-3 w-2/3 rounded bg-zinc-850" />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-2 border-t border-white/5 pt-3">
              <div className="h-3 w-12 rounded bg-zinc-850" />
              <div className="h-3 w-8 rounded bg-zinc-850" />
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div
      ref={viewRef}
      className="h-auto bg-admin-bg pb-admin lg:pb-12 text-white duration-200 animate-in fade-in selection:bg-admin-gold/30"
    >
      {/* Header Elite */}
      <div className="flex items-center justify-between gap-4 px-6 pb-2 pt-6">
        <h1 className="flex shrink-0 select-none items-center gap-3 text-2xl font-black uppercase leading-none tracking-tighter md:text-3xl">
          <span className="flex flex-nowrap items-baseline whitespace-nowrap">
            <span className="italic text-white">Clientes</span>
          </span>
          <button
            type="button"
            onClick={() => setShowHelpModal(true)}
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/5 bg-zinc-900/60 text-zinc-500 transition-all duration-300 hover:border-white/10 hover:text-white active:scale-95"
            title="Guia de Clientes e Ajuda"
          >
            <HelpCircle className="size-4.5" />
          </button>
          {/* Missão 06 (C3): ponto com estado real de conexão no lugar da
              tag que ficava verde após a carga. Desde o pedido do Gabriel de
              02/09 à tarde ele vive AQUI, ao lado direito do título (igual
              em Pedidos e Produtos), fora do canto da tela. */}
          <PontoDeOperacao sincronizando={loading} />
        </h1>
      </div>

      <div className="space-y-8 p-4 sm:p-6 lg:p-8">
        {/* Support & Engagement Banners */}
        <div className="duration-300 animate-in fade-in slide-in-from-bottom-2">
          <CustomerBanners onNavigate={handleLocalNavigate} />
        </div>
        {/* Control Bar para Carrossel/Grid de Métricas */}
        <div className="space-y-4">
          <LocalErrorBoundary>
            <AdminKpiCarousel
              active={active}
              cards={kpiCards}
              loading={loading && !globalStats}
              title="Métricas de Clientes"
            />
          </LocalErrorBoundary>
        </div>
        {/* Unified Control Bar Compacta */}
        <div className="relative z-30 mb-5 mt-3 flex flex-col border-t border-white/5 pt-4">
          {/* Sticky de filha DIRETA deste bloco (que contém a lista): sticky
              só anda dentro do próprio containing block — embrulhada num
              wrapper da própria altura ela nunca gruda (achado 1 da revisão). */}
          <div className="sticky top-0 z-30 -mx-4 w-full border-b border-white/5 bg-[#09090b]/95 px-4 py-2.5 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            <div className="flex w-full items-center gap-3">
              <div className="group relative w-full flex-1">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                  {loading || isTyping ? (
                    <Loader2 className="size-4 animate-spin text-admin-gold" />
                  ) : (
                    <Search className="size-4 text-zinc-600 transition-colors group-focus-within:text-admin-gold" />
                  )}
                </div>
                <label htmlFor="customers-search" className="sr-only">
                  Buscar clientes
                </label>
                <DebouncedSearchInput
                  id="customers-search"
                  name="search"
                  placeholder="Buscar clientes..."
                  className="h-11 w-full rounded-xl border-zinc-800 bg-black/40 pl-10 text-xs font-bold text-white transition-all placeholder:text-zinc-600 focus:border-admin-gold/50 focus:ring-admin-gold/20"
                  value={searchTerm}
                  onChange={(val) => {
                    setSearchTerm(val);
                    setPage(0);
                    shouldScrollToTop.current = true;
                  }}
                  onTyping={setIsTyping}
                  delay={300}
                />
              </div>

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
            </div>

            {/* Chips de ordenação (pedido do Gabriel, 02/09: a mesma fileira
                de filtros da tela de Pedidos — substitui o funil dropdown).
                Parte da MESMA âncora da busca: gruda junto com ela. */}
            <div className="custom-scrollbar-hidden relative flex w-full snap-x gap-3 overflow-x-auto pt-3">
              {ORDENACOES_CLIENTES.map((o) => (
                <button
                  key={o.campo}
                  onClick={() => {
                    setSortField(o.campo);
                    setSortDirection(o.direcao);
                    setPage(0);
                    shouldScrollToTop.current = true;
                  }}
                  className={cn(
                    "h-11 shrink-0 snap-center rounded-xl border px-5 text-[10px] font-black uppercase tracking-widest transition-all",
                    sortField === o.campo && sortDirection === o.direcao
                      ? "bg-admin-gold border-admin-gold text-black shadow-[0_0_20px_rgba(212,175,55,0.2)]"
                      : "bg-zinc-900/60 border-zinc-800 text-zinc-500 hover:bg-zinc-800 hover:text-white",
                  )}
                >
                  {o.rotulo}
                </button>
              ))}
            </div>
          </div>

          {/* Data List (Responsive Grid/Cards) */}
          <LocalErrorBoundary>
            <div className="group/table relative w-full p-2 sm:p-0">
              {loading && paginatedCustomers.length > 0 && (
                <div className="admin-sync-progress-bar" />
              )}
              {/* Glow Decoration */}
              <div className="pointer-events-none absolute -left-24 -top-24 size-48 bg-admin-gold/5 blur-[100px]" />

              <div className="relative z-10 flex w-full flex-col">
                {loading && paginatedCustomers.length === 0 ? (
                  viewMode === "detailed" ? (
                    renderDetailedSkeletons()
                  ) : (
                    renderCompactSkeletons()
                  )
                ) : paginatedCustomers.length === 0 ? (
                  <div className="py-24 text-center">
                    <div className="flex flex-col items-center justify-center text-zinc-600">
                      <div className="mb-6 flex size-20 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 shadow-inner">
                        <Users className="size-8 opacity-20" />
                      </div>
                      <p className="text-sm font-bold uppercase tracking-widest text-zinc-500">
                        Nenhum cliente retornado
                      </p>
                      <p className="mt-2 text-[10px] text-zinc-600">
                        Revise os filtros ou sua pesquisa.
                      </p>
                    </div>
                  </div>
                ) : viewMode === "detailed" ? (
                  <>
                    {/* Desktop Headers */}
                    <div className="sticky top-[120px] z-20 hidden grid-cols-12 gap-4 border-b border-zinc-800/50 bg-zinc-900/60 px-8 py-5 shadow-sm md:grid">
                      <div
                        className="group/th col-span-4 flex cursor-pointer items-center gap-2"
                        onClick={() => handleSort("full_name")}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleSort("full_name");
                          }
                        }}
                      >
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 transition-colors group-hover/th:text-admin-gold">
                          Cliente
                        </span>
                        <ArrowUpDown className="size-3 text-zinc-600 transition-all group-hover/th:translate-y-0.5 group-hover/th:text-admin-gold" />
                      </div>
                      <div
                        className="group/th col-span-3 flex cursor-pointer items-center gap-2"
                        onClick={() => handleSort("role")}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleSort("role");
                          }
                        }}
                      >
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 transition-colors group-hover/th:text-admin-gold">
                          Contato / Role
                        </span>
                        <ArrowUpDown className="size-3 text-zinc-600 transition-all group-hover/th:translate-y-0.5 group-hover/th:text-admin-gold" />
                      </div>
                      <div
                        className="group/th col-span-2 flex cursor-pointer items-center justify-end gap-2"
                        onClick={() => handleSort("total_spent")}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleSort("total_spent");
                          }
                        }}
                      >
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 transition-colors group-hover/th:text-admin-gold">
                          LTV (Gasto)
                        </span>
                        <ArrowUpDown className="size-3 text-zinc-600 transition-all group-hover/th:translate-y-0.5 group-hover/th:text-admin-gold" />
                      </div>
                      <div
                        className="group/th col-span-1 flex cursor-pointer items-center justify-center gap-2"
                        onClick={() => handleSort("orders_count")}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleSort("orders_count");
                          }
                        }}
                      >
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 transition-colors group-hover/th:text-admin-gold">
                          Pedidos
                        </span>
                      </div>
                      <div className="col-span-2 flex items-center justify-end">
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                          Gestão
                        </span>
                      </div>
                    </div>

                    {/* Data Rows */}
                    <div className="flex flex-col gap-4 divide-y-0 divide-zinc-800/30 md:gap-0 md:divide-y">
                      {paginatedCustomers.map((customer) => (
                        <CustomerRowDetailed
                          key={customer.id}
                          customer={customer}
                          onNavigate={handleLocalNavigate}
                          onPrefetch={handlePrefetchUserDetail}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:gap-6 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {paginatedCustomers.map((customer) => (
                      <CustomerRowCompact
                        key={customer.id}
                        customer={customer}
                        onNavigate={handleLocalNavigate}
                        onPrefetch={handlePrefetchUserDetail}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </LocalErrorBoundary>
          {/* Missão 06 (C2): paginação única — "Segmento" morre e o tamanho de
              página alinha com pedidos/produtos (12). */}
          <PaginacaoAdmin
            pagina={page}
            totalPaginas={totalPages}
            totalItens={totalCustomers}
            itensPorPagina={PAGE_SIZE}
            aoMudar={(nova) => {
              setPage(nova);
              shouldScrollToTop.current = true;
            }}
            className="mt-0 border-t border-zinc-800/50 bg-zinc-900/60 px-8 py-5"
          />
        </div>
      </div>
      {/* Modal de Ajuda */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Guia da Base de Clientes"
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-zinc-400">
            Esta tela exibe a base de perfis de consumidores cadastrados. Ela
            reúne informações consolidadas de compras e histórico financeiro de
            cada cliente.
          </p>

          <div className="space-y-3">
            <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Métricas e Conceitos
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Users className="size-4 text-emerald-500" />
                  Total de Clientes
                </div>
                <p className="text-xs text-zinc-400">
                  O número total de usuários cadastrados que já realizaram login
                  ou criaram perfil na plataforma.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Wallet className="size-4 text-admin-gold" />
                  LTV (Lifetime Value)
                </div>
                <p className="text-xs text-zinc-400">
                  O valor financeiro total gasto por um cliente ao longo de todo
                  o tempo de vida de sua conta na loja.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <ShoppingBag className="size-4 text-sky-500" />
                  Pedidos Totais
                </div>
                <p className="text-xs text-zinc-400">
                  Volume acumulado de compras que o usuário efetuou,
                  independentemente do status atual do pagamento.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <TrendingUp className="size-4 text-purple-500" />
                  Novos Clientes (30d)
                </div>
                <p className="text-xs text-zinc-400">
                  {/* Laudo 0109 (A11): o número é perfis CRIADOS nos
                  últimos 30 dias (profiles.created_at) — o texto antigo
                  prometia "ou que realizaram o primeiro acesso", regra que
                  a contagem nunca usou. */}
                  Quantidade de perfis criados nos últimos 30 dias.
                </p>
              </div>
            </div>
          </div>
        </div>
      </AdminHelpModal>
    </div>
  );
});

interface CustomerRowProps {
  readonly customer: Customer;
  readonly onNavigate: (view: View, id?: string) => void;
  readonly onPrefetch: () => void;
}

const CustomerRowDetailed = memo(function CustomerRowDetailed({
  customer,
  onNavigate,
  onPrefetch,
}: CustomerRowProps) {
  return (
    <div
      className="content-visibility-auto group relative flex min-h-[120px] cursor-pointer flex-col gap-5 overflow-hidden rounded-3xl border border-zinc-800/50 bg-zinc-900/30 p-5 shadow-xl transition-all hover:bg-zinc-800/20 md:grid md:grid-cols-12 md:items-center md:gap-4 md:rounded-none md:border-transparent md:bg-transparent md:px-8 md:py-6 md:shadow-none md:hover:bg-zinc-800/30"
      onClick={() => onNavigate("admin-user-detail", customer.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNavigate("admin-user-detail", customer.id);
        }
      }}
      onMouseEnter={onPrefetch}
      onTouchStart={onPrefetch}
    >
      {/* Column 1: Client Info (md:col-span-4) */}
      <div className="flex items-center gap-4 pr-10 md:col-span-4 md:pr-0">
        <div className="relative shrink-0 transition-transform duration-300 group-hover:scale-105">
          <Avatar className="size-12 border-2 border-zinc-800/60 shadow-2xl transition-colors group-hover:border-admin-gold/50 sm:size-14">
            <AvatarImage src={customer.avatar_url} className="object-cover" />
            <AvatarFallback className="border border-zinc-800/50 bg-zinc-950 text-xs font-black text-zinc-400">
              {customer.full_name?.substring(0, 2).toUpperCase() || "CX"}
            </AvatarFallback>
          </Avatar>
          {customer.is_push_subscribed && (
            <div className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border-2 border-black bg-gradient-to-br from-admin-gold to-yellow-600 shadow-[0_0_15px_rgba(255,191,0,0.4)] sm:size-6">
              <Zap className="size-2.5 fill-black text-black sm:size-3" />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col justify-center">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-sm font-black leading-none text-white transition-colors group-hover:text-admin-gold sm:text-base">
              {customer.full_name || "Usuário"}
            </h4>
            <Badge
              className={`rounded-md border px-2 py-0.5 text-[8px] font-black uppercase tracking-widest sm:text-[9px] ${
                customer.role === "admin"
                  ? "border-admin-gold/50 bg-admin-gold text-black"
                  : "border-zinc-800/80 bg-zinc-950 text-zinc-500 shadow-inner"
              }`}
            >
              {customer.role === "admin" && (
                <Shield className="mr-1 inline-flex hidden size-2.5 md:block" />
              )}
              {customer.role}
            </Badge>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="rounded border border-white/5 bg-black/20 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-widest text-zinc-600">
              #{customer.id.slice(0, 8).toUpperCase()}
            </span>
            <span className="truncate text-[9px] font-bold uppercase tracking-widest text-zinc-600 md:hidden">
              Desde {new Date(customer.created_at).toLocaleDateString("pt-BR")}
            </span>
          </div>
        </div>
      </div>

      {/* Column 2: Contact Info (md:col-span-3) */}
      <div className="flex flex-col gap-2.5 overflow-hidden md:col-span-3">
        <div className="flex w-full items-center gap-3">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-[0.6rem] border border-zinc-800/80 bg-zinc-950/80 text-zinc-500 shadow-inner transition-colors group-hover:border-admin-gold/30 group-hover:text-admin-gold sm:size-8">
            <Mail className="size-3.5" />
          </div>
          <span className="truncate text-[11px] font-semibold tracking-wide text-zinc-300 sm:text-xs">
            {customer.email || "N/A"}
          </span>
        </div>
        {customer.phone && (
          <div className="flex w-full items-center gap-3">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-[0.6rem] border border-zinc-800/80 bg-zinc-950/80 text-zinc-500 shadow-inner transition-colors group-hover:border-admin-gold/30 group-hover:text-admin-gold sm:size-8">
              <Phone className="size-3.5" />
            </div>
            <span className="truncate text-[11px] font-semibold tracking-wider text-zinc-400 sm:text-xs">
              {customer.phone}
            </span>
          </div>
        )}
      </div>

      {/* Quick Mobile Stats Divider */}
      <div className="my-1 h-px w-full bg-gradient-to-r from-transparent via-zinc-800/80 to-transparent md:hidden" />

      {/* Columns 3 & 4: Mobile Grid Stats footer OR Desktop LTV/Orders */}
      <div className="grid grid-cols-2 justify-between gap-4 md:col-span-3 md:flex md:items-center md:justify-end">
        {/* Desktop: LTV | Mobile: Col 1 */}
        <div className="flex flex-col items-start gap-1.5 md:w-full md:items-end">
          <span className="text-[8px] font-black uppercase tracking-[0.2em] text-zinc-600 md:hidden">
            LTV Total
          </span>
          <div className="flex min-w-[100px] items-center gap-1.5 rounded-xl border border-zinc-800/80 bg-gradient-to-br from-zinc-900 to-zinc-950 px-3 py-2 text-sm font-black text-white shadow-inner transition-colors group-hover:border-admin-gold/30 md:min-w-0 xl:text-base">
            <span className="text-[10px] leading-none text-zinc-500">R$</span>
            <span className="leading-none">
              {Number(customer.total_spent || 0).toLocaleString("pt-BR", {
                minimumFractionDigits: 2,
              })}
            </span>
          </div>
        </div>

        {/* Desktop: Orders | Mobile: Col 2 */}
        <div className="flex flex-col items-end gap-1.5 md:items-center">
          <span className="text-right text-[8px] font-black uppercase tracking-[0.2em] text-zinc-600 md:hidden">
            Pedidos
          </span>
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[0.8rem] border border-zinc-800/80 bg-gradient-to-b from-zinc-900 to-zinc-950 shadow-inner transition-colors group-hover:border-admin-gold/50 group-hover:bg-black group-hover:text-admin-gold sm:size-11">
            <span className="text-xs font-black text-white sm:text-sm">
              {customer.orders_count || 0}
            </span>
          </div>
        </div>
      </div>

      {/* Column 5: Desktop Date (hidden on mobile, inline above) */}
      <div className="hidden flex-col items-end gap-1.5 md:col-span-1 md:flex">
        <div
          className="flex w-full items-center justify-center truncate rounded-lg border border-zinc-800/80 bg-zinc-950/80 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400 shadow-inner"
          title={
            customer.last_order_date
              ? new Date(customer.last_order_date).toLocaleDateString()
              : "Nenhuma"
          }
        >
          <Calendar className="mr-1.5 size-3 shrink-0 text-admin-gold/50" />
          {customer.last_order_date
            ? new Date(customer.last_order_date).toLocaleDateString()
            : "--"}
        </div>
      </div>

      {/* Column 6: Management Options */}
      <div className="absolute right-4 top-4 flex justify-end md:relative md:right-auto md:top-auto md:col-span-1">
        <div onClick={(e) => e.stopPropagation()} role="presentation">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-10 rounded-[0.8rem] border border-zinc-800/80 bg-zinc-950/80 text-zinc-400 shadow-xl backdrop-blur-md transition-all hover:border-admin-gold hover:bg-admin-gold hover:text-white group-hover:border-zinc-700 sm:size-12 md:size-10 md:bg-zinc-900/50 md:shadow-none"
              >
                <MoreHorizontal className="size-5 flex-shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="z-[100] w-[200px] rounded-2xl border border-zinc-800/80 bg-zinc-950/95 p-2 shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-2xl"
            >
              <DropdownMenuLabel className="p-3 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400">
                Gestão de Cliente
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-zinc-800/60" />
              <DropdownMenuItem
                className="group flex cursor-pointer items-center gap-1 rounded-xl p-3 text-[10px] font-black uppercase tracking-widest text-zinc-200 transition-colors focus:bg-admin-gold focus:text-black"
                onClick={() => onNavigate("admin-user-detail", customer.id)}
              >
                <Shield className="mr-2 size-4 shrink-0 text-zinc-400 transition-colors group-focus:text-black" />
                Ver Perfil Elite
              </DropdownMenuItem>
              <DropdownMenuItem
                className="group flex cursor-pointer items-center gap-1 rounded-xl p-3 text-[10px] font-black uppercase tracking-widest text-zinc-200 transition-colors focus:bg-admin-gold focus:text-black"
                onClick={() => onNavigate("admin-push", customer.id)}
              >
                <Zap className="mr-2 size-4 shrink-0 text-zinc-400 transition-colors group-focus:text-black" />
                Notificação Push
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
});

const CustomerRowCompact = memo(function CustomerRowCompact({
  customer,
  onNavigate,
  onPrefetch,
}: CustomerRowProps) {
  return (
    <div
      onClick={() => onNavigate("admin-user-detail", customer.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNavigate("admin-user-detail", customer.id);
        }
      }}
      onMouseEnter={onPrefetch}
      onTouchStart={onPrefetch}
      className="content-visibility-auto group relative flex min-h-[170px] cursor-pointer flex-col justify-between rounded-3xl border border-white/5 bg-zinc-950/40 p-3.5 backdrop-blur-md transition-all duration-500 hover:scale-[1.01] hover:border-admin-gold/30 hover:shadow-[0_15px_40px_rgba(212,175,55,0.05)] active:scale-[0.98] sm:p-5"
    >
      {/* Glow Background */}
      <div className="pointer-events-none absolute inset-0 z-0 rounded-3xl bg-gradient-to-br from-admin-gold/0 via-transparent to-admin-gold/0 transition-all duration-700 group-hover:from-admin-gold/5 group-hover:to-transparent" />

      <div className="relative z-10 flex size-full flex-col">
        {/* Header Row: Avatar and Action Dropdown */}
        <div className="relative flex w-full items-start justify-between">
          <div className="relative shrink-0 transition-transform duration-300 group-hover:scale-105">
            <Avatar className="size-10 border border-zinc-800/60 shadow-md transition-colors group-hover:border-admin-gold/50 sm:size-12">
              <AvatarImage src={customer.avatar_url} className="object-cover" />
              <AvatarFallback className="border border-zinc-800/50 bg-zinc-950 text-xs font-black text-zinc-400">
                {customer.full_name?.substring(0, 2).toUpperCase() || "CX"}
              </AvatarFallback>
            </Avatar>
            {customer.is_push_subscribed && (
              <div className="absolute -bottom-0.5 -right-0.5 flex size-4.5 items-center justify-center rounded-full border border-black bg-gradient-to-br from-admin-gold to-yellow-600 shadow-[0_0_10px_rgba(255,191,0,0.4)]">
                <Zap className="size-2.5 fill-black text-black" />
              </div>
            )}
          </div>

          <div
            className="absolute right-0 top-0"
            onClick={(e) => e.stopPropagation()}
            role="presentation"
          >
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="flex size-11 items-center justify-center rounded-xl border border-white/5 bg-zinc-950/80 text-zinc-400 shadow-md transition-all hover:bg-zinc-900 hover:text-white"
                >
                  <MoreHorizontal className="size-5 flex-shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="z-[100] w-[180px] rounded-2xl border border-zinc-800/80 bg-zinc-950/95 p-2 shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-2xl"
              >
                <DropdownMenuLabel className="p-2.5 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400">
                  Gestão de Cliente
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-zinc-800/60" />
                <DropdownMenuItem
                  className="group flex cursor-pointer items-center gap-1 rounded-xl p-2.5 text-[9px] font-black uppercase tracking-widest text-zinc-200 transition-colors focus:bg-admin-gold focus:text-black"
                  onClick={() => onNavigate("admin-user-detail", customer.id)}
                >
                  <Shield className="mr-2 size-3.5 shrink-0 text-zinc-400 transition-colors group-focus:text-black" />
                  Ver Perfil Elite
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="group flex cursor-pointer items-center gap-1 rounded-xl p-2.5 text-[9px] font-black uppercase tracking-widest text-zinc-200 transition-colors focus:bg-admin-gold focus:text-black"
                  onClick={() => onNavigate("admin-push", customer.id)}
                >
                  <Zap className="mr-2 size-3.5 shrink-0 text-zinc-400 transition-colors group-focus:text-black" />
                  Notificação Push
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Customer Name and Badges */}
        <div className="mt-3 min-w-0 pr-2">
          <h4 className="truncate text-xs font-black leading-none text-white transition-colors group-hover:text-admin-gold sm:text-sm">
            {customer.full_name || "Usuário"}
          </h4>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge
              className={cn(
                "px-1.5 py-0.5 rounded-md text-[7px] font-black tracking-widest uppercase border",
                customer.role === "admin"
                  ? "bg-admin-gold text-black border-admin-gold/50"
                  : "bg-zinc-950 text-zinc-500 border-zinc-800/80 shadow-inner",
              )}
            >
              {customer.role}
            </Badge>
            <span className="rounded border border-white/5 bg-black/20 px-1 py-0.5 font-mono text-[8px] font-bold text-zinc-600">
              #{customer.id.slice(0, 8).toUpperCase()}
            </span>
          </div>
        </div>

        {/* Email & Phone */}
        <div className="mt-3 space-y-1 text-[10px] text-zinc-400">
          <div className="flex items-center gap-1.5 truncate">
            <Mail className="size-3 shrink-0 text-zinc-600" />
            <span className="truncate">{customer.email || "N/A"}</span>
          </div>
          {customer.phone && (
            <div className="flex items-center gap-1.5 truncate">
              <Phone className="size-3 shrink-0 text-zinc-600" />
              <span className="truncate">{customer.phone}</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom KPIs: LTV & Pedidos */}
      <div className="relative z-10 mt-4 flex items-center justify-between gap-2 border-t border-white/5 pt-3">
        <div className="flex flex-col">
          <span className="text-[7px] font-black uppercase tracking-[0.2em] text-zinc-600">
            LTV Total
          </span>
          <span className="mt-0.5 text-xs font-black text-white">
            <span className="mr-0.5 text-[9px] text-zinc-500">R$</span>
            {Number(customer.total_spent || 0).toLocaleString("pt-BR", {
              minimumFractionDigits: 2,
            })}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[7px] font-black uppercase tracking-[0.2em] text-zinc-600">
            Pedidos
          </span>
          <span className="mt-0.5 text-xs font-black text-admin-gold">
            {customer.orders_count || 0}
          </span>
        </div>
      </div>
    </div>
  );
});
