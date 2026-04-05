import {
    Search,
    X,
    ArrowRight
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useEffect, useState, useRef, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { haptic } from '@/utils/haptic';
import { useProducts } from '@/hooks/useProducts';
import { type Product } from '@/types';

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

export function SearchBar({ value, onChange, onProductClick, placeholder = "Buscar produtos...", className = "" }: SearchBarProps) {
    const [localValue, setLocalValue] = useState(value);
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
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsFocused(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleClear = () => {
        haptic.light();
        setLocalValue('');
        onChange('');
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
        if (!localValue.trim()) {
            // Show bestsellers or trending if no search
            return products
                .filter(p => p.isActive && (p.isBestseller || p.stock > 0))
                .slice(0, 4)
                .map(p => ({ ...p, score: 0 }));
        }

        const query = localValue.toLowerCase().trim();
        const scored = products
            .filter(product => product.isActive)
            .map(product => {
                let score = 0;
                const name = product.name.toLowerCase();
                const description = product.description.toLowerCase();
                const category = product.category.toLowerCase();
                const tags = (product.tags || []).map(t => t.toLowerCase());

                // Exact match
                if (name === query) score += 100;
                // Starts with
                else if (name.startsWith(query)) score += 80;
                // Contains
                else if (name.includes(query)) score += 50;

                // Word match (for multi-word queries)
                const queryWords = query.split(' ');
                queryWords.forEach(word => {
                    if (name.includes(word)) score += 20;
                    if (category.includes(word)) score += 15;
                    if (tags.some(t => t.includes(word))) score += 10;
                });

                // Category match
                if (category === query) score += 40;
                else if (category.includes(query)) score += 20;

                // Description match (light weight)
                if (description.includes(query)) score += 5;

                return { ...product, score } as ScoredProduct;
            })
            .filter(p => p.score > 0)
            .sort((a, b) => (b as ScoredProduct).score - (a as ScoredProduct).score)
            .slice(0, 6);

        return scored as ScoredProduct[];
    }, [products, localValue]);

    const trendingProducts = useMemo<Product[]>(() => {
        const bestsellers = products.filter(p => p.isActive && p.isBestseller);
        if (bestsellers.length > 0) return bestsellers.slice(0, 4);
        // Fallback to most recent active products if no bestsellers found
        return products.filter(p => p.isActive).slice(0, 4);
    }, [products]);

    return (
        <div ref={containerRef} className={cn(
            "relative z-50",
            className
        )}>
            {/* Liquid Search Container */}
            <div className={cn(
                "absolute inset-0 bg-white shadow-sm border border-zinc-100 rounded-full transition-[box-shadow,border-color,transform] duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]",
                isFocused ? "shadow-xl border-zinc-200 scale-[1.01]" : ""
            )} />

            <div className={cn(
                "relative flex items-center h-10 transition-[z-index,opacity] duration-300",
                isFocused ? "z-[60]" : "z-10"
            )}>
                <Search className={cn(
                    "absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 transition-[color,transform] duration-200 z-30",
                    isFocused ? "text-zinc-900 scale-110" : "text-zinc-400"
                )} />

                {/* Animação Premium de Placeholder para Mobile */}
                {!localValue && !isFocused && (
                    <div className="absolute left-12 right-10 top-0 bottom-0 flex items-center overflow-hidden pointer-events-none z-[25] select-none">
                        <div className="flex gap-12 whitespace-nowrap animate-marquee-x">
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
                    className={cn(
                        "relative pl-12 pr-10 border-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 h-full text-sm font-bold tracking-tight text-zinc-900 placeholder:text-zinc-300 placeholder:font-medium rounded-full z-20 transition-[background-color,color] duration-200 bg-transparent focus:outline-none focus:ring-0 focus-visible:outline-none",
                    )}
                    placeholder=""
                />

                {localValue && (
                    <button
                        onClick={handleClear}
                        className="absolute right-3 w-5 h-5 flex items-center justify-center rounded-full bg-zinc-900/5 text-zinc-400 hover:bg-zinc-900 hover:text-white transition-[background-color,color,transform] duration-200 z-30 active:scale-90"
                    >
                        <X className="w-2.5 h-2.5" />
                    </button>
                )}
            </div>

            {/* Elite Expanded Panel */}
            {isFocused && (
                <>
                    <div className="fixed inset-0 top-[calc(var(--header-height)+var(--safe-area-top))] bg-black/40 backdrop-blur-sm z-40 animate-in fade-in duration-700" />

                    <div className="fixed top-[calc(var(--header-height)+var(--safe-area-top))] left-0 right-0 w-full bg-white shadow-[0_40px_100px_rgba(0,0,0,0.25)] animate-in slide-in-from-top-2 fade-in duration-700 z-[100] overflow-y-auto bottom-[calc(var(--nav-height)+var(--safe-area-bottom))] border-b border-zinc-100">
                        <div className="py-6">

                            {/* Intelligent Trending/Search Results - Max Fidelity */}
                            <div>
                                <div className="flex items-center gap-3 mb-8 px-8">
                                    <div className="w-1.5 h-4 bg-zinc-900 rounded-full" />
                                    <span className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-400">
                                        {localValue ? "Resultados" : "Tendências do Catálogo"}
                                    </span>
                                </div>
                                <div className="space-y-0.5">
                                    {localValue.trim().length > 0 ? (
                                        searchResults.length > 0 ? searchResults.map((item) => (
                                        <button
                                            key={item.id}
                                            onClick={() => handleSuggestionClick(item.name, item.id)}
                                            className="w-full flex items-center justify-between px-6 py-3 hover:bg-zinc-50/80 transition-all group relative border-b border-zinc-50/50 last:border-0"
                                        >
                                            <div className="flex items-center gap-6">
                                                <div className="relative">
                                                    <div className="w-12 h-12 bg-zinc-100 rounded-[16px] overflow-hidden border border-zinc-200/50 shadow-sm group-hover:scale-105 transition-transform duration-500">
                                                        <img
                                                            src={item.images[0] || "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&q=80&w=100"}
                                                            alt={item.name}
                                                            className="w-full h-full object-cover"
                                                            loading="lazy"
                                                        />
                                                    </div>
                                                    {item.isBestseller && (
                                                        <div className="absolute -top-1 -right-1 w-3 h-3 bg-amber-500 rounded-full border-2 border-white animate-pulse shadow-sm" />
                                                    )}
                                                </div>
                                                <div className="flex flex-col items-start gap-1.5">
                                                    <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-300 group-hover:text-amber-600 transition-colors">{item.category}</span>
                                                    <span className="text-xl font-bold text-zinc-900 tracking-tighter group-hover:translate-x-2 transition-transform duration-500">{item.name}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <span className="text-[10px] font-bold text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    R$ {item.price.toFixed(2)}
                                                </span>
                                                <ArrowRight className="w-6 h-6 text-zinc-900 opacity-0 group-hover:opacity-100 -translate-x-6 group-hover:translate-x-0 transition-all duration-700 ease-out" />
                                            </div>
                                        </button>
                                        )) : (
                                            <div className="px-8 py-12 text-center text-zinc-400 font-medium">
                                                Nenhum produto encontrado para "{localValue}"
                                            </div>
                                        )
                                    ) : null}
                                </div>
                            </div>

                            {/* Trending Products Section - NEW Integration */}
                            {(localValue.trim().length === 0 || searchResults.length < 3) && (
                                <div className="mt-8">
                                <div className="flex items-center gap-3 mb-8 px-8">
                                    <div className="w-1.5 h-4 bg-amber-500 rounded-full" />
                                    <span className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-400">
                                        Produtos em Alta
                                    </span>
                                </div>
                                <div className="space-y-0.5">
                                    {trendingProducts.map((item) => (
                                        <button
                                            key={`trending-${item.id}`}
                                            onClick={() => handleSuggestionClick(item.name, item.id)}
                                            className="w-full flex items-center justify-between px-6 py-3 hover:bg-zinc-50/80 transition-all group relative border-b border-zinc-50/50 last:border-0"
                                        >
                                            <div className="flex items-center gap-8">
                                                <div className="relative">
                                                    <div className="w-16 h-16 bg-zinc-100 rounded-[20px] overflow-hidden border border-zinc-200/50 shadow-sm group-hover:scale-105 transition-transform duration-500">
                                                        <img
                                                            src={item.images[0] || "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&q=80&w=100"}
                                                            alt={item.name}
                                                            className="w-full h-full object-cover"
                                                            loading="lazy"
                                                        />
                                                    </div>
                                                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-amber-500 rounded-full border-2 border-white animate-pulse shadow-sm" />
                                                </div>
                                                <div className="flex flex-col items-start gap-1.5">
                                                    <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-300 group-hover:text-amber-600 transition-colors">{item.category}</span>
                                                    <span className="text-xl font-bold text-zinc-900 tracking-tighter group-hover:translate-x-2 transition-transform duration-500">{item.name}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <span className="text-[10px] font-bold text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    R$ {item.price.toFixed(2)}
                                                </span>
                                                <ArrowRight className="w-6 h-6 text-zinc-900 opacity-0 group-hover:opacity-100 -translate-x-6 group-hover:translate-x-0 transition-all duration-700 ease-out" />
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
