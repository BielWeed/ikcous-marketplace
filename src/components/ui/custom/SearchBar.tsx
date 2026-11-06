import { Button } from "@/components/ui/button";
import { LimiteDePedaco } from "@/components/ui/custom/LimiteDePedaco";
import { Input } from "@/components/ui/input";
import { useStore } from "@/contexts/StoreContext";
import { useAlturaDoTeclado } from "@/hooks/useAlturaDoTeclado";
import { useCategories } from "@/hooks/useCategories";
import { useProducts } from "@/hooks/useProducts";
import {
  formaAparece,
  palavrasDaBusca,
  pontuadorDaBusca,
  produtoCombinaComBusca,
} from "@/lib/busca-de-produtos";
import { miniaturaDaSugestao, usarImagemOriginal } from "@/lib/imageUrl";
import { precoDeVitrine } from "@/lib/preco-de-vitrine";
import { cn, formatCurrency, normalizeText } from "@/lib/utils";
import type { Product } from "@/types";
import { haptic } from "@/utils/haptic";
import { ArrowRight, Search, Sparkles, Tag, X } from "lucide-react";
import {
  Suspense,
  lazy,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// A caixinha só precisa do desenho da categoria quando há categoria na resposta: carregado sob demanda.
const IconeDaCategoriaBuscada = lazy(() =>
  import("./IconeDaCategoriaBuscada").then((m) => ({
    default: m.IconeDaCategoriaBuscada,
  })),
);

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

/** A categoria tem todas as palavras da busca (qualquer forma: "anel" -> "Anéis")? */
const categoriaCombina = (
  categoria: string,
  palavras: ReturnType<typeof palavrasDaBusca>,
): boolean => {
  const texto = normalizeText(categoria);
  return (
    palavras.length > 0 &&
    palavras.every((formas) => formas.some((f) => formaAparece(texto, f)))
  );
};

/**
 * O nome da categoria COMEÇA com o que se digitou (autocompletar)? Para uma
 * palavra só, vale também o plural irregular ("anel" -> "Anéis"); a forma de
 * palavra inteira não pode ser só o começo de outra ("cases" não sugere "Casa").
 */
const categoriaComecaCom = (
  categoria: string,
  query: string,
  palavras: ReturnType<typeof palavrasDaBusca>,
): boolean => {
  const texto = normalizeText(categoria);
  if (texto.startsWith(query)) return true;
  if (palavras.length !== 1) return false;
  return palavras[0].some(
    (f) =>
      texto.startsWith(f.texto) &&
      !(f.palavraInteira && /[a-z0-9]/.test(texto.charAt(f.texto.length))),
  );
};

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
  const { altura: teclado, alturaVisivel } = useAlturaDoTeclado();
  const inputRef = useRef<HTMLInputElement>(null);
  const { products } = useProducts();
  // Catálogo ainda carregando ou que falhou de vez: "nenhum produto" seria
  // mentira (mesma régua da tela /search).
  const { loadingProducts, catalogoErro, fetchProducts } = useStore();
  const [tentandoBusca, setTentandoBusca] = useState(false);
  const tentarBusca = async () => {
    if (tentandoBusca) return;
    setTentandoBusca(true);
    try {
      await fetchProducts();
    } finally {
      setTentandoBusca(false);
    }
  };

  // Categoria que a lojista escondeu não é sugerida (mesma régua da tela
  // /search: minúscula, sem espaço nas pontas). Só tira o que sabe estar
  // escondido: se a lista de categorias ainda não chegou, nada sai.
  const { categories } = useCategories();
  const escondidas = useMemo(
    () =>
      new Set(
        categories
          .filter((c) => !c.isActive)
          .map((c) => c.name.toLowerCase().trim()),
      ),
    [categories],
  );

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

  // O foco do campo abre a caixa quando ha texto; ao devolver o foco a ele
  // depois de um Esc, esse foco nao pode reabri-la.
  const focoDevolvido = useRef(false);

  // Esc com o foco em qualquer ponto da busca (uma sugestao, o X, o veu) fecha
  // a caixa e volta ao campo. So o campo e o veu tratavam Esc: quem navegava
  // por Tab ate uma sugestao nao tinha como sair pelo teclado. O proprio campo
  // ja trata o Esc (tira o foco dele), entao fica de fora.
  const showDropdown = isOpen && localValue.trim().length > 0;
  useEffect(() => {
    if (!showDropdown) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const alvo = event.target as Node | null;
      if (!alvo || !containerRef.current?.contains(alvo)) return;
      if (alvo === inputRef.current) return;
      setIsOpen(false);
      focoDevolvido.current = true;
      inputRef.current?.focus();
      focoDevolvido.current = false;
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [showDropdown]);

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
    const palavras = palavrasDaBusca(query);

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

      // Category match (prefixo, como as palavras do nome; o plural irregular
      // entra: "anel" sugere "Anéis")
      if (
        categoriaComecaCom(p.category, query, palavras) &&
        !escondidas.has(p.category.toLowerCase().trim())
      ) {
        termSet.add(p.category);
      }
    });

    // Etiquetas (`tags`) NAO sugerem termo: a lista nunca as procurou, entao
    // a sugestao levaria a "nenhum produto". Pelo mesmo motivo, so fica o
    // termo que a regra unica da busca acha em algum produto a venda (o termo
    // vira a busca ao toque; palavra de nome com hifen, por exemplo, perde o
    // hifen aqui e deixaria de achar o proprio produto).
    return Array.from(termSet)
      .filter((termo) =>
        products.some((p) => p.isActive && produtoCombinaComBusca(p, termo)),
      )
      .slice(0, 4);
  }, [products, deferredLocalValue, escondidas]);

  // Matching categories
  const matchingCategories = useMemo<string[]>(() => {
    const query = normalizeText(deferredLocalValue);
    if (!query) return [];
    const palavras = palavrasDaBusca(query);

    const catSet = new Set<string>();
    products.forEach((p) => {
      if (
        p.isActive &&
        categoriaCombina(p.category, palavras) &&
        !escondidas.has(p.category.toLowerCase().trim())
      ) {
        catSet.add(p.category);
      }
    });

    return Array.from(catSet).slice(0, 3);
  }, [products, deferredLocalValue, escondidas]);

  // Produtos que a busca acha, do mais ao menos relevante. QUEM decide se um
  // produto entra e' `produtoCombinaComBusca` -- a mesma regra da lista da
  // Home e da tela /search (todas as palavras, plural, nome/categoria/
  // descricao). A pontuacao aqui so ORDENA; nao decide quem entra.
  const allResults = useMemo<ScoredProduct[]>(() => {
    const query = normalizeText(deferredLocalValue);
    if (!query) return [];
    const pontuar = pontuadorDaBusca(query);

    return products
      .filter(
        (product) => product.isActive && produtoCombinaComBusca(product, query),
      )
      .map((product) => ({ ...product, score: pontuar(product) }))
      .sort((a, b) => b.score - a.score);
  }, [products, deferredLocalValue]);

  // A caixinha mostra no maximo 6, mas o numero do titulo e' o TOTAL: e' ele
  // que a lista inteira (o "Ver todos os resultados") vai mostrar.
  const searchResults = useMemo(() => allResults.slice(0, 6), [allResults]);

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
            if (focoDevolvido.current) return;
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
          // Laudo 05/09 (onda 3, item invisível): as variantes do anel só
          // para foco visível apagavam a marcação sem repor — mesmo padrão
          // do BottomNav/Header (PR #437, M3): anel visível só para quem
          // navega por teclado.
          // 30/10/2026: no celular, com Voltar + logo + sino ao lado, o campo
          // sobra com ~140px e o texto de apoio saía cortado ("Buscar p"). A
          // reserva da direita (40px) só serve ao X de limpar, que só existe
          // com texto; a da esquerda acompanha o ícone (16 + 16px). O que
          // ainda não couber termina em reticências.
          className={cn(
            "relative z-20 h-full rounded-full border-transparent bg-transparent pl-10 text-sm font-bold tracking-tight text-zinc-900 shadow-none placeholder:font-medium placeholder:text-ellipsis placeholder:text-zinc-500 focus:outline-none focus:ring-0 focus-visible:ring-2 focus-visible:ring-zinc-900/50",
            localValue ? "pr-10" : "pr-3",
          )}
          placeholder={placeholder}
          autoComplete="off"
          // Link colado de 300 letras estourava a caixinha; busca de produto
          // não precisa de mais que isso.
          maxLength={100}
        />

        {localValue && (
          <button
            type="button"
            onClick={handleClear}
            // Laudo 05/09, M4: X de 20px (size-5) era alvo de toque abaixo
            // do mínimo WCAG de 24px — pseudo-elemento invisível amplia a
            // área SEM mudar o visual. Laudo Opus 07/09 (M1): o X mora
            // DENTRO do campo, então o inset horizontal fica em 4px — com
            // 8px a área invadia o input e tocar a borda direita do campo
            // APAGAVA o texto em vez de focar. 20+8=28px de largura,
            // 20+16=36px de altura (mesma grafia do Header).
            className="absolute right-3 z-30 flex size-5 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition-all after:absolute after:-inset-x-1 after:-inset-y-2 after:content-[''] hover:bg-zinc-900 hover:text-white active:scale-90"
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
          <div
            style={
              // O teclado do celular se sobrepõe à página: 72vh passava por
              // baixo dele. Com teclado, o limite é a área visível menos o
              // topo do cartão e uma folga.
              teclado > 0
                ? {
                    maxHeight: `min(72vh, calc(${alturaVisivel}px - var(--header-height) - 18px))`,
                  }
                : undefined
            }
            className="fixed inset-x-0 top-[calc(var(--header-height)+6px)] z-[100] mx-auto max-h-[72vh] w-[calc(100vw-24px)] max-w-lg overflow-y-auto rounded-[28px] border border-zinc-200/90 bg-white p-4 shadow-[0_30px_70px_-15px_rgba(0,0,0,0.35)] duration-200 animate-in fade-in slide-in-from-top-2 sm:p-5"
          >
            {/* 1. PREDICTIVE AUTOCOMPLETE TERMS */}
            {predictedTerms.length > 0 && (
              <div className="mb-4 border-b border-zinc-100 pb-3">
                <div className="mb-2 flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-amber-500" />
                  <span className="text-[10px] font-black uppercase tracking-wider text-zinc-600">
                    Sugestões de Busca
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {predictedTerms.map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => handleSuggestionClick(term)}
                      className="shadow-2xs flex min-h-11 items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-bold text-zinc-800 transition-all hover:border-zinc-900 hover:bg-zinc-900 hover:text-white active:scale-95"
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
                  <span className="text-[10px] font-black uppercase tracking-wider text-zinc-600">
                    Categorias Encontradas
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {matchingCategories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => handleSuggestionClick(cat)}
                      className="shadow-2xs flex min-h-11 items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-bold text-primary transition-all hover:bg-primary hover:text-primary-foreground active:scale-95"
                    >
                      {/* Se o arquivo do desenho não baixa, fica a mesma
                          etiqueta do carregamento: um ícone nunca derruba a
                          busca (nem a tela inteira). */}
                      <LimiteDePedaco
                        fallback={() => <Tag className="size-3" />}
                      >
                        <Suspense fallback={<Tag className="size-3" />}>
                          <IconeDaCategoriaBuscada
                            nome={cat}
                            className="size-3"
                          />
                        </Suspense>
                      </LimiteDePedaco>
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
                  <span className="text-[10px] font-black uppercase tracking-wider text-zinc-600">
                    Produtos ({allResults.length})
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
                            // Miniatura leve (em 3G eram várias fotos grandes
                            // por letra digitada). O mesmo helper alimenta o
                            // useCacheWarmer: a string aquecida é esta.
                            src={
                              item.images[0]
                                ? miniaturaDaSugestao(item.images[0])
                                : "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&q=80&w=100"
                            }
                            onError={(event) =>
                              usarImagemOriginal(
                                event.currentTarget,
                                item.images[0],
                              )
                            }
                            alt={item.name}
                            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                            loading="lazy"
                            decoding="async"
                          />
                          {item.isBestseller && (
                            <span className="absolute right-0.5 top-0.5 size-2.5 rounded-full bg-amber-500 ring-2 ring-white" />
                          )}
                        </div>
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-[10px] font-extrabold uppercase tracking-wider text-zinc-600">
                            {item.category}
                          </span>
                          <span className="truncate text-xs font-bold text-zinc-900 transition-colors group-hover:text-primary">
                            {item.name}
                          </span>
                          <span className="text-xs font-black text-zinc-800">
                            {formatCurrency(precoDeVitrine(item).preco)}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-shrink-0 items-center gap-1.5">
                        <ArrowRight className="size-4 text-zinc-400 transition-transform group-hover:translate-x-1 group-hover:text-zinc-900" />
                      </div>
                    </button>
                  ))}
                </div>
              ) : products.length === 0 &&
                (loadingProducts || tentandoBusca) ? (
                <p
                  role="status"
                  className="py-8 text-center text-xs text-zinc-600"
                >
                  Carregando busca…
                </p>
              ) : products.length === 0 && catalogoErro ? (
                <div role="alert" className="py-8 text-center">
                  <p className="text-xs font-bold text-zinc-700">
                    Não conseguimos carregar a busca agora
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-600">
                    Verifique sua conexão e tente de novo.
                  </p>
                  <Button
                    onClick={() => {
                      void tentarBusca();
                    }}
                    className="mt-3 min-h-11 rounded-2xl text-xs font-bold"
                  >
                    Tentar de novo
                  </Button>
                </div>
              ) : (
                <div className="py-8 text-center">
                  <p className="break-words text-xs font-bold text-zinc-700 [overflow-wrap:anywhere]">
                    Nenhum produto encontrado para "{localValue}"
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-600">
                    Tente pesquisar por categorias ou termos mais genéricos.
                  </p>
                </div>
              )}
            </div>

            {/* 4. ACTION BANNER FOR FULL SEARCH RESULTS */}
            <div className="sticky bottom-0 -mx-4 -mb-4 mt-3 border-t border-zinc-100 bg-white px-4 pb-4 pt-2.5 sm:-mx-5 sm:-mb-5 sm:px-5 sm:pb-5">
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
                <span className="min-w-0 truncate">
                  Ver todos os resultados para "{localValue}"
                </span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
