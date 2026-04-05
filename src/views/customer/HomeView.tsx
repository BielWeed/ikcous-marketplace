import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { Product, View } from '@/types';
import { CategoryFilter } from '@/components/ui/custom/CategoryFilter';
import { BannerCarousel } from '@/components/ui/custom/BannerCarousel';
import { SlidersHorizontal, TrendingUp, ArrowDown, ArrowUp, Sparkles, Clock, MapPin, PackageSearch } from 'lucide-react';
import { useBanners } from '@/hooks/useBanners';
import { useCategories } from '@/hooks/useCategories';
import { useStore } from '@/contexts/StoreContext';
import { haptic } from '@/utils/haptic';
import { CartReminder } from '@/components/ui/custom/CartReminder';
import { ProductCarousel } from '@/components/ui/custom/ProductCarousel';
import { ProductList } from '@/components/ui/custom/ProductList';
import { InfoBlockCarousel } from '@/components/ui/custom/InfoBlockCarousel';
import { FreeShippingBlock } from '@/components/ui/custom/FreeShippingBlock';
import { Helmet } from 'react-helmet-async';

interface HomeViewProps {
  products: Product[];
  favorites: string[];
  recentlyViewedProducts: Product[];
  onToggleFavorite: (product: Product) => void;
  onProductClick: (productId: string) => void;
  onNavigate: (view: View) => void;
  searchQuery: string;
  onAddToCart?: (product: Product, quantity?: number, variantId?: string) => void;
  onQuickBuy?: (product: Product, variantId?: string) => void;
  isLoading?: boolean;
  scrollProgress?: number;
}

type SortOption = 'default' | 'price-asc' | 'price-desc' | 'sold';

