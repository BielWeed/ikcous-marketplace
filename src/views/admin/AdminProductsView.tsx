import { LazyImage } from "@/components/LazyImage";
import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import {
  AdminKpiCarousel,
  type KpiCardConfig,
} from "@/components/admin/AdminKpiCarousel";
import { DebouncedSearchInput } from "@/components/admin/DebouncedSearchInput";
import { ProductBanners } from "@/components/admin/dashboard/ProductBanners";
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
import { Button } from "@/components/ui/button";
import { LocalErrorBoundary } from "@/components/ui/custom/LocalErrorBoundary";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useCategories } from "@/hooks/useCategories";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { useProducts } from "@/hooks/useProducts";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import { haptic } from "@/utils/haptic";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Calculator,
  ChevronLeft,
  ChevronRight,
  Coins,
  Copy,
  DollarSign,
  Edit2,
  Eye,
  Filter,
  HelpCircle,
  Layers,
  LayoutGrid,
  List,
  Loader2,
  MoreVertical,
  Package,
  Percent,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

let cachedProductsTotal = 0;

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

  useEffect(() => {
    if (active && !stats) {
      fetchExecutiveSummary(false);
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

  const firstLoadRef = useRef(true);
  const shouldScrollToTop = useRef(false);

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
          setTotalProducts(result.total);
          cachedProductsTotal = result.total;

          const maxPage = Math.max(0, Math.ceil(result.total / pageSize) - 1);
          if (pageToFetch > maxPage) {
            setCurrentPage(maxPage);
          }
        }
      } finally {
        firstLoadRef.current = false;
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

  // Lógica de cálculo financeiro global (SWR / Server-Side)
  const financialStats = useMemo(() => {
    const invested = stats?.inventory?.totalCost ?? 0;
    const potentialValue = stats?.inventory?.totalValue ?? 0;
    const potentialProfit = potentialValue - invested;
    const avgRoi = invested > 0 ? (potentialProfit / invested) * 100 : 0;

    return {
      invested,
      potential: potentialProfit,
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
        label: "Capital Alocado",
        value: `R$ ${financialStats.invested.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
        icon: Wallet,
        accent: "text-emerald-500",
        subValue: "Capital Líquido",
      },
      {
        id: "lucro-potencial",
        label: "Lucro Potencial",
        value: `R$ ${financialStats.potential.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
        icon: TrendingUp,
        accent: "text-admin-gold",
        subValue: "Margem Bruta",
      },
      {
        id: "roi-portfolio",
        label: "ROI do Portfólio",
        value: `${financialStats.avgRoi.toFixed(2)}%`,
        icon: DollarSign,
        accent: "text-blue-500",
        subValue: "Rendimento %",
      },
      {
        id: "produtos-cadastrados",
        label: "Produtos no Catálogo",
        value: `${totalProducts} itens`,
        icon: Package,
        accent: "text-purple-500",
        subValue: "Catálogo Geral",
      },
    ],
    [financialStats, totalProducts],
  );

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
      await toggleProductStatus(id, active);
    },
    [toggleProductStatus, isOffline],
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
      await deleteProduct(productToDelete);
      haptic.success();
      toast.success("Produto Removido", {
        description: "O produto foi excluído com sucesso.",
      });
    } catch {
      haptic.error();
      toast.error("Erro na Exclusão", {
        description: "Não foi possível remover o produto.",
      });
    } finally {
      setProductToDelete(null);
    }
  }, [deleteProduct, productToDelete, isOffline]);

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
      const duplicateData = {
        name: `${productToDuplicate.name} (Cópia)`,
        description: productToDuplicate.description,
        price: productToDuplicate.price,
        costPrice: productToDuplicate.costPrice || 0,
        originalPrice: productToDuplicate.originalPrice,
        stock: productToDuplicate.stock,
        category: productToDuplicate.category,
        images: productToDuplicate.images,
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
        variants: productToDuplicate.variants?.map((v: any) => ({
          name: v.name,
          value: v.value,
          sku: v.sku ? `${v.sku}-COPY` : undefined,
          stockIncrement: v.stockIncrement,
          priceOverride: v.priceOverride,
          active: v.active,
          imageUrl: v.imageUrl,
        })),
      };

      await addProduct(duplicateData);
      haptic.success();
      toast.success("Produto Duplicado", {
        description: "O produto foi duplicado com sucesso.",
      });
    } catch (err) {
      console.error("Error duplicating product:", err);
      haptic.error();
      toast.error("Erro na Duplicação", {
        description: "Não foi possível duplicar o produto.",
      });
    } finally {
      setProductToDuplicate(null);
    }
  }, [addProduct, productToDuplicate, isOffline]);

  // Removed early return loading block to prevent visual layout shifts

  return (
    <div
      ref={viewRef}
      className="h-auto bg-admin-bg pb-admin lg:pb-12 text-white duration-200 animate-in fade-in"
    >
      <style>{`
        @keyframes help-vertical-scroll {
          0% {
            transform: translateY(0%);
          }
          100% {
            transform: translateY(-50%);
          }
        }
        .help-scroll-active {
          animation: help-vertical-scroll 18s linear infinite;
        }
        .help-scroll-active-long {
          animation: help-vertical-scroll 28s linear infinite;
        }
        .help-scroll-active:hover,
        .help-scroll-active-long:hover {
          animation-play-state: paused;
        }
      `}</style>

      {/* Header & Main Actions */}
      <div className="flex items-center justify-between gap-4 px-6 pb-2 pt-6">
        <h1 className="flex shrink-0 select-none items-center gap-3 text-2xl font-black uppercase leading-none tracking-tighter md:text-3xl">
          <span className="flex flex-nowrap items-baseline whitespace-nowrap">
            <span className="italic text-white">Produtos</span>
          </span>
          <button
            type="button"
            onClick={() => toggleHelp("global-guide")}
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center border transition-all duration-300 active:scale-95 shrink-0",
              expandedHelp["global-guide"]
                ? "bg-admin-gold border-admin-gold/40 text-black shadow-md shadow-admin-gold/10 scale-105"
                : "bg-zinc-900/60 border-white/5 text-zinc-500 hover:text-white hover:border-white/10",
            )}
            title="Guia Completo de Métricas e Ajuda"
          >
            <HelpCircle className="size-4.5" />
          </button>
        </h1>

        <div className="flex items-center gap-3">
          <div
            className={cn(
              "inline-flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full transition-all duration-300",
              loading
                ? "bg-amber-500/10 border-amber-500/20 text-amber-500"
                : "bg-emerald-500/10 border-emerald-500/20 text-emerald-500",
            )}
          >
            <div
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                loading
                  ? "bg-amber-500 animate-pulse"
                  : "bg-emerald-500 animate-pulse",
              )}
            />
            <span className="text-[9px] font-black uppercase tracking-widest sm:text-[10px]">
              {loading ? "Sincronizando..." : "Operações ao Vivo"}
            </span>
          </div>

          <Button
            disabled={isOffline}
            className="hidden h-11 shrink-0 items-center justify-center rounded-xl bg-admin-gold px-5 text-[10px] font-black uppercase tracking-widest text-black shadow-[0_0_15px_rgba(234,179,8,0.2)] transition-all hover:scale-105 hover:bg-admin-gold/90 active:scale-95 disabled:pointer-events-none disabled:opacity-50 sm:flex"
            onClick={() => handleLocalNavigate("admin-product-form")}
          >
            <Plus className="mr-2 size-4 shrink-0 stroke-[3]" />
            Novo Produto
          </Button>
          <Button
            disabled={isOffline}
            size="icon"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-admin-gold text-black shadow-[0_0_15px_rgba(234,179,8,0.2)] transition-all hover:bg-admin-gold/90 active:scale-95 disabled:pointer-events-none disabled:opacity-50 sm:hidden"
            onClick={() => handleLocalNavigate("admin-product-form")}
          >
            <Plus className="size-5 stroke-[3]" />
          </Button>
        </div>
      </div>

      <div className="space-y-8 p-4 sm:p-6 lg:p-8">
        {/* Shortcuts Section */}
        <div className="duration-300 animate-in fade-in slide-in-from-bottom-2">
          <ProductBanners onNavigate={handleLocalNavigate} />
        </div>

        <div className="space-y-4">
          <LocalErrorBoundary>
            <AdminKpiCarousel
              cards={kpiCards}
              loading={loading && !stats}
              active={active}
              title="Visão Financeira"
            />
          </LocalErrorBoundary>
        </div>

        {/* Unified Control Bar Compacta */}
        <div className="relative mb-8 mt-4 flex flex-col border-t border-white/5 pt-8">
          <div className="relative z-20 flex flex-col gap-6 md:flex-row md:items-center">
            <div className="flex w-full flex-1 items-center gap-4">
              <div className="group relative w-full">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-5">
                  {loading || isTyping ? (
                    <Loader2 className="size-5 animate-spin text-admin-gold" />
                  ) : (
                    <Search className="size-5 text-zinc-600 transition-colors group-focus-within:text-admin-gold" />
                  )}
                </div>
                <label htmlFor="search-assets" className="sr-only">
                  Buscar produtos
                </label>
                <DebouncedSearchInput
                  id="search-assets"
                  name="search-assets"
                  placeholder="Buscar produtos..."
                  className="h-14 w-full rounded-2xl border-zinc-800 bg-black/40 pl-14 text-sm font-bold text-white transition-all placeholder:text-zinc-600 focus:border-admin-gold/50 focus:ring-admin-gold/20"
                  value={searchTerm}
                  onChange={(val) => {
                    setSearchTerm(val);
                    setCurrentPage(0);
                    shouldScrollToTop.current = true;
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
                    className="group size-14 shrink-0 rounded-2xl border-zinc-800 bg-zinc-900/60 transition-all hover:border-admin-gold/50 hover:bg-zinc-800"
                  >
                    <Filter className="size-5 text-zinc-500 transition-colors group-hover:text-admin-gold" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="mt-2 w-56 rounded-2xl border-zinc-800/50 bg-zinc-950 p-2 shadow-2xl backdrop-blur-3xl">
                  {categories.map((cat) => (
                    <DropdownMenuItem
                      key={cat}
                      onClick={() => {
                        setFilterCategory(cat);
                        setCurrentPage(0);
                        shouldScrollToTop.current = true;
                      }}
                      className="mb-1 cursor-pointer rounded-xl px-4 py-3 text-xs font-bold capitalize text-zinc-400 transition-all last:mb-0 focus:bg-white/5 focus:text-white"
                    >
                      {cat === "all" ? "Todas as Categorias" : cat}
                    </DropdownMenuItem>
                  ))}
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
                className="group size-14 shrink-0 rounded-2xl border-zinc-800 bg-zinc-900/60 transition-all hover:border-admin-gold/50 hover:bg-zinc-800"
              >
                {viewMode === "detailed" ? (
                  <LayoutGrid className="size-5 text-zinc-500 transition-colors group-hover:text-admin-gold" />
                ) : (
                  <List className="size-5 text-zinc-500 transition-colors group-hover:text-admin-gold" />
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Grid view of Products as Assets */}
        <LocalErrorBoundary>
          {!loading && products?.length === 0 ? null : (
            <div className="relative min-h-[400px]">
              {showVisualLoading && <div className="admin-sync-progress-bar" />}
              {viewMode === "detailed" ? (
                <div
                  key="detailed-grid"
                  className="grid min-h-[400px] grid-cols-1 gap-8 pb-10 duration-200 animate-in fade-in md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                >
                  {loading && products.length === 0
                    ? Array.from({ length: 8 }).map((_, i) => (
                        <div
                          key={i}
                          className="admin-glass flex h-[440px] animate-pulse flex-col justify-between space-y-6 rounded-[2.5rem] border border-white/5 p-8 shadow-[0_20px_50px_rgba(0,0,0,0.3)]"
                        >
                          <div className="flex items-start gap-6">
                            <Skeleton className="size-24 shrink-0 animate-pulse rounded-3xl bg-white/5" />
                            <div className="flex-1 space-y-3 pt-2">
                              <Skeleton className="h-5 w-3/4 animate-pulse bg-white/5" />
                              <Skeleton className="h-3.5 w-1/2 animate-pulse bg-white/5" />
                              <Skeleton className="h-4.5 w-1/3 animate-pulse rounded-lg bg-white/5" />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3 border-t border-white/5 pt-6">
                            <Skeleton className="h-16 animate-pulse rounded-2xl bg-white/5" />
                            <Skeleton className="h-16 animate-pulse rounded-2xl bg-white/5" />
                          </div>
                          <div className="flex-1 space-y-4 pt-2">
                            <div className="flex items-center justify-between">
                              <Skeleton className="h-3.5 w-1/3 animate-pulse bg-white/5" />
                              <Skeleton className="h-3.5 w-1/12 animate-pulse bg-white/5" />
                            </div>
                            <div className="flex items-center justify-between">
                              <Skeleton className="h-3.5 w-1/4 animate-pulse bg-white/5" />
                              <Skeleton className="h-3.5 w-1/4 animate-pulse bg-white/5" />
                            </div>
                          </div>
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
                  className="grid min-h-[250px] grid-cols-2 gap-3 pb-10 duration-200 animate-in fade-in sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
                >
                  {loading && products.length === 0
                    ? Array.from({ length: 12 }).map((_, i) => (
                        <div
                          key={i}
                          className="admin-glass flex h-[250px] animate-pulse flex-col justify-between overflow-hidden rounded-3xl border border-white/5 shadow-lg"
                        >
                          <Skeleton className="aspect-square w-full animate-pulse bg-white/5" />
                          <div className="flex flex-col gap-2 p-3">
                            <Skeleton className="h-3 w-1/3 animate-pulse bg-white/5" />
                            <Skeleton className="h-3.5 w-3/4 animate-pulse bg-white/5" />
                            <div className="flex items-baseline justify-between border-t border-white/5 pt-1">
                              <Skeleton className="h-3 w-1/4 animate-pulse bg-white/5" />
                              <Skeleton className="h-3.5 w-1/3 animate-pulse bg-white/5" />
                            </div>
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

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="mt-4 flex select-none items-center justify-between px-4 pb-0 sm:px-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Exibindo {currentPage * pageSize + 1} -{" "}
              {Math.min((currentPage + 1) * pageSize, totalProducts)} de{" "}
              {totalProducts}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCurrentPage((prev) => Math.max(0, prev - 1));
                  shouldScrollToTop.current = true;
                }}
                disabled={currentPage === 0}
                className="h-10 rounded-xl border-white/5 bg-zinc-950/60 px-4 text-zinc-400 transition-all hover:bg-zinc-800 hover:text-white"
              >
                <ChevronLeft className="mr-1.5 size-4" /> Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1));
                  shouldScrollToTop.current = true;
                }}
                disabled={currentPage === totalPages - 1}
                className="h-10 rounded-xl border-white/5 bg-zinc-950/60 px-4 text-zinc-400 transition-all hover:bg-zinc-800 hover:text-white"
              >
                Próximo <ChevronRight className="ml-1.5 size-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!loading && products?.length === 0 && (
          <div className="admin-glass relative flex flex-col items-center justify-center overflow-hidden rounded-[2rem] border border-white/5 px-6 py-12 text-center">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-admin-gold/[0.02] to-transparent" />
            <div className="relative z-10 mb-3 rounded-full border border-white/5 bg-zinc-900/60 p-4 shadow-xl">
              <Package className="size-6 text-zinc-600" />
            </div>
            <h3 className="relative z-10 text-xs font-black uppercase tracking-widest text-zinc-400">
              Nenhum produto cadastrado
            </h3>
          </div>
        )}

        {/* Modal de Ajuda Global */}
        <AdminHelpModal
          isOpen={!!expandedHelp["global-guide"]}
          onClose={() => toggleHelp("global-guide")}
          title="Guia de Métricas & Informações"
        >
          {/* Tabs Control */}
          <div className="mb-4 flex shrink-0 gap-2 rounded-2xl border border-white/5 bg-zinc-900/60 p-1">
            <button
              type="button"
              onClick={() => setHelpTab("concepts")}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-200",
                helpTab === "concepts"
                  ? "bg-admin-gold text-black shadow-lg shadow-admin-gold/10"
                  : "text-zinc-400 hover:text-white hover:bg-white/5",
              )}
            >
              <BookOpen className="size-3.5" />
              Dicionário
            </button>
            <button
              type="button"
              onClick={() => setHelpTab("simulator")}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-200",
                helpTab === "simulator"
                  ? "bg-admin-gold text-black shadow-lg shadow-admin-gold/10"
                  : "text-zinc-400 hover:text-white hover:bg-white/5",
              )}
            >
              <Calculator className="size-3.5" />
              Simulador
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="space-y-6">
            {helpTab === "concepts" ? (
              <>
                {/* Seção 1: Indicadores Globais */}
                <div className="space-y-3">
                  <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
                    Indicadores Financeiros Globais
                  </h4>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="group relative rounded-2xl border border-white/5 bg-zinc-900/40 p-4 transition-all duration-300 hover:border-admin-gold/20 hover:bg-zinc-900/60">
                      <div className="mb-1.5 flex items-center gap-2">
                        <div className="rounded-lg bg-admin-gold/10 p-1 text-admin-gold">
                          <Coins className="size-3.5" />
                        </div>
                        <p className="text-[9px] font-black uppercase tracking-wider text-white">
                          Capital Alocado
                        </p>
                      </div>
                      <p className="mb-3 text-[10px] font-medium leading-relaxed text-zinc-500">
                        Custo total de aquisição de todas as unidades de
                        produtos atualmente em estoque. Representa o capital
                        líquido imobilizado no inventário.
                      </p>
                      <div className="flex items-center justify-between rounded-xl border border-white/5 bg-black/40 p-2 font-mono text-[9px] text-zinc-500">
                        <span className="text-[8px] font-bold uppercase text-zinc-600">
                          Fórmula:
                        </span>
                        <span className="font-black text-zinc-300">
                          Custo Unitário × Estoque
                        </span>
                      </div>
                    </div>

                    <div className="group relative rounded-2xl border border-white/5 bg-zinc-900/40 p-4 transition-all duration-300 hover:border-admin-gold/20 hover:bg-zinc-900/60">
                      <div className="mb-1.5 flex items-center gap-2">
                        <div className="rounded-lg bg-emerald-500/10 p-1 text-emerald-400">
                          <TrendingUp className="size-3.5" />
                        </div>
                        <p className="text-[9px] font-black uppercase tracking-wider text-white">
                          Lucro Potencial
                        </p>
                      </div>
                      <p className="mb-3 text-[10px] font-medium leading-relaxed text-zinc-500">
                        Lucro bruto total estimado se todos os produtos em
                        estoque forem vendidos pelo preço atual de venda.
                      </p>
                      <div className="flex items-center justify-between rounded-xl border border-white/5 bg-black/40 p-2 font-mono text-[9px] text-zinc-500">
                        <span className="text-[8px] font-bold uppercase text-zinc-600">
                          Fórmula:
                        </span>
                        <span className="font-black text-zinc-300">
                          (Preço − Custo) × Estoque
                        </span>
                      </div>
                    </div>

                    <div className="group relative rounded-2xl border border-white/5 bg-zinc-900/40 p-4 transition-all duration-300 hover:border-admin-gold/20 hover:bg-zinc-900/60">
                      <div className="mb-1.5 flex items-center gap-2">
                        <div className="rounded-lg bg-blue-500/10 p-1 text-blue-400">
                          <Activity className="size-3.5" />
                        </div>
                        <p className="text-[9px] font-black uppercase tracking-wider text-white">
                          ROI do Portfólio
                        </p>
                      </div>
                      <p className="mb-3 text-[10px] font-medium leading-relaxed text-zinc-500">
                        Retorno médio percentual sobre o capital total investido
                        para obter o lote de produtos cadastrados.
                      </p>
                      <div className="flex items-center justify-between rounded-xl border border-white/5 bg-black/40 p-2 font-mono text-[9px] text-zinc-500">
                        <span className="text-[8px] font-bold uppercase text-zinc-600">
                          Fórmula:
                        </span>
                        <span className="font-black text-zinc-300">
                          (Lucro Potencial ÷ Custo) × 100
                        </span>
                      </div>
                    </div>

                    <div className="group relative rounded-2xl border border-white/5 bg-zinc-900/40 p-4 transition-all duration-300 hover:border-admin-gold/20 hover:bg-zinc-900/60">
                      <div className="mb-1.5 flex items-center gap-2">
                        <div className="rounded-lg bg-purple-500/10 p-1 text-purple-400">
                          <Layers className="size-3.5" />
                        </div>
                        <p className="text-[9px] font-black uppercase tracking-wider text-white">
                          Produtos Ativos
                        </p>
                      </div>
                      <p className="mb-3 text-[10px] font-medium leading-relaxed text-zinc-500">
                        Proporção de produtos que estão ativos e visíveis para
                        compra pelos clientes no catálogo em relação ao total
                        cadastrado.
                      </p>
                      <div className="flex items-center justify-between rounded-xl border border-white/5 bg-black/40 p-2 font-mono text-[9px] text-zinc-500">
                        <span className="text-[8px] font-bold uppercase text-zinc-600">
                          Fórmula:
                        </span>
                        <span className="font-black text-zinc-300">
                          (Ativos ÷ Total) × 100
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Seção 2: Métricas de Cada Produto */}
                <div className="space-y-3 pt-2">
                  <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
                    Métricas Individuais do Produto
                  </h4>
                  <div className="space-y-2.5">
                    <div className="flex gap-4 rounded-2xl border border-white/5 bg-zinc-900/40 p-4 transition-all duration-300 hover:border-emerald-500/20 hover:shadow-[0_0_15px_rgba(16,185,129,0.05)]">
                      <div className="w-1 shrink-0 rounded-full bg-emerald-500" />
                      <div className="flex-1 space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <Percent className="size-3.5 text-emerald-400" />
                          <p className="text-[9px] font-black uppercase tracking-wider text-white">
                            Margem de Lucro %
                          </p>
                        </div>
                        <p className="text-[10px] font-medium leading-relaxed text-zinc-500">
                          Indica a porcentagem do preço final de venda que
                          corresponde ao lucro bruto.
                        </p>
                        <div className="flex flex-col gap-1 rounded-xl border border-white/5 bg-black/40 p-2 font-mono text-[9px] text-zinc-500">
                          <div className="flex items-center justify-between">
                            <span className="text-[8px] font-bold uppercase text-zinc-600">
                              Fórmula:
                            </span>
                            <span className="font-black text-emerald-400">
                              ((Preço − Custo) ÷ Preço) × 100
                            </span>
                          </div>
                          <div className="flex items-center justify-between border-t border-white/5 pt-1">
                            <span className="text-[8px] font-bold uppercase text-zinc-600">
                              Exemplo:
                            </span>
                            <span className="font-medium text-zinc-400">
                              Custo R$10 / Venda R$15 ➜ Margem = 33.3%
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-4 rounded-2xl border border-white/5 bg-zinc-900/40 p-4 transition-all duration-300 hover:border-blue-500/20 hover:shadow-[0_0_15px_rgba(59,130,246,0.05)]">
                      <div className="w-1 shrink-0 rounded-full bg-blue-500" />
                      <div className="flex-1 space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <TrendingUp className="size-3.5 text-blue-400" />
                          <p className="text-[9px] font-black uppercase tracking-wider text-white">
                            ROI de Rendimento %
                          </p>
                        </div>
                        <p className="text-[10px] font-medium leading-relaxed text-zinc-500">
                          Retorno sobre o Investimento para cada unidade
                          adquirida do produto. Mede a eficiência do capital
                          alocado na compra frente ao ganho.
                        </p>
                        <div className="flex flex-col gap-1 rounded-xl border border-white/5 bg-black/40 p-2 font-mono text-[9px] text-zinc-500">
                          <div className="flex items-center justify-between">
                            <span className="text-[8px] font-bold uppercase text-zinc-600">
                              Fórmula:
                            </span>
                            <span className="font-black text-blue-400">
                              ((Preço − Custo) ÷ Custo) × 100
                            </span>
                          </div>
                          <div className="flex items-center justify-between border-t border-white/5 pt-1">
                            <span className="text-[8px] font-bold uppercase text-zinc-600">
                              Exemplo:
                            </span>
                            <span className="font-medium text-zinc-400">
                              Custo R$10 / Venda R$15 ➜ ROI = 50.0%
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-4 rounded-2xl border border-white/5 bg-zinc-900/40 p-4 transition-all duration-300 hover:border-amber-500/20 hover:shadow-[0_0_15px_rgba(245,158,11,0.05)]">
                      <div className="w-1 shrink-0 rounded-full bg-amber-500" />
                      <div className="flex-1 space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle className="size-3.5 text-amber-400" />
                          <p className="text-[9px] font-black uppercase tracking-wider text-white">
                            Unidades em Estoque & Alerta Crítico
                          </p>
                        </div>
                        <p className="text-[10px] font-medium leading-relaxed text-zinc-500">
                          Quantidade física disponível. Caso o estoque caia para
                          5 unidades ou menos, um alerta crítico pisca no
                          painel.
                        </p>
                        <div className="flex items-center justify-between rounded-xl border border-white/5 bg-black/40 p-2 font-mono text-[9px] text-zinc-500">
                          <span className="text-[8px] font-bold uppercase text-zinc-600">
                            Regra:
                          </span>
                          <span className="font-black text-amber-400">
                            Estoque ≤ 5 ➜ Indicador Crítico
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              /* Simulador de Lucratividade */
              <div className="space-y-5">
                <div className="space-y-4 rounded-3xl border border-white/5 bg-zinc-900/20 p-4">
                  <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
                    Parâmetros do Produto
                  </h4>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label
                        htmlFor="sim-cost"
                        className="mb-1 block text-[9px] font-black uppercase tracking-wider text-zinc-500"
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
                          className="w-full rounded-xl border border-white/10 bg-zinc-900/60 py-2 pl-8 pr-3 font-mono text-xs text-white transition-all focus:border-admin-gold focus:outline-none"
                          placeholder="0.00"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="sim-price"
                        className="mb-1 block text-[9px] font-black uppercase tracking-wider text-zinc-500"
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
                          className="w-full rounded-xl border border-white/10 bg-zinc-900/60 py-2 pl-8 pr-3 font-mono text-xs text-white transition-all focus:border-admin-gold focus:outline-none"
                          placeholder="0.00"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="sim-stock"
                        className="mb-1 block text-[9px] font-black uppercase tracking-wider text-zinc-500"
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
                          className="w-full rounded-xl border border-white/10 bg-zinc-900/60 py-2 pl-8 pr-3 font-mono text-xs text-white transition-all focus:border-admin-gold focus:outline-none"
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
                    className="flex items-center gap-1.5 pt-1 text-[8px] font-black uppercase tracking-widest text-zinc-500 transition-colors hover:text-white"
                  >
                    <RefreshCw className="size-3" />
                    Resetar Simulador
                  </button>
                </div>

                {/* Resultados do Painel Simulador */}
                <div className="space-y-3">
                  <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
                    Análise de Performance
                  </h4>

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
                      <p className="text-[10px] font-black uppercase tracking-wider">
                        {simulatorMetrics.healthLabel}
                      </p>
                      <p className="mt-0.5 text-[10px] font-medium leading-normal text-zinc-500">
                        {simulatorMetrics.health === "excellent" &&
                          "Alta lucratividade por unidade! Ideal para alavancar vendas e suportar taxas operacionais confortavelmente."}
                        {simulatorMetrics.health === "good" &&
                          "Sua margem está bem equilibrada com a média saudável do mercado de e-commerce."}
                        {simulatorMetrics.health === "low" &&
                          "Rentabilidade reduzida. Monitore custos extras de frete ou transações para evitar margens negativas."}
                        {simulatorMetrics.health === "danger" &&
                          "Atenção: Operando abaixo do mínimo recomendado ou em prejuízo líquido. Considere elevar o Preço de Venda."}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div
                      className={cn(
                        "p-4 rounded-2xl bg-zinc-900/40 border transition-all duration-300 flex flex-col justify-between h-20",
                        simulatorMetrics.health === "excellent" &&
                          "border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.03)]",
                        simulatorMetrics.health === "good" &&
                          "border-teal-500/20 shadow-[0_0_15px_rgba(20,184,166,0.03)]",
                        simulatorMetrics.health === "low" &&
                          "border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.03)]",
                        simulatorMetrics.health === "danger" &&
                          "border-rose-500/20 shadow-[0_0_15px_rgba(244,63,94,0.03)]",
                      )}
                    >
                      <p className="text-[8px] font-black uppercase tracking-wider text-zinc-500">
                        Margem de Lucro
                      </p>
                      <p
                        className={cn(
                          "text-xl font-mono font-black",
                          simulatorMetrics.health === "excellent" &&
                            "text-emerald-400",
                          simulatorMetrics.health === "good" && "text-teal-400",
                          simulatorMetrics.health === "low" && "text-amber-400",
                          simulatorMetrics.health === "danger" &&
                            "text-rose-400",
                        )}
                      >
                        {simulatorMetrics.margin.toFixed(1)}%
                      </p>
                    </div>

                    <div className="flex h-20 flex-col justify-between rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                      <p className="text-[8px] font-black uppercase tracking-wider text-zinc-500">
                        ROI Unitário
                      </p>
                      <p className="font-mono text-xl font-black text-blue-400">
                        {simulatorMetrics.roi.toFixed(1)}%
                      </p>
                    </div>

                    <div className="flex h-20 flex-col justify-between rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                      <p className="text-[8px] font-black uppercase tracking-wider text-zinc-500">
                        Lucro Líquido (Unit.)
                      </p>
                      <p className="font-mono text-xl font-black text-white">
                        R${" "}
                        {simulatorMetrics.unitProfit.toLocaleString("pt-BR", {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                    </div>

                    <div className="flex h-20 flex-col justify-between rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                      <p className="text-[8px] font-black uppercase tracking-wider text-zinc-500">
                        Capital de Lote (Custo)
                      </p>
                      <p className="font-mono text-xl font-black text-zinc-400">
                        R${" "}
                        {simulatorMetrics.totalCost.toLocaleString("pt-BR", {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="relative flex h-20 items-center justify-between overflow-hidden rounded-2xl border border-admin-gold/10 bg-gradient-to-br from-zinc-900 to-zinc-950 p-4">
                    <div className="absolute inset-0 bg-admin-gold/5" />
                    <div className="relative z-10">
                      <p className="text-[8px] font-black uppercase tracking-widest text-admin-gold">
                        Retorno Total Estimado
                      </p>
                      <p className="mt-0.5 font-mono text-xl font-black text-white">
                        R${" "}
                        {simulatorMetrics.totalProfit.toLocaleString("pt-BR", {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                      <p className="text-[8px] font-medium text-zinc-500">
                        Faturamento Potencial: R${" "}
                        {simulatorMetrics.totalRevenue.toLocaleString("pt-BR", {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div className="relative z-10 shrink-0 rounded-xl bg-admin-gold/10 p-2 text-admin-gold">
                      <TrendingUp className="size-4" />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </AdminHelpModal>

        {/* Diálogo de Confirmação de Exclusão */}
        <AlertDialog
          open={productToDelete !== null}
          onOpenChange={(open) => !open && setProductToDelete(null)}
        >
          <AlertDialogContent className="max-w-md rounded-3xl border border-white/10 bg-zinc-950">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-lg font-black uppercase tracking-tight text-white">
                Excluir Produto?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-xs text-zinc-400">
                Tem certeza que deseja excluir este produto? Esta ação não pode
                ser desfeita e removerá o item permanentemente do catálogo.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-4 gap-2">
              <AlertDialogCancel className="rounded-xl border border-0 border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-zinc-400 hover:bg-white/10 hover:text-white">
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDelete}
                className="bg-rose-650 rounded-xl border-0 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700"
              >
                Confirmar Exclusão
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Diálogo de Confirmação de Duplicação */}
        <AlertDialog
          open={productToDuplicate !== null}
          onOpenChange={(open) => !open && setProductToDuplicate(null)}
        >
          <AlertDialogContent className="max-w-md rounded-3xl border border-white/10 bg-zinc-950">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-lg font-black uppercase tracking-tight text-white">
                Duplicar Produto?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-xs text-zinc-400">
                Deseja realmente duplicar o produto "{productToDuplicate?.name}
                "? Uma nova cópia será criada desativada.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-4 gap-2">
              <AlertDialogCancel className="rounded-xl border border-0 border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-zinc-400 hover:bg-white/10 hover:text-white">
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDuplicate}
                className="rounded-xl border-0 bg-admin-gold px-4 py-2 text-xs font-bold text-black hover:bg-admin-gold/90"
              >
                Confirmar Duplicação
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
});

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
  if (viewMode === "detailed") {
    const margin =
      product.price > 0
        ? ((product.price - (product.costPrice || 0)) / product.price) * 100
        : 0;
    const roi =
      (product.costPrice || 0) > 0
        ? ((product.price - (product.costPrice || 0)) /
            (product.costPrice || 0)) *
          100
        : 0;
    const invested = (product.costPrice || 0) * product.stock;
    const totalProfit = (product.price || 0) * product.stock - invested;

    return (
      <motion.div
        layout
        className="group relative h-[440px] transform-gpu"
        onMouseEnter={onPrefetch}
        onTouchStart={onPrefetch}
      >
        <div className="absolute inset-0 rounded-[2.5rem] bg-gradient-to-br from-admin-gold to-transparent opacity-0 blur-2xl transition-opacity duration-700 group-hover:opacity-5" />
        <div className="admin-glass content-visibility-detailed-card relative flex h-full flex-col overflow-hidden border-y border-white/5 shadow-[0_20px_50px_rgba(0,0,0,0.3)] transition-all duration-500 group-hover:border-white/10 sm:rounded-[2.5rem] sm:border-x">
          {/* Header Action Overlay */}
          <div className="absolute right-4 top-4 z-20">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-11 rounded-xl border border-white/5 bg-black/40 p-0 text-zinc-500 backdrop-blur-md transition-all hover:bg-black/60 hover:text-white"
                >
                  <MoreVertical className="size-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="z-50 min-w-[180px] rounded-2xl border border-white/10 bg-zinc-950/95 p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.8)] backdrop-blur-3xl">
                <DropdownMenuItem
                  disabled={isOffline}
                  onClick={() => onNavigate("admin-product-form", product.id)}
                  className="mb-0.5 flex cursor-pointer items-center rounded-xl px-3.5 py-2.5 text-xs font-bold text-zinc-300 transition-colors focus:bg-white/[0.08] focus:text-white disabled:pointer-events-none disabled:opacity-40"
                >
                  <Edit2 className="mr-3 size-4 shrink-0 text-admin-gold" />{" "}
                  Editar Produto
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={isOffline}
                  onClick={() => onToggleStatus(product.id, product.isActive)}
                  className="mb-0.5 flex cursor-pointer items-center rounded-xl px-3.5 py-2.5 text-xs font-bold text-zinc-300 transition-colors focus:bg-white/[0.08] focus:text-white disabled:pointer-events-none disabled:opacity-40"
                >
                  <Eye className="mr-3 size-4 shrink-0 text-blue-400" />{" "}
                  {product.isActive ? "Pausar Produto" : "Ativar Produto"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={isOffline}
                  onClick={() => onDuplicate(product)}
                  className="mb-0.5 flex cursor-pointer items-center rounded-xl px-3.5 py-2.5 text-xs font-bold text-zinc-300 transition-colors focus:bg-white/[0.08] focus:text-white disabled:pointer-events-none disabled:opacity-40"
                >
                  <Copy className="mr-3 size-4 shrink-0 text-purple-400" />{" "}
                  Duplicar Produto
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={isOffline}
                  onClick={() => onDelete(product.id)}
                  className="flex cursor-pointer items-center rounded-xl px-3.5 py-2.5 text-xs font-bold text-zinc-400 transition-colors focus:bg-rose-500/10 focus:text-rose-500 disabled:pointer-events-none disabled:opacity-40"
                >
                  <Trash2 className="mr-3 size-4 shrink-0" /> Excluir Produto
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Main Content */}
          <div className="flex h-full flex-col space-y-8 p-8">
            {/* Visual Identity */}
            <div className="flex items-start gap-6">
              <div className="relative size-24 flex-shrink-0 overflow-hidden rounded-3xl border border-white/5 bg-zinc-900 shadow-2xl transition-transform duration-700 group-hover:scale-105">
                <LazyImage
                  src={product.images[0] || "https://via.placeholder.com/150"}
                  alt={product.name}
                  className="size-full object-cover transition-all duration-700"
                />
                {!product.isActive && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <Eye className="size-6 text-white/20" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 pt-2">
                <h4 className="truncate text-xl font-black leading-[1.2] text-white transition-colors group-hover:text-admin-gold">
                  {product.name}
                </h4>
                <p className="mt-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600">
                  {product.category}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge
                    className={`${product.isActive ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-500" : "border-white/5 bg-zinc-800 text-zinc-500"} rounded-lg border px-2.5 py-1 text-[8px] font-black uppercase tracking-widest backdrop-blur-md transition-all`}
                  >
                    {product.isActive ? "Em Operação" : "Offline"}
                  </Badge>
                  {product.costPrice !== undefined &&
                    product.costPrice !== null &&
                    product.costPrice > 0 &&
                    product.costPrice <= 0.1 && (
                      <Badge className="animate-pulse rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[8px] font-black uppercase tracking-widest text-amber-500 backdrop-blur-md">
                        Custo Suspeito
                      </Badge>
                    )}
                  {product.stock <= 5 && (
                    <Badge className="animate-pulse rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[8px] font-black uppercase tracking-widest text-amber-500 shadow-[0_0_15px_rgba(234,179,8,0.2)]">
                      Crítico
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Operational Metrics Grid */}
            <div className="grid grid-cols-2 gap-3 border-t border-white/5 pt-6">
              <div className="rounded-2xl border border-white/5 bg-zinc-900/50 p-4 transition-colors group-hover:border-white/10">
                <p className="mb-2 text-[8px] font-black uppercase tracking-[0.2em] text-zinc-600">
                  Margem de Lucro
                </p>
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "text-lg font-black tracking-tighter",
                      margin >= 40 && "text-emerald-500",
                      margin >= 20 && margin < 40 && "text-admin-gold",
                      margin < 20 && "text-rose-500",
                    )}
                  >
                    {margin.toFixed(1)}%
                  </span>
                  <div
                    className={cn(
                      "w-6 h-6 rounded-lg flex items-center justify-center border",
                      margin >= 20
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                        : "bg-rose-500/10 border-rose-500/20 text-rose-500",
                    )}
                  >
                    <TrendingUp className="size-3.5" />
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-white/5 bg-zinc-900/50 p-4 transition-colors group-hover:border-white/10">
                <p className="mb-2 text-[8px] font-black uppercase tracking-[0.2em] text-zinc-600">
                  ROI de Rendimento
                </p>
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "text-lg font-black tracking-tighter",
                      roi >= 100 && "text-emerald-500",
                      roi >= 50 && roi < 100 && "text-admin-gold",
                      roi < 50 && "text-rose-500",
                    )}
                  >
                    {roi.toFixed(1)}%
                  </span>
                  <div className="flex size-6 items-center justify-center rounded-lg border border-blue-500/20 bg-blue-500/10 text-blue-400">
                    <ArrowUpRight className="size-3.5" />
                  </div>
                </div>
              </div>
            </div>

            {/* Inventory Specs */}
            <div className="flex-1 space-y-4 pt-2">
              <div className="group/spec flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-700 transition-colors group-hover/spec:text-zinc-500">
                  Unidades em Estoque
                </span>
                <div className="flex items-center gap-2">
                  <div className="h-1 w-12 overflow-hidden rounded-full bg-zinc-900">
                    <div
                      className={cn(
                        "h-full transition-all duration-1000",
                        product.stock <= 5 ? "bg-rose-500" : "bg-admin-gold",
                      )}
                      style={{ width: `${Math.min(product.stock * 5, 100)}%` }}
                    />
                  </div>
                  <span
                    className={cn(
                      "text-xs font-black font-mono",
                      product.stock <= 5 ? "text-rose-500" : "text-white",
                    )}
                  >
                    {product.stock.toString().padStart(2, "0")}
                  </span>
                </div>
              </div>

              <div className="group/spec flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-700 transition-colors group-hover/spec:text-zinc-500">
                  Capital Alocado
                </span>
                <span className="font-mono text-xs font-bold text-zinc-400">
                  R${" "}
                  {invested.toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>

              <div className="mt-auto flex items-end justify-between border-t border-white/5 pt-6">
                <div className="space-y-1">
                  <p className="text-[8px] font-black uppercase tracking-[0.3em] text-admin-gold">
                    Preço de Venda
                  </p>
                  <h4 className="text-3xl font-black tracking-tighter text-white">
                    R${" "}
                    {product.price.toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                    })}
                  </h4>
                </div>
                <div className="space-y-1 text-right">
                  <p className="text-[8px] font-black uppercase tracking-[0.3em] text-emerald-500">
                    Potencial
                  </p>
                  <p className="text-sm font-black tracking-tight text-white/80">
                    + R${" "}
                    {totalProfit.toLocaleString("pt-BR", {
                      minimumFractionDigits: 0,
                    })}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Footer Gradient Strip */}
          <div className="h-1.5 w-full bg-gradient-to-r from-zinc-900 via-admin-gold/20 to-zinc-900 transition-all duration-1000 group-hover:via-admin-gold/50" />
        </div>
      </motion.div>
    );
  }

  // compact mode
  return (
    <motion.div
      layout
      className="group relative h-[250px] transform-gpu"
      onMouseEnter={onPrefetch}
      onTouchStart={onPrefetch}
    >
      <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-admin-gold to-transparent opacity-0 blur-xl transition-opacity duration-700 group-hover:opacity-5" />
      <div className="admin-glass content-visibility-compact-card relative flex h-full flex-col overflow-hidden rounded-3xl border border-white/5 shadow-lg transition-all duration-500 group-hover:border-white/10">
        {/* Image and Action Button */}
        <div className="relative aspect-square w-full overflow-hidden border-b border-white/5 bg-zinc-900">
          <LazyImage
            src={product.images[0] || "https://via.placeholder.com/150"}
            alt={product.name}
            className="size-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
          {!product.isActive && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <Eye className="size-5 text-white/40" />
            </div>
          )}
          {/* Dropdown in the corner of image */}
          <div className="absolute right-2 top-2 z-10">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex size-11 items-center justify-center rounded-xl border border-white/5 bg-black/60 p-0 text-zinc-400 backdrop-blur-md transition-all hover:bg-black/80 hover:text-white"
                >
                  <MoreVertical className="size-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="z-50 min-w-[160px] rounded-2xl border border-white/10 bg-zinc-950/95 p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.8)] backdrop-blur-3xl">
                <DropdownMenuItem
                  disabled={isOffline}
                  onClick={() => onNavigate("admin-product-form", product.id)}
                  className="mb-0.5 flex cursor-pointer items-center rounded-xl px-3.5 py-2.5 text-xs font-bold text-zinc-300 transition-colors focus:bg-white/[0.08] focus:text-white disabled:pointer-events-none disabled:opacity-40"
                >
                  <Edit2 className="mr-2 size-3.5 shrink-0 text-admin-gold" />{" "}
                  Editar Produto
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={isOffline}
                  onClick={() => onToggleStatus(product.id, product.isActive)}
                  className="mb-0.5 flex cursor-pointer items-center rounded-xl px-3.5 py-2.5 text-xs font-bold text-zinc-300 transition-colors focus:bg-white/[0.08] focus:text-white disabled:pointer-events-none disabled:opacity-40"
                >
                  <Eye className="mr-2 size-3.5 shrink-0 text-blue-400" />{" "}
                  {product.isActive ? "Pausar Produto" : "Ativar Produto"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={isOffline}
                  onClick={() => onDuplicate({ ...product, sold: 0 })}
                  className="mb-0.5 flex cursor-pointer items-center rounded-xl px-3.5 py-2.5 text-xs font-bold text-zinc-300 transition-colors focus:bg-white/[0.08] focus:text-white disabled:pointer-events-none disabled:opacity-40"
                >
                  <Copy className="mr-2 size-3.5 shrink-0 text-purple-400" />{" "}
                  Duplicar Produto
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={isOffline}
                  onClick={() => onDelete(product.id)}
                  className="flex cursor-pointer items-center rounded-xl px-3.5 py-2.5 text-xs font-bold text-zinc-400 transition-colors focus:bg-rose-500/10 focus:text-rose-500 disabled:pointer-events-none disabled:opacity-40"
                >
                  <Trash2 className="mr-2 size-3.5 shrink-0" /> Excluir Produto
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Badges on image */}
          <div className="absolute bottom-2 left-2 z-10 flex flex-col gap-1">
            <Badge
              className={cn(
                "text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded border backdrop-blur-md transition-all self-start",
                product.isActive
                  ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                  : "bg-zinc-800 text-zinc-500 border-white/5",
              )}
            >
              {product.isActive ? "Em Operação" : "Offline"}
            </Badge>
          </div>
        </div>

        {/* Details */}
        <div className="flex flex-1 flex-col justify-between gap-2 p-3">
          <div className="min-w-0">
            <p className="mb-1 text-[8px] font-black uppercase leading-none tracking-widest text-zinc-500">
              {product.category}
            </p>
            <h4 className="truncate text-xs font-black leading-[1.3] text-white transition-colors group-hover:text-admin-gold">
              {product.name}
            </h4>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[9px]">
              <span className="font-bold uppercase tracking-wider text-zinc-500">
                Estoque
              </span>
              <span
                className={cn(
                  "font-black font-mono",
                  product.stock <= 5 ? "text-rose-500" : "text-white",
                )}
              >
                {product.stock.toString().padStart(2, "0")}
              </span>
            </div>

            <div className="flex items-baseline justify-between border-t border-white/5 pt-1">
              <span className="text-[8px] font-bold uppercase tracking-wider text-admin-gold">
                Preço
              </span>
              <span className="font-mono text-xs font-black text-white">
                R${" "}
                {product.price.toLocaleString("pt-BR", {
                  minimumFractionDigits: 2,
                })}
              </span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
});

export default AdminProductsView;
