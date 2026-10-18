import type { KpiCardConfig } from "@/components/admin/AdminKpiCarousel";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DebouncedSearchInput } from "@/components/admin/DebouncedSearchInput";
import { MetricasDoPainel } from "@/components/admin/MetricasDoPainel";
import { PaginacaoAdmin } from "@/components/admin/PaginacaoAdmin";
import { PontoDeOperacao } from "@/components/admin/PontoDeOperacao";
import { CartaoCliente } from "@/components/admin/users/CartaoCliente";
import {
  BOTAO_CLIENTES,
  FOCO_CLIENTES,
  FolhaClientes,
} from "@/components/admin/users/FolhaClientes";
import { AcaoDaBarra } from "@/components/layouts/AcaoDaBarra";
import { LocalErrorBoundary } from "@/components/ui/custom/LocalErrorBoundary";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { formatarInteiro } from "@/lib/crm";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import {
  AlertCircle,
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowUpDown,
  Box,
  CloudOff,
  HelpCircle,
  Info,
  LayoutGrid,
  List,
  Loader2,
  Megaphone,
  MessageSquare,
  RefreshCw,
  Search,
  ShoppingBag,
  TrendingUp,
  Users,
  Wallet,
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
  {
    campo: "total_spent",
    direcao: "desc",
    rotulo: "Maior total comprado",
    icone: ArrowDownWideNarrow,
    cor: "text-indigo-300",
  },
  {
    campo: "orders_count",
    direcao: "desc",
    rotulo: "Mais Pedidos",
    icone: Box,
    cor: "text-pink-300",
  },
  {
    campo: "full_name",
    direcao: "asc",
    rotulo: "Alfabética",
    icone: ArrowDownAZ,
    cor: "text-violet-300",
  },
] as const;

/** Mesmo par campo/direção de ORDENACOES_CLIENTES, como `Map` — pra
 * `handleSort` (abaixo) usar a direção-padrão de CADA campo no primeiro
 * clique do cabeçalho da coluna, igual ao chip equivalente (achado
 * AdminCustomersView-636: o cabeçalho "Total já comprado" (antes "LTV
 * (Gasto)") começava em "asc", ao contrário do chip "Maior total comprado",
 * que é "desc"). `Map.get` em vez de
 * indexar um objeto por campo dinâmico: o eslint-plugin-security acusa
 * `detect-object-injection` em `objeto[variável]` mesmo quando a chave
 * vem de uma união fechada — mesmo padrão de CustomerPaymentBadge.tsx
 * (`customerPaymentConfigByKey`). "role" não tem chip próprio e cai no
 * fallback "asc" de `handleSort`. */
