import { Button } from "@/components/ui/button";
import { ProductCard } from "@/components/ui/custom/ProductCard";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { branding } from "@/config/branding";
import { useStore } from "@/contexts/StoreContext";
import { useFavorites } from "@/hooks/useFavorites";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { useProducts } from "@/hooks/useProducts";
import { useSearch } from "@/hooks/useSearch";
import type { View } from "@/types";
import {
  ArrowLeft,
  PackageSearch,
  Search as SearchIcon,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from "react";

interface SearchViewProps {
  onNavigate: (view: View, productId?: string) => void;
  initialQuery?: string;
  onBack: () => void;
  selectedProductId?: string;
}

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
}

const SearchInput = React.memo(function SearchInput({
  value,
  onChange,
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    const handler = setTimeout(() => {
      onChange(localValue);
    }, 300);
    return () => clearTimeout(handler);
  }, [localValue, onChange]);

  return (
    <div className="group relative flex-1">
      <SearchIcon className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-zinc-400 transition-colors group-focus-within:text-zinc-900" />
      <Input
        id="search-input"
        name="q"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder="O que você deseja hoje?"
        className="h-12 rounded-2xl border-zinc-100 bg-zinc-50 pl-11 pr-4 text-sm transition-all placeholder:text-zinc-400 focus:border-zinc-200 focus:ring-black/5"
      />
    </div>
  );
});

