import { BannerCarousel } from "@/components/ui/custom/BannerCarousel";
import { CategoryFilter } from "@/components/ui/custom/CategoryFilter";
import { useStore } from "@/contexts/StoreContext";
import { useBanners } from "@/hooks/useBanners";
import { useCategories } from "@/hooks/useCategories";
import { cn, normalizeText } from "@/lib/utils";
import { ordenarParaVitrine } from "@/lib/vitrine";
import type { Product, SortOption, View } from "@/types";
import {
  ArrowDown,
  ArrowUp,
  Clock,
  PackageSearch,
  SlidersHorizontal,
  TrendingUp,
} from "lucide-react";
import React, { useState, useMemo } from "react";

import { FreeShippingBlock } from "@/components/ui/custom/FreeShippingBlock";
import { InfoBlockCarousel } from "@/components/ui/custom/InfoBlockCarousel";
import { PremiumOffers } from "@/components/ui/custom/PremiumOffers";
import { ProductCarousel } from "@/components/ui/custom/ProductCarousel";
import { ProductList } from "@/components/ui/custom/ProductList";
import { branding } from "@/config/branding";
import { LIMITE_MAX_ITENS_CARROSSEL } from "@/config/carrossel";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { haptic } from "@/utils/haptic";

interface HomeViewProps {
  products: Product[];
  favorites: string[];
  onToggleFavorite: (product: Product) => void;
  onProductClick: (productId: string) => void;
  onNavigate: (view: View) => void;
  searchQuery: string;
  onAddToCart?: (
    product: Product,
    quantity?: number,
    variantId?: string,
  ) => void;
  onQuickBuy?: (product: Product, variantId?: string) => void;
  isLoading?: boolean;
  scrollProgress?: number;
  selectedProductId?: string;
  selectedCategory: string;
  onCategoryChange: (category: string) => void;
  sortBy: SortOption;
  onSortByChange: (sort: SortOption) => void;
  onHeaderDockChange?: (isDocked: boolean) => void;
}

