import { Input } from "@/components/ui/input";
import { useProducts } from "@/hooks/useProducts";
import { cn, normalizeText } from "@/lib/utils";
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
    // BUSCA-010 (#20): compara SEM acento nos dois lados, mas exibe o termo
    // como ele foi cadastrado -- quem digita "alianca" ve "Alianca" sugerido.
    const query = normalizeText(deferredLocalValue);
    if (!query) return [];

    const termSet = new Set<string>();

    products.forEach((p) => {
      if (!p.isActive) return;

      // Extract words from product name
      const words = p.name.split(/\s+/);
      words.forEach((w) => {
        const clean = w.replace(/[^\wÀ-ú]/gi, "").trim();
        const cleanNormalizado = normalizeText(clean);
        if (
          cleanNormalizado.startsWith(query) &&
          cleanNormalizado.length >= query.length
        ) {
          const formatted =
            clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
          termSet.add(formatted);
        }
      });

      // Category match
      if (normalizeText(p.category).startsWith(query)) {
        termSet.add(p.category);
      }

      // Tags match
      (p.tags || []).forEach((t) => {
        if (normalizeText(t).startsWith(query)) {
          termSet.add(t);
        }
      });
    });

    return Array.from(termSet).slice(0, 4);
  }, [products, deferredLocalValue]);

  // Matching categories
  const matchingCategories = useMemo<string[]>(() => {
    const query = normalizeText(deferredLocalValue);
    if (!query) return [];

    const catSet = new Set<string>();
    products.forEach((p) => {
      if (p.isActive && normalizeText(p.category).includes(query)) {
        catSet.add(p.category);
      }
    });

    return Array.from(catSet).slice(0, 3);
  }, [products, deferredLocalValue]);

  // Scored Product Search Results
  const searchResults = useMemo<ScoredProduct[]>(() => {
    const query = normalizeText(deferredLocalValue);
    if (!query) return [];

    const scored = products
      .filter((product) => product.isActive)
      .map((product) => {
        let score = 0;
        const name = normalizeText(product.name);
        // `description` pode vir nula do banco: `.toLowerCase()` direto
        // quebrava a busca inteira aqui. `normalizeText` aguenta nulo.
        const description = normalizeText(product.description);
        const category = normalizeText(product.category);
        const tags = (product.tags || []).map((t) => normalizeText(t));

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
          className="relative z-20 h-full rounded-full border-transparent bg-transparent pl-12 pr-10 text-sm font-bold tracking-tight text-zinc-900 shadow-none placeholder:font-medium placeholder:text-zinc-500 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
          placeholder={placeholder}
          autoComplete="off"
        />

        {localValue && (
          <button
            type="button"
            onClick={handleClear}
            // Laudo 05/09, M4: X de 20px (size-5) era alvo de toque abaixo
            // do mínimo WCAG de 24px — `after:-inset-2` amplia para 36px sem
            // mudar o visual (mesmo truque do X do cupom em CouponInput; o
            // botão já é `absolute`, então o pseudo-elemento ancora nele).
            className="absolute right-3 z-30 flex size-5 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition-all after:absolute after:-inset-2 after:content-[''] hover:bg-zinc-900 hover:text-white active:scale-90"
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
            className="backdrop-blur-xs fixed inset-x-0 bottom-0 top-[calc(var(--header-height)+var(--safe-area-top))] z-[80] w-full cursor-default border-none bg-black/25 p-0 text-left duration-200 animate-in fade-in"
          />

          {/* Floating Solid White Card directly under Search Input */}
          <div className="fixed inset-x-0 top-[calc(var(--header-height)+6px)] z-[100] mx-auto max-h-[72vh] w-[calc(100vw-24px)] max-w-lg overflow-y-auto rounded-[28px] border border-zinc-200/90 bg-white p-4 shadow-[0_30px_70px_-15px_rgba(0,0,0,0.35)] duration-200 animate-in fade-in slide-in-from-top-2 sm:p-5">
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
                      className="shadow-2xs flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-bold text-zinc-800 transition-all hover:border-zinc-900 hover:bg-zinc-900 hover:text-white active:scale-95"
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
                      className="shadow-2xs flex items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-bold text-primary transition-all hover:bg-primary hover:text-white active:scale-95"
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
                      className="group flex w-full items-center justify-between rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-zinc-50"
                    >
                      <div className="flex min-w-0 items-center gap-3.5 pr-2">
                        <div className="shadow-2xs relative size-12 flex-shrink-0 overflow-hidden rounded-xl border border-zinc-200/80 bg-zinc-100">
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
                            <span className="absolute right-0.5 top-0.5 size-2.5 rounded-full bg-amber-500 ring-2 ring-white" />
                          )}
                        </div>
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-[9px] font-extrabold uppercase tracking-wider text-zinc-400">
                            {item.category}
                          </span>
                          <span className="truncate text-xs font-bold text-zinc-900 transition-colors group-hover:text-primary">
                            {item.name}
                          </span>
                          <span className="text-xs font-black text-zinc-800">
                            R$ {item.price.toFixed(2)}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-shrink-0 items-center gap-1.5">
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
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    Tente pesquisar por categorias ou termos mais genéricos.
                  </p>
                </div>
              )}
            </div>

            {/* 4. ACTION BANNER FOR FULL SEARCH RESULTS */}
            <div className="mt-3 border-t border-zinc-100 pt-2.5">
              <button
                type="button"
                onClick={() => {
                  haptic.medium();
                  onChange(localValue);
                  setIsOpen(false);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 px-4 py-3 text-xs font-bold text-white shadow-md transition-all hover:bg-zinc-800 active:scale-[0.98]"
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