export const SearchView = React.memo(function SearchView({
  onNavigate,
  initialQuery = "",
  onBack,
  selectedProductId,
}: SearchViewProps) {
  const { config } = useStore();
  const { prefetchView } = usePrefetchOnHover();
  const { products: allProducts } = useProducts();
  const {
    query,
    setQuery,
    category,
    setCategory,
    minPrice,
    setMinPrice,
    maxPrice,
    setMaxPrice,
    sort,
    setSort,
    filteredProducts,
    totalResults,
  } = useSearch(allProducts);

  const { isFavorite, toggleFavorite } = useFavorites();
  const handleProductClick = useCallback(
    (id: string) => {
      onNavigate("product-detail", id);
    },
    [onNavigate],
  );

  const handlePrefetchProductDetail = useCallback(() => {
    prefetchView("product-detail");
  }, [prefetchView]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(12);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const observerTargetRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }

      if (node) {
        const mainContainer = node.closest("main") || null;
        const observer = new IntersectionObserver(
          (entries) => {
            if (entries[0].isIntersecting) {
              setVisibleCount((prev) =>
                Math.min(prev + 12, filteredProducts.length),
              );
            }
          },
          {
            root: mainContainer,
            threshold: 0.1,
            rootMargin: "300px",
          },
        );
        observer.observe(node);
        observerRef.current = observer;
      }
    },
    [filteredProducts.length],
  );

  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  // Reset pagination when any query filters change
  useEffect(() => {
    setVisibleCount(12);
  }, [query, category, minPrice, maxPrice, sort]);
  // Get trending products for empty state (prioritizing available products)
  const trendingProducts = useMemo(() => {
    return [...allProducts]
      .sort((a, b) => {
        const aAvailable = a.stock > 0 ? 1 : 0;
        const bAvailable = b.stock > 0 ? 1 : 0;
        return bAvailable - aAvailable;
      })
      .slice(0, 4);
  }, [allProducts]);

  // Extract unique categories
  const categoriesSet = [
    "Todas",
    ...Array.from(new Set(allProducts.map((p) => p.category))),
  ];

  const handleClearFilters = useCallback(() => {
    setCategory("Todas");
    setMinPrice("");
    setMaxPrice("");
    setSort("newest");
  }, [setCategory, setMinPrice, setMaxPrice, setSort]);

  // Initialize query from props if needed
  useEffect(() => {
    if (initialQuery !== undefined) {
      setQuery(initialQuery);
      if (!initialQuery) {
        handleClearFilters();
      }
    }
  }, [initialQuery, setQuery, handleClearFilters]);

  const activeFiltersCount =
    (category !== "Todas" ? 1 : 0) +
    (minPrice !== "" ? 1 : 0) +
    (maxPrice !== "" ? 1 : 0);

  return (
    <div className="pb-customer min-h-full bg-white selection:bg-black selection:text-white">
      {/* Premium Sticky Search Header */}
      <div className="sticky top-[-2px] z-50 border-b border-zinc-100 bg-white/90 backdrop-blur-2xl">
        <div className="mx-auto max-w-7xl space-y-4 p-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="flex size-10 items-center justify-center rounded-2xl border border-zinc-100 bg-zinc-50 transition-all hover:bg-zinc-100 active:scale-90"
            >
              <ArrowLeft className="size-5 text-zinc-900" />
            </button>
            <SearchInput value={query} onChange={setQuery} />
          </div>

          {/* Quick Filters - Pill Style */}
          <div className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-1">
            <Sheet open={isFilterOpen} onOpenChange={setIsFilterOpen}>
              <SheetTrigger asChild>
                <button className="flex items-center gap-2 whitespace-nowrap rounded-full bg-[#5C061E] px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white shadow-xl shadow-rose-100/30 transition-all hover:bg-[#720E28] active:scale-95">
                  <SlidersHorizontal className="size-3" />
                  Filtros {activeFiltersCount > 0 && `(${activeFiltersCount})`}
                </button>
              </SheetTrigger>
              <SheetContent
                side="bottom"
                className="max-h-[90vh] overflow-y-auto rounded-t-[3rem] p-8"
              >
                <SheetHeader className="mb-8">
                  <div className="flex items-center justify-between">
                    <SheetTitle className="text-2xl font-black tracking-tighter">
                      Refinar Busca
                    </SheetTitle>
                    {activeFiltersCount > 0 && (
                      <button
                        onClick={handleClearFilters}
                        className="text-[10px] font-black uppercase tracking-widest text-red-500"
                      >
                        Limpar Tudo
                      </button>
                    )}
                  </div>
                </SheetHeader>

                <div className="space-y-8 pb-10">
                  <div>
                    <p className="mb-4 text-[10px] font-black uppercase tracking-widest text-zinc-400">
                      Categorias
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {categoriesSet.map((catName) => (
                        <button
                          key={catName}
                          onClick={() => setCategory(catName)}
                          className={`rounded-2xl border px-5 py-2.5 text-[11px] font-bold transition-all ${
                            category === catName
                              ? "scale-105 border-primary bg-primary text-white shadow-lg shadow-rose-100/20"
                              : "border-zinc-100 bg-zinc-50 text-zinc-600 hover:border-zinc-300"
                          }`}
                        >
                          {catName}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-4 text-[10px] font-black uppercase tracking-widest text-zinc-400">
                      Ordenação
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: "Menor Preço", value: "price_asc" },
                        { label: "Maior Preço", value: "price_desc" },
                        { label: "Mais Novos", value: "newest" },
                        { label: "Alfabetica", value: "name_asc" },
                      ].map((option) => (
                        <button
                          key={option.value}
                          onClick={() => setSort(option.value as any)}
                          className={`rounded-2xl border px-4 py-3 text-[11px] font-bold transition-all ${
                            sort === option.value
                              ? "border-primary bg-primary text-white"
                              : "border-zinc-100 bg-zinc-50 text-zinc-600 hover:border-zinc-300"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <Button
                    onClick={() => setIsFilterOpen(false)}
                    className="h-14 w-full rounded-2xl bg-[#5C061E] text-xs font-black uppercase tracking-widest text-white shadow-2xl shadow-rose-100/20 transition-all hover:bg-[#720E28]"
                  >
                    Aplicar Filtros
                  </Button>
                </div>
              </SheetContent>
            </Sheet>

            <div className="mx-2 h-4 w-px bg-zinc-100" />

            {categoriesSet.slice(0, 6).map((catName) => (
              <button
                key={catName}
                onClick={() => setCategory(catName)}
                className={`whitespace-nowrap rounded-full border px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-all ${
                  category === catName
                    ? "border-primary bg-primary text-white"
                    : "border-zinc-100 bg-zinc-50 text-zinc-500 hover:border-primary hover:text-primary"
                }`}
              >
                {catName}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="mx-auto max-w-7xl px-4 py-8">
        {filteredProducts.length > 0 ? (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-zinc-900" />
                <h2 className="text-xl font-black tracking-tighter">
                  Encontramos {totalResults} resultados
                </h2>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
              {filteredProducts.slice(0, visibleCount).map((product, index) => (
                <div
                  key={product.id}
                  style={{
                    animationDelay: `${(index % 8) * 50}ms`,
                    animationFillMode: "both",
                  }}
                  className="animate-fade-in flex h-full flex-col"
                >
                  <ProductCard
                    product={product}
                    isFavorite={isFavorite(product.id)}
                    onToggleFavorite={toggleFavorite}
                    onClick={handleProductClick}
                    isEligibleForFreeShipping={config.freeShippingMin > 0}
                    onMouseEnter={handlePrefetchProductDetail}
                    onTouchStart={handlePrefetchProductDetail}
                    priority={index < 4}
                    selectedProductId={selectedProductId}
                  />
                </div>
              ))}
            </div>

            {visibleCount < filteredProducts.length && (
              <div
                ref={observerTargetRef}
                className="flex h-20 items-center justify-center"
              >
                <div className="size-6 animate-spin rounded-full border-2 border-zinc-900 border-t-transparent" />
              </div>
            )}
          </div>
        ) : (
          /* Smart Empty State */
          <div className="py-20 duration-700 animate-in fade-in slide-in-from-bottom-8">
            <div className="mx-auto mb-20 max-w-sm text-center">
              <div className="mx-auto mb-6 flex size-20 items-center justify-center rounded-[2.5rem] border border-zinc-100 bg-zinc-50">
                <PackageSearch className="size-8 text-zinc-300" />
              </div>
              <h2 className="text-2xl font-black tracking-tighter text-zinc-900">
                Ué, nenhum resultado?
              </h2>
              <p className="mt-2 text-xs font-medium leading-relaxed text-zinc-400">
                Não encontramos o que você buscou com esses filtros. <br />
                <span className="font-black text-zinc-900">
                  Que tal dar uma olhada no que é tendência?
                </span>
              </p>
              <Button
                variant="outline"
                onClick={handleClearFilters}
                className="mt-8 h-12 rounded-2xl border-zinc-200 px-8 text-[10px] font-black uppercase tracking-widest text-zinc-900"
              >
                Limpar Tudo
              </Button>
            </div>

            {/* Trending Recommendations */}
            <div className="border-t border-zinc-100 pt-10">
              <div className="mb-10 flex flex-col items-center text-center">
                <span className="mb-2 text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">
                  Editor's Choice
                </span>
                <h3 className="text-2xl font-black tracking-tighter text-zinc-900">
                  Trending na {branding.appName}
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
                {trendingProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    isFavorite={isFavorite(product.id)}
                    onToggleFavorite={toggleFavorite}
                    onClick={handleProductClick}
                    isEligibleForFreeShipping={config.freeShippingMin > 0}
                    onMouseEnter={handlePrefetchProductDetail}
                    onTouchStart={handlePrefetchProductDetail}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
