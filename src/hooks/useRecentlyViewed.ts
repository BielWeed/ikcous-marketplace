import { useState, useEffect, useCallback } from 'react';
import type { Product } from '@/types';

const RECENTLY_VIEWED_KEY = 'ikcous_recently_viewed';
const MAX_ITEMS = 10;

export function useRecentlyViewed() {
  const [recentlyViewed, setRecentlyViewed] = useState<string[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(RECENTLY_VIEWED_KEY);
    setTimeout(() => {
      if (stored) {
        setRecentlyViewed(JSON.parse(stored));
      }
      setIsLoaded(true);
    }, 0);
  }, []);

  const saveRecentlyViewed = useCallback((items: string[]) => {
    setRecentlyViewed(items);
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(items));
  }, []);

  const addToRecentlyViewed = useCallback((productId: string) => {
    setRecentlyViewed(prev => {
      const filtered = prev.filter(id => id !== productId);
      const updated = [productId, ...filtered].slice(0, MAX_ITEMS);
      localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const clearRecentlyViewed = useCallback(() => {
    saveRecentlyViewed([]);
  }, [saveRecentlyViewed]);

  const getRecentlyViewedProducts = useCallback((allProducts: Product[]): Product[] => {
    return recentlyViewed
      .map(id => allProducts.find(p => p.id === id))
      .filter((p): p is Product => p !== undefined && p.isActive);
  }, [recentlyViewed]);

  return {
    recentlyViewed,
    isLoaded,
    addToRecentlyViewed,
    clearRecentlyViewed,
    getRecentlyViewedProducts
  };
}
