import { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react';
import {
  Plus,
  Search,
  Filter,
  MoreVertical,
  Edit2,
  Trash2,
  Copy,
  Eye,
  Package,
  TrendingUp,
  DollarSign,
  Wallet,
  ArrowUpRight,
  LayoutGrid,
  List,
  Layers,
  HelpCircle,
  BookOpen,
  Calculator,
  Percent,
  Activity,
  Coins,
  RefreshCw,
  Sparkles,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2
} from 'lucide-react';
import { useProducts } from '@/hooks/useProducts';
import { useCategories } from '@/hooks/useCategories';
import { useAnalytics } from '@/hooks/useAnalytics';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import type { View } from '@/types';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { AdminKpiCarousel, type KpiCardConfig } from '@/components/admin/AdminKpiCarousel';
import { DebouncedSearchInput } from '@/components/admin/DebouncedSearchInput';
import { LazyImage } from '@/components/LazyImage';
import { LocalErrorBoundary } from '@/components/ui/custom/LocalErrorBoundary';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

let cachedProductsTotal = 0;

interface AdminProductsViewProps {
  onNavigate: (view: View, id?: string) => void;
  active?: boolean;
}

export const AdminProductsView = memo(function AdminProductsView({ onNavigate, active }: Readonly<AdminProductsViewProps>) {
  const { products, loading, deleteProduct, toggleProductStatus, addProduct, loadProducts } = useProducts({ autoFetch: false });
  const { stats, fetchExecutiveSummary } = useAnalytics();
  const { categories: dbCategories } = useCategories();
  const isOffline = useOnlineStatus();

  const [savedScrollPosition, setSavedScrollPosition] = useState(0);
  const viewRef = useRef<HTMLDivElement>(null);
  const hasRestoredScrollRef = useRef(false);
  const wasActiveRef = useRef(active);

  const handleLocalNavigate = useCallback((view: View, id?: string) => {
    const container = viewRef.current?.closest('.admin-scroll-container') || document.querySelector('.active-scroll-container') || document.querySelector('main');
    if (container) {
      setSavedScrollPosition(container.scrollTop);
      hasRestoredScrollRef.current = false;
    }
    onNavigate(view, id);
  }, [onNavigate]);

  useEffect(() => {
    if (!active) {
      if (wasActiveRef.current) {
        const container = viewRef.current?.closest('.admin-scroll-container') || document.querySelector('.active-scroll-container') || document.querySelector('main');
        if (container) {
          setSavedScrollPosition(container.scrollTop);
        }
      }
      hasRestoredScrollRef.current = false;
      wasActiveRef.current = false;
      return;
    }

    wasActiveRef.current = true;

    if (active && !loading && products.length > 0 && savedScrollPosition > 0 && !hasRestoredScrollRef.current) {
      const container = viewRef.current?.closest('.admin-scroll-container') || document.querySelector('.active-scroll-container') || document.querySelector('main');
      if (container) {
        hasRestoredScrollRef.current = true;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            container.scrollTop = savedScrollPosition;
          });
        });
      }
    }
  }, [active, loading, products.length, savedScrollPosition]);

  useEffect(() => {
    if (active && !stats) {
      fetchExecutiveSummary(false);
    }
  }, [active, stats, fetchExecutiveSummary]);

  const [searchTerm, setSearchTerm] = useLocalStorage<string>('admin_products_search_term', '');
  const [isTyping, setIsTyping] = useState(false);
  const [filterCategory, setFilterCategory] = useLocalStorage<string>('admin_products_filter_category', 'all');
  const [totalProducts, setTotalProducts] = useState(() => cachedProductsTotal);
  const [currentPage, setCurrentPage] = useLocalStorage<number>('admin_products_current_page', 0);
  const pageSize = 12;

  const [showVisualLoading, setShowVisualLoading] = useState(false);
  useEffect(() => {
    if (loading) {
      const timer = setTimeout(() => setShowVisualLoading(true), 180);
      return () => clearTimeout(timer);
    } else {
      setShowVisualLoading(false);
    }
  }, [loading]);

  const [viewMode, setViewMode] = useState<'detailed' | 'compact'>(() => {
    const saved = localStorage.getItem('admin_products_view_mode');
    return (saved === 'detailed' || saved === 'compact') ? saved : 'compact';
  });

  const [expandedHelp, setExpandedHelp] = useState<Record<string, boolean>>({});
  const [helpTab, setHelpTab] = useState<'concepts' | 'simulator'>('concepts');
  const [simCost, setSimCost] = useState<string>('10.00');
  const [simPrice, setSimPrice] = useState<string>('15.00');
  const [simStock, setSimStock] = useState<string>('20');
  const [productToDelete, setProductToDelete] = useState<string | null>(null);
  const [productToDuplicate, setProductToDuplicate] = useState<any | null>(null);

  useEffect(() => {
    localStorage.setItem('admin_products_view_mode', viewMode);
  }, [viewMode]);

  const firstLoadRef = useRef(true);

  const loadData = useCallback(async (pageToFetch: number) => {
    try {
      const result = await loadProducts(pageToFetch, pageSize, {
        search: searchTerm || undefined,
        category: filterCategory === 'all' ? undefined : filterCategory
      });
      if (result) {
        setTotalProducts(result.total);
        cachedProductsTotal = result.total;
      }
    } finally {
      firstLoadRef.current = false;
    }
  }, [loadProducts, pageSize, searchTerm, filterCategory]);

  useEffect(() => {
    if (!active) return;
    loadData(currentPage);
  }, [currentPage, searchTerm, filterCategory, active, loadData]);

  const simulatorMetrics = useMemo(() => {
    const cost = parseFloat(simCost) || 0;
    const price = parseFloat(simPrice) || 0;
    const stock = parseInt(simStock) || 0;

    const unitProfit = price - cost;
    const margin = price > 0 ? (unitProfit / price) * 100 : 0;
    const roi = cost > 0 ? (unitProfit / cost) * 100 : 0;
    const totalCost = cost * stock;
    const totalRevenue = price * stock;
    const totalProfit = totalRevenue - totalCost;

    let health: 'excellent' | 'good' | 'low' | 'danger' = 'good';
    let healthLabel = 'Margem Saudável';
    if (margin >= 35) {
      health = 'excellent';
      healthLabel = 'Margem Excelente (Alta Rentabilidade)';
    } else if (margin >= 20) {
      health = 'good';
      healthLabel = 'Margem Saudável (Média do Mercado)';
    } else if (margin >= 10) {
      health = 'low';
      healthLabel = 'Margem Apertada (Atenção ao Volume)';
    } else {
      health = 'danger';
      healthLabel = 'Margem Crítica (Risco de Prejuízo)';
    }

    return {
      unitProfit,
      margin,
      roi,
      totalCost,
      totalRevenue,
      totalProfit,
      health,
      healthLabel
    };
  }, [simCost, simPrice, simStock]);

  const toggleHelp = (key: string) => {
    setExpandedHelp(prev => ({ ...prev, [key]: !prev[key] }));
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
      totalCount: totalProducts
    };
  }, [stats, totalProducts]);

  const categories = useMemo(() => {
    return ['all', ...dbCategories.map(c => c.name)];
  }, [dbCategories]);

  const kpiCards = useMemo<readonly KpiCardConfig[]>(() => [
    {
      id: 'capital-alocado',
      label: 'Capital Alocado',
      value: `R$ ${financialStats.invested.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      icon: Wallet,
      accent: 'text-emerald-500',
      subValue: "Capital Líquido",
    },
    {
      id: 'lucro-potencial',
      label: 'Lucro Potencial',
      value: `R$ ${financialStats.potential.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      icon: TrendingUp,
      accent: 'text-admin-gold',
      subValue: "Margem Bruta",
    },
    {
      id: 'roi-portfolio',
      label: 'ROI do Portfólio',
      value: `${financialStats.avgRoi.toFixed(2)}%`,
      icon: DollarSign,
      accent: 'text-blue-500',
      subValue: "Rendimento %",
    },
    {
      id: 'produtos-cadastrados',
      label: 'Produtos no Catálogo',
      value: `${totalProducts} itens`,
      icon: Package,
      accent: 'text-purple-500',
      subValue: "Catálogo Geral",
    },
  ], [financialStats, totalProducts]);

  const handleToggleStatus = useCallback(async (id: string, active: boolean) => {
    if (isOffline) {
      toast.error("Ação não permitida offline", {
        description: "Reconecte-se à internet para alterar o status do produto.",
      });
      return;
    }
    await toggleProductStatus(id, active);
  }, [toggleProductStatus, isOffline]);

  const handleDelete = useCallback((id: string) => {
    if (isOffline) {
      toast.error("Ação não permitida offline", {
        description: "Reconecte-se à internet para excluir produtos.",
      });
      return;
    }
    setProductToDelete(id);
  }, [isOffline]);

  const confirmDelete = useCallback(async () => {
    if (!productToDelete) return;
    if (isOffline) {
      toast.error("Você está offline", {
        description: "Não é possível confirmar a exclusão sem conexão.",
      });
      setProductToDelete(null);
      return;
    }
    try {
      await deleteProduct(productToDelete);
      toast.success("Produto Removido", {
        description: "O produto foi excluído com sucesso.",
      });
    } catch {
      toast.error("Erro na Exclusão", {
        description: "Não foi possível remover o produto.",
      });
    } finally {
      setProductToDelete(null);
    }
  }, [deleteProduct, productToDelete, isOffline]);

  const handleDuplicate = useCallback((product: any) => {
    if (isOffline) {
      toast.error("Ação não permitida offline", {
        description: "Reconecte-se à internet para duplicar produtos.",
      });
      return;
    }
    setProductToDuplicate(product);
  }, [isOffline]);

  const confirmDuplicate = useCallback(async () => {
    if (!productToDuplicate) return;
    if (isOffline) {
      toast.error("Você está offline", {
        description: "Não é possível confirmar a duplicação sem conexão.",
      });
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
        sku: productToDuplicate.sku ? `${productToDuplicate.sku}-COPY` : undefined,
        variants: productToDuplicate.variants?.map((v: any) => ({
          name: v.name,
          value: v.value,
          sku: v.sku ? `${v.sku}-COPY` : undefined,
          stockIncrement: v.stockIncrement,
          priceOverride: v.priceOverride,
          active: v.active,
          imageUrl: v.imageUrl
        }))
      };
      
      await addProduct(duplicateData);
      toast.success("Produto Duplicado", {
        description: "O produto foi duplicado com sucesso.",
      });
    } catch (err) {
      console.error('Error duplicating product:', err);
      toast.error("Erro na Duplicação", {
        description: "Não foi possível duplicar o produto.",
      });
    } finally {
      setProductToDuplicate(null);
    }
  }, [addProduct, productToDuplicate, isOffline]);



  // Removed early return loading block to prevent visual layout shifts

  return (
    <div ref={viewRef} className="h-auto bg-admin-bg text-white pb-8 animate-in fade-in duration-1000">
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
      <div className="px-6 flex items-center justify-between gap-4 pt-6 pb-2">
          <h1 className="text-2xl md:text-3xl font-black tracking-tighter uppercase leading-none select-none flex items-center gap-3 shrink-0">
              <span className="flex items-baseline flex-nowrap whitespace-nowrap">
                  <span className="italic text-white">Produtos</span>
              </span>
              <button
                type="button"
                onClick={() => toggleHelp('global-guide')}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center border transition-all duration-300 active:scale-95 shrink-0",
                  expandedHelp['global-guide']
                    ? "bg-admin-gold border-admin-gold/40 text-black shadow-md shadow-admin-gold/10 scale-105"
                    : "bg-zinc-900/60 border-white/5 text-zinc-500 hover:text-white hover:border-white/10"
                )}
                title="Guia Completo de Métricas e Ajuda"
              >
                <HelpCircle className="w-4.5 h-4.5" />
              </button>
          </h1>

          <div className="flex items-center gap-3 mr-auto md:ml-2">
            <div className={cn(
              "inline-flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full transition-all duration-300",
              loading 
                ? "bg-amber-500/10 border-amber-500/20 text-amber-500" 
                : "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
            )}>
              <div className={cn(
                "w-1.5 h-1.5 rounded-full",
                loading ? "bg-amber-500 animate-pulse" : "bg-emerald-500 animate-pulse"
              )} />
              <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest">
                {loading ? "Sincronizando..." : "Operações ao Vivo"}
              </span>
            </div>
          </div>
          
          <Button
              disabled={isOffline}
              className="h-11 px-5 rounded-xl bg-admin-gold text-black hover:bg-admin-gold/90 font-black text-[10px] uppercase tracking-widest shadow-[0_0_15px_rgba(234,179,8,0.2)] hover:scale-105 active:scale-95 transition-all shrink-0 items-center justify-center hidden sm:flex disabled:opacity-50 disabled:pointer-events-none"
              onClick={() => handleLocalNavigate('admin-product-form')}
          >
              <Plus className="w-4 h-4 mr-2 stroke-[3] shrink-0" />
              Novo Produto
          </Button>
          <Button
              disabled={isOffline}
              size="icon"
              className="h-11 w-11 rounded-xl bg-admin-gold text-black hover:bg-admin-gold/90 shadow-[0_0_15px_rgba(234,179,8,0.2)] active:scale-95 transition-all shrink-0 sm:hidden flex items-center justify-center disabled:opacity-50 disabled:pointer-events-none"
              onClick={() => handleLocalNavigate('admin-product-form')}
          >
              <Plus className="w-5 h-5 stroke-[3]" />
          </Button>
      </div>

      <div className="px-4 sm:px-6 mt-6 space-y-6 sm:space-y-12">
      <div className="space-y-4">
        {active && (
          <LocalErrorBoundary>
            <AdminKpiCarousel cards={kpiCards} loading={loading && !stats} active={active} title="Visão Financeira" />
          </LocalErrorBoundary>
        )}
      </div>

      {/* Unified Control Bar Compacta */}
      <div className="pt-8 border-t border-white/5 relative flex flex-col mb-8 mt-4">
        <div className="flex flex-col md:flex-row md:items-center gap-6 relative z-20">
            <div className="flex items-center gap-4 w-full flex-1">
                <div className="relative group w-full">
                    <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                         {loading || isTyping ? (
                             <Loader2 className="h-5 w-5 text-admin-gold animate-spin" />
                         ) : (
                             <Search className="h-5 w-5 text-zinc-600 group-focus-within:text-admin-gold transition-colors" />
                         )}
                    </div>
                    <label htmlFor="search-assets" className="sr-only">Buscar produtos</label>
                    <DebouncedSearchInput
                        id="search-assets"
                        name="search-assets"
                        placeholder="Buscar produtos..."
                        className="pl-14 h-14 rounded-2xl border-zinc-800 bg-black/40 text-white placeholder:text-zinc-600 focus:ring-admin-gold/20 focus:border-admin-gold/50 transition-all font-bold text-sm w-full"
                        value={searchTerm}
                        onChange={(val) => { setSearchTerm(val); setCurrentPage(0); }}
                        onTyping={setIsTyping}
                        delay={300}
                    />
                </div>
                
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="h-14 w-14 rounded-2xl border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 hover:border-admin-gold/50 group transition-all shrink-0">
                        <Filter className="w-5 h-5 text-zinc-500 group-hover:text-admin-gold transition-colors" />
                    </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="bg-zinc-950 border-zinc-800/50 p-2 rounded-2xl backdrop-blur-3xl w-56 mt-2 shadow-2xl">
                    {categories.map(cat => (
                        <DropdownMenuItem
                        key={cat}
                        onClick={() => { setFilterCategory(cat); setCurrentPage(0); }}
                        className="capitalize text-zinc-400 focus:text-white focus:bg-white/5 rounded-xl px-4 py-3 cursor-pointer transition-all font-bold text-xs mb-1 last:mb-0"
                        >
                        {cat === 'all' ? 'Todas as Categorias' : cat}
                        </DropdownMenuItem>
                    ))}
                    </DropdownMenuContent>
                </DropdownMenu>

                <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setViewMode(prev => prev === 'detailed' ? 'compact' : 'detailed')}
                    className="h-14 w-14 rounded-2xl border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 hover:border-admin-gold/50 group transition-all shrink-0"
                >
                    {viewMode === 'detailed' ? (
                        <LayoutGrid className="w-5 h-5 text-zinc-500 group-hover:text-admin-gold transition-colors" />
                    ) : (
                        <List className="w-5 h-5 text-zinc-500 group-hover:text-admin-gold transition-colors" />
                    )}
                </Button>
            </div>
        </div>
      </div>

         {/* Grid view of Products as Assets */}
      <LocalErrorBoundary>
        <div className="relative min-h-[400px]">
          {showVisualLoading && <div className="admin-sync-progress-bar" />}
          {viewMode === 'detailed' ? (
            <div key="detailed-grid" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 pb-10 animate-in fade-in duration-200 min-h-[400px]">
              {(firstLoadRef.current && loading && products.length === 0) ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="admin-glass rounded-[2.5rem] border border-white/5 p-8 space-y-6 h-[440px] flex flex-col justify-between shadow-[0_20px_50px_rgba(0,0,0,0.3)] animate-pulse">
                    <div className="flex gap-6 items-start">
                      <Skeleton className="w-24 h-24 rounded-3xl bg-white/5 shrink-0 animate-pulse" />
                      <div className="flex-1 space-y-3 pt-2">
                        <Skeleton className="h-5 w-3/4 bg-white/5 animate-pulse" />
                        <Skeleton className="h-3.5 w-1/2 bg-white/5 animate-pulse" />
                        <Skeleton className="h-4.5 w-1/3 bg-white/5 rounded-lg animate-pulse" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-6 border-t border-white/5">
                      <Skeleton className="h-16 rounded-2xl bg-white/5 animate-pulse" />
                      <Skeleton className="h-16 rounded-2xl bg-white/5 animate-pulse" />
                    </div>
                    <div className="space-y-4 pt-2 flex-1">
                      <div className="flex justify-between items-center">
                        <Skeleton className="h-3.5 w-1/3 bg-white/5 animate-pulse" />
                        <Skeleton className="h-3.5 w-1/12 bg-white/5 animate-pulse" />
                      </div>
                      <div className="flex justify-between items-center">
                        <Skeleton className="h-3.5 w-1/4 bg-white/5 animate-pulse" />
                        <Skeleton className="h-3.5 w-1/4 bg-white/5 animate-pulse" />
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                products?.map((product) => (
                  <AdminProductCard
                    key={product.id}
                    product={product}
                    viewMode="detailed"
                    onNavigate={handleLocalNavigate}
                    onToggleStatus={handleToggleStatus}
                    onDuplicate={handleDuplicate}
                    onDelete={handleDelete}
                    isOffline={isOffline}
                  />
                ))
              )}
            </div>
          ) : (
            <div key="compact-grid" className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 pb-10 animate-in fade-in duration-200 min-h-[250px]">
              {(firstLoadRef.current && loading && products.length === 0) ? (
                Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="admin-glass rounded-[1.5rem] border border-white/5 overflow-hidden h-[250px] flex flex-col justify-between shadow-lg animate-pulse">
                    <Skeleton className="w-full aspect-square bg-white/5 animate-pulse" />
                    <div className="p-3 flex flex-col gap-2">
                      <Skeleton className="h-3 w-1/3 bg-white/5 animate-pulse" />
                      <Skeleton className="h-3.5 w-3/4 bg-white/5 animate-pulse" />
                      <div className="flex justify-between items-baseline pt-1 border-t border-white/5">
                        <Skeleton className="h-3 w-1/4 bg-white/5 animate-pulse" />
                        <Skeleton className="h-3.5 w-1/3 bg-white/5 animate-pulse" />
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                products?.map((product) => (
                  <AdminProductCard
                    key={product.id}
                    product={product}
                    viewMode="compact"
                    onNavigate={handleLocalNavigate}
                    onToggleStatus={handleToggleStatus}
                    onDuplicate={handleDuplicate}
                    onDelete={handleDelete}
                    isOffline={isOffline}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </LocalErrorBoundary>
 
      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pb-10 select-none px-4 sm:px-0">
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
            Exibindo {currentPage * pageSize + 1} - {Math.min((currentPage + 1) * pageSize, totalProducts)} de {totalProducts}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                setCurrentPage(prev => Math.max(0, prev - 1));
                const mainEl = e.currentTarget.closest('.admin-scroll-container') || document.querySelector('.active-scroll-container') || document.querySelector('main');
                if (mainEl) mainEl.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              disabled={currentPage === 0}
              className="border-white/5 bg-zinc-950/60 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-xl h-10 px-4 transition-all"
            >
              <ChevronLeft className="w-4 h-4 mr-1.5" /> Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                setCurrentPage(prev => Math.min(totalPages - 1, prev + 1));
                const mainEl = e.currentTarget.closest('.admin-scroll-container') || document.querySelector('.active-scroll-container') || document.querySelector('main');
                if (mainEl) mainEl.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              disabled={currentPage === totalPages - 1}
              className="border-white/5 bg-zinc-950/60 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-xl h-10 px-4 transition-all"
            >
              Próximo <ChevronRight className="w-4 h-4 ml-1.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && products?.length === 0 && (
        <div className="admin-glass p-32 rounded-[3rem] border border-white/5 flex flex-col items-center justify-center text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-admin-gold/5 animate-pulse" />
          <div className="p-8 bg-zinc-900 border border-white/5 rounded-[2rem] mb-8 shadow-2xl relative z-10">
            <Search className="w-16 h-16 text-zinc-800" />
          </div>
          <h3 className="text-xl font-black text-white uppercase italic tracking-tighter mb-2">Nenhum Registro Detectado</h3>
          <p className="text-sm font-medium text-zinc-500 uppercase tracking-widest max-w-xs mx-auto mb-8">O sistema de inteligência não localizou produtos para os parâmetros definidos.</p>
          <Button
            variant="ghost"
            onClick={() => { setSearchTerm(''); setFilterCategory('all'); setCurrentPage(0); }}
            className="bg-black/40 border border-white/5 text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl px-10 h-14 hover:bg-admin-gold hover:text-black transition-all"
          >
            Resetar Filtros Mestres
          </Button>
        </div>
      )}

      {/* Modal de Ajuda Global */}
      {expandedHelp['global-guide'] && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300">
          <div className="relative bg-zinc-950/95 border border-white/10 rounded-[2rem] sm:rounded-[2.5rem] w-full max-w-2xl p-5 sm:p-8 flex flex-col max-h-[88vh] sm:max-h-[85vh] shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden animate-in zoom-in-95 duration-300">
            {/* Header */}
            <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
              <h3 className="text-sm font-black text-admin-gold uppercase tracking-[0.2em] flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-admin-gold animate-pulse" />
                Guia de Métricas & Informações
              </h3>
              <button
                type="button"
                onClick={() => toggleHelp('global-guide')}
                className="w-8 h-8 rounded-xl bg-zinc-900/50 border border-white/5 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all flex items-center justify-center font-bold text-sm"
              >
                ✕
              </button>
            </div>

            {/* Tabs Control */}
            <div className="flex gap-2 p-1 bg-zinc-900/60 border border-white/5 rounded-2xl mb-4 shrink-0">
              <button
                type="button"
                onClick={() => setHelpTab('concepts')}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-200",
                  helpTab === 'concepts'
                    ? "bg-admin-gold text-black shadow-lg shadow-admin-gold/10"
                    : "text-zinc-400 hover:text-white hover:bg-white/5"
                )}
              >
                <BookOpen className="w-3.5 h-3.5" />
                Dicionário
              </button>
              <button
                type="button"
                onClick={() => setHelpTab('simulator')}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-200",
                  helpTab === 'simulator'
                    ? "bg-admin-gold text-black shadow-lg shadow-admin-gold/10"
                    : "text-zinc-400 hover:text-white hover:bg-white/5"
                )}
              >
                <Calculator className="w-3.5 h-3.5" />
                Simulador
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto space-y-6 pr-1 pb-6 custom-scrollbar">
              {helpTab === 'concepts' ? (
                <>
                  {/* Seção 1: Indicadores Globais */}
                  <div className="space-y-3">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 border-l-2 border-admin-gold pl-2">
                      Indicadores Financeiros Globais
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="group relative p-4 rounded-2xl bg-zinc-900/40 border border-white/5 hover:border-admin-gold/20 hover:bg-zinc-900/60 transition-all duration-300">
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="p-1 rounded-lg bg-admin-gold/10 text-admin-gold">
                            <Coins className="w-3.5 h-3.5" />
                          </div>
                          <p className="text-[9px] font-black text-white uppercase tracking-wider">Capital Alocado</p>
                        </div>
                        <p className="text-[10px] text-zinc-500 font-medium leading-relaxed mb-3">
                          Custo total de aquisição de todas as unidades de produtos atualmente em estoque. Representa o capital líquido imobilizado no inventário.
                        </p>
                        <div className="p-2 rounded-xl bg-black/40 border border-white/5 font-mono text-[9px] text-zinc-500 flex justify-between items-center">
                          <span className="uppercase text-zinc-600 font-bold text-[8px]">Fórmula:</span>
                          <span className="text-zinc-300 font-black">Custo Unitário × Estoque</span>
                        </div>
                      </div>

                      <div className="group relative p-4 rounded-2xl bg-zinc-900/40 border border-white/5 hover:border-admin-gold/20 hover:bg-zinc-900/60 transition-all duration-300">
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="p-1 rounded-lg bg-emerald-500/10 text-emerald-400">
                            <TrendingUp className="w-3.5 h-3.5" />
                          </div>
                          <p className="text-[9px] font-black text-white uppercase tracking-wider">Lucro Potencial</p>
                        </div>
                        <p className="text-[10px] text-zinc-500 font-medium leading-relaxed mb-3">
                          Lucro bruto total estimado se todos os produtos em estoque forem vendidos pelo preço atual de venda.
                        </p>
                        <div className="p-2 rounded-xl bg-black/40 border border-white/5 font-mono text-[9px] text-zinc-500 flex justify-between items-center">
                          <span className="uppercase text-zinc-600 font-bold text-[8px]">Fórmula:</span>
                          <span className="text-zinc-300 font-black">(Preço − Custo) × Estoque</span>
                        </div>
                      </div>

                      <div className="group relative p-4 rounded-2xl bg-zinc-900/40 border border-white/5 hover:border-admin-gold/20 hover:bg-zinc-900/60 transition-all duration-300">
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="p-1 rounded-lg bg-blue-500/10 text-blue-400">
                            <Activity className="w-3.5 h-3.5" />
                          </div>
                          <p className="text-[9px] font-black text-white uppercase tracking-wider">ROI do Portfólio</p>
                        </div>
                        <p className="text-[10px] text-zinc-500 font-medium leading-relaxed mb-3">
                          Retorno médio percentual sobre o capital total investido para obter o lote de produtos cadastrados.
                        </p>
                        <div className="p-2 rounded-xl bg-black/40 border border-white/5 font-mono text-[9px] text-zinc-500 flex justify-between items-center">
                          <span className="uppercase text-zinc-600 font-bold text-[8px]">Fórmula:</span>
                          <span className="text-zinc-300 font-black">(Lucro Potencial ÷ Custo) × 100</span>
                        </div>
                      </div>

                      <div className="group relative p-4 rounded-2xl bg-zinc-900/40 border border-white/5 hover:border-admin-gold/20 hover:bg-zinc-900/60 transition-all duration-300">
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="p-1 rounded-lg bg-purple-500/10 text-purple-400">
                            <Layers className="w-3.5 h-3.5" />
                          </div>
                          <p className="text-[9px] font-black text-white uppercase tracking-wider">Produtos Ativos</p>
                        </div>
                        <p className="text-[10px] text-zinc-500 font-medium leading-relaxed mb-3">
                          Proporção de produtos que estão ativos e visíveis para compra pelos clientes no catálogo em relação ao total cadastrado.
                        </p>
                        <div className="p-2 rounded-xl bg-black/40 border border-white/5 font-mono text-[9px] text-zinc-500 flex justify-between items-center">
                          <span className="uppercase text-zinc-600 font-bold text-[8px]">Fórmula:</span>
                          <span className="text-zinc-300 font-black">(Ativos ÷ Total) × 100</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Seção 2: Métricas de Cada Produto */}
                  <div className="space-y-3 pt-2">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 border-l-2 border-admin-gold pl-2">
                      Métricas Individuais do Produto
                    </h4>
                    <div className="space-y-2.5">
                      <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 hover:border-emerald-500/20 hover:shadow-[0_0_15px_rgba(16,185,129,0.05)] transition-all duration-300 flex gap-4">
                        <div className="w-1 bg-emerald-500 rounded-full shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <Percent className="w-3.5 h-3.5 text-emerald-400" />
                            <p className="text-[9px] font-black text-white uppercase tracking-wider">Margem de Lucro %</p>
                          </div>
                          <p className="text-[10px] text-zinc-500 font-medium leading-relaxed">
                            Indica a porcentagem do preço final de venda que corresponde ao lucro bruto.
                          </p>
                          <div className="p-2 rounded-xl bg-black/40 border border-white/5 font-mono text-[9px] text-zinc-500 flex flex-col gap-1">
                            <div className="flex justify-between items-center">
                              <span className="uppercase text-zinc-600 font-bold text-[8px]">Fórmula:</span>
                              <span className="text-emerald-400 font-black">((Preço − Custo) ÷ Preço) × 100</span>
                            </div>
                            <div className="flex justify-between items-center pt-1 border-t border-white/5">
                              <span className="uppercase text-zinc-600 font-bold text-[8px]">Exemplo:</span>
                              <span className="text-zinc-400 font-medium">Custo R$10 / Venda R$15 ➜ Margem = 33.3%</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 hover:border-blue-500/20 hover:shadow-[0_0_15px_rgba(59,130,246,0.05)] transition-all duration-300 flex gap-4">
                        <div className="w-1 bg-blue-500 rounded-full shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                            <p className="text-[9px] font-black text-white uppercase tracking-wider">ROI de Rendimento %</p>
                          </div>
                          <p className="text-[10px] text-zinc-500 font-medium leading-relaxed">
                            Retorno sobre o Investimento para cada unidade adquirida do produto. Mede a eficiência do capital alocado na compra frente ao ganho.
                          </p>
                          <div className="p-2 rounded-xl bg-black/40 border border-white/5 font-mono text-[9px] text-zinc-500 flex flex-col gap-1">
                            <div className="flex justify-between items-center">
                              <span className="uppercase text-zinc-600 font-bold text-[8px]">Fórmula:</span>
                              <span className="text-blue-400 font-black">((Preço − Custo) ÷ Custo) × 100</span>
                            </div>
                            <div className="flex justify-between items-center pt-1 border-t border-white/5">
                              <span className="uppercase text-zinc-600 font-bold text-[8px]">Exemplo:</span>
                              <span className="text-zinc-400 font-medium">Custo R$10 / Venda R$15 ➜ ROI = 50.0%</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 hover:border-amber-500/20 hover:shadow-[0_0_15px_rgba(245,158,11,0.05)] transition-all duration-300 flex gap-4">
                        <div className="w-1 bg-amber-500 rounded-full shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                            <p className="text-[9px] font-black text-white uppercase tracking-wider">Unidades em Estoque & Alerta Crítico</p>
                          </div>
                          <p className="text-[10px] text-zinc-500 font-medium leading-relaxed">
                            Quantidade física disponível. Caso o estoque caia para 5 unidades ou menos, um alerta crítico pisca no painel.
                          </p>
                          <div className="p-2 rounded-xl bg-black/40 border border-white/5 font-mono text-[9px] text-zinc-500 flex justify-between items-center">
                            <span className="uppercase text-zinc-600 font-bold text-[8px]">Regra:</span>
                            <span className="text-amber-400 font-black">Estoque ≤ 5 ➜ Indicador Crítico</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                /* Simulador de Lucratividade */
                <div className="space-y-5">
                  <div className="p-4 rounded-3xl bg-zinc-900/20 border border-white/5 space-y-4">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 border-l-2 border-admin-gold pl-2">
                      Parâmetros do Produto
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-[9px] font-black uppercase tracking-wider text-zinc-500 mb-1 block">Custo Unitário (R$)</label>
                        <div className="relative">
                          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={simCost}
                            onChange={(e) => setSimCost(e.target.value)}
                            className="w-full bg-zinc-900/60 border border-white/10 rounded-xl py-2 pl-8 pr-3 text-xs text-white font-mono focus:outline-none focus:border-admin-gold transition-all"
                            placeholder="0.00"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-[9px] font-black uppercase tracking-wider text-zinc-500 mb-1 block">Preço de Venda (R$)</label>
                        <div className="relative">
                          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={simPrice}
                            onChange={(e) => setSimPrice(e.target.value)}
                            className="w-full bg-zinc-900/60 border border-white/10 rounded-xl py-2 pl-8 pr-3 text-xs text-white font-mono focus:outline-none focus:border-admin-gold transition-all"
                            placeholder="0.00"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-[9px] font-black uppercase tracking-wider text-zinc-500 mb-1 block">Unidades em Estoque</label>
                        <div className="relative">
                          <Package className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                          <input
                            type="number"
                            min="0"
                            value={simStock}
                            onChange={(e) => setSimStock(e.target.value)}
                            className="w-full bg-zinc-900/60 border border-white/10 rounded-xl py-2 pl-8 pr-3 text-xs text-white font-mono focus:outline-none focus:border-admin-gold transition-all"
                            placeholder="0"
                          />
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setSimCost('10.00');
                        setSimPrice('15.00');
                        setSimStock('20');
                      }}
                      className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-colors pt-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Resetar Simulador
                    </button>
                  </div>

                  {/* Resultados do Painel Simulador */}
                  <div className="space-y-3">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 border-l-2 border-admin-gold pl-2">
                      Análise de Performance
                    </h4>

                    {/* Recomendação de Margem */}
                    <div className={cn(
                      "p-3.5 rounded-2xl border transition-all duration-300 flex items-start gap-3 relative overflow-hidden",
                      simulatorMetrics.health === 'excellent' && "bg-emerald-950/20 border-emerald-500/20 text-emerald-400",
                      simulatorMetrics.health === 'good' && "bg-teal-950/20 border-teal-500/20 text-teal-400",
                      simulatorMetrics.health === 'low' && "bg-amber-950/20 border-amber-500/20 text-amber-400",
                      simulatorMetrics.health === 'danger' && "bg-rose-950/20 border-rose-500/20 text-rose-400"
                    )}>
                      <div className="shrink-0 p-1.5 rounded-xl bg-white/5 border border-white/5">
                        <Sparkles className="w-4 h-4 animate-pulse" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-wider">{simulatorMetrics.healthLabel}</p>
                        <p className="text-[10px] text-zinc-500 font-medium leading-normal mt-0.5">
                          {simulatorMetrics.health === 'excellent' && "Alta lucratividade por unidade! Ideal para alavancar vendas e suportar taxas operacionais confortavelmente."}
                          {simulatorMetrics.health === 'good' && "Sua margem está bem equilibrada com a média saudável do mercado de e-commerce."}
                          {simulatorMetrics.health === 'low' && "Rentabilidade reduzida. Monitore custos extras de frete ou transações para evitar margens negativas."}
                          {simulatorMetrics.health === 'danger' && "Atenção: Operando abaixo do mínimo recomendado ou em prejuízo líquido. Considere elevar o Preço de Venda."}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className={cn(
                        "p-4 rounded-2xl bg-zinc-900/40 border transition-all duration-300 flex flex-col justify-between h-20",
                        simulatorMetrics.health === 'excellent' && "border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.03)]",
                        simulatorMetrics.health === 'good' && "border-teal-500/20 shadow-[0_0_15px_rgba(20,184,166,0.03)]",
                        simulatorMetrics.health === 'low' && "border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.03)]",
                        simulatorMetrics.health === 'danger' && "border-rose-500/20 shadow-[0_0_15px_rgba(244,63,94,0.03)]"
                      )}>
                        <p className="text-[8px] font-black uppercase text-zinc-500 tracking-wider">Margem de Lucro</p>
                        <p className={cn(
                          "text-xl font-mono font-black",
                          simulatorMetrics.health === 'excellent' && "text-emerald-400",
                          simulatorMetrics.health === 'good' && "text-teal-400",
                          simulatorMetrics.health === 'low' && "text-amber-400",
                          simulatorMetrics.health === 'danger' && "text-rose-400"
                        )}>
                          {simulatorMetrics.margin.toFixed(1)}%
                        </p>
                      </div>

                      <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 flex flex-col justify-between h-20">
                        <p className="text-[8px] font-black uppercase text-zinc-500 tracking-wider">ROI Unitário</p>
                        <p className="text-xl font-mono font-black text-blue-400">
                          {simulatorMetrics.roi.toFixed(1)}%
                        </p>
                      </div>

                      <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 flex flex-col justify-between h-20">
                        <p className="text-[8px] font-black uppercase text-zinc-500 tracking-wider">Lucro Líquido (Unit.)</p>
                        <p className="text-xl font-mono font-black text-white">
                          R$ {simulatorMetrics.unitProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                      </div>

                      <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 flex flex-col justify-between h-20">
                        <p className="text-[8px] font-black uppercase text-zinc-500 tracking-wider">Capital de Lote (Custo)</p>
                        <p className="text-xl font-mono font-black text-zinc-400">
                          R$ {simulatorMetrics.totalCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-950 border border-admin-gold/10 relative overflow-hidden flex justify-between items-center h-20">
                      <div className="absolute inset-0 bg-admin-gold/5" />
                      <div className="relative z-10">
                        <p className="text-[8px] font-black uppercase text-admin-gold tracking-widest">Retorno Total Estimado</p>
                        <p className="text-xl font-mono font-black text-white mt-0.5">
                          R$ {simulatorMetrics.totalProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                        <p className="text-[8px] text-zinc-500 font-medium">
                          Faturamento Potencial: R$ {simulatorMetrics.totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div className="p-2 rounded-xl bg-admin-gold/10 text-admin-gold relative z-10 shrink-0">
                        <TrendingUp className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="pt-4 border-t border-white/5 mt-4 shrink-0">
              <Button
                onClick={() => toggleHelp('global-guide')}
                className="w-full h-12 rounded-2xl bg-admin-gold text-black hover:bg-admin-gold/90 font-black text-[10px] uppercase tracking-wider shadow-lg active:scale-95 transition-all"
              >
                Entendido e Fechar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Diálogo de Confirmação de Exclusão */}
      <AlertDialog open={productToDelete !== null} onOpenChange={(open) => !open && setProductToDelete(null)}>
        <AlertDialogContent className="bg-zinc-950 border border-white/10 rounded-3xl max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white font-black text-lg uppercase tracking-tight">Excluir Produto?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400 text-xs">
              Tem certeza que deseja excluir este produto? Esta ação não pode ser desfeita e removerá o item permanentemente do catálogo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="bg-white/5 border border-white/10 text-zinc-400 hover:bg-white/10 hover:text-white rounded-xl text-xs font-bold px-4 py-2 border-0">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-rose-650 hover:bg-rose-700 text-white rounded-xl text-xs font-bold px-4 py-2 border-0">
              Confirmar Exclusão
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Diálogo de Confirmação de Duplicação */}
      <AlertDialog open={productToDuplicate !== null} onOpenChange={(open) => !open && setProductToDuplicate(null)}>
        <AlertDialogContent className="bg-zinc-950 border border-white/10 rounded-3xl max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white font-black text-lg uppercase tracking-tight">Duplicar Produto?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400 text-xs">
              Deseja realmente duplicar o produto "{productToDuplicate?.name}"? Uma nova cópia será criada desativada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="bg-white/5 border border-white/10 text-zinc-400 hover:bg-white/10 hover:text-white rounded-xl text-xs font-bold px-4 py-2 border-0">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDuplicate} className="bg-admin-gold hover:bg-admin-gold/90 text-black rounded-xl text-xs font-bold px-4 py-2 border-0">
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
  readonly viewMode: 'detailed' | 'compact';
  readonly onNavigate: (view: View, id?: string) => void;
  readonly onToggleStatus: (id: string, active: boolean) => Promise<void> | void;
  readonly onDuplicate: (product: any) => void;
  readonly onDelete: (id: string) => void;
  readonly isOffline?: boolean;
}

