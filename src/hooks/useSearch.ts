import { useState, useMemo } from 'react';
import type { Product } from '@/types';
import { useDebounce } from './useDebounce';

export type SortOption = 'price_asc' | 'price_desc' | 'name_asc' | 'newest';

export function useSearch(products: Product[]) {
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('Todas');
    const [minPrice, setMinPrice] = useState<number | ''>('');
    const [maxPrice, setMaxPrice] = useState<number | ''>('');
    const [sort, setSort] = useState<SortOption>('newest');

    // Debounce inputs to avoid excessive re-filtering
    const debouncedQuery = useDebounce(query, 300);
    const debouncedMinPrice = useDebounce(minPrice, 500);
    const debouncedMaxPrice = useDebounce(maxPrice, 500);

    const filteredProducts = useMemo(() => {
        return products.filter(product => {
            const productName = product.name.toLowerCase();
            const productDesc = product.description?.toLowerCase() || '';
            const searchQuery = debouncedQuery.toLowerCase();

            const matchesQuery = productName.includes(searchQuery) || productDesc.includes(searchQuery);
            const matchesCategory = category === 'Todas' ||
                product.category.toLowerCase().trim() === category.toLowerCase().trim();

            const matchesMinPrice = debouncedMinPrice === '' || product.price >= debouncedMinPrice;
            const matchesMaxPrice = debouncedMaxPrice === '' || product.price <= debouncedMaxPrice;

            return matchesQuery && matchesCategory && matchesMinPrice && matchesMaxPrice;
        }).sort((a, b) => {
            switch (sort) {
                case 'price_asc': return a.price - b.price;
                case 'price_desc': return b.price - a.price;
                case 'name_asc': return a.name.localeCompare(b.name);
                case 'newest': return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                default: return 0;
            }
        });
    }, [products, debouncedQuery, category, debouncedMinPrice, debouncedMaxPrice, sort]);

    return {
        query, setQuery,
        category, setCategory,
        minPrice, setMinPrice,
        maxPrice, setMaxPrice,
        sort, setSort,
        filteredProducts,
        totalResults: filteredProducts.length
    };
}
