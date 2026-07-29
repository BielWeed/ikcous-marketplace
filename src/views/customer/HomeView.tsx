import { BannerCarousel } from "@/components/ui/custom/BannerCarousel";
import { CategoryFilter } from "@/components/ui/custom/CategoryFilter";
import { useBanners } from "@/hooks/useBanners";
import { useCategories } from "@/hooks/useCategories";
import { cn } from "@/lib/utils";
import type { Product, SortOption, View } from "@/types";
import {
  ArrowDown,
  ArrowUp,
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
import { haptic } from "@/utils/haptic";
import { Helmet } from "react-helmet-async";

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

  const filteredProducts = useMemo(() => {
    // Precise filtering logic
    let result = [...products];

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
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query) ||
          p.category.toLowerCase().includes(query),
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

    if (result.length !== products.length || searchQuery) {
      console.log(
        `[HomeView] Filtered: ${result.length}/${products.length} products`,
      );
    }

    return result;
  }, [products, selectedCategory, searchQuery, sortBy]);

  const newArrivals = useMemo(() => {
    return [...products]
      .sort((a, b) => {
        const aAvailable = a.stock > 0 ? 1 : 0;
        const bAvailable = b.stock > 0 ? 1 : 0;
        if (aAvailable !== bAvailable) {
          return bAvailable - aAvailable;
        }
        return (b.createdTime ?? 0) - (a.createdTime ?? 0);
      })
      .slice(0, 6);
  }, [products]);

  const offerProducts = useMemo(() => {
    return products
      .filter((p) => p.originalPrice && p.originalPrice > p.price)
      .sort((a, b) => {
        const aAvailable = a.stock > 0 ? 1 : 0;
        const bAvailable = b.stock > 0 ? 1 : 0;
        return bAvailable - aAvailable;
      })
      .slice(0, 10);
  }, [products]);

  const bestsellerProducts = useMemo(() => {
    return products
      .filter((p) => p.isBestseller)
      .sort((a, b) => {
        const aAvailable = a.stock > 0 ? 1 : 0;
        const bAvailable = b.stock > 0 ? 1 : 0;
        return bAvailable - aAvailable;
      })
      .slice(0, 10);
  }, [products]);

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

  return (
    <div className="pb-customer min-h-full">
      <Helmet>
        <title>{branding.appName} | Monte Carmelo, MG</title>
        <meta
          name="description"
          content={`O melhor marketplace de Monte Carmelo com entrega ultrarrápida e troca garantida - ${branding.appName}`}
        />
        <meta
          property="og:title"
          content={`${branding.appName} - Seu Shopping Local`}
        />
        <meta
          property="og:description"
          content="Descubra produtos exclusivos com frete grátis e entrega expressa em Monte Carmelo, MG."
        />
        <meta property="og:type" content="website" />
        <meta
          property="og:image"
          content={`${globalThis.location.origin}/branding/logo.png`}
        />
        <meta property="og:url" content={globalThis.location.origin} />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta
          name="twitter:title"
          content={`${branding.appName} - Seu Shopping Local`}
        />
        <meta
          name="twitter:description"
          content="Descubra produtos exclusivos com frete grátis e entrega expressa em Monte Carmelo, MG."
        />
        <meta
          name="twitter:image"
          content={`${globalThis.location.origin}/branding/logo.png`}
        />

        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: branding.appName,
            url: globalThis.location.origin,
            potentialAction: {
              "@type": "SearchAction",
              target: `${globalThis.location.origin}/?search={search_term_string}`,
              "query-input": "required name=search_term_string",
            },
          })}
        </script>
      </Helmet>

      {/* Top Banners - Full Width */}
      {!bannersLoaded && topBanners.length === 0 ? (
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
      ) : null}

      {/* Recently Viewed - Removed and moved to Profile */}

      {/* New Arrivals Section */}
      {!searchQuery && selectedCategory === "Todas" && (
        <ProductCarousel
          title="Últimos Lançamentos"
          products={newArrivals}
          favorites={favorites}
          onToggleFavorite={onToggleFavorite}
          onProductClick={onProductClick}
          onAddToCart={onAddToCart}
          onQuickBuy={onQuickBuy}
          selectedProductId={selectedProductId}
        />
      )}

      {/* Offers Section */}
      {!searchQuery &&
        selectedCategory === "Todas" &&
        offerProducts.length > 0 && (
          <PremiumOffers
            products={offerProducts}
            favorites={favorites}
            onToggleFavorite={onToggleFavorite}
            onProductClick={onProductClick}
            onAddToCart={onAddToCart}
            onQuickBuy={onQuickBuy}
          />
        )}

      {/* Bestsellers Section - Converted to Carousel! */}
      {!searchQuery &&
        selectedCategory === "Todas" &&
        bestsellerProducts.length > 0 && (
          <ProductCarousel
            title="Destaques em Alta"
            products={bestsellerProducts}
            favorites={favorites}
            onToggleFavorite={onToggleFavorite}
            onProductClick={onProductClick}
            onAddToCart={onAddToCart}
            onQuickBuy={onQuickBuy}
            className="bg-zinc-50/50"
            selectedProductId={selectedProductId}
          />
        )}

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
                  className="flex size-10 items-center justify-center rounded-full bg-zinc-900 text-white shadow-lg shadow-zinc-200 transition-all hover:bg-black active:scale-95"
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
                                ? "translate-x-1 bg-zinc-900 text-white"
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
    </div>
  );
});
