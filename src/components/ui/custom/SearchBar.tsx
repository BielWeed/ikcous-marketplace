import { Input } from "@/components/ui/input";
import { useProducts } from "@/hooks/useProducts";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";
import { haptic } from "@/utils/haptic";
import { ArrowRight, Search, Sparkles, Tag, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

interface SearchBarProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onProductClick?: (id: string) => void;
  readonly placeholder?: string;
  readonly className?: string;
}

interface ScoredProduct extends Product {
  score: number;
}

export function SearchBar({
  value,
  onChange,
  onProductClick,
  // Igual ao que o Header passa, de propósito: um default divergente ("Buscar
  // produtos...", com reticências) faz quem lê só a assinatura acreditar num
  // texto que a tela não mostra.
  placeholder = "Buscar produtos",
  className = "",
}: SearchBarProps) {
  const [localValue, setLocalValue] = useState(value);
  const deferredLocalValue = useDeferredValue(localValue);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { products } = useProducts();

  // Keep localValue in sync with props
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Ensure dropdown is closed whenever input is empty
  useEffect(() => {
    if (localValue.trim().length === 0) {
      setIsOpen(false);
    }
  }, [localValue]);

  // Debounced update to parent for catalog filter
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localValue !== value) {
        onChange(localValue);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [localValue, onChange, value]);

  // Handle clicking outside the container to dismiss dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleClear = () => {
    haptic.light();
    setLocalValue("");
    onChange("");
    setIsOpen(false);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleSuggestionClick = (suggestion: string, productId?: string) => {
    haptic.medium();
    if (productId && onProductClick) {
      onProductClick(productId);
      setIsOpen(false);
      return;
    }
    setLocalValue(suggestion);
    onChange(suggestion);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setIsOpen(false);
      if (inputRef.current) inputRef.current.blur();
    } else if (e.key === "Enter") {
      haptic.light();
      onChange(localValue);
      setIsOpen(false);
      if (inputRef.current) inputRef.current.blur();
    }
  };

  // Predictive term suggestions (autocomplete letter-by-letter)
  const predictedTerms = useMemo<string[]>(() => {
    const query = deferredLocalValue.trim().toLowerCase();
    if (!query) return [];

    const termSet = new Set<string>();

    products.forEach((p) => {
      if (!p.isActive) return;

      // Extract words from product name
      const words = p.name.split(/\s+/);
      words.forEach((w) => {
        const clean = w.replace(/[^\wÀ-ú]/gi, "").trim();
        if (
          clean.toLowerCase().startsWith(query) &&
          clean.length >= query.length
        ) {
          const formatted =
            clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
          termSet.add(formatted);
        }
      });

      // Category match
      if (p.category.toLowerCase().startsWith(query)) {
        termSet.add(p.category);
      }

      // Tags match
      (p.tags || []).forEach((t) => {
        if (t.toLowerCase().startsWith(query)) {
          termSet.add(t);
        }
      });
    });

    return Array.from(termSet).slice(0, 4);
  }, [products, deferredLocalValue]);

  // Matching categories
  const matchingCategories = useMemo<string[]>(() => {
    const query = deferredLocalValue.trim().toLowerCase();
    if (!query) return [];

    const catSet = new Set<string>();
    products.forEach((p) => {
      if (p.isActive && p.category.toLowerCase().includes(query)) {
        catSet.add(p.category);
      }
    });

    return Array.from(catSet).slice(0, 3);
  }, [products, deferredLocalValue]);

  // Scored Product Search Results
  const searchResults = useMemo<ScoredProduct[]>(() => {
    const query = deferredLocalValue.toLowerCase().trim();
    if (!query) return [];

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
        // Starts with query
        else if (name.startsWith(query)) score += 85;
        // Contains query
        else if (name.includes(query)) score += 50;

        // Word level score
        const queryWords = query.split(/\s+/).filter(Boolean);
        for (const word of queryWords) {
          if (name.includes(word)) score += 20;
          if (category.includes(word)) score += 15;
          if (tags.some((t) => t.includes(word))) score += 10;
        }

        // Category match
        if (category === query) score += 40;
        else if (category.includes(query)) score += 25;

        // Description match
        if (description.includes(query)) score += 5;

        return { ...product, score } as ScoredProduct;
      })
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    return scored;
  }, [products, deferredLocalValue]);

  const showDropdown = isOpen && localValue.trim().length > 0;

  return (
    <div
      ref={containerRef}
      className={cn("relative z-[90] w-full overflow-hidden", className)}
    >
      {/* Search Input Container */}
      <div
        className={cn(
          "absolute inset-0 bg-white shadow-xs border border-zinc-200/90 rounded-full transition-all duration-300",
          showDropdown ? "shadow-md border-zinc-900 scale-[1.01]" : "",
        )}
      />

      <div
        className={cn(
          "relative flex items-center h-10 transition-all duration-200",
          showDropdown ? "z-[60]" : "z-10",
        )}
      >
        <Search
          className={cn(
            "absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 transition-all duration-200 z-30",
            showDropdown ? "text-zinc-900 scale-110" : "text-zinc-400",
          )}
        />

        <Input
          ref={inputRef}
          id="global-search"
          name="search"
          value={localValue}
          onFocus={() => {
            if (localValue.trim().length > 0) setIsOpen(true);
          }}
          onChange={(e) => {
            const val = e.target.value;
            setLocalValue(val);
            setIsOpen(val.trim().length > 0);
          }}
          onKeyDown={handleKeyDown}
          aria-label="Buscar produtos"
          title="Buscar produtos"
          className="relative pl-12 pr-10 border-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 h-full text-sm font-bold tracking-tight text-zinc-900 placeholder:font-medium placeholder:text-zinc-500 rounded-full z-20 bg-transparent focus:outline-none focus:ring-0 focus-visible:outline-none"
          placeholder={placeholder}
          autoComplete="off"
        />

        {localValue && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 z-30 flex size-5 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition-all hover:bg-zinc-900 hover:text-white active:scale-90"
            aria-label="Limpar busca"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      {/* Instant Predictive Search Floating Dropdown - ONLY SHOWS WHEN TYPING (localValue > 0) */}
      {showDropdown && (
        <>
          {/* Backdrop Blur Overlay - Starts BELOW Header so top bar stays pure clean white */}
          <button
            type="button"
            aria-label="Fechar busca"
            onClick={() => setIsOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape" || e.key === " ") {
                setIsOpen(false);
              }
            }}
            className="fixed inset-x-0 bottom-0 top-[calc(var(--header-height)+var(--safe-area-top))] z-[80] bg-black/25 backdrop-blur-xs animate-in fade-in duration-200 cursor-default border-none p-0 w-full text-left"
          />

          {/* Floating Solid White Card directly under Search Input */}
          <div className="fixed inset-x-0 top-[calc(var(--header-height)+6px)] z-[100] mx-auto w-[calc(100vw-24px)] max-w-lg max-h-[72vh] overflow-y-auto rounded-[28px] border border-zinc-200/90 bg-white p-4 sm:p-5 shadow-[0_30px_70px_-15px_rgba(0,0,0,0.35)] animate-in fade-in slide-in-from-top-2 duration-200">
            {/* 1. PREDICTIVE AUTOCOMPLETE TERMS */}
            {predictedTerms.length > 0 && (
              <div className="mb-4 border-b border-zinc-100 pb-3">
                <div className="mb-2 flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-amber-500" />
                  <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">
                    Sugestões de Busca
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {predictedTerms.map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => handleSuggestionClick(term)}
                      className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-bold text-zinc-800 transition-all hover:border-zinc-900 hover:bg-zinc-900 hover:text-white active:scale-95 shadow-2xs"
                    >
                      <Search className="size-3 opacity-60" />
                      <span>{term}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 2. MATCHING CATEGORIES BADGES */}
            {matchingCategories.length > 0 && (
              <div className="mb-4 border-b border-zinc-100 pb-3">
                <div className="mb-2 flex items-center gap-1.5">
                  <Tag className="size-3.5 text-primary" />
                  <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">
                    Categorias Encontradas
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {matchingCategories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => handleSuggestionClick(cat)}
                      className="flex items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-bold text-primary transition-all hover:bg-primary hover:text-white active:scale-95 shadow-2xs"
                    >
                      <Tag className="size-3" />
                      <span>{cat}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 3. PRODUCT RESULTS */}
            <div>
              <div className="mb-2.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Search className="size-3.5 text-zinc-700" />
                  <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">
                    Produtos ({searchResults.length})
                  </span>
                </div>
              </div>

              {searchResults.length > 0 ? (
                <div className="divide-y divide-zinc-100">
                  {searchResults.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSuggestionClick(item.name, item.id)}
                      className="group flex w-full items-center justify-between py-2.5 px-2 text-left transition-colors hover:bg-zinc-50 rounded-xl"
                    >
                      <div className="flex items-center gap-3.5 min-w-0 pr-2">
                        <div className="relative flex-shrink-0 size-12 overflow-hidden rounded-xl border border-zinc-200/80 bg-zinc-100 shadow-2xs">
                          <img
                            src={
                              item.images[0] ||
                              "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&q=80&w=100"
                            }
                            alt={item.name}
                            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                            loading="lazy"
                          />
                          {item.isBestseller && (
                            <span className="absolute top-0.5 right-0.5 size-2.5 rounded-full bg-amber-500 ring-2 ring-white" />
                          )}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-[9px] font-extrabold uppercase tracking-wider text-zinc-400 truncate">
                            {item.category}
                          </span>
                          <span className="text-xs font-bold text-zinc-900 truncate group-hover:text-primary transition-colors">
                            {item.name}
                          </span>
                          <span className="text-xs font-black text-zinc-800">
                            R$ {item.price.toFixed(2)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <ArrowRight className="size-4 text-zinc-400 transition-transform group-hover:translate-x-1 group-hover:text-zinc-900" />
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center">
                  <p className="text-xs font-bold text-zinc-700">
                    Nenhum produto encontrado para "{localValue}"
                  </p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Tente pesquisar por categorias ou termos mais genéricos.
                  </p>
                </div>
              )}
            </div>

            {/* 4. ACTION BANNER FOR FULL SEARCH RESULTS */}
            <div className="mt-3 pt-2.5 border-t border-zinc-100">
              <button
                type="button"
                onClick={() => {
                  haptic.medium();
                  onChange(localValue);
                  setIsOpen(false);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 py-3 px-4 text-xs font-bold text-white transition-all hover:bg-zinc-800 active:scale-[0.98] shadow-md"
              >
                <Search className="size-3.5" />
                <span>Ver todos os resultados para "{localValue}"</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
