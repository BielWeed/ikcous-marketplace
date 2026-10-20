import type { KpiCardConfig } from "@/components/admin/AdminKpiCarousel";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BarraDeBusca } from "@/components/admin/BarraDeBusca";
import { MetricasDoPainel } from "@/components/admin/MetricasDoPainel";
import { PaginacaoAdmin } from "@/components/admin/PaginacaoAdmin";
import { PontoDeOperacao } from "@/components/admin/PontoDeOperacao";
import { AtalhosDaAba } from "@/components/admin/primitivos/AtalhosDaAba";
import { FolhaDoPainel } from "@/components/admin/primitivos/FolhaDoPainel";
import { AcaoDaBarra } from "@/components/layouts/AcaoDaBarra";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { LocalErrorBoundary } from "@/components/ui/custom/LocalErrorBoundary";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useAoMudarCategoria } from "@/hooks/useAoMudarCategoria";
import { useCategories } from "@/hooks/useCategories";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { useProducts } from "@/hooks/useProducts";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { soFotosReais } from "@/lib/foto-do-produto";
import { mesmaCategoria } from "@/lib/gestao-de-categorias";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import {
  LIMIAR_PADRAO_DE_ESTOQUE,
  precisaDeReposicao,
} from "@/utils/avisos-do-lojista";
import { haptic } from "@/utils/haptic";
import { consumirProdutoNovoCadastrado } from "@/utils/produto-recem-cadastrado";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Calculator,
  Camera,
  ChevronDown,
  Copy,
  DollarSign,
  Edit2,
  Package,
  Pause,
  Percent,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  Sparkles,
  Trash2,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import "@/components/admin/products/catalogo-produtos.css";

let cachedProductsTotal = 0;

// Estimativa inicial do cartão recolhido; `auto` guarda a altura real ao renderizar.
// O esqueleto reserva o mesmo espaço. A medição no navegador fica para o QA visual.
const RESERVA_DO_CARTAO_DETALHADO = "![contain-intrinsic-size:auto_210px]";
const ALTURA_DO_ESQUELETO_DETALHADO = "h-[210px]";

/** Percentual com 1 casa, em pt-BR ("130,2%", nunca "130.15%"): a mesma
 * grafia no cartão do topo, no simulador e no cartão detalhado. */
