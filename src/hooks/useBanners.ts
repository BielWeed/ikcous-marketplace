import { useAuth } from "@/hooks/useAuth";
import { useSyncListener } from "@/hooks/useDataVault";
import { DataVault } from "@/lib/dataVault";
import { supabase } from "@/lib/supabase";
import type { Banner } from "@/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// Module-level cache to persist data across component mounts
let globalBannersCache: Banner[] | null = null;
let bannersFetchPromise: Promise<Banner[]> | null = null;
let lastBannersFetchTime = 0;
const FETCH_THROTTLE = 60000; // 1 minute throttle for network checks

const preloadTopBanner = (items: Banner[]) => {
  const topBanner = items.find((b) => b.position === "home_top" && b.active);
  if (topBanner?.imageUrl && typeof window !== "undefined") {
    const img = new Image();
    img.src = topBanner.imageUrl;
  }
};

async function normalizeBannersOrder(
  pos: "home_top" | "home_middle" | "home_bottom",
) {
  try {
    const { data, error } = await supabase
      .from("banners")
      .select("id, order")
      .eq("position", pos)
      .order("order", { ascending: true })
      .order("id", { ascending: true });

    if (error) throw error;
    if (!data || data.length === 0) return;

    const updates = data
      .map((b: any, idx: number) => {
        const targetOrder = idx + 1;
        if (b.order !== targetOrder) {
          return supabase
            .from("banners")
            .update({ order: targetOrder })
            .eq("id", b.id);
        }
        return null;
      })
      .filter(Boolean);

    if (updates.length > 0) {
      await Promise.all(updates);
      console.log(
        `[Banners] Normalized ${updates.length} orders for position: ${pos}`,
      );
    }
  } catch (err) {
    console.error("[Banners] Error normalizing banners order:", err);
  }
}

