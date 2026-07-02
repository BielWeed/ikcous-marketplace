import { useState, useEffect, useCallback, useRef } from 'react';
import type { Banner } from '@/types';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { DataVault } from '@/lib/dataVault';
import { useSyncListener } from '@/hooks/useDataVault';
import { useAuth } from '@/hooks/useAuth';

// Module-level cache to persist data across component mounts
let globalBannersCache: Banner[] | null = null;
let bannersFetchPromise: Promise<Banner[]> | null = null;
let lastBannersFetchTime = 0;
let cacheOnlyActive: boolean | null = null;
const FETCH_THROTTLE = 60000; // 1 minute throttle for network checks

export function useBanners(adminMode: boolean = false) {
  const { isAdmin } = useAuth();
  const vaultRef = useRef<DataVault | null>(null);
  const [banners, setBanners] = useState<Banner[]>(globalBannersCache || []);
  const [isLoaded, setIsLoaded] = useState(!!globalBannersCache);
  const isFetchingRef = useRef(false);

  // Persist to DataVault (non-blocking helper)
  const persistToVault = useCallback((items: Banner[]) => {
    vaultRef.current?.replaceAll('banners', items).then(() => {
      vaultRef.current?.setLastSync('banners');
    }).catch(() => {});
  }, []);

  // Load from DataVault on mount (instant, <5ms)
  useEffect(() => {
    let cancelled = false;
    const initVaultAndLoad = async () => {
      try {
        const vault = await DataVault.init();
        vaultRef.current = vault;
        if (!globalBannersCache) {
          const cached = await vault.getAll<Banner>('banners');
          if (cached.length > 0 && !cancelled) {
            globalBannersCache = cached;
            setBanners(cached);
            setIsLoaded(true);
          }
        }
      } catch (err) {
        console.error('[useBanners] DataVault load failed:', err);
      }
    };
    initVaultAndLoad();
    return () => { cancelled = true; };
  }, []);

  const fetchBanners = useCallback(async (onlyActive = !adminMode, forceRefresh = false) => {
    // Prevent duplicate concurrent fetches
    if (isFetchingRef.current && !forceRefresh) return;
    
    // If a network fetch is already active, wait for it
    if (bannersFetchPromise && !forceRefresh) {
      try {
        const data = await bannersFetchPromise;
        setBanners(data);
        setIsLoaded(true);
      } catch { /* fallback */ }
      return;
    }

    isFetchingRef.current = true;

    const queryPromise = (async () => {
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
          .filter((b: any) => b.image_url || b.imagem_url)
          .map((b: any) => ({
            id: b.id,
            imageUrl: b.image_url || b.imagem_url,
            title: b.title || '',
            link: b.link || undefined,
            position: b.position as "home_top" | "home_middle" | "home_bottom",
            active: b.active ?? b.ativo ?? true,
            order: b.order || 0
          }));

        globalBannersCache = mappedBanners;
        cacheOnlyActive = onlyActive;
        lastBannersFetchTime = Date.now();
        persistToVault(mappedBanners);
        return mappedBanners;
      }
      return [];
    })();

    bannersFetchPromise = queryPromise;

    try {
      const mappedBanners = await queryPromise;
      setBanners(mappedBanners);
    } catch (error: any) {
      console.error('[Banners] Error fetching banners:', error.message);
    } finally {
      setIsLoaded(true);
      isFetchingRef.current = false;
      bannersFetchPromise = null;
    }
  }, [persistToVault, adminMode]);

  useEffect(() => {
    const needsDifferentCacheType = cacheOnlyActive !== null && cacheOnlyActive !== !adminMode;
    
    // Only fetch from network if DataVault didn't have cached data or cache type mismatch
    if (!isLoaded || needsDifferentCacheType) {
      fetchBanners(!adminMode, true);
    } else if (Date.now() - lastBannersFetchTime > FETCH_THROTTLE) {
      // Stale-While-Revalidate: cached data is shown, fetch fresh in background if throttled out
      fetchBanners(!adminMode, true);
    }
  }, [fetchBanners, isLoaded, adminMode]);

  const getBannersByPosition = useCallback((position: Banner['position']) => {
    return banners
      .filter(b => b.position === position && (adminMode || b.active))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [banners, adminMode]);

  const uploadBannerImage = async (file: File): Promise<string> => {
    if (!isAdmin) {
      throw new Error('Acesso negado: Apenas administradores podem fazer upload de imagens de banners.');
    }
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

      const newBanner: Banner = {
        id: data.id,
        imageUrl: data.image_url,
        title: data.title || '',
        link: data.link || undefined,
        position: data.position as "home_top" | "home_middle" | "home_bottom",
        active: data.active ?? true,
        order: data.order || 0
      };

      const updatedBanners = [...banners, newBanner];
      persistToVault(updatedBanners);
      setBanners(updatedBanners);


      toast.success('Banner adicionado com sucesso!');
      return data;
    } catch (error) {
      console.error('Error adding banner:', error);
      toast.error('Erro ao adicionar banner.');
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

      const updated = banners.map(b => b.id === id ? { ...b, ...updates } : b);
      persistToVault(updated);
      setBanners(updated);


      toast.success('Banner atualizado com sucesso!');
    } catch (error) {
      console.error('Error updating banner:', error);
      toast.error('Erro ao atualizar banner.');
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
      const cachedBanners = [...banners];
      cachedBanners[activeIndex] = overBanner;
      cachedBanners[overIndex] = activeBanner;
      cachedBanners.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      
      persistToVault(cachedBanners);
      setBanners(cachedBanners);
    }

    try {
      const { error } = await (supabase.rpc as any)('swap_banner_order', {
        banner_id_1: activeBannerId,
        banner_id_2: overBannerId
      });

      if (error) throw error;
    } catch (error) {
      persistToVault(previousBanners);
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
      const updated = banners.filter(b => b.id !== id);
      persistToVault(updated);
      setBanners(prev => prev.filter(b => b.id !== id));
      toast.success('Banner excluído com sucesso!');
    } catch (error) {
      console.error('Error deleting banner:', error);
      toast.error('Erro ao excluir banner.');
      throw error;
    }
  };

  // Realtime sync: re-read from DataVault when RealtimeSyncEngine updates banners
  useSyncListener(['banners'], useCallback(async () => {
    if (vaultRef.current) {
      const fresh = await vaultRef.current.getAll<Banner>('banners');
      if (fresh.length > 0) {
        setBanners(fresh);
      }
    }
  }, []));

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
