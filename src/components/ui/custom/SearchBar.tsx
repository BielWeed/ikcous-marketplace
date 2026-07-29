import { Input } from "@/components/ui/input";
import { useProducts } from "@/hooks/useProducts";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";
import { haptic } from "@/utils/haptic";
import { ArrowRight, Search, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onProductClick?: (id: string) => void;
  placeholder?: string;
  className?: string;
}

interface ScoredProduct extends Product {
  score: number;
}

export function SearchBar({
  value,
  onChange,
  onProductClick,
  placeholder = "Buscar produtos...",
  className = "",
}: SearchBarProps) {
  const [localValue, setLocalValue] = useState(value);
  const deferredLocalValue = useDeferredValue(localValue);
  const [isFocused, setIsFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { products } = useProducts();

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (localValue !== value) {
        onChange(localValue);
      }
    }, 300); // Faster debounce for better "intelligence" feel

    return () => clearTimeout(timer);
  }, [localValue, onChange, value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleClear = () => {
    haptic.light();
    setLocalValue("");
    onChange("");
  };

  const handleSuggestionClick = (suggestion: string, productId?: string) => {
    haptic.medium();
    if (productId && onProductClick) {
      onProductClick(productId);
      setIsFocused(false);
      return;
    }
    setLocalValue(suggestion);
    onChange(suggestion);
    setIsFocused(false);
  };

  // Advanced Scoring Algorithm - Elite Precision
  const searchResults = useMemo<ScoredProduct[]>(() => {
    if (!deferredLocalValue.trim()) {
      // Show bestsellers or trending if no search
      return products
        .filter((p) => p.isActive && (p.isBestseller || p.stock > 0))
        .slice(0, 4)
        .map((p) => {
          const item = Object.assign({}, p) as ScoredProduct;
          item.score = 0;
          return item;
        });
    }

    const query = deferredLocalValue.toLowerCase().trim();
    const scored = products
      .filter((product) => product.isActive)
      .map((product) => {
        let score = 0;
        const name = product.name.toLowerCase();
        const description = product.description.toLowerCase();
        const category = product.category.toLowerCase();
        const tags = (product.tags || []).map((t) => t.toLowerCase());

        // Exact match
        if (name === query) score += 100;
        // Starts with
        else if (name.startsWith(query)) score += 80;
        // Contains
        else if (name.includes(query)) score += 50;

        // Word match (for multi-word queries)
        const queryWords = query.split(" ");
        queryWords.forEach((word) => {
          if (name.includes(word)) score += 20;
          if (category.includes(word)) score += 15;
          if (tags.some((t) => t.includes(word))) score += 10;
        });

        // Category match
        if (category === query) score += 40;
        else if (category.includes(query)) score += 20;

        // Description match (light weight)
        if (description.includes(query)) score += 5;

        const scoredItem = Object.assign({}, product) as ScoredProduct;
        scoredItem.score = score;
        return scoredItem;
      })
      .filter((p) => p.score > 0)
      .sort((a, b) => (b as ScoredProduct).score - (a as ScoredProduct).score)
      .slice(0, 6);

    return scored as ScoredProduct[];
  }, [products, deferredLocalValue]);

  const trendingProducts = useMemo<Product[]>(() => {
    const bestsellers = products.filter((p) => p.isActive && p.isBestseller);
    if (bestsellers.length > 0) return bestsellers.slice(0, 4);
    // Fallback to most recent active products if no bestsellers found
    return products.filter((p) => p.isActive).slice(0, 4);
  }, [products]);

  return (
    <div ref={containerRef} className={cn("relative z-50", className)}>
      {/* Liquid Search Container */}
      <div
        className={cn(
          "absolute inset-0 bg-white shadow-sm border border-zinc-100 rounded-full transition-[box-shadow,border-color,transform] duration-700",
          isFocused ? "shadow-xl border-zinc-200 scale-[1.01]" : "",
        )}
        style={{ transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" }}
      />

      <div
        className={cn(
          "relative flex items-center h-10 transition-[z-index,opacity] duration-300",
          isFocused ? "z-[60]" : "z-10",
        )}
      >
        <Search
          className={cn(
            "absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 transition-[color,transform] duration-200 z-30",
            isFocused ? "text-zinc-900 scale-110" : "text-zinc-400",
          )}
        />

        {/* Animação Premium de Placeholder para Mobile */}
        {!localValue && !isFocused && (
          <div className="pointer-events-none absolute inset-y-0 left-12 right-10 z-[25] flex select-none items-center overflow-hidden">
            <div className="animate-marquee-x flex gap-12 whitespace-nowrap">
              <span className="text-sm font-medium text-zinc-300">
                {placeholder}
              </span>
              <span className="text-sm font-medium text-zinc-300 sm:hidden">
                {placeholder}
              </span>
              <span className="text-sm font-medium text-zinc-300 sm:hidden">
                {placeholder}
              </span>
            </div>
          </div>
        )}

        <Input
          id="global-search"
          name="search"
          value={localValue}
          onFocus={() => setIsFocused(true)}
          onChange={(e) => setLocalValue(e.target.value)}
          aria-label="Buscar produtos"
          title="Buscar produtos"
          className={cn(
            "relative pl-12 pr-10 border-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 h-full text-sm font-bold tracking-tight text-zinc-900 placeholder:text-zinc-300 placeholder:font-medium rounded-full z-20 transition-[background-color,color] duration-200 bg-transparent focus:outline-none focus:ring-0 focus-visible:outline-none",
          )}
          placeholder=""
        />

        {localValue && (
          <button
            onClick={handleClear}
            className="absolute right-3 z-30 flex size-5 items-center justify-center rounded-full bg-zinc-900/5 text-zinc-400 transition-[background-color,color,transform] duration-200 hover:bg-zinc-900 hover:text-white active:scale-90"
          >
            <X className="size-2.5" />
          </button>
        )}
      </div>

      {/* Elite Expanded Panel */}
      {isFocused && (
        <>
          <div className="fixed inset-0 top-[calc(var(--header-height)+var(--safe-area-top))] z-40 bg-black/40 backdrop-blur-sm duration-700 animate-in fade-in" />

          <div className="fixed inset-x-0 bottom-[calc(var(--nav-height)+var(--safe-area-bottom))] top-[calc(var(--header-height)+var(--safe-area-top))] z-[100] w-full overflow-y-auto border-b border-zinc-100 bg-white shadow-[0_40px_100px_rgba(0,0,0,0.25)] duration-700 animate-in fade-in slide-in-from-top-2">
            <div className="py-6">
              {/* Intelligent Trending/Search Results - Max Fidelity */}
              <div>
                <div className="mb-8 flex items-center gap-3 px-8">
                  <div className="h-4 w-1.5 rounded-full bg-zinc-900" />
                  <span className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-400">
                    {localValue ? "Resultados" : "Tendências do Catálogo"}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {localValue.trim().length > 0 ? (
                    searchResults.length > 0 ? (
                      searchResults.map((item) => (
                        <button
                          key={item.id}
                          onClick={() =>
                            handleSuggestionClick(item.name, item.id)
                          }
                          className="group relative flex w-full items-center justify-between border-b border-zinc-50/50 px-6 py-3 transition-all last:border-0 hover:bg-zinc-50/80"
                        >
                          <div className="flex items-center gap-6">
                            <div className="relative">
                              <div className="size-12 overflow-hidden rounded-[16px] border border-zinc-200/50 bg-zinc-100 shadow-sm transition-transform duration-500 group-hover:scale-105">
                                <img
                                  src={
                                    item.images[0] ||
                                    "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&q=80&w=100"
                                  }
                                  alt={item.name}
                                  className="size-full object-cover"
                                  loading="lazy"
                                />
                              </div>
                              {item.isBestseller && (
                                <div className="absolute -right-1 -top-1 size-3 animate-pulse rounded-full border-2 border-white bg-amber-500 shadow-sm" />
                              )}
                            </div>
                            <div className="flex flex-col items-start gap-1.5">
                              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-300 transition-colors group-hover:text-amber-600">
                                {item.category}
                              </span>
                              <span className="text-xl font-bold tracking-tighter text-zinc-900 transition-transform duration-500 group-hover:translate-x-2">
                                {item.name}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-[10px] font-bold text-zinc-400 opacity-100 transition-opacity hover-hover:opacity-0 hover-hover:group-hover:opacity-100">
                              R$ {item.price.toFixed(2)}
                            </span>
                            <ArrowRight className="size-6 translate-x-0 text-zinc-900 opacity-100 transition-all duration-700 ease-out hover-hover:-translate-x-6 hover-hover:opacity-0 hover-hover:group-hover:translate-x-0 hover-hover:group-hover:opacity-100" />
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="px-8 py-12 text-center font-medium text-zinc-400">
                        Nenhum produto encontrado para "{localValue}"
                      </div>
                    )
                  ) : null}
                </div>
              </div>

              {/* Trending Products Section - NEW Integration */}
              {(localValue.trim().length === 0 || searchResults.length < 3) && (
                <div className="mt-8">
                  <div className="mb-8 flex items-center gap-3 px-8">
                    <div className="h-4 w-1.5 rounded-full bg-amber-500" />
                    <span className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-400">
                      Produtos em Alta
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {trendingProducts.map((item) => (
                      <button
                        key={`trending-${item.id}`}
                        onClick={() =>
                          handleSuggestionClick(item.name, item.id)
                        }
                        className="group relative flex w-full items-center justify-between border-b border-zinc-50/50 px-6 py-3 transition-all last:border-0 hover:bg-zinc-50/80"
                      >
                        <div className="flex items-center gap-8">
                          <div className="relative">
                            <div className="size-16 overflow-hidden rounded-[20px] border border-zinc-200/50 bg-zinc-100 shadow-sm transition-transform duration-500 group-hover:scale-105">
                              <img
                                src={
                                  item.images[0] ||
                                  "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&q=80&w=100"
                                }
                                alt={item.name}
                                className="size-full object-cover"
                                loading="lazy"
                              />
                            </div>
                            <div className="absolute -right-1 -top-1 size-3 animate-pulse rounded-full border-2 border-white bg-amber-500 shadow-sm" />
                          </div>
                          <div className="flex flex-col items-start gap-1.5">
                            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-300 transition-colors group-hover:text-amber-600">
                              {item.category}
                            </span>
                            <span className="text-xl font-bold tracking-tighter text-zinc-900 transition-transform duration-500 group-hover:translate-x-2">
                              {item.name}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-[10px] font-bold text-zinc-400 opacity-100 transition-opacity hover-hover:opacity-0 hover-hover:group-hover:opacity-100">
                            R$ {item.price.toFixed(2)}
                          </span>
                          <ArrowRight className="size-6 translate-x-0 text-zinc-900 opacity-100 transition-all duration-700 ease-out hover-hover:-translate-x-6 hover-hover:opacity-0 hover-hover:group-hover:translate-x-0 hover-hover:group-hover:opacity-100" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