export function useBanners(adminMode = false) {
  const { isAdmin } = useAuth();
  const vaultRef = useRef<DataVault | null>(null);
  const [banners, setBanners] = useState<Banner[]>(globalBannersCache || []);
  const [isLoaded, setIsLoaded] = useState(!!globalBannersCache);
  const isFetchingRef = useRef(false);

  // Persist to DataVault (non-blocking helper)
  const persistToVault = useCallback((items: Banner[]) => {
    vaultRef.current
      ?.replaceAll("banners", items)
      .then(() => {
        vaultRef.current?.setLastSync("banners");
      })
      .catch(() => {});
  }, []);

  const normalizeLocalBannersOrder = useCallback(
    (
      pos: "home_top" | "home_middle" | "home_bottom",
      currentList: Banner[],
    ): Banner[] => {
      const samePosBanners = currentList
        .filter((b) => b.position === pos)
        .sort(
          (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id),
        );

      const orderMap = new Map(samePosBanners.map((b, idx) => [b.id, idx + 1]));

      return currentList.map((b) =>
        b.position === pos ? { ...b, order: orderMap.get(b.id) ?? b.order } : b,
      );
    },
    [],
  );

  const deleteStorageFileByUrl = useCallback(async (imageUrl: string) => {
    try {
      if (!imageUrl || imageUrl.includes("placeholder")) return;
      const url = new URL(imageUrl);
      const fileName = url.pathname.split("/").pop();
      if (fileName) {
        await supabase.storage.from("banners").remove([fileName]);
      }
    } catch (err) {
      console.warn(
        "[useBanners] Failed to delete storage file from URL:",
        imageUrl,
        err,
      );
    }
  }, []);

  // Load from DataVault on mount (instant, <5ms)
  useEffect(() => {
    let cancelled = false;
    const initVaultAndLoad = async () => {
      try {
        const vault = await DataVault.init();
        vaultRef.current = vault;
        if (!globalBannersCache) {
          const cached = await vault.getAll<Banner>("banners");
          if (cached.length > 0 && !cancelled) {
            globalBannersCache = cached;
            preloadTopBanner(cached);
            setBanners(cached);
            setIsLoaded(true);
          }
        }
      } catch (err) {
        console.error("[useBanners] DataVault load failed:", err);
      }
    };
    initVaultAndLoad();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchBanners = useCallback(
    async (_onlyActive = false, forceRefresh = false) => {
      // If a network fetch is already active, wait for it (never duplicate parallel fetches)
      if (bannersFetchPromise) {
        try {
          const data = await bannersFetchPromise;
          setBanners(data);
          setIsLoaded(true);
        } catch {
          /* fallback */
        }
        return;
      }

      // Prevent duplicate concurrent fetches
      if (isFetchingRef.current && !forceRefresh) return;

      isFetchingRef.current = true;

      const queryPromise = (async () => {
        console.log("[Banners] Fetching banners...");
        const query = supabase.from("banners").select("*");

        const { data, error } = await query.order("order", { ascending: true });

        if (error) {
          console.error("[Banners] Supabase error:", error);
          throw error;
        }

        console.log(`[Banners] Found ${data?.length || 0} banners`);

        if (data) {
          const mappedBanners: Banner[] = data
            .filter((b: any) => b.image_url || b.imagem_url)
            .map((b: any) => ({
              id: b.id,
              imageUrl: b.image_url || b.imagem_url,
              title: b.title || "",
              link: b.link || undefined,
              position: b.position as
                | "home_top"
                | "home_middle"
                | "home_bottom",
              active: b.active ?? b.ativo ?? true,
              order: b.order || 0,
              subtitle: b.subtitle || "",
              titleColor: b.title_color || "",
              subtitleColor: b.subtitle_color || "",
              buttonText: b.button_text || "",
              buttonBgColor: b.button_bg_color || "",
              buttonTextColor: b.button_text_color || "",
              fontFamily: b.font_family || "",
              overlayColor: b.overlay_color || "",
              overlayOpacity:
                b.overlay_opacity !== null && b.overlay_opacity !== undefined
                  ? Number(b.overlay_opacity)
                  : undefined,
              badgeText: b.badge_text || "",
              templateType: b.template_type || "default",
              productId: b.product_id || undefined,
              startDate: b.start_date || null,
              endDate: b.end_date || null,
              showTextOverlay: b.show_text_overlay ?? true,
            }));

          globalBannersCache = mappedBanners;
          preloadTopBanner(mappedBanners);
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
        console.error("[Banners] Error fetching banners:", error.message);
      } finally {
        setIsLoaded(true);
        isFetchingRef.current = false;
        bannersFetchPromise = null;
      }
    },
    [persistToVault],
  );

  useEffect(() => {
    // Only fetch from network if DataVault didn't have cached data
    if (!isLoaded) {
      fetchBanners(false, true);
    } else if (Date.now() - lastBannersFetchTime > FETCH_THROTTLE) {
      // Stale-While-Revalidate: cached data is shown, fetch fresh in background if throttled out
      fetchBanners(false, true);
    }
  }, [fetchBanners, isLoaded]);

  const getBannersByPosition = useCallback(
    (position: Banner["position"]) => {
      const now = new Date();
      return banners
        .filter((b) => {
          if (b.position !== position) return false;
          if (adminMode) return true;
          if (!b.active) return false;

          if (b.startDate) {
            const start = new Date(b.startDate);
            if (now < start) return false;
          }
          if (b.endDate) {
            const end = new Date(b.endDate);
            if (now > end) return false;
          }

          return true;
        })
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    },
    [banners, adminMode],
  );

  const uploadBannerImage = async (file: File): Promise<string> => {
    if (!isAdmin) {
      throw new Error(
        "Acesso negado: Apenas administradores podem fazer upload de imagens de banners.",
      );
    }
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("banners")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("banners").getPublicUrl(filePath);

      return data.publicUrl;
    } catch (error) {
      console.error("Error uploading banner:", error);
      throw error;
    }
  };

  const addBanner = async (banner: Omit<Banner, "id">) => {
    if (!isAdmin)
      throw new Error(
        "Acesso negado: Apenas administradores podem adicionar banners.",
      );
    try {
      const { data, error } = await supabase
        .from("banners")
        .insert([
          {
            image_url: banner.imageUrl,
            title: banner.title,
            link: banner.link,
            position: banner.position,
            active: banner.active,
            order: banner.order,
            subtitle: banner.subtitle,
            title_color: banner.titleColor,
            subtitle_color: banner.subtitleColor,
            button_text: banner.buttonText,
            button_bg_color: banner.buttonBgColor,
            button_text_color: banner.buttonTextColor,
            font_family: banner.fontFamily,
            overlay_color: banner.overlayColor,
            overlay_opacity: banner.overlayOpacity,
            badge_text: banner.badgeText,
            template_type: banner.templateType,
            product_id: banner.productId || null,
            start_date: banner.startDate || null,
            end_date: banner.endDate || null,
            show_text_overlay: banner.showTextOverlay ?? true,
          },
        ])
        .select()
        .single();

      if (error) throw error;

      const newBanner: Banner = {
        id: data.id,
        imageUrl: data.image_url,
        title: data.title || "",
        link: data.link || undefined,
        position: data.position as "home_top" | "home_middle" | "home_bottom",
        active: data.active ?? true,
        order: data.order || 0,
        subtitle: data.subtitle || "",
        titleColor: data.title_color || "",
        subtitleColor: data.subtitle_color || "",
        buttonText: data.button_text || "",
        buttonBgColor: data.button_bg_color || "",
        buttonTextColor: data.button_text_color || "",
        fontFamily: data.font_family || "",
        overlayColor: data.overlay_color || "",
        overlayOpacity:
          data.overlay_opacity !== null && data.overlay_opacity !== undefined
            ? Number(data.overlay_opacity)
            : undefined,
        badgeText: data.badge_text || "",
        templateType: data.template_type || "default",
        productId: data.product_id || undefined,
        startDate: data.start_date || null,
        endDate: data.end_date || null,
        showTextOverlay: data.show_text_overlay ?? true,
      };

      const updatedBanners = normalizeLocalBannersOrder(
        data.position as "home_top" | "home_middle" | "home_bottom",
        [...banners, newBanner],
      );
      persistToVault(updatedBanners);
      setBanners(updatedBanners);

      // Async normalization of position order in DB
      normalizeBannersOrder(
        data.position as "home_top" | "home_middle" | "home_bottom",
      ).catch(() => {});

      toast.success("Banner adicionado com sucesso!");
      return data;
    } catch (error) {
      console.error("Error adding banner:", error);
      toast.error("Erro ao adicionar banner.");
      throw error;
    }
  };

  const updateBanner = async (id: string, updates: Partial<Banner>) => {
    if (!isAdmin)
      throw new Error(
        "Acesso negado: Apenas administradores podem atualizar banners.",
      );

    const oldBanner = banners.find((b) => b.id === id);

    // Optimistic Update
    const previousBanners = [...banners];
    let updated = banners.map((b) => (b.id === id ? { ...b, ...updates } : b));

    if (
      updates.position &&
      oldBanner &&
      updates.position !== oldBanner.position
    ) {
      updated = normalizeLocalBannersOrder(oldBanner.position, updated);
      updated = normalizeLocalBannersOrder(updates.position, updated);
    } else if (updates.order !== undefined && oldBanner) {
      updated = normalizeLocalBannersOrder(oldBanner.position, updated);
    }

    persistToVault(updated);
    setBanners(updated);

    try {
      const dbUpdates: any = {};
      if (updates.imageUrl !== undefined)
        dbUpdates.image_url = updates.imageUrl;
      if (updates.title !== undefined) dbUpdates.title = updates.title;
      if (updates.link !== undefined) dbUpdates.link = updates.link;
      if (updates.position !== undefined) dbUpdates.position = updates.position;
      if (updates.active !== undefined) dbUpdates.active = updates.active;
      if (updates.order !== undefined) dbUpdates.order = updates.order;
      if (updates.subtitle !== undefined) dbUpdates.subtitle = updates.subtitle;
      if (updates.titleColor !== undefined)
        dbUpdates.title_color = updates.titleColor;
      if (updates.subtitleColor !== undefined)
        dbUpdates.subtitle_color = updates.subtitleColor;
      if (updates.buttonText !== undefined)
        dbUpdates.button_text = updates.buttonText;
      if (updates.buttonBgColor !== undefined)
        dbUpdates.button_bg_color = updates.buttonBgColor;
      if (updates.buttonTextColor !== undefined)
        dbUpdates.button_text_color = updates.buttonTextColor;
      if (updates.fontFamily !== undefined)
        dbUpdates.font_family = updates.fontFamily;
      if (updates.overlayColor !== undefined)
        dbUpdates.overlay_color = updates.overlayColor;
      if (updates.overlayOpacity !== undefined)
        dbUpdates.overlay_opacity = updates.overlayOpacity;
      if (updates.badgeText !== undefined)
        dbUpdates.badge_text = updates.badgeText;
      if (updates.templateType !== undefined)
        dbUpdates.template_type = updates.templateType;
      if (updates.productId !== undefined)
        dbUpdates.product_id = updates.productId || null;
      if (updates.startDate !== undefined)
        dbUpdates.start_date = updates.startDate || null;
      if (updates.endDate !== undefined)
        dbUpdates.end_date = updates.endDate || null;
      if (updates.showTextOverlay !== undefined)
        dbUpdates.show_text_overlay = updates.showTextOverlay;

      const { error } = await supabase
        .from("banners")
        .update(dbUpdates)
        .eq("id", id);

      if (error) throw error;

      // If image changed, clean up old file from storage
      if (
        updates.imageUrl &&
        oldBanner &&
        oldBanner.imageUrl !== updates.imageUrl
      ) {
        deleteStorageFileByUrl(oldBanner.imageUrl).catch(() => {});
      }

      // Run DB order normalization if position or order changed
      if (oldBanner) {
        if (updates.position && updates.position !== oldBanner.position) {
          normalizeBannersOrder(oldBanner.position).catch(() => {});
          normalizeBannersOrder(updates.position).catch(() => {});
        } else if (
          updates.order !== undefined ||
          updates.position !== undefined
        ) {
          normalizeBannersOrder(oldBanner.position).catch(() => {});
        }
      }

      toast.success("Banner atualizado com sucesso!");
    } catch (error) {
      console.error("Error updating banner:", error);
      toast.error("Erro ao atualizar banner.");
      persistToVault(previousBanners);
      setBanners(previousBanners);
      throw error;
    }
  };

  const reorderBanners = async (
    activeBannerId: string,
    overBannerId: string,
  ) => {
    if (!isAdmin) {
      toast.error(
        "Acesso negado: Apenas administradores podem reordenar banners.",
      );
      return;
    }

    const activeBanner = banners.find((b) => b.id === activeBannerId);
    const overBanner = banners.find((b) => b.id === overBannerId);
    if (!activeBanner || !overBanner) return;

    // Resolve any clashing/duplicate order issues in the database first
    const activePosition = activeBanner.position;
    const samePosBanners = banners.filter((b) => b.position === activePosition);
    const hasOrderCollision = samePosBanners.some((b, idx) => {
      const matchIndex = samePosBanners.findIndex((x) => x.order === b.order);
      return matchIndex !== idx;
    });

    if (hasOrderCollision) {
      console.log(
        `[Banners] Collision detected in ${activePosition}. Normalizing before swap.`,
      );
      try {
        const sorted = [...samePosBanners].sort((a, b) => {
          if ((a.order ?? 0) !== (b.order ?? 0))
            return (a.order ?? 0) - (b.order ?? 0);
          return a.id.localeCompare(b.id);
        });
        const updates = sorted.map((b, idx) => {
          b.order = idx + 1;
          return supabase
            .from("banners")
            .update({ order: idx + 1 })
            .eq("id", b.id);
        });
        await Promise.all(updates);
      } catch (err) {
        console.error("[Banners] Collision normalization failed:", err);
      }
    }

    // 1. Optimistic Update
    const previousBanners = [...banners];
    const newBanners = [...banners];
    const activeIndex = newBanners.findIndex((b) => b.id === activeBannerId);
    const overIndex = newBanners.findIndex((b) => b.id === overBannerId);

    if (activeIndex !== -1 && overIndex !== -1) {
      const activeB = { ...newBanners[activeIndex] };
      const overB = { ...newBanners[overIndex] };

      // Swap the 'order' values
      const tempOrder = activeB.order;
      activeB.order = overB.order;
      overB.order = tempOrder;

      newBanners[activeIndex] = overB;
      newBanners[overIndex] = activeB;

      // Sort by order
      const cachedBanners = [...banners];
      cachedBanners[activeIndex] = overB;
      cachedBanners[overIndex] = activeB;
      cachedBanners.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      persistToVault(cachedBanners);
      setBanners(cachedBanners);
    }

    try {
      const { error } = await (supabase.rpc as any)("swap_banner_order", {
        banner_id_1: activeBannerId,
        banner_id_2: overBannerId,
      });

      if (error) throw error;
    } catch (error) {
      persistToVault(previousBanners);
      setBanners(previousBanners);
      console.error("Error reordering banners:", error);
      toast.error("Erro ao reordenar banners.");
    }
  };

  const deleteBanner = async (id: string, imageUrl?: string) => {
    if (!isAdmin)
      throw new Error(
        "Acesso negado: Apenas administradores podem excluir banners.",
      );
    try {
      const { error } = await supabase.from("banners").delete().eq("id", id);

      if (error) throw error;

      const deletedBanner = banners.find((b) => b.id === id);

      if (imageUrl) {
        deleteStorageFileByUrl(imageUrl).catch(() => {});
      }

      let updated = banners.filter((b) => b.id !== id);
      if (deletedBanner) {
        updated = normalizeLocalBannersOrder(deletedBanner.position, updated);
        normalizeBannersOrder(deletedBanner.position).catch(() => {});
      }

      persistToVault(updated);
      setBanners(updated);
      toast.success("Banner excluído com sucesso!");
    } catch (error) {
      console.error("Error deleting banner:", error);
      toast.error("Erro ao excluir banner.");
      throw error;
    }
  };

  // Realtime sync: re-read from DataVault when RealtimeSyncEngine updates banners
  useSyncListener(
    ["banners"],
    useCallback(async () => {
      if (vaultRef.current) {
        const fresh = await vaultRef.current.getAll<Banner>("banners");
        if (fresh.length > 0) {
          setBanners(fresh);
        }
      }
    }, []),
  );

  return {
    banners,
    isLoaded,
    getBannersByPosition,
    uploadBannerImage,
    addBanner,
    updateBanner,
    deleteBanner,
    deleteStorageFile: deleteStorageFileByUrl,
    reorderBanners,
    refreshBanners: fetchBanners,
  };
}