export function HomeView({
  products,
  favorites,
  recentlyViewedProducts,
  onToggleFavorite,
  onProductClick,
  onNavigate,
  searchQuery,
  onAddToCart,
  onQuickBuy,
  isLoading = false,
  scrollProgress = 0
}: HomeViewProps) {
  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [sortBy, setSortBy] = useState<SortOption>('default');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const { categories, isLoading: isLoadingCategories } = useCategories();
  const { getBannersByPosition } = useBanners();
  const { config } = useStore();

  const topBanners = getBannersByPosition('home_top');
  const middleBanners = getBannersByPosition('home_middle');
  const bottomBanners = getBannersByPosition('home_bottom');

  // Removed derived uniqueCategories logic in favor of useCategories hook

  const filteredProducts = useMemo(() => {
    // Precise filtering logic
    let result = [...products];

    // Filter by category
    if (selectedCategory && selectedCategory !== 'Todas') {
      result = result.filter(p =>
        p.category.toLowerCase().trim() === selectedCategory.toLowerCase().trim()
      );
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query) ||
        p.category.toLowerCase().includes(query)
      );
    }

    // Sort
    switch (sortBy) {
      case 'price-asc':
        result.sort((a, b) => a.price - b.price);
        break;
      case 'price-desc':
        result.sort((a, b) => b.price - a.price);
        break;
      case 'sold':
        result.sort((a, b) => b.sold - a.sold);
        break;
    }

    if (result.length !== products.length || searchQuery) {
      console.log(`[HomeView] Filtered: ${result.length}/${products.length} products`);
    }

    return result;
  }, [products, selectedCategory, searchQuery, sortBy]);

  const newArrivals = useMemo(() => {
    return [...products]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 6);
  }, [products]);

  const recommendedProducts = useMemo(() => {
    if (recentlyViewedProducts.length === 0) return [];

    const lastViewed = recentlyViewedProducts[0];
    return products
      .filter(p => p.category === lastViewed.category && p.id !== lastViewed.id)
      .slice(0, 4);
  }, [products, recentlyViewedProducts]);

  const sortOptions: { value: SortOption; label: string; icon: React.ElementType }[] = [
    { value: 'default', label: 'Relevância', icon: SlidersHorizontal },
    { value: 'sold', label: 'Mais Vendidos', icon: TrendingUp },
    { value: 'price-asc', label: 'Menor Preço', icon: ArrowDown },
    { value: 'price-desc', label: 'Maior Preço', icon: ArrowUp },
  ];


  return (
    <div className="min-h-full pb-24">
      <Helmet>
        <title>IKCOUS Marketplace | Monte Carmelo, MG</title>
        <meta name="description" content="O melhor marketplace de Monte Carmelo com entrega ultrarrápida e troca garantida." />
        <meta property="og:title" content="IKCOUS Marketplace - Seu Shopping Local" />
        <meta property="og:description" content="Descubra produtos exclusivos com frete grátis e entrega expressa em Monte Carmelo, MG." />
        <meta property="og:type" content="website" />
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": "IKCOUS Marketplace",
            "url": globalThis.location.origin,
            "potentialAction": {
              "@type": "SearchAction",
              "target": `${globalThis.location.origin}/?search={search_term_string}`,
              "query-input": "required name=search_term_string"
            }
          })}
        </script>
      </Helmet>

      {/* Exchange Banner */}
      <div className="bg-black text-white text-center py-2 px-4 text-xs font-medium">
        Troca garantida em até 24h após entrega
      </div>

      {/* Top Banners - Full Width */}
      {topBanners.length > 0 && (
        <div className="w-full mb-2 relative">
          <BannerCarousel banners={topBanners} autoPlay={true} interval={5000} />

          {/* Premium Info Carousel */}
          <InfoBlockCarousel>
            <FreeShippingBlock onNavigate={onNavigate} />
          </InfoBlockCarousel>
        </div>
      )}

      {/* Recently Viewed - Removed and moved to Profile */}

      {/* New Arrivals Section */}
      {!searchQuery && selectedCategory === 'Todas' && (
        <ProductCarousel
          title="Últimos Lançamentos"
          subtitle="Novo & Exclusivo"
          products={newArrivals}
          favorites={favorites}
          onToggleFavorite={onToggleFavorite}
          onProductClick={onProductClick}
          onAddToCart={onAddToCart}
          onQuickBuy={onQuickBuy}
          icon={<Sparkles className="w-5 h-5 text-amber-500 fill-amber-500" />}
          accentColor="amber"
        />
      )}

      {/* Recommended "For You" Section */}
      {!searchQuery && recommendedProducts.length > 0 && (
        <ProductCarousel
          title="Especialmente Para Você"
          subtitle="Baseado no seu estilo"
          products={recommendedProducts}
          favorites={favorites}
          onToggleFavorite={onToggleFavorite}
          onProductClick={onProductClick}
          onAddToCart={onAddToCart}
          onQuickBuy={onQuickBuy}
          icon={<Sparkles className="w-5 h-5 text-emerald-500" />}
          accentColor="emerald"
          className="bg-gradient-to-b from-transparent to-zinc-50/50"
        />
      )}

      {/* Bestsellers Section - Converted to Carousel! */}
      {!searchQuery && selectedCategory === 'Todas' && products.some(p => p.isBestseller) && (
        <ProductCarousel
          title="Destaques em Alta"
          subtitle="Favoritos da Comunidade"
          products={products.filter(p => p.isBestseller).slice(0, 10)}
          favorites={favorites}
          onToggleFavorite={onToggleFavorite}
          onProductClick={onProductClick}
          onAddToCart={onAddToCart}
          onQuickBuy={onQuickBuy}
          icon={<TrendingUp className="w-5 h-5 text-zinc-900" />}
          accentColor="zinc"
          className="bg-zinc-50/50"
        />
      )}

      {/* Middle Banners - Full Width */}
      {middleBanners.length > 0 && !searchQuery && selectedCategory === 'Todas' && (
        <div className="w-full py-4">
          <BannerCarousel banners={middleBanners} autoPlay={false} />
        </div>
      )}

      {/* All Products */}
      <div className="px-3 sm:px-4 py-3 sm:py-4">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900 leading-none mb-6">
          {searchQuery ? 'Resultados da busca' : 'Todos os Produtos'}
        </h2>

        {/* Integrated Filter Bar - Premium Glassmorphism & STICKY */}
        <div className={cn(
          "sticky top-0 z-40 -mx-4 px-4 pb-3 pt-1 bg-white flex flex-col gap-2 transition-[box-shadow,border-color] duration-200 mb-4",
          scrollProgress > 20 ? "shadow-sm border-b border-zinc-100/50" : "border-b border-transparent"
        )}>
          {/* Interactive Header Bar */}
          <div className="flex items-center gap-3 py-2">
            <div className="flex-1 min-w-0">
              {isLoading ? (
                <div className="h-9 w-full bg-zinc-100 animate-pulse rounded-full" />
              ) : (
                <CategoryFilter
                  categories={categories}
                  selectedCategory={selectedCategory}
                  onCategoryChange={setSelectedCategory}
                  isLoading={isLoadingCategories}
                />
              )}
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="relative">
                <button
                  onClick={() => {
                    haptic.light();
                    setShowSortMenu(!showSortMenu);
                  }}
                  className="flex items-center justify-center w-10 h-10 bg-zinc-900 rounded-full text-white hover:bg-black transition-all active:scale-95 shadow-lg shadow-zinc-200"
                  aria-expanded={showSortMenu}
                  aria-haspopup="listbox"
                  title="Filtrar e Ordenar"
                >
                  <SlidersHorizontal className="w-4 h-4" />
                </button>

                {showSortMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowSortMenu(false)}
                    />
                    <div
                      className="absolute right-0 top-full mt-3 w-56 bg-white/95 backdrop-blur-2xl rounded-3xl shadow-2xl border border-white/20 z-50 py-2 p-2 animate-in fade-in zoom-in duration-300"
                      role="listbox"
                    >
                      <div className="px-4 py-2 border-b border-zinc-50 mb-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Ordenar por</span>
                      </div>
                      {sortOptions.map((option) => {
                        const Icon = option.icon;
                        return (
                          <button
                            key={option.value}
                            role="option"
                            aria-selected={sortBy === option.value}
                            onClick={() => {
                              setSortBy(option.value);
                              setShowSortMenu(false);
                            }}
                            className={`w-full flex items-center justify-between px-4 py-3 text-[10px] uppercase font-black tracking-widest rounded-2xl transition-all ${sortBy === option.value
                              ? 'bg-zinc-900 text-white translate-x-1'
                              : 'text-zinc-400 hover:bg-zinc-50 hover:text-zinc-900'
                              }`}
                          >
                            <div className="flex items-center gap-3">
                              <Icon className="w-4 h-4" />
                              {option.label}
                            </div>
                            {sortBy === option.value && <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />}
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

        {
          filteredProducts.length === 0 ? (
            <div className="text-center py-20 px-4 bg-zinc-50/50 rounded-[2.5rem] mt-16 border border-zinc-100 italic relative z-10">
              <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm ring-1 ring-zinc-100">
                <PackageSearch className="w-10 h-10 text-zinc-300" />
              </div>
              <h3 className="text-xl font-bold text-zinc-900 mb-2 tracking-tight">
                Nenhum produto agora
              </h3>
              <p className="text-sm text-zinc-500 max-w-[200px] mx-auto leading-relaxed">
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
            />
          )
        }
      </div >

      {
        bottomBanners.length > 0 && !searchQuery && selectedCategory === 'Todas' && (
          <div className="w-full py-4">
            <BannerCarousel banners={bottomBanners} autoPlay={true} interval={8000} />
          </div>
        )
      }

      {/* Location Footer */}
      <div className="px-6 py-12 mt-12 bg-zinc-900 rounded-[3rem] mx-4 mb-4 text-white overflow-hidden relative group">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl group-hover:bg-white/10 transition-colors duration-700" />

        <div className="relative z-10 flex flex-col items-center text-center">
          <div className="w-12 h-12 bg-white/10 backdrop-blur-xl rounded-2xl flex items-center justify-center mb-6 border border-white/10">
            <MapPin className="w-6 h-6 text-white" />
          </div>

          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 mb-2">Exclusividade Local</span>
          <h2 className="text-2xl font-black tracking-tighter mb-4">Monte Carmelo, MG</h2>

          <p className="text-sm text-zinc-400 max-w-[240px] leading-relaxed mb-8 font-medium">
            Focamos em oferecer a melhor experiência de entrega ultra-rápida para nossa cidade.
          </p>

          <div className="flex flex-col gap-2 p-4 bg-white/5 backdrop-blur-md rounded-2xl border border-white/5 w-full max-w-[280px]">
            <div className="flex items-center justify-between text-[10px] uppercase font-black tracking-widest text-zinc-500">
              <div className="flex items-center gap-2">
                <Clock className="w-3 h-3" />
                <span>Horário</span>
              </div>
              <span className="text-white">{config.businessHours.split('das')[1]?.trim() || 'Comercial'}</span>
            </div>
          </div>
        </div>
      </div>

      <CartReminder onAction={() => onNavigate('cart')} />
    </div >
  );
}