const DIRECAO_PADRAO_POR_CAMPO = new Map<keyof Customer, "asc" | "desc">(
  ORDENACOES_CLIENTES.map((o) => [o.campo, o.direcao]),
);

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
  // Qual consulta (busca + ordem + página) falhou por último: só ela esconde a
  // lista, para a falha não parecer o resultado de outra busca.
  const [chaveComErro, setChaveComErro] = useState<string | null>(null);
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
      const chaveDaRodada = JSON.stringify([
        searchTerm,
        sortField,
        sortDirection,
        pageToFetch,
      ]);
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
          setChaveComErro(null);
        }
      } catch (error) {
        console.error("Error fetching customers:", error);
        if (rodada === rodadaRef.current) {
          setChaveComErro(chaveDaRodada);
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
        value: formatarInteiro(globalStats?.total_customers),
        icon: Users,
        accent: "text-indigo-300",
        subValue: "Base de Clientes",
      },
      {
        label: "Novos (30 dias)",
        value: formatarInteiro(globalStats?.new_customers_30d),
        icon: TrendingUp,
        accent: "text-emerald-300",
        subValue: "Crescimento",
      },
      {
        label: "Valor médio por venda",
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
        accent: "text-orange-300",
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
        value: formatarInteiro(analyticsStats?.executive?.totalOrders),
        icon: ShoppingBag,
        accent: "text-pink-300",
        subValue: "Pedidos",
      },
    ],
    [globalStats, analyticsStats],
  );

  const chaveDaConsulta = JSON.stringify([
    searchTerm,
    sortField,
    sortDirection,
    page,
  ]);
  const erroDaListagem = chaveComErro === chaveDaConsulta;
  const totalExibido = erroDaListagem ? 0 : totalCustomers;
  const totalPages = Math.ceil(totalExibido / PAGE_SIZE);
  const paginatedCustomers = erroDaListagem ? [] : customers; // Already paginated from server

  // `sortField`/`sortDirection` já NASCEM como "total_spent"/"desc" (linhas
  // 111-112, pra bater com o chip "Maior total comprado" antes de qualquer
  // clique). O defeito 636 era comparar `sortField === field` contra esse
  // estado pré-populado: no primeiro clique em "Total já comprado" parecia "o
  // lojista já tinha escolhido total_spent" e caía direto no ramo de
  // alternância, invertendo pra "asc" — menor gasto no topo, ao contrário
  // do chip. Este ref guarda "o lojista já clicou em ALGUM cabeçalho
  // alguma vez", que é a pergunta certa: só alterna depois de um clique
  // de verdade no mesmo campo; o primeiro clique em qualquer campo sempre
  // aplica a direção-padrão daquele campo (igual ao chip).
  const jaClicouEmAlgumCabecalhoRef = useRef(false);

  const handleSort = (field: keyof Customer) => {
    setPage(0);
    shouldScrollToTop.current = true;
    if (jaClicouEmAlgumCabecalhoRef.current && sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection(DIRECAO_PADRAO_POR_CAMPO.get(field) ?? "asc");
    }
    jaClicouEmAlgumCabecalhoRef.current = true;
  };
  const renderSkeletons = () => (
    <div aria-label="Carregando clientes" className="space-y-3">
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-2xl border border-white/10 bg-[#101013] p-3"
        >
          <div className="flex gap-3">
            <div className="size-10 shrink-0 rounded-full bg-[#1E1E24]" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-3 w-2/3 rounded-full bg-[#1E1E24]" />
              <div className="h-2 w-1/4 rounded-full bg-[#1E1E24]" />
            </div>
          </div>
          <div className="mt-3 flex gap-4">
            <div className="h-3 w-1/3 rounded-full bg-[#1E1E24]" />
            <div className="h-3 w-1/6 rounded-full bg-[#1E1E24]" />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div
      ref={viewRef}
      className="pb-admin h-auto bg-[#08080A] text-white lg:pb-12"
    >
      <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
        <div className="min-w-0 [&_h1]:normal-case [&_h1]:tracking-tight [&_h1_span]:not-italic">
          <AdminPageHeader titulo={NOMES_DO_PAINEL["admin-customers"]} />
          <div
            className={cn(
              "mt-1 flex items-center gap-1.5 text-xs",
              isOffline || erroDaListagem ? "text-red-300" : "text-zinc-400",
            )}
          >
            <PontoDeOperacao sincronizando={loading} />
            <span>
              {isOffline
                ? "Sem conexão com o servidor"
                : loading
                  ? "Sincronizando clientes..."
                  : erroDaListagem
                    ? "Falha ao atualizar clientes"
                    : `${formatarInteiro(globalStats?.total_customers)} contas no app · Sincronizado`}
            </span>
          </div>
        </div>
        <FolhaClientes
          aberta={showHelpModal}
          aoMudar={setShowHelpModal}
          titulo="Guia da Base de Clientes"
          ajuda
          gatilho={
            <button
              type="button"
              aria-label="Guia de Clientes e Ajuda"
              title="Guia de Clientes e Ajuda"
              className={`flex size-11 min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-violet-300/20 bg-violet-300/10 text-violet-300 ${FOCO_CLIENTES}`}
            >
              <HelpCircle aria-hidden="true" className="size-6" />
            </button>
          }
        >
          <AjudaDaBaseClientes />
        </FolhaClientes>
      </div>
      <p className="flex items-start gap-1.5 px-5 pb-3 text-xs text-zinc-400">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Clientes com conta no app. Quem comprou só no balcão aparece em{" "}
          {NOMES_DO_PAINEL["admin-crm"]} › Clientes.
        </span>
      </p>
      <div className="px-5">
        <LocalErrorBoundary>
          <MetricasDoPainel
            titulo="Métricas de Clientes"
            legendasDoResumo={[
              "Total",
              "Novos · 30d",
              "Média/pedido",
              "Pedidos",
            ]}
            cards={kpiCards}
          />
        </LocalErrorBoundary>
        <div className="relative z-30 mt-7 flex flex-col">
          {/* Sticky de filha DIRETA deste bloco (que contém a lista): sticky
              só anda dentro do próprio containing block — embrulhada num
              wrapper da própria altura ela nunca gruda (achado 1 da revisão). */}
          <div className="sticky top-0 z-30 -mx-5 bg-[#08080A]/95 px-5 py-2 backdrop-blur-md">
            <div className="flex w-full flex-wrap items-stretch gap-2">
              <div className="relative min-w-[120px] flex-1">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-3 z-10 flex size-5 items-center justify-center rounded-md bg-indigo-300/10 text-indigo-300"
                >
                  {loading || isTyping ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Search className="size-4" />
                  )}
                </span>
                <label htmlFor="customers-search" className="sr-only">
                  Buscar clientes
                </label>
                <DebouncedSearchInput
                  limpavel
                  id="customers-search"
                  name="search"
                  placeholder="Buscar clientes..."
                  className="h-11 w-full rounded-xl border-white/10 bg-[#17171C] pl-10 text-sm text-zinc-100 placeholder:text-zinc-400 focus-visible:ring-sky-300"
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
              <div
                role="group"
                aria-label="Visualização dos clientes"
                className="flex gap-1"
              >
                {(["compact", "detailed"] as const).map((modo) => {
                  const Icone = modo === "compact" ? List : LayoutGrid;
                  return (
                    <button
                      key={modo}
                      type="button"
                      onClick={() => setViewMode(modo)}
                      aria-label={
                        modo === "compact"
                          ? "Visualização Compacta"
                          : "Visualização Detalhada"
                      }
                      aria-pressed={viewMode === modo}
                      className={cn(
                        `flex min-h-11 min-w-11 flex-col items-center justify-center rounded-xl border px-2 text-xs ${FOCO_CLIENTES}`,
                        viewMode === modo
                          ? "border-white/20 bg-[#26262E] font-bold text-white"
                          : "border-white/10 bg-[#101013] text-zinc-400",
                      )}
                    >
                      <Icone
                        aria-hidden="true"
                        className="size-4 rounded bg-indigo-300/10 text-indigo-300"
                      />
                      {modo === "compact" ? "Compacta" : "Detalhada"}
                    </button>
                  );
                })}
              </div>
            </div>
            <div
              role="group"
              aria-label="Ordenar clientes"
              className="mt-1 flex w-full gap-1"
            >
              {ORDENACOES_CLIENTES.map((o) => (
                <button
                  key={o.campo}
                  type="button"
                  aria-pressed={
                    sortField === o.campo && sortDirection === o.direcao
                  }
                  onClick={() => {
                    setSortField(o.campo);
                    setSortDirection(o.direcao);
                    setPage(0);
                    shouldScrollToTop.current = true;
                  }}
                  className={cn(
                    `flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl border px-1 py-1 text-left text-xs leading-tight ${FOCO_CLIENTES}`,
                    sortField === o.campo && sortDirection === o.direcao
                      ? "border-[#F5C542] bg-[#F5C542]/10 font-bold text-white"
                      : "border-white/10 bg-[#17171C] text-zinc-300",
                  )}
                >
                  <o.icone
                    aria-hidden="true"
                    className={cn(
                      "size-6 shrink-0 rounded-lg border border-white/10 bg-white/5 p-1",
                      o.cor,
                    )}
                  />
                  <span className="min-w-0 break-words">{o.rotulo}</span>
                </button>
              ))}
            </div>
          </div>
          {isOffline && (
            <div
              role="status"
              className="mt-5 flex items-start gap-3 rounded-2xl border border-red-300/10 bg-red-400/5 p-4 text-xs text-zinc-300"
            >
              <CloudOff
                aria-hidden="true"
                className="size-8 shrink-0 rounded-xl bg-red-400/10 p-1.5 text-red-300"
              />
              <div>
                <p className="font-semibold text-red-300">
                  Sem conexão com o servidor
                </p>
                <p className="mt-1">
                  Os dados na tela podem estar desatualizados até a conexão
                  voltar.
                </p>
              </div>
            </div>
          )}

          {/* Data List (Responsive Grid/Cards) */}
          {erroDaListagem && (
            <div
              role="alert"
              className="mt-7 flex flex-col items-center gap-3 rounded-3xl border border-red-300/10 bg-red-400/5 p-5 text-center text-sm text-zinc-100"
            >
              <AlertCircle
                aria-hidden="true"
                className="size-10 rounded-xl bg-red-400/10 p-2 text-red-300"
              />
              <p className="font-semibold">
                Não conseguimos carregar os clientes agora.
              </p>
              <button
                type="button"
                aria-label="Tentar carregar os clientes de novo"
                onClick={() => fetchCustomers(page)}
                disabled={loading}
                className={`${BOTAO_CLIENTES} w-full disabled:opacity-60`}
              >
                <RefreshCw
                  aria-hidden="true"
                  className="size-4 text-violet-300"
                />
                Tentar de novo
              </button>
            </div>
          )}
          <LocalErrorBoundary>
            <div className="group/table relative w-full">
              {loading && paginatedCustomers.length > 0 && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-full bg-[#26262E]"
                >
                  <span className="block h-full w-2/5 animate-pulse bg-indigo-300" />
                </div>
              )}
              <div
                className="relative z-10 mt-7 flex w-full flex-col"
                aria-busy={loading}
              >
                {loading && paginatedCustomers.length > 0 && (
                  <p role="status" className="mb-3 text-xs text-zinc-400">
                    Carregando novos dados...
                  </p>
                )}
                {loading && paginatedCustomers.length === 0 ? (
                  renderSkeletons()
                ) : erroDaListagem ? null : paginatedCustomers.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 rounded-3xl bg-[#101013] px-4 py-6 text-center">
                    <Search
                      aria-hidden="true"
                      className="size-10 rounded-xl border border-indigo-300/20 bg-indigo-300/10 p-2 text-indigo-300"
                    />
                    <p className="text-sm font-bold text-white">
                      Nenhum cliente retornado
                    </p>
                    <p className="text-xs text-zinc-400">
                      Revise os filtros ou sua pesquisa.
                    </p>
                  </div>
                ) : viewMode === "detailed" ? (
                  <>
                    {/* Cabeçalhos desktop: mesmos campos e handlers de ordenação. */}
                    <div className="sticky top-[112px] z-20 hidden grid-cols-12 gap-4 border-b border-white/10 bg-[#17171C] p-3 md:grid">
                      <div
                        className="group/th col-span-4 flex min-h-11 cursor-pointer items-center gap-2"
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
                        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-300 transition-colors group-hover/th:text-white">
                          Cliente
                        </span>
                        <ArrowUpDown className="size-3 text-indigo-300" />
                      </div>
                      <div
                        className="group/th col-span-3 flex min-h-11 cursor-pointer items-center gap-2"
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
                        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-300 transition-colors group-hover/th:text-white">
                          Contato / Tipo de conta
                        </span>
                        <ArrowUpDown className="size-3 text-indigo-300" />
                      </div>
                      <div
                        className="group/th col-span-2 flex min-h-11 cursor-pointer items-center justify-end gap-2"
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
                        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-300 transition-colors group-hover/th:text-white">
                          Total já comprado
                        </span>
                        <ArrowUpDown className="size-3 text-indigo-300" />
                      </div>
                      <div
                        className="group/th col-span-1 flex min-h-11 cursor-pointer items-center justify-center gap-2"
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
                        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-300 transition-colors group-hover/th:text-white">
                          Pedidos
                        </span>
                      </div>
                      <div className="col-span-2 flex items-center justify-end">
                        <span className="text-[11px] font-semibold text-zinc-300">
                          Gestão
                        </span>
                      </div>
                    </div>

                    {/* Data Rows */}
                    <div className="flex flex-col gap-3">
                      {paginatedCustomers.map((customer) => (
                        <CartaoCliente
                          detalhado
                          key={customer.id}
                          customer={customer}
                          onNavigate={handleLocalNavigate}
                          onPrefetch={handlePrefetchUserDetail}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
                    {paginatedCustomers.map((customer) => (
                      <CartaoCliente
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
              página alinha com pedidos/produtos (12). Sem cartão próprio:
              mesmo padrão limpo das outras telas (pedido do Gabriel, 02/09). */}
          <PaginacaoAdmin
            aparencia="clientes"
            pagina={page}
            totalPaginas={totalPages}
            totalItens={totalExibido}
            itensPorPagina={PAGE_SIZE}
            aoMudar={(nova) => {
              setPage(nova);
              shouldScrollToTop.current = true;
            }}
          />
        </div>
        <AcaoDaBarra ativa={active !== false} aria-label="Ações dos clientes">
          <button
            type="button"
            onClick={() => handleLocalNavigate("admin-qa")}
            className={`flex min-h-14 min-w-0 flex-[0.8] items-center justify-center gap-2 rounded-[1.125rem] border border-white/10 bg-[#17171C] p-2 text-left text-xs font-bold text-white ${FOCO_CLIENTES}`}
          >
            <MessageSquare
              aria-hidden="true"
              className="size-7 shrink-0 rounded-lg border border-violet-300/20 bg-violet-300/10 p-1 text-violet-300"
            />
            <span className="min-w-0">Perguntas e avaliações</span>
          </button>
          <button
            type="button"
            onClick={() => handleLocalNavigate("admin-push")}
            className={`admin-barra-principal flex min-h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-[1.125rem] bg-gradient-to-b from-[#F9D65C] to-[#E4AF16] p-2 text-sm font-bold text-[#1B1300] ${FOCO_CLIENTES}`}
          >
            <Megaphone
              aria-hidden="true"
              className="size-8 shrink-0 rounded-xl border border-sky-300/30 bg-sky-950 p-1.5 text-sky-200"
            />
            <span>{NOMES_DO_PAINEL["admin-push"]}</span>
          </button>
        </AcaoDaBarra>
      </div>
    </div>
  );
});

function AjudaDaBaseClientes() {
  return (
    <div className="space-y-7">
      <section className="rounded-2xl bg-[#101013] p-4">
        <h3 className="mb-2 text-base font-bold text-white">
          Quem aparece aqui?
        </h3>
        <p className="text-xs text-zinc-400">
          Clientes com conta no app. Quem comprou só no balcão aparece em{" "}
          {NOMES_DO_PAINEL["admin-crm"]} › Clientes.
        </p>
      </section>
      <section>
        <h3 className="mb-4 text-lg font-bold text-white">
          Métricas e Conceitos
        </h3>
        <div className="space-y-4">
          {[
            {
              titulo: "Total Clientes",
              icone: Users,
              cor: "text-indigo-300",
              texto: "Base de Clientes: perfis com conta no app.",
            },
            {
              titulo: "Novos (30 dias)",
              icone: TrendingUp,
              cor: "text-emerald-300",
              texto: "Crescimento: perfis criados nos últimos 30 dias.",
            },
            {
              titulo: "Valor médio por venda",
              icone: Wallet,
              cor: "text-orange-300",
              texto: "Média por pedido: valor médio das compras consolidadas.",
            },
            {
              titulo: "Pedidos Totais",
              icone: ShoppingBag,
              cor: "text-pink-300",
              texto:
                "Pedidos com pagamento reconhecido. Cancelados e pendentes ficam fora.",
            },
          ].map((item) => (
            <div key={item.titulo} className="flex gap-3">
              <item.icone
                aria-hidden="true"
                className={cn(
                  "size-8 shrink-0 rounded-xl border border-current bg-white/5 p-1.5",
                  item.cor,
                )}
              />
              <div>
                <h4 className="text-sm font-bold text-white">{item.titulo}</h4>
                <p className="mt-1 text-xs text-zinc-400">{item.texto}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-3 rounded-2xl bg-[#1E1E24] p-4 text-xs text-zinc-300">
        <h3 className="text-base font-bold text-white">
          Encontre e abra a ficha
        </h3>
        <p>
          Toque no cartão para ver a ficha. No menu de três pontos, escolha Ver
          ficha do cliente ou Notificação Push.
        </p>
        <p>
          A busca volta à página 1. São 12 clientes por página. Busca, modos e
          ordenação ficam fixos ao rolar; o cabeçalho e as métricas saem da
          janela.
        </p>
        <p>
          Compacta é a visualização padrão. A escolha entre Compacta e Detalhada
          fica salva.
        </p>
        <p>
          O raio indica avisos ativos. Sem raio, Notificação Push continua
          disponível no menu.
        </p>
        <p>
          Avisar clientes abre os avisos sem destinatário. Perguntas e
          avaliações abre a tela de dúvidas e avaliações. Ambos ficam acima da
          navegação.
        </p>
      </section>
    </div>
  );
}
