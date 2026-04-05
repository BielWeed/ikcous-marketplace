import { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, Search as SearchIcon, SlidersHorizontal, Sparkles, PackageSearch } from 'lucide-react';
import { useSearch } from '@/hooks/useSearch';
import { useProducts } from '@/hooks/useProducts';
import { useFavorites } from '@/hooks/useFavorites';
import { ProductCard } from '@/components/ui/custom/ProductCard';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { View } from '@/types';

interface SearchViewProps {
    onNavigate: (view: View, productId?: string) => void;
    initialQuery?: string;
    onBack: () => void;
}

export function SearchView({ onNavigate, initialQuery = '', onBack }: SearchViewProps) {
    const { products: allProducts } = useProducts();
    const {
        query, setQuery,
        category, setCategory,
        minPrice, setMinPrice,
        maxPrice, setMaxPrice,
        sort, setSort,
        filteredProducts,
        totalResults
    } = useSearch(allProducts);

    const { isFavorite, toggleFavorite } = useFavorites();
    const [isFilterOpen, setIsFilterOpen] = useState(false);

    // Get trending products for empty state
    const trendingProducts = allProducts.slice(0, 4);

    // Extract unique categories
    const categoriesSet = ['Todas', ...Array.from(new Set(allProducts.map(p => p.category)))];

    const handleClearFilters = useCallback(() => {
        setCategory('Todas');
        setMinPrice('');
        setMaxPrice('');
        setSort('newest');
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
        (category !== 'Todas' ? 1 : 0) +
        (minPrice !== '' ? 1 : 0) +
        (maxPrice !== '' ? 1 : 0);

    return (
        <div className="min-h-full bg-white pb-32 selection:bg-black selection:text-white">
            {/* Premium Sticky Search Header */}
            <div className="bg-white/90 backdrop-blur-2xl sticky top-0 z-50 border-b border-zinc-100">
                <div className="px-4 py-4 max-w-7xl mx-auto space-y-4">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={onBack}
                            className="w-10 h-10 flex items-center justify-center bg-zinc-50 rounded-2xl border border-zinc-100 hover:bg-zinc-100 transition-all active:scale-90"
                        >
                            <ArrowLeft className="w-5 h-5 text-zinc-900" />
                        </button>
                        <div className="flex-1 relative group">
                            <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 group-focus-within:text-zinc-900 transition-colors" />
                            <Input
                                id="search-input"
                                name="q"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="O que você deseja hoje?"
                                className="h-12 bg-zinc-50 border-zinc-100 rounded-2xl pl-11 pr-4 text-sm focus:ring-black/5 focus:border-zinc-200 transition-all placeholder:text-zinc-400"
                            />
                        </div>
                    </div>

                    {/* Quick Filters - Pill Style */}
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                        <Sheet open={isFilterOpen} onOpenChange={setIsFilterOpen}>
                            <SheetTrigger asChild>
                                <button className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap shadow-xl shadow-black/10 active:scale-95 transition-all">
                                    <SlidersHorizontal className="w-3 h-3" />
                                    Filtros {activeFiltersCount > 0 && `(${activeFiltersCount})`}
                                </button>
                            </SheetTrigger>
                            <SheetContent side="bottom" className="rounded-t-[3rem] p-8 max-h-[90vh] overflow-y-auto">
                                <SheetHeader className="mb-8">
                                    <div className="flex items-center justify-between">
                                        <SheetTitle className="text-2xl font-black tracking-tighter">Refinar Busca</SheetTitle>
                                        {activeFiltersCount > 0 && (
                                            <button
                                                onClick={handleClearFilters}
                                                className="text-[10px] font-black text-red-500 uppercase tracking-widest"
                                            >
                                                Limpar Tudo
                                            </button>
                                        )}
                                    </div>
                                </SheetHeader>

                                <div className="space-y-8 pb-10">
                                    <div>
                                        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-4">Categorias</p>
                                        <div className="flex flex-wrap gap-2">
                                            {categoriesSet.map((catName) => (
                                                <button
                                                    key={catName}
                                                    onClick={() => setCategory(catName)}
                                                    className={`px-5 py-2.5 rounded-2xl text-[11px] font-bold transition-all border ${category === catName
                                                        ? 'bg-zinc-950 text-white border-zinc-950 scale-105 shadow-lg shadow-black/10'
                                                        : 'bg-zinc-50 text-zinc-600 border-zinc-100 hover:border-zinc-300'
                                                        }`}
                                                >
                                                    {catName}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-4">Ordenação</p>
                                        <div className="grid grid-cols-2 gap-3">
                                            {[
                                                { label: 'Menor Preço', value: 'price_asc' },
                                                { label: 'Maior Preço', value: 'price_desc' },
                                                { label: 'Mais Novos', value: 'newest' },
                                                { label: 'Alfabetica', value: 'name_asc' }
                                            ].map((option) => (
                                                <button
                                                    key={option.value}
                                                    onClick={() => setSort(option.value as any)}
                                                    className={`px-4 py-3 rounded-2xl border text-[11px] font-bold transition-all ${sort === option.value
                                                        ? 'bg-zinc-950 text-white border-zinc-950'
                                                        : 'bg-zinc-50 text-zinc-600 border-zinc-100 hover:border-zinc-300'
                                                        }`}
                                                >
                                                    {option.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <Button
                                        onClick={() => setIsFilterOpen(false)}
                                        className="w-full h-14 rounded-2xl bg-zinc-950 text-white font-black uppercase tracking-widest text-xs hover:bg-zinc-900 transition-all shadow-2xl shadow-black/20"
                                    >
                                        Aplicar Filtros
                                    </Button>
                                </div>
                            </SheetContent>
                        </Sheet>

                        <div className="w-[1px] h-4 bg-zinc-100 mx-2" />

                        {categoriesSet.slice(0, 6).map(catName => (
                            <button
                                key={catName}
                                onClick={() => setCategory(catName)}
                                className={`px-4 py-2 rounded-full border text-[10px] font-bold uppercase tracking-widest whitespace-nowrap transition-all ${category === catName
                                    ? 'bg-zinc-950 text-white border-zinc-950'
                                    : 'bg-zinc-50 text-zinc-500 border-zinc-100 hover:border-zinc-900 hover:text-zinc-900'
                                    }`}
                            >
                                {catName}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div className="px-4 py-8 max-w-7xl mx-auto">
                {filteredProducts.length > 0 ? (
                    <div className="space-y-8">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-zinc-900" />
                                <h2 className="text-xl font-black tracking-tighter">Encontramos {totalResults} resultados</h2>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                            {filteredProducts.map((product) => (
                                <ProductCard
                                    key={product.id}
                                    product={product}
                                    isFavorite={isFavorite(product.id)}
                                    onToggleFavorite={(e) => {
                                        e.stopPropagation();
                                        toggleFavorite(product);
                                    }}
                                    onClick={() => onNavigate('product-detail', product.id)}
                                />
                            ))}
                        </div>
                    </div>
                ) : (
                    /* Smart Empty State */
                    <div className="py-20 animate-in fade-in slide-in-from-bottom-8 duration-700">
                        <div className="text-center max-w-sm mx-auto mb-20">
                            <div className="w-20 h-20 bg-zinc-50 rounded-[2.5rem] flex items-center justify-center border border-zinc-100 mx-auto mb-6">
                                <PackageSearch className="w-8 h-8 text-zinc-300" />
                            </div>
                            <h2 className="text-2xl font-black tracking-tighter text-zinc-900">Ué, nenhum resultado?</h2>
                            <p className="text-zinc-400 text-xs mt-2 leading-relaxed font-medium">
                                Não encontramos o que você buscou com esses filtros. <br />
                                <span className="text-zinc-900 font-black">Que tal dar uma olhada no que é tendência?</span>
                            </p>
                            <Button
                                variant="outline"
                                onClick={handleClearFilters}
                                className="mt-8 rounded-2xl border-zinc-200 text-zinc-900 font-black text-[10px] uppercase tracking-widest h-12 px-8"
                            >
                                Limpar Tudo
                            </Button>
                        </div>

                        {/* Trending Recommendations */}
                        <div className="pt-10 border-t border-zinc-100">
                            <div className="flex flex-col items-center text-center mb-10">
                                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400 mb-2">Editor's Choice</span>
                                <h3 className="text-2xl font-black tracking-tighter text-zinc-900">Trending na IKCOUS</h3>
                            </div>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                                {trendingProducts.map((product) => (
                                    <ProductCard
                                        key={product.id}
                                        product={product}
                                        isFavorite={isFavorite(product.id)}
                                        onToggleFavorite={(e) => {
                                            e.stopPropagation();
                                            toggleFavorite(product);
                                        }}
                                        onClick={() => onNavigate('product-detail', product.id)}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