export const HomeView = React.memo(function HomeView({
  products,
  favorites,
  onToggleFavorite,
  onProductClick,
  onNavigate,
  searchQuery,
  onAddToCart,
  onQuickBuy,
  isLoading = false,
  scrollProgress = 0,
  selectedProductId,
  selectedCategory,
  onCategoryChange,
  sortBy,
  onSortByChange,
  onHeaderDockChange,
}: HomeViewProps) {
  const { config } = useStore();
  const [showSortMenu, setShowSortMenu] = useState(false);
  const { categories, isLoading: isLoadingCategories } = useCategories();
  const { getBannersByPosition, isLoaded: bannersLoaded } = useBanners();
  const sentinelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!onHeaderDockChange) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const scrollContainer = sentinel.closest("main") || null;
    if (!scrollContainer) return;

    let isDocked = false;

    const checkDock = () => {
      const sentinelRect = sentinel.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();

      // Sentinel is docked if its top coordinate is less than or equal to the container's top coordinate
      const currentlyDocked = sentinelRect.top <= containerRect.top;

      if (currentlyDocked !== isDocked) {
        isDocked = currentlyDocked;
        onHeaderDockChange(currentlyDocked);
      }
    };

    // Check initial layout docking state
    checkDock();

    scrollContainer.addEventListener("scroll", checkDock, { passive: true });
    globalThis.addEventListener("resize", checkDock);

    return () => {
      scrollContainer.removeEventListener("scroll", checkDock);
      globalThis.removeEventListener("resize", checkDock);
    };
  }, [onHeaderDockChange]);

  const topBanners = getBannersByPosition("home_top");
  const middleBanners = getBannersByPosition("home_middle");
  const bottomBanners = getBannersByPosition("home_bottom");

  // Removed derived uniqueCategories logic in favor of useCategories hook

  // A lojista pausa um produto para tirá-lo da prateleira (`ativo = false` no
  // banco). Sem este filtro ele continua na vitrine, com preço e estoque, dando
  // para clicar -- e a MESMA tela já se contradiz, porque a busca
  // (SearchBar.tsx:119 e :173) sempre filtrou. Um ponto só: as listas abaixo
  // derivam desta, então nenhuma pode esquecer o filtro.
  const produtosAVenda = useMemo(
    () => products.filter((p) => p.isActive),
    [products],
  );

  const filteredProducts = useMemo(() => {
    // Precise filtering logic
    let result = [...produtosAVenda];

    // Filter by category
    if (selectedCategory && selectedCategory !== "Todas") {
      result = result.filter(
        (p) =>
          p.category.toLowerCase().trim() ===
          selectedCategory.toLowerCase().trim(),
      );
    }

    // Filter by search query
    if (searchQuery.trim()) {
      // Os DOIS lados normalizados (BUSCA-010, #20). `description` pode vir
      // nula do banco; `normalizeText` aguenta.
      const query = normalizeText(searchQuery);
      result = result.filter(
        (p) =>
          normalizeText(p.name).includes(query) ||
          normalizeText(p.description).includes(query) ||
          normalizeText(p.category).includes(query),
      );
    }

    // Sort with availability (in-stock first) prioritization, preserving sort order
    result.sort((a, b) => {
      const aAvailable = a.stock > 0 ? 1 : 0;
      const bAvailable = b.stock > 0 ? 1 : 0;
      if (aAvailable !== bAvailable) {
        return bAvailable - aAvailable;
      }

      switch (sortBy) {
        case "price-asc":
          return a.price - b.price;
        case "price-desc":
          return b.price - a.price;
        case "sold":
          return b.sold - a.sold;
        default:
          return 0;
      }
    });

    if (result.length !== produtosAVenda.length || searchQuery) {
      console.log(
        `[HomeView] Filtered: ${result.length}/${produtosAVenda.length} products`,
      );
    }

    return result;
  }, [produtosAVenda, selectedCategory, searchQuery, sortBy]);

  const newArrivals = useMemo(() => {
    // A ordenação mora em ordenarParaVitrine (src/lib/vitrine.ts) — a MESMA
    // função que o preview do painel usa (item 15 do laudo de 29/08: preview
    // e loja ordenavam diferente). Comportamento byte a byte o de antes.
    return (
      ordenarParaVitrine(produtosAVenda)
        // LIMITE_MAX_ITENS_CARROSSEL, nunca literal: o 6 fixo travava a vitrine
        // abaixo do que o seletor de maxItems promete (defeito 20260825-1050).
        // O corte real por seção continua no render, pelo `max` escolhido.
        .slice(0, LIMITE_MAX_ITENS_CARROSSEL)
    );
  }, [produtosAVenda]);

  const offerProducts = useMemo(() => {
    return produtosAVenda
      .filter((p) => p.originalPrice && p.originalPrice > p.price)
      .sort((a, b) => {
        const aAvailable = a.stock > 0 ? 1 : 0;
        const bAvailable = b.stock > 0 ? 1 : 0;
        return bAvailable - aAvailable;
      })
      .slice(0, LIMITE_MAX_ITENS_CARROSSEL);
  }, [produtosAVenda]);

  const bestsellerProducts = useMemo(() => {
    return produtosAVenda
      .filter((p) => p.isBestseller)
      .sort((a, b) => {
        const aAvailable = a.stock > 0 ? 1 : 0;
        const bAvailable = b.stock > 0 ? 1 : 0;
        return bAvailable - aAvailable;
      })
      .slice(0, LIMITE_MAX_ITENS_CARROSSEL);
  }, [produtosAVenda]);

  const sortOptions: {
    value: SortOption;
    label: string;
    icon: React.ElementType;
  }[] = [
    { value: "default", label: "Relevância", icon: SlidersHorizontal },
    { value: "sold", label: "Mais Vendidos", icon: TrendingUp },
    { value: "price-asc", label: "Menor Preço", icon: ArrowDown },
    { value: "price-desc", label: "Maior Preço", icon: ArrowUp },
  ];

  // A cidade da loja vem do StoreConfig, não do código. `undefined` = a
  // loja ainda não configurou, e o trecho de localização some inteiro — sem
  // vírgula, travessão ou "|" solto no lugar dela.
  const cidadeLoja = config.storeCity
    ? config.storeState
      ? `${config.storeCity}, ${config.storeState}`
      : config.storeCity
    : undefined;

  // "Entrega expressa" saiu: não existe entrega expressa neste app — é a
  // mesma classe de mentira que o PR #225 já tinha tirado do carrinho, só
  // que esta sobreviveu escondida atrás do `cidadeLoja ? ... : ...` (a Tarefa
  // 6 só olhou as linhas 217/222/224 e ninguém reparou nesta). O frete grátis
  // fica: ele é de verdade, configurável, com valor mínimo.
  const homeDescription = cidadeLoja
    ? `Descubra produtos exclusivos com frete grátis em ${cidadeLoja}.`
    : "Descubra produtos exclusivos.";
  // Mesma preferência do Header: o nome que o lojista gravou no banco vem
  // antes do branding.json estático.
  const nomeDaLoja = config.storeName?.trim() || branding.appName;
  const homeSocialTitle = `${nomeDaLoja} - Seu Shopping Local`;
  const homeLogo = `${globalThis.location.origin}/branding/logo.png`;

  useDocumentMeta({
    title: cidadeLoja ? `${nomeDaLoja} | ${cidadeLoja}` : nomeDaLoja,
    names: {
      // "Entrega ultrarrápida" e "troca garantida" saíram: não existe fluxo
      // de troca (issues #46 e #108, ambas abertas) nem entrega ultrarrápida
      // — é a mesma mentira que o PR #225 já tinha tirado do carrinho.
      description: cidadeLoja
        ? `O marketplace online de ${cidadeLoja} - ${nomeDaLoja}`
        : `O marketplace online - ${nomeDaLoja}`,
      "twitter:card": "summary_large_image",
      "twitter:title": homeSocialTitle,
      "twitter:description": homeDescription,
      "twitter:image": homeLogo,
    },
    properties: {
      "og:title": homeSocialTitle,
      "og:description": homeDescription,
      "og:type": "website",
      "og:image": homeLogo,
      "og:url": globalThis.location.origin,
    },
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: nomeDaLoja,
      url: globalThis.location.origin,
      potentialAction: {
        "@type": "SearchAction",
        target: `${globalThis.location.origin}/?search={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
    jsonLdId: "home-structured-data",
  });

  return (
    <div className="pb-customer min-h-full">
      {/* Top Banners - Full Width */}
      {!searchQuery &&
        selectedCategory === "Todas" &&
        (!bannersLoaded && topBanners.length === 0 ? (
          <div className="mb-2 flex h-[200px] w-full animate-pulse items-center justify-center bg-zinc-100 sm:h-[400px]">
            <div className="size-8 animate-spin rounded-full border-4 border-zinc-200 border-t-primary" />
          </div>
        ) : topBanners.length > 0 ? (
          <div className="relative mb-2 w-full">
            <BannerCarousel
              banners={topBanners}
              autoPlay={true}
              interval={5000}
            />

            {/* Premium Info Carousel */}
            <InfoBlockCarousel>
              <FreeShippingBlock onNavigate={onNavigate} />
            </InfoBlockCarousel>
          </div>
        ) : null)}

      {/* Recently Viewed - Removed and moved to Profile */}

      {/* Dynamic Showcases / Carousels */}
      {!searchQuery &&
        selectedCategory === "Todas" &&
        (
          config.homeSections ?? [
            {
              id: "new_arrivals",
              title: "Últimos Lançamentos",
              active: true,
            },
            { id: "offers", title: "Ofertas Imperdíveis", active: true },
            { id: "bestsellers", title: "Destaques em Alta", active: true },
          ]
        ).map((section) => {
          if (!section.active) return null;
          const max = section.maxItems ?? 6;

          let secProducts: typeof products = [];
          if (section.productIds && section.productIds.length > 0) {
            // Um produto pausado escolhido para uma seção configurável também
            // não pode aparecer -- por isso o mapa vem de `produtosAVenda`,
            // não de `products`.
            const productMap = new Map(produtosAVenda.map((p) => [p.id, p]));
            secProducts = section.productIds
              .map((id) => productMap.get(id))
              .filter((p): p is (typeof products)[0] => Boolean(p))
              .slice(0, max);
          } else if (section.id === "offers") {
            secProducts = offerProducts.slice(0, max);
          } else if (section.id === "bestsellers") {
            secProducts = bestsellerProducts.slice(0, max);
          } else {
            secProducts = newArrivals.slice(0, max);
          }

          if (secProducts.length === 0) return null;

          if (section.id === "offers") {
            return (
              <PremiumOffers
                key={section.id}
                title={section.title}
                products={secProducts}
                favorites={favorites}
                onToggleFavorite={onToggleFavorite}
                onProductClick={onProductClick}
                onAddToCart={onAddToCart}
                onQuickBuy={onQuickBuy}
              />
            );
          }

          return (
            <ProductCarousel
              key={section.id}
              title={section.title}
              products={secProducts}
              favorites={favorites}
              onToggleFavorite={onToggleFavorite}
              onProductClick={onProductClick}
              onAddToCart={onAddToCart}
              onQuickBuy={onQuickBuy}
              className={
                section.id === "bestsellers" ? "bg-zinc-50/50" : undefined
              }
              selectedProductId={selectedProductId}
            />
          );
        })}

      {/* Middle Banners - Full Width */}
      {!searchQuery &&
        selectedCategory === "Todas" &&
        (!bannersLoaded && middleBanners.length === 0 ? (
          <div className="mx-4 w-full py-4">
            <div className="h-[120px] w-[calc(100%-2rem)] animate-pulse rounded-[2rem] bg-zinc-100 sm:h-[200px]" />
          </div>
        ) : middleBanners.length > 0 ? (
          <div className="w-full py-4">
            <BannerCarousel banners={middleBanners} autoPlay={false} />
          </div>
        ) : null)}

      {/* All Products */}
      <div className="p-3 sm:p-4">
        <h2 className="mb-8 text-3xl font-black leading-none tracking-tighter text-zinc-900">
          {searchQuery ? "Resultados da busca" : "Catálogo"}
        </h2>

        {/* Sentinel for sticky docking detection */}
        <div
          ref={sentinelRef}
          className="pointer-events-none h-0 w-full opacity-0"
        />

        {/* Integrated Filter Bar - Premium Glassmorphism & STICKY */}
        <div
          className={cn(
            "sticky top-[-2px] z-40 -mx-4 px-4 pb-1.5 pt-0 bg-white/95 backdrop-blur flex flex-col transition-all duration-200 mb-1.5 gpu-accelerated",
            scrollProgress > 20
              ? "shadow-sm border-b border-zinc-200/60"
              : "border-b border-transparent",
          )}
        >
          {/* Interactive Header Bar */}
          <div className="flex items-center gap-3 py-1">
            <div className="min-w-0 flex-1">
              {isLoading ? (
                <div className="h-9 w-full animate-pulse rounded-full bg-zinc-100" />
              ) : (
                <CategoryFilter
                  categories={categories}
                  selectedCategory={selectedCategory}
                  onCategoryChange={onCategoryChange}
                  isLoading={isLoadingCategories}
                />
              )}
            </div>

            <div className="flex flex-shrink-0 items-center gap-2">
              <div className="relative">
                <button
                  onClick={() => {
                    haptic.light();
                    setShowSortMenu(!showSortMenu);
                  }}
                  className="flex size-10 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-black/10 transition-all hover:bg-primary/90 active:scale-95"
                  aria-expanded={showSortMenu}
                  aria-haspopup="listbox"
                  title="Filtrar e Ordenar"
                >
                  <SlidersHorizontal className="size-4" />
                </button>

                {showSortMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowSortMenu(false)}
                      role="button"
                      aria-label="Fechar menu"
                      tabIndex={-1}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Escape" ||
                          e.key === "Enter" ||
                          e.key === " "
                        ) {
                          setShowSortMenu(false);
                        }
                      }}
                    />
                    <div
                      className="absolute right-0 top-full z-50 mt-3 w-56 rounded-3xl border border-white/20 bg-white/95 p-2 shadow-2xl backdrop-blur-2xl duration-300 animate-in fade-in zoom-in"
                      role="listbox"
                    >
                      <div className="mb-1 border-b border-zinc-50 px-4 py-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                          Ordenar por
                        </span>
                      </div>
                      {sortOptions.map((option) => {
                        const Icon = option.icon;
                        return (
                          <button
                            key={option.value}
                            role="option"
                            aria-selected={sortBy === option.value}
                            onClick={() => {
                              onSortByChange(option.value);
                              setShowSortMenu(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-[10px] font-black uppercase tracking-widest transition-all ${
                              sortBy === option.value
                                ? "translate-x-1 bg-primary text-white"
                                : "text-zinc-400 hover:bg-zinc-50 hover:text-zinc-900"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <Icon className="size-4" />
                              {option.label}
                            </div>
                            {sortBy === option.value && (
                              <div className="size-1.5 animate-pulse rounded-full bg-white" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {filteredProducts.length === 0 && !isLoading ? (
          <div className="relative z-10 mt-16 rounded-[2.5rem] border border-zinc-100 bg-zinc-50/50 px-4 py-20 text-center italic">
            <div className="mx-auto mb-6 flex size-20 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-zinc-100">
              <PackageSearch className="size-10 text-zinc-300" />
            </div>
            <h3 className="mb-2 text-xl font-bold tracking-tight text-zinc-900">
              Nenhum produto agora
            </h3>
            <p className="mx-auto max-w-[200px] text-sm leading-relaxed text-zinc-500">
              Tente buscar por outro termo ou mudar a categoria.
            </p>
          </div>
        ) : (
          <ProductList
            products={filteredProducts}
            isLoading={isLoading}
            favorites={favorites}
            onToggleFavorite={onToggleFavorite}
            onProductClick={onProductClick}
            onAddToCart={onAddToCart}
            onQuickBuy={onQuickBuy}
            selectedProductId={selectedProductId}
          />
        )}
      </div>

      {bottomBanners.length > 0 &&
        !searchQuery &&
        selectedCategory === "Todas" && (
          <div className="w-full py-4">
            <BannerCarousel
              banners={bottomBanners}
              autoPlay={true}
              interval={8000}
            />
          </div>
        )}

      {/* Item 6 do laudo "o que falta" (29/08): o painel promete "Informa aos
          clientes no PWA" e o horário nunca chegava — o dado existia no
          config (business_hours), nada o exibia. Bloco discreto no fim da
          vitrine, só quando a lojista preencheu. */}
      {config.businessHours?.trim() && (
        <div className="relative z-10 mt-8 rounded-[2rem] border border-zinc-100 bg-zinc-50/50 p-6 text-center">
          <p className="flex items-center justify-center gap-2 text-sm font-bold text-zinc-700">
            <Clock className="size-4 text-admin-gold" />
            Horário de atendimento
          </p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-500">
            {config.businessHours}
          </p>
        </div>
      )}
    </div>
  );
});