const AdminProductCard = memo(function AdminProductCard({
  product,
  viewMode,
  onNavigate,
  onToggleStatus,
  onDuplicate,
  onDelete,
  isOffline = false
}: AdminProductCardProps) {
  if (viewMode === 'detailed') {
    const margin = product.price > 0 ? ((product.price - (product.costPrice || 0)) / product.price) * 100 : 0;
    const roi = (product.costPrice || 0) > 0 ? ((product.price - (product.costPrice || 0)) / (product.costPrice || 0)) * 100 : 0;
    const invested = (product.costPrice || 0) * product.stock;
    const totalProfit = ((product.price || 0) * product.stock) - invested;

    return (
      <div className="group relative">
        <div className="absolute inset-0 bg-gradient-to-br from-admin-gold to-transparent rounded-[2.5rem] blur-2xl opacity-0 group-hover:opacity-5 transition-opacity duration-700" />
        <div className="relative admin-glass sm:rounded-[2.5rem] border-y sm:border-x border-white/5 overflow-hidden group-hover:border-white/10 transition-all duration-500 flex flex-col h-full shadow-[0_20px_50px_rgba(0,0,0,0.3)] content-visibility-detailed-card">
          {/* Header Action Overlay */}
          <div className="absolute right-4 top-4 z-20">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-11 w-11 bg-black/40 backdrop-blur-md border border-white/5 text-zinc-500 hover:text-white hover:bg-black/60 rounded-xl p-0 transition-all">
                  <MoreVertical className="w-5 h-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="bg-zinc-950/95 border border-white/10 p-1.5 rounded-2xl backdrop-blur-3xl min-w-[180px] shadow-[0_10px_30px_rgba(0,0,0,0.8)] z-50">
                <DropdownMenuItem 
                  disabled={isOffline}
                  onClick={() => onNavigate('admin-product-form', product.id)} 
                  className="flex items-center cursor-pointer focus:bg-white/[0.08] text-zinc-300 focus:text-white rounded-xl px-3.5 py-2.5 transition-colors font-bold text-xs mb-0.5 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Edit2 className="w-4 h-4 mr-3 text-admin-gold shrink-0" /> Editar Produto
                </DropdownMenuItem>
                <DropdownMenuItem 
                  disabled={isOffline}
                  onClick={() => onToggleStatus(product.id, product.isActive)} 
                  className="flex items-center cursor-pointer focus:bg-white/[0.08] text-zinc-300 focus:text-white rounded-xl px-3.5 py-2.5 transition-colors font-bold text-xs mb-0.5 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Eye className="w-4 h-4 mr-3 text-blue-400 shrink-0" /> {product.isActive ? 'Pausar Produto' : 'Ativar Produto'}
                </DropdownMenuItem>
                <DropdownMenuItem 
                  disabled={isOffline}
                  onClick={() => onDuplicate(product)} 
                  className="flex items-center cursor-pointer focus:bg-white/[0.08] text-zinc-300 focus:text-white rounded-xl px-3.5 py-2.5 transition-colors font-bold text-xs mb-0.5 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Copy className="w-4 h-4 mr-3 text-purple-400 shrink-0" /> Duplicar Produto
                </DropdownMenuItem>
                <DropdownMenuItem 
                  disabled={isOffline}
                  onClick={() => onDelete(product.id)} 
                  className="flex items-center cursor-pointer focus:bg-rose-500/10 text-zinc-400 focus:text-rose-500 rounded-xl px-3.5 py-2.5 transition-colors font-bold text-xs disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Trash2 className="w-4 h-4 mr-3 shrink-0" /> Excluir Produto
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Main Content */}
          <div className="p-8 space-y-8 h-full flex flex-col">
            {/* Visual Identity */}
            <div className="flex gap-6 items-start">
              <div className="w-24 h-24 rounded-3xl overflow-hidden bg-zinc-900 border border-white/5 flex-shrink-0 relative group-hover:scale-105 transition-transform duration-700 shadow-2xl">
                <LazyImage
                  src={product.images[0] || 'https://via.placeholder.com/150'}
                  alt={product.name}
                  className="w-full h-full object-cover transition-all duration-700"
                />
                {!product.isActive && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-sm">
                    <Eye className="w-6 h-6 text-white/20" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 pt-2">
                <h4 className="text-xl font-black text-white truncate group-hover:text-admin-gold transition-colors leading-[1.2]">{product.name}</h4>
                <p className="text-[10px] text-zinc-600 mt-2 font-black uppercase tracking-[0.2em]">{product.category}</p>
                <div className="flex flex-wrap gap-2 mt-4">
                  <Badge className={`${product.isActive ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-zinc-800 text-zinc-500 border-white/5'} text-[8px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border backdrop-blur-md transition-all`}>
                    {product.isActive ? 'Em Operação' : 'Offline'}
                  </Badge>
                  {product.costPrice !== undefined && product.costPrice !== null && product.costPrice > 0 && product.costPrice <= 0.1 && (
                    <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[8px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border backdrop-blur-md animate-pulse">
                      Custo Suspeito
                    </Badge>
                  )}
                  {product.stock <= 5 && (
                    <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[8px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border animate-pulse shadow-[0_0_15px_rgba(234,179,8,0.2)]">
                      Crítico
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Operational Metrics Grid */}
            <div className="grid grid-cols-2 gap-3 pt-6 border-t border-white/5">
              <div className="p-4 bg-zinc-900/50 rounded-2xl border border-white/5 group-hover:border-white/10 transition-colors">
                <p className="text-[8px] text-zinc-600 uppercase font-black tracking-[0.2em] mb-2">Margem de Lucro</p>
                <div className="flex items-center justify-between">
                  <span className={cn(
                    "text-lg font-black tracking-tighter",
                    margin >= 40 && 'text-emerald-500',
                    margin >= 20 && margin < 40 && 'text-admin-gold',
                    margin < 20 && 'text-rose-500'
                  )}>
                    {margin.toFixed(1)}%
                  </span>
                  <div className={cn(
                    "w-6 h-6 rounded-lg flex items-center justify-center border",
                    margin >= 20 ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" : "bg-rose-500/10 border-rose-500/20 text-rose-500"
                  )}>
                    <TrendingUp className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>
              <div className="p-4 bg-zinc-900/50 rounded-2xl border border-white/5 group-hover:border-white/10 transition-colors">
                <p className="text-[8px] text-zinc-600 uppercase font-black tracking-[0.2em] mb-2">ROI de Rendimento</p>
                <div className="flex items-center justify-between">
                  <span className={cn(
                    "text-lg font-black tracking-tighter",
                    roi >= 100 && 'text-emerald-500',
                    roi >= 50 && roi < 100 && 'text-admin-gold',
                    roi < 50 && 'text-rose-500'
                  )}>
                    {roi.toFixed(1)}%
                  </span>
                  <div className="w-6 h-6 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center">
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>
            </div>

            {/* Inventory Specs */}
            <div className="space-y-4 pt-2 flex-1">
              <div className="flex justify-between items-center group/spec">
                <span className="text-[10px] font-bold text-zinc-700 uppercase tracking-widest group-hover/spec:text-zinc-500 transition-colors">Unidades em Estoque</span>
                <div className="flex items-center gap-2">
                  <div className="w-12 h-1 bg-zinc-900 rounded-full overflow-hidden">
                    <div
                      className={cn("h-full transition-all duration-1000", product.stock <= 5 ? "bg-rose-500" : "bg-admin-gold")}
                      style={{ width: `${Math.min(product.stock * 5, 100)}%` }}
                    />
                  </div>
                  <span className={cn("text-xs font-black font-mono", product.stock <= 5 ? "text-rose-500" : "text-white")}>
                    {product.stock.toString().padStart(2, '0')}
                  </span>
                </div>
              </div>

              <div className="flex justify-between items-center group/spec">
                <span className="text-[10px] font-bold text-zinc-700 uppercase tracking-widest group-hover/spec:text-zinc-500 transition-colors">Capital Alocado</span>
                <span className="font-mono text-xs font-bold text-zinc-400">R$ {invested.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>

              <div className="flex justify-between items-end pt-6 border-t border-white/5 mt-auto">
                <div className="space-y-1">
                  <p className="text-[8px] font-black text-admin-gold uppercase tracking-[0.3em]">Preço de Venda</p>
                  <h4 className="text-3xl font-black text-white tracking-tighter">
                    R$ {product.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </h4>
                </div>
                <div className="text-right space-y-1">
                  <p className="text-[8px] font-black text-emerald-500 uppercase tracking-[0.3em]">Potencial</p>
                  <p className="text-sm font-black text-white/80 tracking-tight">
                    + R$ {totalProfit.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Footer Gradient Strip */}
          <div className="h-1.5 w-full bg-gradient-to-r from-zinc-900 via-admin-gold/20 to-zinc-900 group-hover:via-admin-gold/50 transition-all duration-1000" />
        </div>
      </div>
    );
  }

  // compact mode
  return (
    <div className="group relative">
      <div className="absolute inset-0 bg-gradient-to-br from-admin-gold to-transparent rounded-[1.5rem] blur-xl opacity-0 group-hover:opacity-5 transition-opacity duration-700" />
      <div className="relative admin-glass rounded-[1.5rem] border border-white/5 overflow-hidden group-hover:border-white/10 transition-all duration-500 flex flex-col h-full shadow-lg content-visibility-compact-card">
        {/* Image and Action Button */}
        <div className="relative aspect-square w-full bg-zinc-900 overflow-hidden border-b border-white/5">
          <LazyImage
            src={product.images[0] || 'https://via.placeholder.com/150'}
            alt={product.name}
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
          {!product.isActive && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-sm">
              <Eye className="w-5 h-5 text-white/40" />
            </div>
          )}
          {/* Dropdown in the corner of image */}
          <div className="absolute right-2 top-2 z-10">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-11 w-11 bg-black/60 backdrop-blur-md border border-white/5 text-zinc-400 hover:text-white hover:bg-black/80 rounded-xl p-0 transition-all flex items-center justify-center">
                  <MoreVertical className="w-5 h-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="bg-zinc-950/95 border border-white/10 p-1.5 rounded-2xl backdrop-blur-3xl min-w-[160px] shadow-[0_10px_30px_rgba(0,0,0,0.8)] z-50">
                <DropdownMenuItem 
                  disabled={isOffline}
                  onClick={() => onNavigate('admin-product-form', product.id)} 
                  className="flex items-center cursor-pointer focus:bg-white/[0.08] text-zinc-300 focus:text-white rounded-xl px-3.5 py-2.5 transition-colors font-bold text-xs mb-0.5 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Edit2 className="w-3.5 h-3.5 mr-2 text-admin-gold shrink-0" /> Editar Produto
                </DropdownMenuItem>
                <DropdownMenuItem 
                  disabled={isOffline}
                  onClick={() => onToggleStatus(product.id, product.isActive)} 
                  className="flex items-center cursor-pointer focus:bg-white/[0.08] text-zinc-300 focus:text-white rounded-xl px-3.5 py-2.5 transition-colors font-bold text-xs mb-0.5 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Eye className="w-3.5 h-3.5 mr-2 text-blue-400 shrink-0" /> {product.isActive ? 'Pausar Produto' : 'Ativar Produto'}
                </DropdownMenuItem>
                <DropdownMenuItem 
                  disabled={isOffline}
                  onClick={() => onDuplicate({ ...product, sold: 0 })} 
                  className="flex items-center cursor-pointer focus:bg-white/[0.08] text-zinc-300 focus:text-white rounded-xl px-3.5 py-2.5 transition-colors font-bold text-xs mb-0.5 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Copy className="w-3.5 h-3.5 mr-2 text-purple-400 shrink-0" /> Duplicar Produto
                </DropdownMenuItem>
                <DropdownMenuItem 
                  disabled={isOffline}
                  onClick={() => onDelete(product.id)} 
                  className="flex items-center cursor-pointer focus:bg-rose-500/10 text-zinc-400 focus:text-rose-500 rounded-xl px-3.5 py-2.5 transition-colors font-bold text-xs disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-2 shrink-0" /> Excluir Produto
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Badges on image */}
          <div className="absolute left-2 bottom-2 flex flex-col gap-1 z-10">
            <Badge className={cn(
              "text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded border backdrop-blur-md transition-all self-start",
              product.isActive ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-zinc-800 text-zinc-500 border-white/5'
            )}>
              {product.isActive ? 'Em Operação' : 'Offline'}
            </Badge>
          </div>
        </div>

        {/* Details */}
        <div className="p-3 flex flex-col flex-1 justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[8px] text-zinc-500 font-black uppercase tracking-widest leading-none mb-1">{product.category}</p>
            <h4 className="text-xs font-black text-white truncate group-hover:text-admin-gold transition-colors leading-[1.3]">{product.name}</h4>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-center text-[9px]">
              <span className="font-bold text-zinc-500 uppercase tracking-wider">Estoque</span>
              <span className={cn("font-black font-mono", product.stock <= 5 ? "text-rose-500" : "text-white")}>
                {product.stock.toString().padStart(2, '0')}
              </span>
            </div>

            <div className="flex justify-between items-baseline pt-1 border-t border-white/5">
              <span className="text-[8px] font-bold text-admin-gold uppercase tracking-wider">Preço</span>
              <span className="font-mono text-xs font-black text-white">
                R$ {product.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default AdminProductsView;
