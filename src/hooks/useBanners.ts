import { useState, useEffect, useCallback } from 'react';
import type { Banner } from '@/types';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

// Module-level cache to persist banners across component remounts
let cachedBanners: Banner[] = [];
let isInitialLoadDone = false;
let globalFetchPromise: Promise<void> | null = null;

import { useAuth } from '@/hooks/useAuth';

export function useBanners() {
  const { isAdmin } = useAuth();
  const [banners, setBanners] = useState<Banner[]>(cachedBanners);
  const [isLoaded, setIsLoaded] = useState(isInitialLoadDone);

  const fetchBanners = useCallback(async (onlyActive = true, forceRefresh = false) => {
    // If already fetching, wait for the same promise
    if (globalFetchPromise !== null && !forceRefresh) return globalFetchPromise;

    // If already loaded and not forcing refresh, skip
    if (isInitialLoadDone && !forceRefresh) return;

    const fetchAction = async () => {
      try {
        console.log('[Banners] Fetching banners...');
        let query = supabase
          .from('banners')
          .select('*');

        if (onlyActive) {
          query = query.eq('active', true);
        }

        const { data, error } = await query.order('order', { ascending: true });

        if (error) {
          console.error('[Banners] Supabase error:', error);
          throw error;
        }

        console.log(`[Banners] Found ${data?.length || 0} banners`);

        if (data) {
          const mappedBanners: Banner[] = data
            .filter((b: any) => b.image_url || b.imagem_url) // Garantir que tem imagem
            .map((b: any) => ({
              id: b.id,
              imageUrl: b.image_url || b.imagem_url,
              title: b.title || '',
              link: b.link || undefined,
              position: b.position as "home_top" | "home_middle" | "home_bottom",
              active: b.active ?? b.ativo ?? true,
              order: b.order || 0
            }));

          cachedBanners = mappedBanners;
          setBanners(mappedBanners);
        }
        isInitialLoadDone = true;
      } catch (error: any) {
        console.error('[Banners] Error fetching banners:', error.message);
      } finally {
        setIsLoaded(true);
        globalFetchPromise = null;
      }
    };

    globalFetchPromise = fetchAction();
    return globalFetchPromise;
  }, []);

  useEffect(() => {
    if (!isInitialLoadDone) {
      fetchBanners();
    }
  }, [fetchBanners]);

  const getBannersByPosition = useCallback((position: Banner['position']) => {
    return banners
      .filter(b => b.position === position) // Filter by activity happened in fetchBanners
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [banners]);

  const uploadBannerImage = async (file: File): Promise<string> => {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('banners')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('banners')
        .getPublicUrl(filePath);

      return data.publicUrl;
    } catch (error) {
      console.error('Error uploading banner:', error);
      throw error;
    }
  };

  const addBanner = async (banner: Omit<Banner, 'id'>) => {
    if (!isAdmin) throw new Error('Acesso negado: Apenas administradores podem adicionar banners.');
    try {
      const { data, error } = await supabase
        .from('banners')
        .insert([{
          image_url: banner.imageUrl,
          title: banner.title,
          link: banner.link,
          position: banner.position,
          active: banner.active,
          order: banner.order
        }])
        .select()
        .single();

      if (error) throw error;

      isInitialLoadDone = false; // Force re-fetch to update cache correctly
      return data;
    } catch (error) {
      console.error('Error adding banner:', error);
      throw error;
    }
  };

  const updateBanner = async (id: string, updates: Partial<Banner>) => {
    if (!isAdmin) throw new Error('Acesso negado: Apenas administradores podem atualizar banners.');
    try {
      const dbUpdates: any = {};
      if (updates.imageUrl !== undefined) dbUpdates.image_url = updates.imageUrl;
      if (updates.title !== undefined) dbUpdates.title = updates.title;
      if (updates.link !== undefined) dbUpdates.link = updates.link;
      if (updates.position !== undefined) dbUpdates.position = updates.position;
      if (updates.active !== undefined) dbUpdates.active = updates.active;
      if (updates.order !== undefined) dbUpdates.order = updates.order;

      const { error } = await supabase
        .from('banners')
        .update(dbUpdates)
        .eq('id', id);

      if (error) throw error;
      isInitialLoadDone = false;
    } catch (error) {
      console.error('Error updating banner:', error);
      throw error;
    }
  };

  const reorderBanners = async (activeBannerId: string, overBannerId: string) => {
    if (!isAdmin) {
      toast.error('Acesso negado: Apenas administradores podem reordenar banners.');
      return;
    }
    // 1. Optimistic Update
    const previousBanners = [...banners];
    const newBanners = [...banners];
    const activeIndex = newBanners.findIndex(b => b.id === activeBannerId);
    const overIndex = newBanners.findIndex(b => b.id === overBannerId);

    if (activeIndex !== -1 && overIndex !== -1) {
      const activeBanner = { ...newBanners[activeIndex] };
      const overBanner = { ...newBanners[overIndex] };

      // Swap the 'order' values
      const tempOrder = activeBanner.order;
      activeBanner.order = overBanner.order;
      overBanner.order = tempOrder;

      newBanners[activeIndex] = overBanner;
      newBanners[overIndex] = activeBanner;

      // Sort by order
      newBanners.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      setBanners(newBanners);
    }

    try {
      // 2. Atomic Swap via RPC
      const { error } = await (supabase.rpc as any)('swap_banner_order', {
        banner_id_1: activeBannerId,
        banner_id_2: overBannerId
      });

      if (error) throw error;
      isInitialLoadDone = false;
    } catch (error) {
      setBanners(previousBanners);
      console.error('Error reordering banners:', error);
    }
  };

  const deleteBanner = async (id: string, imageUrl?: string) => {
    if (!isAdmin) throw new Error('Acesso negado: Apenas administradores podem excluir banners.');
    try {
      const { error } = await supabase
        .from('banners')
        .delete()
        .eq('id', id);

      if (error) throw error;

      if (imageUrl) {
        try {
          const url = new URL(imageUrl);
          const fileName = url.pathname.split('/').pop();
          if (fileName && !fileName.includes('placeholder')) {
            await supabase.storage.from('banners').remove([fileName]);
          }
        } catch {
          const fileName = imageUrl.split('/').pop();
          if (fileName) {
            await supabase.storage.from('banners').remove([fileName]);
          }
        }
      }
      cachedBanners = cachedBanners.filter(b => b.id !== id);
      setBanners(prev => prev.filter(b => b.id !== id));
    } catch (error) {
      console.error('Error deleting banner:', error);
      throw error;
    }
  };

  return {
    banners,
    isLoaded,
    getBannersByPosition,
    uploadBannerImage,
    addBanner,
    updateBanner,
    deleteBanner,
    reorderBanners,
    refreshBanners: fetchBanners
  };
}
