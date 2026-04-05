import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useLocalStorage } from './useLocalStorage';
import { useProducts } from './useProducts';
import type { Product } from '@/types';
import { toast } from 'sonner';

const FAVORITES_KEY = 'ikcous_favorites';

export function useFavorites() {
  const { user } = useAuth();
  const { products: allProducts } = useProducts();
  const [localFavorites, setLocalFavorites] = useLocalStorage<Product[]>(FAVORITES_KEY, []);
  const [dbFavoriteIds, setDbFavoriteIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // 1. Sync Logic: When User logs in, merge Local -> DB
  useEffect(() => {
    if (!user) {
      setDbFavoriteIds([]);
      return;
    }

    const syncFavorites = async () => {
      setLoading(true);

      try {
        // A. Push Local to DB (Merge)
        if (localFavorites.length > 0) {
          const promises = localFavorites.map(p =>
            supabase.from('favorites').upsert(
              { user_id: user.id, product_id: p.id },
              { onConflict: 'user_id, product_id', ignoreDuplicates: true }
            )
          );
          await Promise.all(promises);

          // After sync, replace state with server data and clear local storage
          setLocalFavorites([]); // Clear local state
          if (typeof window !== 'undefined') {
            localStorage.removeItem(FAVORITES_KEY); // Explicitly remove from localStorage
          }
          toast.success('Seus favoritos locais foram sincronizados!');
        }

        // B. Fetch from DB
        const { data, error } = await supabase
          .from('favorites')
          .select('product_id')
          .eq('user_id', user.id);

        if (error) {
          console.error('Error fetching favorites', error);
        } else if (data) {
          const newIds = data.map(f => f.product_id);
          setDbFavoriteIds(newIds);
        }
      } catch (err) {
        console.error('Sync failed', err);
      } finally {
        setLoading(false);
      }
    };

    syncFavorites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]); // Run ONLY when user changes to prevent race conditions and infinite fetch loops

  // 2. Computed Favorites List
  const favorites = user
    ? allProducts.filter(p => dbFavoriteIds.includes(p.id))
    : localFavorites;

  // 3. Actions
  const addToFavorites = useCallback(async (product: Product) => {
    if (user) {
      // Optimistic
      setDbFavoriteIds(prev => [...prev, product.id]);
      const { error } = await supabase.from('favorites').insert({ user_id: user.id, product_id: product.id });

      if (error) {
        console.error(error);
        toast.error('Erro ao salvar favorito');
        setDbFavoriteIds(prev => prev.filter(id => id !== product.id));
      } else {
        toast.success('Adicionado aos favoritos');
      }
    } else {
      setLocalFavorites(prev => {
        if (prev.find(p => p.id === product.id)) return prev;
        return [...prev, product];
      });
      toast.success('Adicionado aos favoritos');
    }
  }, [user, setLocalFavorites]);

  const removeFromFavorites = useCallback(async (productId: string) => {
    if (user) {
      // Optimistic
      setDbFavoriteIds(prev => prev.filter(id => id !== productId));
      const { error } = await supabase.from('favorites').delete().eq('user_id', user.id).eq('product_id', productId);

      if (error) {
        console.error(error);
        toast.error('Erro ao remover favorito');
        setDbFavoriteIds(prev => [...prev, productId]);
      } else {
        toast.success('Removido dos favoritos');
      }
    } else {
      setLocalFavorites(prev => prev.filter(p => p.id !== productId));
      toast.success('Removido dos favoritos');
    }
  }, [user, setLocalFavorites]);

  const toggleFavorite = useCallback((product: Product) => {
    const isFav = user ? dbFavoriteIds.includes(product.id) : localFavorites.some(p => p.id === product.id);
    if (isFav) {
      removeFromFavorites(product.id);
    } else {
      addToFavorites(product);
    }
  }, [user, dbFavoriteIds, localFavorites, removeFromFavorites, addToFavorites]);

  const isFavorite = useCallback((productId: string) => {
    if (user) return dbFavoriteIds.includes(productId);
    return localFavorites.some(p => p.id === productId);
  }, [user, dbFavoriteIds, localFavorites]);

  return {
    favorites,
    toggleFavorite,
    isFavorite,
    loading
  };
}
