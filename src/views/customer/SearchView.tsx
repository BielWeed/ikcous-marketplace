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
import { useCategories } from "@/hooks/useCategories";
import { useFavorites } from "@/hooks/useFavorites";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { useProducts } from "@/hooks/useProducts";
import {
  type FiltrosDaBusca,
  type QuantidadeDaBusca,
  useSearch,
} from "@/hooks/useSearch";
import { useVoltarFechaAFolha } from "@/hooks/useVoltarFechaAFolha";
import { promessasDeFrete } from "@/lib/estrategias-de-frete";
import { produtoDisponivel } from "@/lib/vitrine";
import type { Product, View } from "@/types";
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
  /** Avisa quem montou a tela que o termo de busca mudou — sem isso, quem
   * segura a cópia "dona" do termo (a barra do Header) nunca fica sabendo
   * que o "Limpar Tudo" do estado vazio zerou a busca aqui dentro. */
  onQueryChange?: (query: string) => void;
  /** O carrinho do App (mesma função que a Home recebe). Sem ela os cards
   * ficam sem como adicionar: viram "Ver produto" em vez de fingir que
   * adicionaram. */
  onAddToCart?: (
    product: Product,
    quantity?: number,
    variantId?: string,
    variantNames?: string,
  ) => unknown;
  /** Categoria, ordem e faixa de preço que o App guardou da última visita a
   * esta tela (ela é desmontada ao abrir um produto). Só vale ao montar. */
  filtrosIniciais?: FiltrosDaBusca;
  /** Avisa o App a cada mudança dos filtros, para ele guardá-los. */
  aoMudarFiltros?: (filtros: FiltrosDaBusca) => void;
  /** Quantos resultados a tela já mostrava na última visita (só vale ao montar,
   * e só se o termo for o mesmo): sem isto a lista volta com 12 e a rolagem
   * guardada pelo App cai numa lista curta. */
  quantidadeInicial?: QuantidadeDaBusca;
  /** Avisa o App a cada mudança da quantidade (ou do termo), para guardá-la. */
  aoMudarQuantidade?: (quantidade: QuantidadeDaBusca) => void;
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
        // A tecla do teclado do celular vira "buscar": aplica o termo na hora
        // (sem esperar os 300 ms) e tira o foco, que fecha o teclado e deixa os
        // resultados à vista (a barra do topo já faz o mesmo).
        enterKeyHint="search"
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          onChange(localValue);
          e.currentTarget.blur();
        }}
        placeholder="O que você deseja hoje?"
        aria-label="Buscar produtos"
        className="h-12 rounded-2xl border-zinc-100 bg-zinc-50 pl-11 pr-4 text-sm text-zinc-900 transition-all placeholder:text-zinc-500 focus:border-zinc-200 focus:ring-black/5"
      />
    </div>
  );
});

