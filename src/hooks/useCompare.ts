import { useState, useCallback } from 'react';
import type { Product } from '@/types';

const COMPARE_KEY = 'ikcous_compare';
const MAX_COMPARE_ITEMS = 4;

export function useCompare() {
  const [compareList, setCompareList] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(COMPARE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [isLoaded] = useState(true);

  const saveCompareList = useCallback((items: string[]) => {
    setCompareList(items);
    localStorage.setItem(COMPARE_KEY, JSON.stringify(items));
  }, []);

  const addToCompare = useCallback((productId: string): boolean => {
    if (compareList.includes(productId)) {
      return true;
    }
    if (compareList.length >= MAX_COMPARE_ITEMS) {
      alert(`Você pode comparar no máximo ${MAX_COMPARE_ITEMS} produtos`);
      return false;
    }
    const updated = [...compareList, productId];
    saveCompareList(updated);
    return true;
  }, [compareList, saveCompareList]);

  const removeFromCompare = useCallback((productId: string) => {
    const updated = compareList.filter(id => id !== productId);
    saveCompareList(updated);
  }, [compareList, saveCompareList]);

  const toggleCompare = useCallback((productId: string): boolean => {
    if (compareList.includes(productId)) {
      removeFromCompare(productId);
      return false;
    }
    return addToCompare(productId);
  }, [compareList, addToCompare, removeFromCompare]);

  const clearCompare = useCallback(() => {
    saveCompareList([]);
  }, [saveCompareList]);

  const isInCompare = useCallback((productId: string) => {
    return compareList.includes(productId);
  }, [compareList]);

  const getCompareProducts = useCallback((allProducts: Product[]): Product[] => {
    return compareList
      .map(id => allProducts.find(p => p.id === id))
      .filter((p): p is Product => p !== undefined);
  }, [compareList]);

  return {
    compareList,
    compareCount: compareList.length,
    isLoaded,
    addToCompare,
    removeFromCompare,
    toggleCompare,
    clearCompare,
    isInCompare,
    getCompareProducts
  };
}