function percentualComUmaCasa(valor: number): string {
  return `${valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

// A tela "Gerenciar categorias" só é baixada quando a lojista a abre.
const GerenciarCategorias = lazy(() =>
  import("@/components/admin/categorias/GerenciarCategorias").then(
    (modulo) => ({ default: modulo.GerenciarCategorias }),
  ),
);

interface AdminProductsViewProps {
  onNavigate: (view: View, id?: string) => void;
  active?: boolean;
}

export const AdminProductsView = memo(function AdminProductsView({
  onNavigate,
  active,
}: Readonly<AdminProductsViewProps>) {
  const {
    products,
    loading,
    deleteProduct,
    toggleProductStatus,
    addProduct,
    loadProducts,
    copiarImagemParaDuplicacao,
  } = useProducts({ autoFetch: false });
  const { stats, fetchExecutiveSummary } = useAnalytics();
  const { categories: dbCategories } = useCategories();
  const isOffline = useOnlineStatus();
  const { prefetchView } = usePrefetchOnHover();

  const handlePrefetchProductForm = useCallback(() => {
    prefetchView("admin-product-form");
  }, [prefetchView]);

  const {
    ref: viewRef,
    saveScroll,
    resetRestored,
  } = useScrollRestoration(
    "admin-products",
    active ?? false,
    products.length > 0,
  );

  const handleLocalNavigate = useCallback(
    (view: View, id?: string) => {
      saveScroll();
      resetRestored();
      onNavigate(view, id);
    },
    [onNavigate, saveScroll, resetRestored],
  );

  // Achado novo da revisão do Achado 7: `AdminProductsView` nunca desmonta —
  // `AdminArea.tsx` só esconde o container por CSS (`visibility`/`opacity`)
  // ao abrir `admin-product-form`. Editar o produto muda o custo, salva
  // (`useProducts.ts` chama `clearAnalyticsCache()`, que zera só o cache de
  // MÓDULO) e volta para "Produtos" com `stats` desta instância intacto —
  // sem forçar aqui, o KPI segue mostrando o snapshot de antes da edição.
  // `wasActiveRef` guarda o `active` do render anterior para disparar SÓ na
  // transição false→true, nunca a cada render enquanto a view já está
  // ativa (senão vira RPC em laço). Mesmo precedente de
  // `AdminOrdersView.tsx:430-436`.
  // A primeira abertura também é uma ativação: pode receber o resumo
  // persistido da versão anterior, ainda sem as métricas novas.
  const wasActiveRef = useRef(false);
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active ?? false;
    if (!active) return;
    if (!stats) {
      fetchExecutiveSummary(false);
      return;
    }
    if (!wasActive) {
      fetchExecutiveSummary(true);
    }
  }, [active, stats, fetchExecutiveSummary]);

  const [searchTerm, setSearchTerm] = useLocalStorage<string>(
    "admin_products_search_term",
    "",
  );
  const [isTyping, setIsTyping] = useState(false);
  const [filterCategory, setFilterCategory] = useLocalStorage<string>(
    "admin_products_filter_category",
    "all",
  );
  const [gerenciandoCategorias, setGerenciandoCategorias] = useState(false);
  const [totalProducts, setTotalProducts] = useState(() => cachedProductsTotal);
  const [currentPage, setCurrentPage] = useLocalStorage<number>(
    "admin_products_current_page",
    0,
  );
  const pageSize = 12;

  const [showVisualLoading, setShowVisualLoading] = useState(false);
  useEffect(() => {
    if (loading) {
      const timer = setTimeout(() => setShowVisualLoading(true), 180);
      return () => clearTimeout(timer);
    }
    setShowVisualLoading(false);
  }, [loading]);

  const [viewMode, setViewMode] = useState<"detailed" | "compact">(() => {
    const saved = localStorage.getItem("admin_products_view_mode");
    return saved === "detailed" || saved === "compact" ? saved : "compact";
  });

  const [expandedHelp, setExpandedHelp] = useState<Record<string, boolean>>({});
  const [helpTab, setHelpTab] = useState<"concepts" | "simulator">("concepts");
  const [simCost, setSimCost] = useState<string>("10.00");
  const [simPrice, setSimPrice] = useState<string>("15.00");
  const [simStock, setSimStock] = useState<string>("20");
  const [productToDelete, setProductToDelete] = useState<string | null>(null);
  const [productToDuplicate, setProductToDuplicate] = useState<any | null>(
    null,
  );

  useEffect(() => {
    localStorage.setItem("admin_products_view_mode", viewMode);
  }, [viewMode]);

  // Reset dialog states when active changes to false to prevent focus traps
  useEffect(() => {
    if (!active) {
      setProductToDelete(null);
      setProductToDuplicate(null);
    }
  }, [active]);

  // Achado 11 da auditoria de 20/08/2026: a busca da lista só dispara 320 ms
  // depois de a tela abrir (o `setTimeout` do efeito logo abaixo), e nesse
  // intervalo `loading` (do `useProducts`) ainda é `false` — só vira `true`
  // DENTRO de `loadProducts`, chamado só depois do atraso. A condição do
  // estado vazio (`products?.length === 0`) já era verdadeira nessa janela:
  // "ainda não perguntei" virava "perguntei e não há nada". `hasLoadedOnce`
  // fecha essa janela (existia um `firstLoadRef` aqui antes, mas era um
  // `ref` nunca LIDO em lugar nenhum do arquivo — não fazia nada). `loadError`
  // é o terceiro estado que faltava: sem ele, a correção óbvia (trocar a
  // condição por `loading || !hasLoadedOnce`) trocaria "nenhum produto" por
  // um esqueleto ETERNO sempre que a busca falhasse de verdade — mentira
  // diferente, mesma gravidade.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const effectiveLoading = loading || !hasLoadedOnce;
  const shouldScrollToTop = useRef(false);

  // Logo depois de CADASTRAR um produto novo, a lista abre na página 1 e sem
  // busca nem categoria: o produto novo é o mais recente, e com o filtro ou a
  // página de antes a lojista não o veria. Qualquer outra abertura continua
  // lembrando o estado guardado no aparelho. O aviso vem do formulário e vale
  // uma vez só (`consumirProdutoNovoCadastrado`).
  useEffect(() => {
    if (!active) return;
    if (!consumirProdutoNovoCadastrado()) return;
    setSearchTerm("");
    setFilterCategory("all");
    setCurrentPage(0);
    shouldScrollToTop.current = true;
  }, [active, setSearchTerm, setFilterCategory, setCurrentPage]);

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
  }, [products, viewRef]);

  const loadData = useCallback(
    async (pageToFetch: number) => {
      try {
        const result = await loadProducts(pageToFetch, pageSize, {
          search: searchTerm || undefined,
          category: filterCategory === "all" ? undefined : filterCategory,
        });
        if (result) {
          setLoadError(false);
          setTotalProducts(result.total);
          cachedProductsTotal = result.total;

          const maxPage = Math.max(0, Math.ceil(result.total / pageSize) - 1);
          if (pageToFetch > maxPage) {
            setCurrentPage(maxPage);
          }
        } else {
          // `loadProducts` nunca lança aqui: numa falha real ela já mostrou
          // `toast.error` e devolveu `null` (abort de uma busca superada
          // também devolve `null`, sem toast — o pior caso é este banner
          // aparecer por um instante numa corrida de busca/filtro, e sumir
          // sozinho na resposta seguinte).
          setLoadError(true);
        }
      } finally {
        setHasLoadedOnce(true);
      }
    },
    [loadProducts, pageSize, searchTerm, filterCategory, setCurrentPage],
  );

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      loadData(currentPage);
    }, 320);
    return () => clearTimeout(timer);
  }, [currentPage, searchTerm, filterCategory, active, loadData]);

  // A exclusão pode demorar: quando termina, a recarga usa a página e os
  // filtros ATUAIS, não os do clique de confirmar.
  const recarregarAtualRef = useRef<() => void>(() => {});
  useEffect(() => {
    recarregarAtualRef.current = () => void loadData(currentPage);
  }, [loadData, currentPage]);

  // Renomear ou apagar categoria mexe nos produtos (o banco troca o nome neles).
  // O filtro lembrado no aparelho (`admin_products_filter_category`) guarda o
  // NOME: se ele era a categoria que mudou, acompanha, senão a lista ficaria
  // vazia com um chip que não existe mais.
  // Vale de onde quer que a tela "Gerenciar categorias" tenha sido aberta
  // (daqui ou do formulário do produto, que fica por baixo desta lista).
  useAoMudarCategoria((mudanca) => {
    if (mudanca.tipo === "renomeada") {
      if (mesmaCategoria(filterCategory, mudanca.de)) {
        setFilterCategory(mudanca.para); // o efeito acima recarrega a lista
        return;
      }
    } else if (mudanca.tipo === "apagada") {
      if (mesmaCategoria(filterCategory, mudanca.nome)) {
        setFilterCategory("all");
        return;
      }
    }
    if (active) void loadData(currentPage);
  });

  const simulatorMetrics = useMemo(() => {
    const cost = Number.parseFloat(simCost) || 0;
    const price = Number.parseFloat(simPrice) || 0;
    const stock = Number.parseInt(simStock) || 0;

    const unitProfit = price - cost;
    const margin = price > 0 ? (unitProfit / price) * 100 : 0;
    const roi = cost > 0 ? (unitProfit / cost) * 100 : 0;
    const totalCost = cost * stock;
    const totalRevenue = price * stock;
    const totalProfit = totalRevenue - totalCost;

    let health: "excellent" | "good" | "low" | "danger" = "good";
    let healthLabel = "Margem Saudável";
    if (margin >= 35) {
      health = "excellent";
      healthLabel = "Margem Excelente (Alta Rentabilidade)";
    } else if (margin >= 20) {
      health = "good";
      healthLabel = "Margem Saudável (Média do Mercado)";
    } else if (margin >= 10) {
      health = "low";
      healthLabel = "Margem Apertada (Atenção ao Volume)";
    } else {
      health = "danger";
      healthLabel = "Margem Crítica (Risco de Prejuízo)";
    }

    return {
      unitProfit,
      margin,
      roi,
      totalCost,
      totalRevenue,
      totalProfit,
      health,
      healthLabel,
    };
  }, [simCost, simPrice, simStock]);

  const toggleHelp = (key: string) => {
    setExpandedHelp((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const totalPages = Math.ceil(totalProducts / pageSize);

  // "Nenhum produto" com busca ou categoria escolhida é o filtro que não achou
  // nada — não o catálogo vazio. A tela diz o que está filtrado e oferece sair.
  const temBuscaOuFiltro = !!searchTerm || filterCategory !== "all";
  const descricaoDoFiltro = [
    searchTerm ? `a busca "${searchTerm}"` : null,
    filterCategory !== "all" ? `a categoria "${filterCategory}"` : null,
  ]
    .filter(Boolean)
    .join(" e ");
  const limparBuscaEFiltros = () => {
    setSearchTerm("");
    setFilterCategory("all");
    setCurrentPage(0);
    shouldScrollToTop.current = true;
  };

  // Lógica de cálculo financeiro global (SWR / Server-Side)
  const financialStats = useMemo(() => {
    // PAINEL-05: `null` quando a analytics nao respondeu — os cartoes
    // exibem "—" em vez de R$ 0,00 (zero falso afirma que o estoque
    // nao vale nada; o travessao nao afirma nada).
    const invested = stats?.inventory?.totalCost ?? null;
    const potentialValue = stats?.inventory?.totalValue ?? null;
    const totalRevenue = stats?.inventory?.totalRevenue;
    const potentialRevenue =
      typeof totalRevenue === "number" && Number.isFinite(totalRevenue)
        ? totalRevenue
        : null;
    const inventory = stats?.inventory;
    const semCusto = inventory?.revenueWithoutCost;
    const produtosSemCusto = inventory?.productsWithoutCost;
    const produtosComCusto = inventory?.productsWithCost;
    // O resumo antigo não comprova nem a cobertura do custo nem os preços
    // efetivos das variações. Só apurar lucro após receber o detalhamento novo.
    const coberturaConferida =
      typeof invested === "number" &&
      Number.isFinite(invested) &&
      invested >= 0 &&
      typeof potentialValue === "number" &&
      Number.isFinite(potentialValue) &&
      potentialValue >= 0 &&
      potentialRevenue !== null &&
      typeof semCusto === "number" &&
      Number.isFinite(semCusto) &&
      semCusto >= 0 &&
      typeof produtosSemCusto === "number" &&
      Number.isInteger(produtosSemCusto) &&
      produtosSemCusto >= 0 &&
      typeof produtosComCusto === "number" &&
      Number.isInteger(produtosComCusto) &&
      produtosComCusto >= 0 &&
      Math.abs(potentialRevenue - potentialValue - semCusto) < 0.01;
    const parcial = coberturaConferida && produtosSemCusto > 0;
    const semNenhumCusto = parcial && produtosComCusto === 0;
    const potentialProfit =
      coberturaConferida && !semNenhumCusto ? potentialValue - invested : null;
    const avgRoi =
      invested !== null && invested > 0 && potentialProfit !== null
        ? (potentialProfit / invested) * 100
        : null;

    return {
      invested,
      potential: potentialProfit,
      potentialRevenue,
      receitaComCusto: coberturaConferida ? potentialValue : null,
      receitaSemCusto: coberturaConferida ? semCusto : null,
      produtosSemCusto: coberturaConferida ? produtosSemCusto : null,
      coberturaConferida,
      parcial,
      semNenhumCusto,
      avgRoi,
      totalCount: totalProducts,
    };
  }, [stats, totalProducts]);

  const categories = useMemo(() => {
    return ["all", ...dbCategories.map((c) => c.name)];
  }, [dbCategories]);

  const kpiCards = useMemo<readonly KpiCardConfig[]>(
    () => [
      {
        id: "capital-alocado",
        label: "Custo conhecido em estoque",
        value:
          financialStats.invested !== null
            ? `R$ ${financialStats.invested.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
            : "—",
        icon: Wallet,
        accent: "text-sky-300",
        subValue: "Quanto custaram os produtos com custo cadastrado",
      },
      {
        id: "lucro-potencial",
        label: "Lucro bruto potencial",
        value:
          financialStats.potential !== null
            ? `R$ ${financialStats.potential.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
            : "—",
        icon: TrendingUp,
        accent: "text-emerald-300",
        subValue: financialStats.parcial
          ? "Parcial · só produtos com custo cadastrado, antes das despesas"
          : "Receita com custo cadastrado menos custo · antes das despesas",
      },
      {
        id: "faturamento-potencial",
        label: "Receita bruta potencial",
        value:
          financialStats.potentialRevenue !== null
            ? `R$ ${financialStats.potentialRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : "—",
        icon: DollarSign,
        accent: "text-amber-300",
        subValue: "Todo o estoque ativo · antes de descontos, taxas e frete",
      },
      {
        id: "lucro-liquido-potencial",
        label: "Lucro líquido potencial",
        value: "Não calculado",
        icon: Calculator,
        accent: "text-sky-300",
        subValue:
          "Faltam descontos, taxas, frete, impostos e outras despesas da venda",
      },
      {
        id: "roi-portfolio",
        label: "Lucro sobre o custo",
        value:
          financialStats.avgRoi !== null
            ? percentualComUmaCasa(financialStats.avgRoi)
            : "—",
        icon: BarChart3,
        accent: "text-violet-300",
        subValue: "Média do estoque com custo",
      },
      {
        id: "produtos-cadastrados",
        label: "Produtos no Catálogo",
        value: `${totalProducts} ${totalProducts === 1 ? "item" : "itens"}`,
        icon: ShoppingBag,
        accent: "text-indigo-300",
        // PAINEL-09: o número é o total FILTRADO (total_count da RPC com
        // busca), não o catálogo geral — o subtítulo mentia. Vale também para
        // o filtro de categoria, não só para a busca.
        subValue: searchTerm
          ? "Resultados da busca"
          : filterCategory !== "all"
            ? "Só desta categoria"
            : "Catálogo Geral",
      },
    ],
    [financialStats, totalProducts, searchTerm, filterCategory], // C2 da 1a revisao: +1 warning sem esta dep
  );

  // Achado 7 da auditoria de 20/08/2026
  // (docs/auditoria/2026-08-20-painel-pedidos-produtos.md): excluir ou
  // duplicar produto muda o catálogo, e `deleteProduct`/`addProduct`
  // chamam `clearAnalyticsCache()` — mas isso só zera o cache de MÓDULO em
  // `useAnalytics.ts`, não avisa esta instância já montada do hook. Sem
  // rebuscar aqui, "Capital Alocado", "Lucro Potencial" e "ROI do
  // Portfólio" seguem precificando o produto que já saiu, até o lojista
  // trocar de aba ou recarregar. A correção anterior tentava consertar
  // isso na RAIZ (fazendo `clearAnalyticsCache()` zerar `stats` de toda
  // instância montada), e foi bloqueada na revisão: zerar `stats` também
  // atinge o Dashboard e a tela de Pedidos, que não rebuscam sozinhos do
  // nulo — o Dashboard passava a mostrar KPI zerado como se fosse real, e
  // o aviso de dinheiro em pedido cancelado sumia da tela de Pedidos.
  // Segue o padrão já usado em `AdminOrdersView.tsx:292-294`: rebuscar na
  // tela que tem o defeito, não zerar o estado para todo mundo.
  const refreshFinancialStats = useCallback(async () => {
    try {
      await fetchExecutiveSummary(true);
    } catch {
      // A rebusca é best-effort: o produto já foi excluído/duplicado com
      // sucesso, e não pode derrubar essa operação. Os KPIs ficam com o
      // snapshot antigo até a próxima revalidação natural.
    }
  }, [fetchExecutiveSummary]);

  const handleToggleStatus = useCallback(
    async (id: string, active: boolean) => {
      if (isOffline) {
        toast.error("Ação não permitida offline", {
          description:
            "Reconecte-se à internet para alterar o status do produto.",
        });
        haptic.error();
        return;
      }
      haptic.light();
      // Achado novo da revisão do Achado 7: ativar/desativar pelo card
      // também muda o que a RPC do resumo executivo conta — ela filtra por
      // `ativo = true` (supabase/migrations/20260822000100_...sql:187-192)
      // — sem rebuscar aqui, "Capital Alocado" continua contando um
      // produto que acabou de sair (ou entrar) do filtro do servidor, com
      // os cartões visíveis na mesma dobra. `toggleProductStatus` resolve
      // falsy numa falha (sem lançar) — não rebusca nesse caso, porque
      // nada mudou de fato no catálogo do servidor.
      const sucesso = await toggleProductStatus(id, active);
      if (sucesso) {
        refreshFinancialStats();
      }
    },
    [toggleProductStatus, isOffline, refreshFinancialStats],
  );

  const handleDelete = useCallback(
    (id: string) => {
      if (isOffline) {
        toast.error("Ação não permitida offline", {
          description: "Reconecte-se à internet para excluir produtos.",
        });
        haptic.error();
        return;
      }
      haptic.medium();
      setProductToDelete(id);
    },
    [isOffline],
  );

  const confirmDelete = useCallback(async () => {
    if (!productToDelete) return;
    if (isOffline) {
      toast.error("Você está offline", {
        description: "Não é possível confirmar a exclusão sem conexão.",
      });
      haptic.error();
      setProductToDelete(null);
      return;
    }
    try {
      // `deleteProduct` nunca lança — captura tudo internamente e devolve
      // `true`/`false`, já mostrando o toast (sucesso OU erro) dela mesma.
      // Achado 16 da auditoria de 20/08/2026: esta view chegou a duplicar o
      // aviso de SUCESSO aqui (`toast.success("Produto Removido", {...})`
      // incondicional), e o admin via dois avisos empilhados para uma
      // exclusão só. O caminho de FALHA já seguia a regra certa — só o
      // hook avisa, com `toast.error`, e o `else` abaixo fica calado —
      // porque é o hook quem sabe o resultado no instante em que ele
      // acontece, o mesmo padrão de TODA outra mutação do hook (criar,
      // atualizar, alternar status, variantes). A correção do sucesso é a
      // mesma regra: o aviso mora só lá, esta view não repete.
      const sucesso = await deleteProduct(productToDelete);
      if (sucesso) {
        haptic.success();
        // A recarga atualiza o total e corrige a página se ela saiu do limite.
        recarregarAtualRef.current();
        // Achado da revisão do Achado 7: `AlertDialogAction` do Radix é
        // `Dialog.Close` e fecha o diálogo síncrono no clique, antes de
        // qualquer `await` — mas o `finally` abaixo (`setProductToDelete`)
        // só roda depois de todos os `await`s daqui. Se o lojista excluir A
        // e, enquanto a rebusca de A ainda corre, abrir o diálogo de B,
        // esse `finally` tardio fecha o diálogo de B sozinho. SEM `await`
        // aqui não alonga essa janela — `refreshFinancialStats` é `async`
        // com `try/catch` interno, nunca rejeita, então não sobra promessa
        // sem tratamento.
        refreshFinancialStats();
      } else {
        haptic.error();
      }
    } catch {
      haptic.error();
      toast.error("Erro na Exclusão", {
        description: "Não foi possível remover o produto.",
      });
    } finally {
      setProductToDelete(null);
    }
  }, [deleteProduct, productToDelete, isOffline, refreshFinancialStats]);

  const handleDuplicate = useCallback(
    (product: any) => {
      if (isOffline) {
        toast.error("Ação não permitida offline", {
          description: "Reconecte-se à internet para duplicar produtos.",
        });
        haptic.error();
        return;
      }
      haptic.medium();
      setProductToDuplicate(product);
    },
    [isOffline],
  );

  const confirmDuplicate = useCallback(async () => {
    if (!productToDuplicate) return;
    if (isOffline) {
      toast.error("Você está offline", {
        description: "Não é possível confirmar a duplicação sem conexão.",
      });
      haptic.error();
      setProductToDuplicate(null);
      return;
    }
    try {
      // Laudo 0109 (A2): a cópia nasce com arquivos PRÓPRIOS no storage —
      // do produto e de cada variação. Reusar as URLs do original fazia a
      // exclusão futura de uma das partes levar o arquivo da outra para
      // backup/ e as fotos do sobrevivente sumirem. Falha de cópia lança e
      // cai no catch de baixo: melhor não duplicar do que duplicar
      // compartilhando arquivo de novo.
      const imagens = await Promise.all(
        // Sem o marcador "Sem Imagem": produto sem foto duplica sem foto.
        soFotosReais(productToDuplicate.images).map((img: string) =>
          copiarImagemParaDuplicacao(img),
        ),
      );
      const variantes = await Promise.all(
        (productToDuplicate.variants || []).map(async (v: any) => ({
          name: v.name,
          value: v.value,
          // Achado AdminProductsView-546 (Missão 05): o sufixo era FIXO
          // ('-COPY'), e product_variants.sku é UNIQUE global — duplicar a
          // MESMA origem uma segunda vez repetia o SKU da primeira cópia, o
          // insert das variantes caía em 23505 e o segundo clone nascia sem
          // grade nenhuma. Sem SKU, a lojista preenche o que quiser depois
          // e não há literal para colidir, duplicar quantas vezes for.
          sku: undefined,
          stockIncrement: v.stockIncrement,
          priceOverride: v.priceOverride,
          active: v.active,
          imageUrl: v.imageUrl
            ? await copiarImagemParaDuplicacao(v.imageUrl)
            : v.imageUrl,
        })),
      );
      const duplicateData = {
        name: `${productToDuplicate.name} (Cópia)`,
        description: productToDuplicate.description,
        price: productToDuplicate.price,
        // `?? null`, não `|| 0`: a cópia herda o estado real do custo — sem
        // custo nasce sem custo (null), brinde de custo zero nasce com 0.
        costPrice: productToDuplicate.costPrice ?? null,
        originalPrice: productToDuplicate.originalPrice,
        stock: productToDuplicate.stock,
        category: productToDuplicate.category,
        images: imagens,
        isActive: false,
        sold: 0,
        isBestseller: productToDuplicate.isBestseller,
        freeShipping: productToDuplicate.freeShipping,
        metaTitle: productToDuplicate.metaTitle,
        metaDescription: productToDuplicate.metaDescription,
        tags: productToDuplicate.tags || [],
        sku: productToDuplicate.sku
          ? `${productToDuplicate.sku}-COPY`
          : undefined,
        weightKg: productToDuplicate.weightKg,
        widthCm: productToDuplicate.widthCm,
        heightCm: productToDuplicate.heightCm,
        lengthCm: productToDuplicate.lengthCm,
        variants: variantes,
      };

      const copia = await addProduct(duplicateData);
      if (copia?.variantesNaoSalvas) {
        // A cópia já existe e `addProduct` já avisou (com o motivo) que a grade
        // não foi salva: anunciar sucesso a esconderia, e um segundo aviso aqui
        // empilharia dois erros para a mesma falha.
        haptic.error();
      } else {
        haptic.success();
        toast.success("Produto Duplicado", {
          description: "O produto foi duplicado com sucesso.",
        });
      }
      // Mesmo motivo de `confirmDelete`: sem `await` para não alongar a
      // janela entre o clique e o `finally` que fecha o diálogo.
      refreshFinancialStats();
    } catch (err) {
      console.error("Error duplicating product:", err);
      haptic.error();
      toast.error("Erro na Duplicação", {
        description: "Não foi possível duplicar o produto.",
      });
    } finally {
      setProductToDuplicate(null);
    }
  }, [
    addProduct,
    copiarImagemParaDuplicacao,
    productToDuplicate,
    isOffline,
    refreshFinancialStats,
  ]);

  return (
    <div
      ref={viewRef}
      className="produtos-tela pb-admin h-auto text-white"
      data-categorias={
        active !== false && gerenciandoCategorias ? "abertas" : undefined
      }
      data-guia={
        active !== false && expandedHelp["global-guide"] ? "aberto" : undefined
      }
    >
      <header className="px-5 pb-4 pt-5">
        <div className="flex items-center justify-between gap-3">
          <AdminPageHeader titulo={NOMES_DO_PAINEL["admin-products"]} />
          <div className="flex shrink-0 items-center gap-2">
            <div className="produtos-cupons">
              <AtalhosDaAba aba="produtos" onNavigate={handleLocalNavigate} />
            </div>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
          {loadError ? (
            <AlertTriangle
              aria-hidden="true"
              className="size-3.5 text-red-300"
            />
          ) : (
            <PontoDeOperacao sincronizando={effectiveLoading} />
          )}
          <span className={isOffline || loadError ? "text-red-300" : undefined}>
            {isOffline
              ? "Sem conexão com o servidor"
              : loadError
                ? "Não sincronizou"
                : effectiveLoading
                  ? "Recarregando..."
                  : `Sincronizado · ${totalProducts} ${searchTerm ? "na busca" : filterCategory !== "all" ? "nesta categoria" : "no catálogo"}`}
          </span>
        </div>
      </header>

      <div className="space-y-7 px-5">
        {isOffline && (
          <div
            role="status"
            className="flex gap-3 rounded-2xl border border-red-300/15 bg-red-300/10 p-4 text-sm"
          >
            <AlertTriangle
              aria-hidden="true"
              className="size-5 shrink-0 text-red-300"
            />
            <div>
              <p className="font-bold">Sem conexão com o servidor</p>
              <p className="mt-1 text-zinc-300">
                Novo produto e ações dos produtos voltam quando a internet
                voltar.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <LocalErrorBoundary>
            <MetricasDoPainel
              titulo="Métricas de Produtos"
              legendasDoResumo={[
                "Custo conhecido",
                financialStats.parcial
                  ? "Lucro bruto (parcial)"
                  : "Lucro bruto",
                "Receita bruta",
                "Lucro líquido",
                "Lucro sobre o custo",
                "Catálogo",
              ]}
              cards={kpiCards}
              loading={loading && !stats}
            />
          </LocalErrorBoundary>
          <div className="space-y-2 rounded-2xl border border-white/10 p-3 text-xs leading-relaxed text-zinc-300">
            <p>
              Estimativa de venda do estoque atual, não dinheiro já recebido.
            </p>
            {!financialStats.coberturaConferida ? (
              <p role="status">
                Aguardando a separação dos produtos com e sem custo para
                conferir o lucro bruto.
              </p>
            ) : (
              <>
                {financialStats.parcial ? (
                  <p className="text-amber-200">
                    {financialStats.produtosSemCusto}{" "}
                    {financialStats.produtosSemCusto === 1
                      ? "produto em estoque está sem custo"
                      : "produtos em estoque estão sem custo"}
                    : R${" "}
                    {financialStats.receitaSemCusto?.toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    em vendas previstas entram na receita, mas ficam fora do
                    custo e do lucro. Cadastre o custo para completar a
                    estimativa.
                  </p>
                ) : (
                  <p>Todos os produtos em estoque têm custo cadastrado.</p>
                )}
                {financialStats.semNenhumCusto ? (
                  <p>
                    Nenhum custo cadastrado para o estoque: ainda não é possível
                    apurar o lucro bruto.
                  </p>
                ) : (
                  <p>
                    Receita dos produtos com custo: R${" "}
                    {financialStats.receitaComCusto?.toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    − custo: R${" "}
                    {financialStats.invested?.toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    = lucro bruto{financialStats.parcial ? " parcial" : ""}: R${" "}
                    {financialStats.potential?.toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                    .
                  </p>
                )}
              </>
            )}
            <p>
              Lucro líquido é o que sobra depois do custo, descontos, taxas,
              frete, impostos e outras despesas. Sem esses valores, não
              calculamos uma estimativa líquida.
            </p>
          </div>
          <button
            type="button"
            onClick={() => toggleHelp("global-guide")}
            className="produto-secundario w-full"
            title="Guia Completo de Métricas e Ajuda"
          >
            <BookOpen aria-hidden="true" className="size-5 text-violet-300" />{" "}
            Guia e simulador
          </button>
        </div>

        <BarraDeBusca
          id="search-assets"
          name="search-assets"
          rotulo="Buscar produtos"
          placeholder="Buscar produto, código…"
          value={searchTerm}
          onChange={(val) => {
            setSearchTerm(val);
            setCurrentPage(0);
            shouldScrollToTop.current = true;
          }}
          onTyping={setIsTyping}
          carregando={loading || isTyping}
          modo={viewMode}
          onMudarModo={setViewMode}
          produtos
          grupo="Categorias dos produtos"
          tituloFiltro="Categoria"
          filtrosAtivos={Number(filterCategory !== "all")}
          opcoes={categories.map((cat) => ({
            valor: cat,
            rotulo: cat === "all" ? "Todas as categorias" : cat,
            selecionada: filterCategory === cat,
            onClick: () => {
              setFilterCategory(cat);
              setCurrentPage(0);
              shouldScrollToTop.current = true;
            },
          }))}
          onLimpar={temBuscaOuFiltro ? limparBuscaEFiltros : undefined}
          onGerenciarCategorias={() => setGerenciandoCategorias(true)}
        />
        {gerenciandoCategorias && (
          <Suspense fallback={null}>
            <GerenciarCategorias
              aberta
              onFechar={() => setGerenciandoCategorias(false)}
            />
          </Suspense>
        )}

        {/* Grid view of Products as Assets */}
        <LocalErrorBoundary>
          {!effectiveLoading && products?.length === 0 ? null : (
            <div className="relative" aria-busy={effectiveLoading}>
              {showVisualLoading && <div className="admin-sync-progress-bar" />}
              {viewMode === "detailed" ? (
                <div
                  key="detailed-grid"
                  className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3"
                >
                  {effectiveLoading && products.length === 0
                    ? Array.from({ length: 8 }).map((_, i) => (
                        <div
                          key={i}
                          aria-hidden="true"
                          className={cn(
                            "produto-esqueleto flex animate-pulse flex-col gap-3 rounded-2xl border border-white/10 bg-[#101013] p-4",
                            ALTURA_DO_ESQUELETO_DETALHADO,
                          )}
                        >
                          <Skeleton className="h-12 w-full bg-white/5" />
                          <Skeleton className="h-6 w-3/4 bg-white/5" />
                          <Skeleton className="h-10 w-full bg-white/5" />
                        </div>
                      ))
                    : products?.map((product) => (
                        <AdminProductCard
                          key={product.id}
                          product={product}
                          viewMode="detailed"
                          onNavigate={handleLocalNavigate}
                          onToggleStatus={handleToggleStatus}
                          onDuplicate={handleDuplicate}
                          onDelete={handleDelete}
                          isOffline={isOffline}
                          onPrefetch={handlePrefetchProductForm}
                        />
                      ))}
                </div>
              ) : (
                <div
                  key="compact-grid"
                  className="grid grid-cols-2 items-stretch gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                >
                  {effectiveLoading && products.length === 0
                    ? Array.from({ length: 12 }).map((_, i) => (
                        <div
                          key={i}
                          aria-hidden="true"
                          className="produto-esqueleto flex min-h-[260px] animate-pulse flex-col gap-3 overflow-hidden rounded-2xl border border-white/10 bg-[#101013]"
                        >
                          <Skeleton className="h-[60px] w-full bg-white/5" />
                          <div className="space-y-3 p-3">
                            <Skeleton className="h-3 w-1/2 bg-white/5" />
                            <Skeleton className="h-8 w-full bg-white/5" />
                            <Skeleton className="h-6 w-3/4 bg-white/5" />
                            <Skeleton className="h-11 w-full bg-white/5" />
                          </div>
                        </div>
                      ))
                    : products?.map((product) => (
                        <AdminProductCard
                          key={product.id}
                          product={product}
                          viewMode="compact"
                          onNavigate={handleLocalNavigate}
                          onToggleStatus={handleToggleStatus}
                          onDuplicate={handleDuplicate}
                          onDelete={handleDelete}
                          isOffline={isOffline}
                          onPrefetch={handlePrefetchProductForm}
                        />
                      ))}
                </div>
              )}
            </div>
          )}
        </LocalErrorBoundary>

        <div className="relative">
          {/* Missão 06 (C2): paginação única do painel */}
          <PaginacaoAdmin
            className="produtos-paginacao"
            pagina={currentPage}
            totalPaginas={totalPages}
            totalItens={totalProducts}
            itensPorPagina={pageSize}
            aoMudar={(nova) => {
              setCurrentPage(nova);
              shouldScrollToTop.current = true;
            }}
          />
          {totalProducts > 0 &&
            (totalPages > 1 ? (
              <p className="produtos-pagina text-xs font-semibold">
                {Math.min(currentPage + 1, totalPages)} de {totalPages}
              </p>
            ) : (
              <>
                <div className="flex items-center justify-center gap-4 text-xs">
                  <button type="button" disabled className="produto-secundario">
                    Anterior
                  </button>
                  <span className="font-semibold">1 de 1</span>
                  <button type="button" disabled className="produto-secundario">
                    Próximo
                  </button>
                </div>
                <p className="mt-3 text-center text-[11px] text-zinc-400">
                  Todos os resultados estão nesta página.
                </p>
              </>
            ))}
        </div>

        {/* Empty State — só depois que o servidor REALMENTE respondeu "nenhum" */}
        {!effectiveLoading && !loadError && products?.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-white/10 bg-[#101013] px-5 py-7 text-center">
            <div className="relative z-10 mb-3 rounded-full border border-white/5 bg-zinc-900/60 p-4 shadow-xl">
              {temBuscaOuFiltro ? (
                <Search aria-hidden="true" className="size-6 text-indigo-300" />
              ) : (
                <ShoppingBag
                  aria-hidden="true"
                  className="size-6 text-indigo-300"
                />
              )}
            </div>
            <h3 className="text-lg font-bold text-zinc-50">
              {temBuscaOuFiltro
                ? "Nenhum produto encontrado"
                : "Nenhum produto cadastrado"}
            </h3>
            {/* Com busca ou filtro, "nenhum" é do filtro, não do catálogo:
                diz o que está filtrado e dá a saída. */}
            {!temBuscaOuFiltro && (
              <p className="mt-3 text-sm text-zinc-400">
                Cadastre seu primeiro produto pelo botão Novo produto.
              </p>
            )}
            {temBuscaOuFiltro && (
              <>
                <p className="mt-3 text-sm text-zinc-400">
                  Nada combina com {descricaoDoFiltro}. Seus produtos continuam
                  cadastrados.
                </p>
                <button
                  type="button"
                  onClick={limparBuscaEFiltros}
                  className="produto-secundario mt-4 w-full"
                >
                  Limpar busca e filtros
                </button>
              </>
            )}
          </div>
        )}

        {/* Erro ao carregar — estado distinto do vazio real e do
            carregamento: achado 11 avisava que trocar a mentira "vazio" por
            um esqueleto eterno na falha seria trocar uma mentira por outra. */}
        {!effectiveLoading && loadError && products?.length === 0 && (
          <div
            role="alert"
            className="rounded-3xl border border-white/10 bg-[#101013] p-6 text-center"
          >
            <AlertTriangle
              aria-hidden="true"
              className="mx-auto mb-4 size-11 rounded-2xl bg-red-300/10 p-2 text-red-300"
            />
            <h3 className="text-lg font-bold">Erro ao Carregar Produtos</h3>
            <p className="my-4 text-sm text-zinc-400">
              A lista não chegou. Confira a internet e tente de novo.
            </p>
            <button
              type="button"
              onClick={() => loadData(currentPage)}
              disabled={loading}
              className="produto-secundario w-full"
            >
              <RefreshCw aria-hidden="true" className="size-4" /> Tentar
              Novamente
            </button>
          </div>
        )}

        <AcaoDaBarra ativa={active !== false}>
          <button
            type="button"
            disabled={isOffline}
            onClick={() => handleLocalNavigate("admin-product-form")}
            className="produto-principal admin-barra-principal w-full"
          >
            <Plus aria-hidden="true" className="size-5" />{" "}
            {isOffline ? "Novo produto indisponível" : "Novo produto"}
          </button>
        </AcaoDaBarra>

        {/* Modal de Ajuda Global */}
        <FolhaDoPainel
          aberta={!!expandedHelp["global-guide"]}
          onFechar={() => toggleHelp("global-guide")}
          titulo="Guia Completo de Métricas e Ajuda"
          icone={BookOpen}
          rodape={
            <button
              type="button"
              onClick={() => toggleHelp("global-guide")}
              className="produto-secundario w-full"
            >
              Fechar
            </button>
          }
        >
          <p className="text-sm text-zinc-400">
            Entenda os números antes de decidir.
          </p>
          {/* Tabs Control */}
          <div className="produtos-abas mb-6 flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setHelpTab("concepts")}
              aria-pressed={helpTab === "concepts"}
              className={cn(
                "flex-1 flex min-h-11 items-center justify-center gap-2 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all duration-200",
                helpTab === "concepts"
                  ? "border border-admin-gold bg-admin-gold/10 text-admin-gold"
                  : "border border-white/10 bg-[#17171c] text-zinc-300 hover:text-white",
              )}
            >
              <BookOpen className="size-3.5" />
              Dicionário
            </button>
            <button
              type="button"
              onClick={() => setHelpTab("simulator")}
              aria-pressed={helpTab === "simulator"}
              className={cn(
                "flex-1 flex min-h-11 items-center justify-center gap-2 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all duration-200",
                helpTab === "simulator"
                  ? "border border-admin-gold bg-admin-gold/10 text-admin-gold"
                  : "border border-white/10 bg-[#17171c] text-zinc-300 hover:text-white",
              )}
            >
              <Calculator className="size-3.5" />
              Simulador
            </button>
          </div>

          <div className="produtos-guia space-y-6">
            {helpTab === "concepts" ? (
              <>
                <h4 className="sr-only">Indicadores Financeiros Globais</h4>
                <div className="space-y-3">
                  {[
                    {
                      titulo: "Custo conhecido em estoque",
                      icone: Wallet,
                      cor: "text-sky-300",
                      descricao:
                        "Quanto você pagou pelas unidades que estão no estoque: o dinheiro que está parado no estoque, pelo preço de custo. A conta só considera produtos com custo cadastrado.",
                      formula: "Custo Unitário × Estoque",
                    },
                    {
                      titulo: "Lucro bruto potencial",
                      icone: TrendingUp,
                      cor: "text-emerald-300",
                      descricao:
                        "Receita prevista dos produtos com custo, usando o preço de cada variação, menos o que esse estoque custou. A conta só considera produtos com custo cadastrado. Se faltar custo, o lucro é parcial. Não é lucro líquido.",
                      formula: "(Preço − Custo) × Estoque",
                    },
                    {
                      titulo: "Receita bruta potencial",
                      icone: DollarSign,
                      cor: "text-amber-300",
                      descricao:
                        "Quanto entraria em vendas de todo o estoque ativo pelo preço de cada variação, inclusive produtos sem custo cadastrado. Ainda não desconta custo, descontos ou despesas.",
                      formula: "Preço de venda × unidades em estoque",
                    },
                    {
                      titulo: "Lucro líquido potencial",
                      icone: Calculator,
                      cor: "text-sky-300",
                      descricao:
                        "O que sobraria depois do custo dos produtos e de todas as despesas. Como descontos, taxas, frete, impostos e outras despesas futuras não estão definidos aqui, este valor não é calculado.",
                      formula: "Receita − custo − descontos − despesas",
                    },
                    {
                      titulo: "Lucro sobre o custo",
                      icone: BarChart3,
                      cor: "text-violet-300",
                      descricao:
                        "Quanto você lucra para cada R$ 100 que pagou. No catálogo, usa o estoque com custo. Custo zero aparece como —.",
                      formula: "((Preço − Custo) ÷ Custo) × 100",
                      exemplo:
                        "Custo R$10 / Venda R$15 ➜ Lucro sobre o custo = 50,0%",
                    },
                    {
                      titulo: "Margem de Lucro",
                      icone: Percent,
                      cor: "text-teal-300",
                      descricao:
                        "A parte do preço de venda que corresponde ao lucro bruto.",
                      formula: "((Preço − Custo) ÷ Preço) × 100",
                      exemplo: "Custo R$10 / Venda R$15 ➜ Margem = 33,3%",
                    },
                    {
                      titulo: "Lucro bruto do estoque",
                      icone: ArrowUpRight,
                      cor: "text-indigo-300",
                      descricao:
                        "Lucro bruto possível ao vender o estoque, descontando o custo cadastrado. Sem custo cadastrado aparece como —. Antes de taxas e despesas.",
                      formula: "(Preço − Custo) × Estoque",
                    },
                    {
                      titulo: "Produtos no Catálogo",
                      icone: ShoppingBag,
                      cor: "text-indigo-300",
                      descricao:
                        "O total muda com o recorte: Catálogo Geral, Resultados da busca ou Só desta categoria.",
                      formula: "Total de produtos do recorte consultado",
                    },
                    {
                      titulo: "Estoque e custo",
                      icone: AlertTriangle,
                      cor: "text-orange-300",
                      descricao: `Crítico: estoque ≤ mínimo (padrão ${LIMIAR_PADRAO_DE_ESTOQUE}). Custo Suspeito: até R$ 0,10. Sem Custo Cadastrado: métricas —. Produtos com variações mostram o estoque total da grade.`,
                      formula: "Estoque ≤ mínimo ➜ Indicador Crítico",
                    },
                  ].map(
                    ({
                      titulo,
                      icone: Icone,
                      cor,
                      descricao,
                      formula,
                      exemplo,
                    }) => (
                      <div
                        key={titulo}
                        className="rounded-2xl border border-white/10 bg-[#101013] p-4"
                      >
                        <div className="flex items-start gap-3">
                          <Icone
                            aria-hidden="true"
                            className={cn(
                              "size-7 shrink-0 rounded-lg bg-white/5 p-1",
                              cor,
                            )}
                          />
                          <div className="min-w-0 space-y-2">
                            <p className="text-sm font-bold text-white">
                              {titulo}
                            </p>
                            <p className="text-sm leading-relaxed text-zinc-400">
                              {descricao}
                            </p>
                            <div className="flex flex-wrap justify-between gap-2 text-[11px] text-zinc-400">
                              <span>Fórmula:</span>
                              <span className="break-words">{formula}</span>
                            </div>
                            {exemplo && (
                              <div className="flex flex-wrap justify-between gap-2 text-[11px] text-zinc-400">
                                <span>Exemplo:</span>
                                <span>{exemplo}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ),
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setHelpTab("simulator")}
                  className="produto-secundario w-full"
                >
                  <Calculator
                    aria-hidden="true"
                    className="size-4 text-violet-300"
                  />{" "}
                  Abrir simulador de margem
                </button>
              </>
            ) : (
              /* Simulador de Lucratividade */
              <div className="space-y-5">
                <div className="space-y-4 rounded-3xl border border-white/5 bg-zinc-900/20 p-4">
                  <h4 className="border-l-2 border-violet-300/50 pl-2 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400">
                    Parâmetros do Produto
                  </h4>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label
                        htmlFor="sim-cost"
                        className="mb-1 block text-[11px] font-black uppercase tracking-wider text-zinc-400"
                      >
                        Custo Unitário (R$)
                      </label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
                        <input
                          id="sim-cost"
                          name="cost"
                          type="number"
                          step="0.01"
                          min="0"
                          autoComplete="off"
                          value={simCost}
                          onChange={(e) => setSimCost(e.target.value)}
                          className="min-h-11 w-full rounded-xl border border-white/10 bg-zinc-900/60 py-2 pl-8 pr-3 font-mono text-xs text-white transition-all focus:border-sky-300 focus:outline-none"
                          placeholder="0.00"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="sim-price"
                        className="mb-1 block text-[11px] font-black uppercase tracking-wider text-zinc-400"
                      >
                        Preço de Venda (R$)
                      </label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
                        <input
                          id="sim-price"
                          name="price"
                          type="number"
                          step="0.01"
                          min="0"
                          autoComplete="off"
                          value={simPrice}
                          onChange={(e) => setSimPrice(e.target.value)}
                          className="min-h-11 w-full rounded-xl border border-white/10 bg-zinc-900/60 py-2 pl-8 pr-3 font-mono text-xs text-white transition-all focus:border-sky-300 focus:outline-none"
                          placeholder="0.00"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="sim-stock"
                        className="mb-1 block text-[11px] font-black uppercase tracking-wider text-zinc-400"
                      >
                        Unidades em Estoque
                      </label>
                      <div className="relative">
                        <Package className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
                        <input
                          id="sim-stock"
                          name="stock"
                          type="number"
                          min="0"
                          autoComplete="off"
                          value={simStock}
                          onChange={(e) => setSimStock(e.target.value)}
                          className="min-h-11 w-full rounded-xl border border-white/10 bg-zinc-900/60 py-2 pl-8 pr-3 font-mono text-xs text-white transition-all focus:border-sky-300 focus:outline-none"
                          placeholder="0"
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSimCost("10.00");
                      setSimPrice("15.00");
                      setSimStock("20");
                    }}
                    className="flex min-h-11 items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-zinc-400 transition-colors hover:text-white"
                  >
                    <RefreshCw className="size-3" />
                    Resetar Simulador
                  </button>
                </div>

                {/* Resultados do Painel Simulador */}
                <div className="space-y-3">
                  <h4 className="border-l-2 border-violet-300/50 pl-2 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400">
                    Análise de Performance
                  </h4>

                  <div className="rounded-2xl border border-white/10 bg-[#101013] p-4 text-xs text-zinc-400">
                    <p className="mb-3 text-sm font-bold text-white">
                      Como interpretar a margem
                    </p>
                    <p className="flex justify-between gap-2">
                      <span className="text-emerald-300">Excelente</span>
                      <span>≥ 35%</span>
                    </p>
                    <p className="mt-2 flex justify-between gap-2">
                      <span className="text-teal-300">Saudável</span>
                      <span>20% a &lt; 35%</span>
                    </p>
                    <p className="mt-2 flex justify-between gap-2">
                      <span className="text-orange-300">Apertada</span>
                      <span>10% a &lt; 20%</span>
                    </p>
                    <p className="mt-2 flex justify-between gap-2">
                      <span className="text-red-300">Crítica</span>
                      <span>&lt; 10%</span>
                    </p>
                    <p className="mt-4">Antes de taxas e outras despesas.</p>
                  </div>

                  {/* Recomendação de Margem */}
                  <div
                    className={cn(
                      "p-3.5 rounded-2xl border transition-all duration-300 flex items-start gap-3 relative overflow-hidden",
                      simulatorMetrics.health === "excellent" &&
                        "bg-emerald-950/20 border-emerald-500/20 text-emerald-400",
                      simulatorMetrics.health === "good" &&
                        "bg-teal-950/20 border-teal-500/20 text-teal-400",
                      simulatorMetrics.health === "low" &&
                        "bg-amber-950/20 border-amber-500/20 text-amber-400",
                      simulatorMetrics.health === "danger" &&
                        "bg-rose-950/20 border-rose-500/20 text-rose-400",
                    )}
                  >
                    <div className="shrink-0 rounded-xl border border-white/5 bg-white/5 p-1.5">
                      <Sparkles className="size-4 animate-pulse" />
                    </div>
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-wider">
                        {simulatorMetrics.healthLabel}
                      </p>
                      <p className="mt-0.5 text-[11px] font-medium leading-normal text-zinc-400">
                        {simulatorMetrics.health === "excellent" &&
                          "Margem bruta alta. Ainda é preciso descontar taxas e outras despesas para conhecer o lucro líquido."}
                        {simulatorMetrics.health === "good" &&
                          "A margem bruta é positiva. Confira as despesas da venda antes de concluir quanto sobra."}
                        {simulatorMetrics.health === "low" &&
                          "Rentabilidade reduzida. Monitore custos extras de frete ou transações para evitar margens negativas."}
                        {simulatorMetrics.health === "danger" &&
                          "Atenção: margem bruta baixa ou negativa, antes das despesas. Revise o custo e o preço de venda."}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {[
                      {
                        rotulo: "Margem de Lucro",
                        valor: percentualComUmaCasa(simulatorMetrics.margin),
                      },
                      {
                        rotulo: "Lucro sobre o custo (por unidade)",
                        valor: percentualComUmaCasa(simulatorMetrics.roi),
                      },
                      {
                        rotulo: "Lucro bruto por unidade",
                        valor: `R$ ${simulatorMetrics.unitProfit.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
                      },
                      {
                        rotulo: "Capital de Lote (Custo)",
                        valor: `R$ ${simulatorMetrics.totalCost.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
                      },
                    ].map(({ rotulo, valor }, indice) => (
                      <div
                        key={rotulo}
                        className={`flex min-h-20 min-w-0 flex-col justify-between gap-2 rounded-2xl border bg-zinc-900/70 bg-gradient-to-b from-white/[0.06] to-transparent p-4 ${indice === 0 ? (simulatorMetrics.health === "excellent" ? "border-emerald-500/20" : simulatorMetrics.health === "good" ? "border-teal-500/20" : simulatorMetrics.health === "low" ? "border-amber-500/20" : "border-rose-500/20") : "border-white/10"}`}
                      >
                        <p className="text-xs font-semibold leading-tight text-zinc-300">
                          {rotulo}
                        </p>
                        <p className="text-[17px] font-black tabular-nums leading-tight sm:text-[22px]">
                          <span className="whitespace-nowrap">{valor}</span>
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="relative flex min-h-20 flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#101013] p-4">
                    <div className="relative z-10">
                      <p className="text-[11px] font-bold text-zinc-300">
                        Lucro bruto do lote simulado
                      </p>
                      <p className="mt-0.5 font-mono text-xl font-black text-white">
                        R${" "}
                        {simulatorMetrics.totalProfit.toLocaleString("pt-BR", {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                      <p className="text-[11px] font-medium text-zinc-400">
                        Faturamento Potencial: R${" "}
                        {simulatorMetrics.totalRevenue.toLocaleString("pt-BR", {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div className="relative z-10 shrink-0 rounded-xl bg-violet-300/10 p-2 text-violet-300">
                      <TrendingUp className="size-4" />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </FolhaDoPainel>

        {/* Diálogo de Confirmação de Exclusão */}
        <AlertDialog
          open={productToDelete !== null}
          onOpenChange={(open) => !open && setProductToDelete(null)}
        >
          <AlertDialogContent className="produtos-confirmacao max-w-md rounded-3xl border border-white/10 bg-[#17171c]">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-xl font-bold text-white">
                <Trash2
                  aria-hidden="true"
                  className="mx-auto mb-4 size-12 rounded-2xl bg-red-300/10 p-3 text-red-300"
                />
                Confirmar Exclusão
              </AlertDialogTitle>
              <AlertDialogDescription className="text-xs text-zinc-400">
                “
                {products.find((p) => p.id === productToDelete)?.name ??
                  "Este produto"}
                ” sai do catálogo para sempre. Não dá para desfazer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-4 gap-2">
              <AlertDialogCancel className="produto-secundario w-full">
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDelete}
                aria-label="Excluir Produto: confirmar exclusão"
                className="produto-perigo w-full"
              >
                <Trash2 aria-hidden="true" className="mr-2 size-4" /> Excluir
                Produto
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Diálogo de Confirmação de Duplicação */}
        <AlertDialog
          open={productToDuplicate !== null}
          onOpenChange={(open) => !open && setProductToDuplicate(null)}
        >
          <AlertDialogContent className="produtos-confirmacao max-w-md rounded-3xl border border-white/10 bg-[#17171c]">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-xl font-bold text-white">
                <Copy
                  aria-hidden="true"
                  className="mx-auto mb-4 size-12 rounded-2xl bg-violet-300/10 p-3 text-violet-300"
                />
                Confirmar Duplicação
              </AlertDialogTitle>
              <AlertDialogDescription className="text-xs text-zinc-400">
                Vamos criar “{productToDuplicate?.name} (Cópia)”, desativada.
                Você revisa e ativa quando quiser.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-4 gap-2">
              <AlertDialogCancel className="produto-secundario w-full">
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDuplicate}
                aria-label="Duplicar Produto: confirmar duplicação"
                className="produto-principal w-full"
              >
                <Copy aria-hidden="true" className="mr-2 size-4" /> Duplicar
                Produto
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
});

/**
 * A etiqueta de status do cartão de produto — mesma decisão nos dois modos
 * de visualização (compact e detailed). Achado 9 da auditoria de 20/08/2026
 * (docs/auditoria/2026-08-20-painel-pedidos-produtos.md): a etiqueta olhava
 * só `isActive` e um produto ATIVO com estoque zero (6 no banco, medido em
 * 20/08/2026) aparecia como "Em Operação" — a mesma tela que, no simulador
 * de celular ao lado (PhoneSimulator.tsx), já escrevia "Esgotado" para o
 * mesmo produto. "Esgotado" é a palavra que o resto do sistema usa
 * (ProductCard.tsx, PremiumOffers.tsx, PhoneSimulator.tsx) — reaproveitada
 * aqui em vez de inventar um sinônimo. Precedência: inativo vence tudo
 * ("Offline", mesmo com estoque), depois esgotado, depois em operação.
 */
function statusDoProdutoNoPainel(product: {
  isActive: boolean;
  stock: number;
}): "Offline" | "Esgotado" | "Em Operação" {
  if (!product.isActive) return "Offline";
  if (product.stock <= 0) return "Esgotado";
  return "Em Operação";
}

interface AdminProductCardProps {
  readonly product: any;
  readonly viewMode: "detailed" | "compact";
  readonly onNavigate: (view: View, id?: string) => void;
  readonly onToggleStatus: (
    id: string,
    active: boolean,
  ) => Promise<void> | void;
  readonly onDuplicate: (product: any) => void;
  readonly onDelete: (id: string) => void;
  readonly isOffline?: boolean;
  readonly onPrefetch?: () => void;
}

/** A mesma foto, ações e nomes acessíveis nos dois modos do catálogo. */
function FotoDoCatalogo({ product }: { readonly product: any }) {
  const foto = soFotosReais(product.images)[0];
  const [fotoComErro, setFotoComErro] = useState<string | null>(null);
  // A foto fica dentro do gatilho do menu: o aviso de erro não pode criar outro botão.
  return foto && foto !== fotoComErro ? (
    <img
      src={foto}
      alt={product.name}
      loading="lazy"
      decoding="async"
      onError={() => setFotoComErro(foto)}
      className={cn(
        "size-full object-contain",
        !product.isActive && "opacity-40 grayscale",
      )}
    />
  ) : (
    <span className="flex size-full flex-col items-center justify-center gap-1 bg-zinc-100 p-2 text-center text-[11px] text-zinc-600">
      <Camera aria-hidden="true" className="size-5 shrink-0 text-slate-600" />
      <span>{foto ? "Foto indisponível" : "Sem foto"}</span>
    </span>
  );
}

function MenuDoProduto({
  product,
  onNavigate,
  onToggleStatus,
  onDuplicate,
  onDelete,
  isOffline,
  children,
  className,
}: Omit<AdminProductCardProps, "viewMode" | "onPrefetch"> & {
  readonly children: React.ReactNode;
  readonly className: string;
}) {
  const [aberto, setAberto] = useState(false);
  // O menu do Radix abre no primeiro contato do dedo, e como a área é grande
  // quem rola a lista em cima de uma foto abriria o menu sem querer. No toque
  // abrimos no clique (que o navegador não dispara depois de uma rolagem);
  // mouse e teclado seguem o caminho do Radix.
  const veioDoToque = useRef(false);
  return (
    <DropdownMenu open={aberto} onOpenChange={setAberto}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={isOffline}
          aria-label={`Ações de ${product.name}`}
          aria-haspopup="menu"
          aria-expanded={aberto}
          onPointerDown={(e) => {
            veioDoToque.current =
              e.pointerType === "touch" || e.pointerType === "pen";
            if (veioDoToque.current) e.preventDefault();
          }}
          onClick={() => {
            if (!veioDoToque.current) return;
            veioDoToque.current = false;
            setAberto((atual) => !atual);
          }}
          className={cn(
            "produto-gatilho min-h-11 min-w-11 w-full cursor-pointer text-left",
            className,
          )}
        >
          {children}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="produto-menu z-50 w-80 max-w-[calc(100vw-40px)] rounded-3xl border border-white/10 bg-[#17171c] p-4 text-zinc-100 shadow-2xl"
      >
        <div className="mb-3 flex gap-3 border-b border-white/10 pb-4">
          <div className="size-12 shrink-0 overflow-hidden rounded-xl bg-zinc-100">
            <FotoDoCatalogo product={product} />
          </div>
          <div className="min-w-0">
            <p className="break-words text-sm font-bold">{product.name}</p>
            <p className="mt-1 text-xs text-zinc-400">
              R${" "}
              {product.price.toLocaleString("pt-BR", {
                minimumFractionDigits: 2,
              })}{" "}
              · {statusDoProdutoNoPainel(product)} · {product.stock} em estoque
            </p>
          </div>
        </div>
        <DropdownMenuItem
          disabled={isOffline}
          onClick={() => onNavigate("admin-product-form", product.id)}
          className="produto-menu-item"
        >
          <Edit2 aria-hidden="true" className="text-sky-300" />
          <div>
            <span>Editar produto</span>
            <small>Nome, preço, fotos e estoque</small>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isOffline}
          onClick={() => onToggleStatus(product.id, product.isActive)}
          className="produto-menu-item"
        >
          {product.isActive ? (
            <Pause aria-hidden="true" className="text-orange-300" />
          ) : (
            <Play aria-hidden="true" className="text-emerald-300" />
          )}
          <div>
            <span>
              {product.isActive ? "Pausar Produto" : "Ativar Produto"}
            </span>
            <small>
              {product.isActive
                ? "Sai da loja na hora"
                : "Volta para a loja na hora"}
            </small>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isOffline}
          onClick={() => onDuplicate(product)}
          className="produto-menu-item"
        >
          <Copy aria-hidden="true" className="text-violet-300" />
          <div>
            <span>Duplicar Produto</span>
            <small>Cria uma cópia desativada</small>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isOffline}
          onClick={() => onDelete(product.id)}
          className="produto-menu-item text-red-300"
        >
          <Trash2 aria-hidden="true" />
          <div>
            <span>Excluir Produto</span>
            <small>Pede confirmação · ação irreversível</small>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setAberto(false)}
          className="produto-secundario mt-3 w-full"
        >
          Fechar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const AdminProductCard = memo(function AdminProductCard({
  product,
  viewMode,
  onNavigate,
  onToggleStatus,
  onDuplicate,
  onDelete,
  isOffline = false,
  onPrefetch,
}: AdminProductCardProps) {
  const [maisMetricas, setMaisMetricas] = useState(false);
  const acoes = {
    product,
    onNavigate,
    onToggleStatus,
    onDuplicate,
    onDelete,
    isOffline,
  };
  const editar = () => onNavigate("admin-product-form", product.id);
  const estado = statusDoProdutoNoPainel(product);
  const classeDoEstado =
    estado === "Offline"
      ? "text-violet-300"
      : estado === "Esgotado"
        ? "text-red-300"
        : "text-zinc-400";
  const botoes = (detalhado: boolean, custoSuspeito = false) => (
    <div className="produto-acoes mt-2 flex flex-wrap gap-2">
      <button
        type="button"
        disabled={isOffline}
        aria-label={`${product.isActive ? "Pausar" : "Ativar"} ${product.name}`}
        aria-pressed={product.isActive}
        onClick={() => onToggleStatus(product.id, product.isActive)}
        className="produto-secundario flex-1 px-2"
      >
        <span
          aria-hidden="true"
          className={cn("produto-interruptor", product.isActive && "ligado")}
        />
        {product.isActive ? "Ativo" : "Ativar"}
      </button>
      <button
        type="button"
        disabled={isOffline}
        aria-label={`Editar ${product.name}`}
        onClick={editar}
        className="produto-secundario min-w-11 px-3"
      >
        <Edit2 aria-hidden="true" className="size-4 text-sky-200" />
        {detalhado && (custoSuspeito ? "Revisar custo" : "Editar")}
      </button>
      {detalhado && (
        <button
          type="button"
          aria-expanded={maisMetricas}
          aria-controls={`metricas-produto-${product.id}`}
          onClick={() => setMaisMetricas(!maisMetricas)}
          className="produto-secundario flex-1 px-2"
        >
          {maisMetricas ? "Menos métricas" : "Mais métricas"}
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 text-violet-300",
              maisMetricas && "rotate-180",
            )}
          />
        </button>
      )}
    </div>
  );
  // "Estoque baixo" é UMA regra só no front (a mesma do sino e do aviso de
  // reposição): o mínimo do produto, ou o limiar padrão quando não tem.
  const estoqueBaixo = precisaDeReposicao(
    product.stock,
    product.estoqueMinimo ?? null,
  );
  if (viewMode === "detailed") {
    // Achado 8 da auditoria de 20/08/2026
    // (docs/auditoria/2026-08-20-painel-pedidos-produtos.md): `costPrice || 0`
    // fundia "sem custo cadastrado" com "custo é zero" — o mesmo produto
    // mostrava margem de 100% (o melhor número do painel) e ROI de 0% ao
    // mesmo tempo, por descrever um custo que ninguém mediu.
    //
    // SEGUNDA ETAPA (item 3 do laudo de 29/08): o gatilho escrito aqui pelo
    // auditor foi cumprido. A migration 20261024000000 derrubou o NOT NULL de
    // produtos.custo e o useProducts parou de achatar null em 0 — agora os
    // dois estados chegam DISTINTOS do banco: custo null = sem custo medido;
    // custo 0 = brinde de custo zero de propósito. `hasCost` virou
    // `costPrice != null` (sem o `> 0`): o brinde medido volta a afirmar
    // números — margem de 100%, capital R$ 0,00, etiqueta "Custo Suspeito" —
    // e "Sem Custo Cadastrado" fica para quem não tem custo nenhum.
    //
    // Uma exceção permanece: o ROI divide PELO custo. Custo zero vira divisão
    // por zero, que não é número — o ROI do brinde mostra "—" enquanto a
    // margem (que divide pelo preço) afirma os 100% verdadeiros.
    const hasCost = product.costPrice != null;
    const temCustoPositivo = hasCost && product.costPrice > 0;
    const invested = !hasCost ? null : product.costPrice * product.stock;
    const variantesAtivas =
      product.variants?.filter((v: { active: boolean }) => v.active) ?? [];
    const receitaDoEstoque =
      variantesAtivas.length > 0
        ? variantesAtivas.reduce(
            (
              total: number,
              v: { priceOverride?: number | null; stockIncrement?: number },
            ) =>
              total +
              (v.priceOverride ?? product.price) * (v.stockIncrement ?? 0),
            0,
          )
        : product.price * product.stock;
    const totalProfit =
      !hasCost || product.variantsUnavailable
        ? null
        : receitaDoEstoque - product.costPrice * product.stock;

    const precoMedio =
      variantesAtivas.length > 0
        ? product.stock > 0
          ? receitaDoEstoque / product.stock
          : null
        : product.price;
    const margin =
      !hasCost || product.variantsUnavailable || precoMedio === null
        ? null
        : precoMedio > 0
          ? ((precoMedio - product.costPrice) / precoMedio) * 100
          : variantesAtivas.length > 0
            ? null
            : 0;
    const roi =
      !temCustoPositivo || product.variantsUnavailable || precoMedio === null
        ? null
        : ((precoMedio - product.costPrice) / product.costPrice) * 100;

    const custoSuspeito = hasCost && product.costPrice <= 0.1;
    return (
      <motion.div
        layout
        className="group relative min-w-0"
        onMouseEnter={onPrefetch}
        onTouchStart={onPrefetch}
      >
        <div
          className={cn(
            "produto-cartao content-visibility-detailed-card rounded-3xl border border-white/10 bg-[#101013] p-3",
            RESERVA_DO_CARTAO_DETALHADO,
          )}
        >
          <MenuDoProduto
            {...acoes}
            className="flex items-start gap-3 rounded-xl"
          >
            <span
              data-produto-foto=""
              className="block size-16 shrink-0 overflow-hidden rounded-xl bg-zinc-100"
            >
              <FotoDoCatalogo product={product} />
            </span>
            <span className="min-w-0 flex-1">
              <span
                data-produto-nome=""
                className="block break-words text-sm font-bold leading-snug"
              >
                {product.name}
              </span>
              <span className="mt-1 block break-words text-[11px] text-zinc-400">
                {product.category} ·{" "}
                <Badge className={cn("produto-status", classeDoEstado)}>
                  {estado}
                </Badge>
                {estoqueBaixo && (
                  <Badge className="produto-status text-[11px] text-orange-300">
                    Crítico
                  </Badge>
                )}
              </span>
              {product.sku && (
                <span className="mt-1 block break-words text-[11px] text-zinc-400">
                  Código {product.sku}
                </span>
              )}
              {!hasCost && (
                <span className="mt-1 block text-[11px] font-semibold text-slate-300">
                  Sem Custo Cadastrado
                </span>
              )}
            </span>
          </MenuDoProduto>
          <h4 className="sr-only">{product.name}</h4>
          <div className="produto-resumo mt-3 grid grid-cols-3 gap-2">
            <div className="min-w-0">
              <p className="text-[11px] text-zinc-400">Preço de Venda</p>
              <p className="mt-1 text-lg font-bold tabular-nums">
                R${" "}
                {product.price.toLocaleString("pt-BR", {
                  minimumFractionDigits: 2,
                })}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-zinc-400">
                {estoqueBaixo
                  ? `Estoque · mín. ${product.estoqueMinimo ?? LIMIAR_PADRAO_DE_ESTOQUE}`
                  : product.variants?.length > 0
                    ? "Estoque total"
                    : "Estoque"}
              </p>
              <p
                className={cn(
                  "mt-1 text-lg font-bold tabular-nums",
                  estoqueBaixo && "text-orange-300",
                  estado === "Esgotado" && "text-red-300",
                )}
              >
                <span className={cn(estoqueBaixo && "text-orange-300")}>
                  {product.stock}
                </span>{" "}
                un.
              </p>
            </div>
            {!custoSuspeito && (
              <div className="min-w-0">
                <p className="text-[11px] text-zinc-400">Margem de Lucro</p>
                <span
                  data-margem
                  className="mt-1 block whitespace-nowrap text-lg font-black tabular-nums tracking-tighter"
                >
                  {margin === null ? "—" : percentualComUmaCasa(margin)}
                </span>
              </div>
            )}
          </div>
          {custoSuspeito && (
            <div
              data-custo-suspeito
              className="mt-3 flex gap-2 rounded-xl bg-orange-300/10 p-3 text-orange-300"
            >
              <AlertTriangle aria-hidden="true" className="size-5 shrink-0" />
              <div className="min-w-0 text-xs">
                <p className="font-bold">Margem calculada com custo suspeito</p>
                <p className="mt-1">
                  <span
                    data-margem
                    className="whitespace-nowrap font-black tabular-nums tracking-tighter"
                  >
                    {margin === null ? "—" : percentualComUmaCasa(margin)}
                  </span>{" "}
                  · <span>Custo Suspeito</span> de R${" "}
                  {product.costPrice.toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                  })}
                </p>
              </div>
            </div>
          )}
          <div
            id={`metricas-produto-${product.id}`}
            data-metricas-do-produto
            hidden={!maisMetricas}
            className="produto-detalhes mt-3 rounded-2xl bg-[#17171c] p-3 text-[11px]"
          >
            {variantesAtivas.length > 0 && (
              <p className="mb-2 text-zinc-400">
                Lucro e percentuais consideram o estoque e os preços de cada
                variação.
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              <p>
                <Package
                  aria-hidden="true"
                  className="produto-icone text-slate-300"
                />
                Unidades em Estoque
              </p>
              <span className="font-bold">{product.stock} un.</span>
            </div>
            <div className="my-2 h-1 overflow-hidden rounded-full bg-white/10">
              <div
                className={cn(
                  "h-full rounded-full",
                  estoqueBaixo ? "bg-orange-300" : "bg-sky-200",
                )}
                style={{ width: `${Math.min(product.stock * 5, 100)}%` }}
              />
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p>
                <BarChart3
                  aria-hidden="true"
                  className="produto-icone text-violet-300"
                />
                Lucro sobre o custo
              </p>
              <span
                data-lucro-sobre-custo
                className={cn(
                  "whitespace-nowrap font-black tracking-tighter tabular-nums",
                  custoSuspeito && "text-orange-300",
                )}
              >
                {roi === null ? "—" : percentualComUmaCasa(roi)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
              <p>
                <Wallet
                  aria-hidden="true"
                  className="produto-icone text-sky-300"
                />
                Dinheiro parado em estoque
              </p>
              <span className="font-semibold">
                {invested === null
                  ? "—"
                  : `R$ ${invested.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
              <p>
                <ArrowUpRight
                  aria-hidden="true"
                  className="produto-icone text-indigo-300"
                />
                Lucro bruto do estoque
              </p>
              <span className="font-semibold">
                {totalProfit === null
                  ? "—"
                  : `${totalProfit >= 0 ? "+ " : ""}R$ ${totalProfit.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
              </span>
            </div>
            {product.variants?.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="font-semibold">
                  Estoque total das variações: {product.stock} unidades
                </p>
                <p className="break-words text-zinc-400">
                  {product.variants
                    .map((v: any) => `${v.value}: ${v.stockIncrement}`)
                    .join(" · ")}
                </p>
              </div>
            )}
            {custoSuspeito && (
              <p className="mt-3 text-orange-300">
                Indicadores de lucro dependem da revisão do custo.
              </p>
            )}
            {hasCost && !temCustoPositivo && (
              <p className="mt-2 text-zinc-400">
                Custo zero: lucro sobre o custo não se aplica.
              </p>
            )}
          </div>
          {botoes(true, custoSuspeito)}
        </div>
      </motion.div>
    );
  }

  // Grade: nome inteiro e preço ancorado ao rodapé de cada linha.
  return (
    <motion.div
      layout
      className="group relative flex min-w-0"
      onMouseEnter={onPrefetch}
      onTouchStart={onPrefetch}
    >
      <div className="produto-cartao content-visibility-compact-card flex w-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#101013]">
        <MenuDoProduto
          {...acoes}
          className="block shrink-0 overflow-hidden rounded-t-3xl"
        >
          <span
            data-produto-foto=""
            className="block aspect-square w-full overflow-hidden bg-zinc-100"
          >
            <FotoDoCatalogo product={product} />
          </span>
          <span className="block min-w-0 p-2.5">
            <span className="block break-words text-[11px] font-semibold uppercase text-zinc-400">
              {product.category}
            </span>
            <span
              data-produto-nome=""
              className={cn(
                "mt-1 block break-words text-sm font-bold leading-snug",
                !product.isActive && "text-zinc-400",
              )}
            >
              {product.name}
            </span>
          </span>
        </MenuDoProduto>
        <h4 className="sr-only">{product.name}</h4>
        <div className="flex min-w-0 flex-1 flex-col px-2.5 pb-2.5">
          <div className="mt-auto pt-3">
            <p className="break-words text-xl font-bold tabular-nums">
              R${" "}
              {product.price.toLocaleString("pt-BR", {
                minimumFractionDigits: 2,
              })}
            </p>
            <div
              className={cn(
                "mt-1 flex flex-wrap items-center gap-x-1 text-[11px]",
                classeDoEstado,
              )}
            >
              {estado === "Offline" ? (
                <Pause aria-hidden="true" className="size-3.5 shrink-0" />
              ) : estado === "Esgotado" || estoqueBaixo ? (
                <AlertTriangle
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-orange-300"
                />
              ) : (
                <Package aria-hidden="true" className="size-3.5 shrink-0" />
              )}
              <Badge
                className={cn(
                  "produto-status text-[11px]",
                  estado === "Em Operação" && "sr-only",
                )}
              >
                {estado}
              </Badge>
              {estoqueBaixo && estado !== "Esgotado" && (
                <Badge className="produto-status text-[11px] text-orange-300">
                  Crítico
                </Badge>
              )}
              <span className={cn(estoqueBaixo && "text-orange-300")}>
                {product.stock}
              </span>
              <span>
                {estado === "Em Operação" && !estoqueBaixo
                  ? "em estoque"
                  : "un."}
              </span>
              {estoqueBaixo && estado !== "Esgotado" && (
                <span className="text-orange-300">
                  · mín. {product.estoqueMinimo ?? LIMIAR_PADRAO_DE_ESTOQUE}
                </span>
              )}
            </div>
            {product.variants?.length > 0 && (
              <p className="mt-1 text-[11px] text-zinc-400">
                {product.variants.length} variações
              </p>
            )}
            {botoes(false)}
          </div>
        </div>
      </div>
    </motion.div>
  );
});