export const SearchView = React.memo(function SearchView({
  onNavigate,
  initialQuery = "",
  onBack,
  selectedProductId,
  onQueryChange,
  onAddToCart,
  filtrosIniciais,
  aoMudarFiltros,
  quantidadeInicial,
  aoMudarQuantidade,
}: SearchViewProps) {
  const { config, catalogoErro, loadingProducts, fetchProducts } = useStore();
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
  // B3 do item 2 da fila (19/09): o selo "Frete Grátis" do card obedece ao
  // preset da LOJA (ProductCard-520), derivado do MESMO config que já
  // alimentava `showRating` — mesmo padrão do ProductView.
  const promessasDaLoja = useMemo(() => promessasDeFrete(config), [config]);
  const { prefetchView } = usePrefetchOnHover();
  const { products: allProducts } = useProducts();
  const { categories, isLoading: carregandoCategorias } = useCategories();
  // O catálogo da dona da loja inclui pausados. A busca, a contagem e as
  // categorias precisam mostrar só o que está à venda, como a vitrine.
  const produtosAVenda = useMemo(
    () => allProducts.filter((p) => p.isActive),
    [allProducts],
  );
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
  } = useSearch(
    produtosAVenda,
    {
      iniciais: filtrosIniciais,
      aoMudar: aoMudarFiltros,
      termoInicial: initialQuery,
    },
    {
      carregando: loadingProducts || carregandoCategorias,
      categorias: categories,
    },
  );

  const { isFavorite, toggleFavorite } = useFavorites();
  const handleProductClick = useCallback(
    (id: string) => {
      onNavigate("product-detail", id);
    },
    [onNavigate],
  );

  // Mesmos dois caminhos da Home. O card chama `onAddToCart(produto, clique)`:
  // o invólucro entrega só o produto — o clique no lugar de `quantity` viraria
  // quantidade. Com opções (tamanho/cor), o card abre a folha e entrega
  // variação + quantidade escolhidas.
  const handleAddToCart = useCallback(
    (product: Product) => onAddToCart?.(product),
    [onAddToCart],
  );
  const handleAddToCartWithVariants = useCallback(
    (
      product: Product,
      variantId: string | undefined,
      variantNames: string,
      quantity = 1,
    ) => {
      return onAddToCart?.(product, quantity, variantId, variantNames);
    },
    [onAddToCart],
  );

  const handlePrefetchProductDetail = useCallback(() => {
    prefetchView("product-detail");
  }, [prefetchView]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  // O Voltar do aparelho fecha só a folha de filtros (a busca e o que foi
  // escolhido ficam), em vez de tirar a cliente da busca.
  useVoltarFechaAFolha(isFilterOpen, () => {
    setIsFilterOpen(false);
  });
  // A quantidade guardada só vale para o MESMO termo; não é cortada pelo total
  // aqui porque a lista pode ainda não ter chegado (cortar em 0 apagaria o que
  // foi guardado). O `slice` já mostra só o que existe.
  const [visibleCount, setVisibleCount] = useState(() =>
    quantidadeInicial && quantidadeInicial.termo === initialQuery
      ? Math.max(12, quantidadeInicial.quantidade)
      : 12,
  );
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

  // Reset pagination when any query filters change. Compara com o desenho
  // anterior em vez de rodar a cada montagem: ao voltar do produto a primeira
  // execução não pode apagar a quantidade restaurada.
  //
  // E leva a página ao topo dos resultados: a lista reordenada/refiltrada volta
  // a ter 12, mas quem tinha rolado várias linhas ficava no meio ou no fim dela,
  // sem ver os primeiros. A rolagem para na borda do cabeçalho fixo (que cobriria
  // o topo da lista), "instant" como na Home ("auto" herdaria o scroll-smooth da
  // tela) e só quando um filtro muda de verdade: carregar mais por rolagem e
  // montar a tela não passam por aqui. (`?.` porque o jsdom não tem `scrollIntoView`.)
  const cabecalhoRef = useRef<HTMLDivElement | null>(null);
  const resultadosRef = useRef<HTMLDivElement | null>(null);
  const filtrosAnterioresRef = useRef({
    query,
    category,
    minPrice,
    maxPrice,
    sort,
  });
  useEffect(() => {
    const antes = filtrosAnterioresRef.current;
    if (
      antes.query !== query ||
      antes.category !== category ||
      antes.minPrice !== minPrice ||
      antes.maxPrice !== maxPrice ||
      antes.sort !== sort
    ) {
      setVisibleCount(12);
      const resultados = resultadosRef.current;
      if (resultados) {
        resultados.style.scrollMarginTop = `${cabecalhoRef.current?.offsetHeight ?? 0}px`;
        resultados.scrollIntoView?.({ block: "start", behavior: "instant" });
      }
    }
    filtrosAnterioresRef.current = {
      query,
      category,
      minPrice,
      maxPrice,
      sort,
    };
  }, [query, category, minPrice, maxPrice, sort]);

  // Guarda no App o que já foi carregado (o aviso pode ser função nova a cada
  // render do pai, então fica fora das dependências — como em useSearch).
  const aoMudarQuantidadeRef = useRef(aoMudarQuantidade);
  useEffect(() => {
    aoMudarQuantidadeRef.current = aoMudarQuantidade;
  });
  useEffect(() => {
    aoMudarQuantidadeRef.current?.({ termo: query, quantidade: visibleCount });
  }, [query, visibleCount]);
  // Get trending products for empty state (prioritizing available products).
  // Defeito irmão do da prova de rua (01/09, sugestões de favoritos): para o
  // dono da loja (admin) a lista carrega o catálogo inteiro — trending só
  // sugere produto ATIVO, pausado não é vitrine nem aqui.
  const trendingProducts = useMemo(() => {
    return [...produtosAVenda]
      .sort((a, b) => {
        const aAvailable = produtoDisponivel(a) ? 1 : 0;
        const bAvailable = produtoDisponivel(b) ? 1 : 0;
        return bAvailable - aAvailable;
      })
      .slice(0, 4);
  }, [produtosAVenda]);

  // Categorias dos filtros: as dos produtos à venda, menos as que a lojista
  // escondeu (a Home só mostra as ativas). Só tira o que sabe estar escondido:
  // se a lista de categorias não chegou, os filtros seguem como eram.
  const escondidas = new Set(
    categories
      .filter((c) => !c.isActive)
      .map((c) => c.name.toLowerCase().trim()),
  );
  const categoriesSet = [
    "Todas",
    ...Array.from(new Set(produtosAVenda.map((p) => p.category))).filter(
      (nome) => !escondidas.has(nome.toLowerCase().trim()),
    ),
  ];

  // Só filtros — categoria, preço e ordenação. É o handler do "Limpar Tudo"
  // do painel "Refinar Busca", e o trabalho dele sempre foi esse: preservar
  // o termo digitado (BUSCA-011).
  const handleClearFilters = useCallback(() => {
    setCategory("Todas");
    setMinPrice("");
    setMaxPrice("");
    setSort("newest");
  }, [setCategory, setMinPrice, setMaxPrice, setSort]);

  // Filtros E termo — é o handler do "Limpar Tudo" do estado vazio ("Ué,
  // nenhum resultado?"). Avisa o pai (onQueryChange) porque a cópia "dona"
  // do termo mora fora desta tela, na barra de busca do Header.
  const handleClearSearch = useCallback(() => {
    handleClearFilters();
    setQuery("");
    onQueryChange?.("");
  }, [handleClearFilters, setQuery, onQueryChange]);

  // A caixa desta página e a barra do topo são o MESMO termo: digitar aqui
  // avisa o App, e o que o App devolve (initialQuery) volta para cá.
  const mudarTermo = useCallback(
    (termo: string) => {
      setQuery(termo);
      onQueryChange?.(termo);
    },
    [setQuery, onQueryChange],
  );

  // Initialize query from props if needed. Termo que já é o desta caixa (o eco
  // do que foi digitada aqui) não mexe nos filtros: só o topo esvaziar o termo
  // zera os filtros, como sempre.
  const queryRef = useRef(query);
  queryRef.current = query;
  useEffect(() => {
    if (initialQuery !== undefined && initialQuery !== queryRef.current) {
      setQuery(initialQuery);
      if (!initialQuery) {
        handleClearFilters();
      }
    }
  }, [initialQuery, setQuery, handleClearFilters]);

  const activeFiltersCount =
    (category !== "Todas" ? 1 : 0) +
    (minPrice !== "" ? 1 : 0) +
    (maxPrice !== "" ? 1 : 0) +
    // "Mais Novos" é o padrão (useSearch): ordenação diferente conta e libera
    // o "Limpar Tudo", que a devolve ao padrão.
    (sort !== "newest" ? 1 : 0);

  return (
    <div className="pb-customer min-h-full bg-white selection:bg-black selection:text-white">
      {/* Premium Sticky Search Header */}
      <div
        ref={cabecalhoRef}
        className="sticky top-[-2px] z-50 border-b border-zinc-100 bg-white/90 backdrop-blur-2xl"
      >
        <div className="mx-auto max-w-7xl space-y-4 p-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              // Laudo 05/09, M5: botão de voltar só-ícone era "botão" para
              // o leitor de tela — sem nome, voltar ficava sem significado.
              aria-label="Voltar"
              className="flex size-11 items-center justify-center rounded-2xl border border-zinc-100 bg-zinc-50 transition-all hover:bg-zinc-100 active:scale-90"
            >
              <ArrowLeft className="size-5 text-zinc-900" />
            </button>
            <SearchInput value={query} onChange={mudarTermo} />
          </div>

          {/* Quick Filters - Pill Style */}
          <div className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-1">
            <Sheet open={isFilterOpen} onOpenChange={setIsFilterOpen}>
              <SheetTrigger asChild>
                <button className="flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full bg-primary px-4 py-2 text-[10px] font-black uppercase tracking-widest text-primary-foreground shadow-xl shadow-black/10 transition-all hover:bg-primary/90 active:scale-95">
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
                        className="-mr-2 min-h-11 px-2 text-[10px] font-black uppercase tracking-widest text-red-500"
                      >
                        Limpar Tudo
                      </button>
                    )}
                  </div>
                </SheetHeader>

                <div className="space-y-8 pb-10">
                  <div>
                    <p className="mb-4 text-[10px] font-black uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
                      Categorias
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {categoriesSet.map((catName) => (
                        <button
                          key={catName}
                          onClick={() => setCategory(catName)}
                          aria-pressed={category === catName}
                          className={`min-h-11 rounded-2xl border px-5 py-2.5 text-[11px] font-bold transition-all ${
                            category === catName
                              ? "scale-105 border-primary bg-primary text-primary-foreground shadow-lg shadow-black/10"
                              : "border-zinc-100 bg-zinc-50 text-zinc-600 hover:border-zinc-300"
                          }`}
                        >
                          {catName}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-4 text-[10px] font-black uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
                      Ordenação
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: "Menor Preço", value: "price_asc" },
                        { label: "Maior Preço", value: "price_desc" },
                        {
                          label: query.trim() ? "Relevância" : "Mais Novos",
                          value: "newest",
                        },
                        { label: "Alfabética", value: "name_asc" },
                      ].map((option) => (
                        <button
                          key={option.value}
                          onClick={() => setSort(option.value as any)}
                          aria-pressed={sort === option.value}
                          className={`min-h-11 rounded-2xl border px-4 py-3 text-[11px] font-bold transition-all ${
                            sort === option.value
                              ? "border-primary bg-primary text-primary-foreground"
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
                    className="h-14 w-full rounded-2xl bg-primary text-xs font-black uppercase tracking-widest text-primary-foreground shadow-2xl shadow-black/10 transition-all hover:bg-primary/90"
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
                aria-pressed={category === catName}
                className={`min-h-11 whitespace-nowrap rounded-full border px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-all ${
                  category === catName
                    ? "border-primary bg-primary text-primary-foreground"
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
      <div ref={resultadosRef} className="mx-auto max-w-7xl px-4 py-8">
        {loadingProducts || tentandoBusca ? (
          <p role="status" className="py-20 text-center text-sm text-zinc-500">
            Carregando busca…
          </p>
        ) : catalogoErro && allProducts.length === 0 ? (
          <div role="alert" className="py-20 text-center">
            <h2 className="text-xl font-black text-zinc-900">
              Não conseguimos carregar a busca agora
            </h2>
            <p className="mt-2 text-sm text-zinc-500">
              Verifique sua conexão e tente de novo.
            </p>
            <Button
              onClick={() => {
                void tentarBusca();
              }}
              className="mt-6"
            >
              Tentar de novo
            </Button>
          </div>
        ) : filteredProducts.length > 0 ? (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <div role="status" className="flex items-center gap-2">
                <Sparkles className="size-4 text-zinc-900" />
                <h2 className="text-xl font-black tracking-tighter">
                  Encontramos {totalResults}{" "}
                  {totalResults === 1 ? "resultado" : "resultados"}
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
                    onAddToCart={onAddToCart ? handleAddToCart : undefined}
                    onAddToCartWithVariants={
                      onAddToCart ? handleAddToCartWithVariants : undefined
                    }
                    showRating={config.enableReviews}
                    promessasDeFrete={promessasDaLoja}
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
              {produtosAVenda.length === 0 ? (
                /* Loja sem produto à venda: ninguém buscou nada que desse
                   para "limpar" -- a Home já separa os dois casos. */
                <>
                  <h2 className="text-2xl font-black tracking-tighter text-zinc-900">
                    A loja ainda não tem produtos
                  </h2>
                  <p className="mt-2 text-xs font-medium leading-relaxed text-zinc-600">
                    Volte em breve.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-black tracking-tighter text-zinc-900">
                    Ué, nenhum resultado?
                  </h2>
                  <p className="mt-2 text-xs font-medium leading-relaxed text-zinc-600">
                    Não encontramos o que você buscou com esses filtros.
                    {trendingProducts.length > 0 && (
                      <>
                        <br />
                        <span className="font-black text-zinc-900">
                          Que tal dar uma olhada em alguns produtos da loja?
                        </span>
                      </>
                    )}
                  </p>
                  <Button
                    variant="outline"
                    onClick={handleClearSearch}
                    className="mt-8 h-12 rounded-2xl border-zinc-200 px-8 text-xs font-black uppercase tracking-widest text-zinc-900"
                  >
                    Limpar Tudo
                  </Button>
                </>
              )}
            </div>

            {/* Sugestões: são só 4 produtos da loja (os com estoque primeiro) --
                UI-191 (G7): nada de "Editor's Choice"/"Trending", que afirmam
                curadoria e tendência que a loja não mediu, e em inglês.
                Sem produto à venda o bloco não existe (como nos Favoritos). */}
            {trendingProducts.length > 0 && (
              <div className="border-t border-zinc-100 pt-10">
                <div className="mb-10 flex flex-col items-center text-center">
                  <span className="mb-2 text-xs font-black uppercase tracking-[0.3em] text-zinc-600">
                    Sugestões
                  </span>
                  <h3 className="text-2xl font-black tracking-tighter text-zinc-900">
                    {/* Nome do banco primeiro, branding.json como fallback —
                        mesma preferência do Header e da Home. */}
                    Alguns produtos da{" "}
                    {config.storeName?.trim() || branding.appName}
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
                      onAddToCart={onAddToCart ? handleAddToCart : undefined}
                      onAddToCartWithVariants={
                        onAddToCart ? handleAddToCartWithVariants : undefined
                      }
                      showRating={config.enableReviews}
                      promessasDeFrete={promessasDaLoja}
                      onMouseEnter={handlePrefetchProductDetail}
                      onTouchStart={handlePrefetchProductDetail}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
