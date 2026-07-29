/**
 * useDataVault — React hook for DataVault lifecycle management
 *
 * Handles:
 * 1. DataVault initialization (IndexedDB open + migrations)
 * 2. First boot detection & full hydration from Supabase
 * 3. localStorage → IndexedDB migration (one-time)
 * 4. RealtimeSyncEngine startup for logged-in users
 *
 * Mount this hook ONCE at the app root level (e.g., in App.tsx or a provider).
 *
 * @module useDataVault
 */

import { useLeaderElection } from "@/hooks/useLeaderElection";
import { DataVault, type StoreName } from "@/lib/dataVault";
import { mapProductFromDB, mapVariantFromDB } from "@/lib/mappers";
import { RealtimeSyncEngine, type SyncEvent } from "@/lib/realtimeSyncEngine";
import { supabase } from "@/lib/supabase";
import { useEffect, useRef, useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DataVaultState {
  /** Whether the DataVault has finished initialization and IDB data is ready */
  isHydrated: boolean;
  /** Whether this is the first time the app is opened (no IDB data, no localStorage) */
  isFirstBoot: boolean;
  /** The DataVault instance (null until initialized) */
  vault: DataVault | null;
  /** Hydration progress (0-100) during first boot */
  hydrationProgress: number;
}

// ─── Hydration Logic ─────────────────────────────────────────────────────────

/**
 * Full hydration: fetches ALL data from Supabase and populates IndexedDB.
 * Called on first boot or when IDB is empty.
 */
async function hydrateAllStores(
  vault: DataVault,
  isAdmin: boolean,
  onProgress: (pct: number) => void,
): Promise<void> {
  try {
    const productSource = isAdmin ? "produtos" : "vw_produtos_public";
    const configSource = isAdmin ? "store_config" : "v_store_config";

    // Dispara todas as consultas de forma concorrente na rede
    const [
      productsResult,
      categoriesResult,
      bannersResult,
      configResult,
      couponsResult,
    ] = await Promise.all([
      supabase
        .from(productSource as any)
        .select("*, product_variants(*)")
        .limit(500)
        .order("data_cadastro", { ascending: false }),
      supabase.from("categorias").select("*").order("nome"),
      supabase.from("banners").select("*").order("order", { ascending: true }),
      supabase
        .from(configSource as any)
        .select("*")
        .single(),
      isAdmin
        ? supabase
            .from("coupons")
            .select("*")
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: null, error: null }),
    ]);

    // Processa e grava os Produtos e suas Variantes juntas
    if (productsResult.data) {
      const rawProducts = productsResult.data;
      const mappedProducts = rawProducts.map((p: any) => mapProductFromDB(p));
      await vault.replaceAll("products", mappedProducts);
      await vault.setLastSync("products");

      const allVariants = rawProducts.flatMap(
        (p: any) => p.product_variants || [],
      );
      if (allVariants.length > 0) {
        const mappedVariants = allVariants.map((v) => mapVariantFromDB(v));
        await vault.replaceAll("product_variants", mappedVariants);
        await vault.setLastSync("product_variants");
      }
    }
    onProgress(20);

    // Grava Categorias
    if (categoriesResult.data) {
      const mappedCategories = categoriesResult.data.map((item: any) => ({
        id: item.id,
        name: item.nome,
        slug: item.slug || "",
        description: item.descricao || "",
        isActive: item.ativo ?? true,
        createdAt: item.created_at,
      }));
      await vault.replaceAll("categories", mappedCategories);
      await vault.setLastSync("categories");
    }
    onProgress(40);

    // Grava Banners
    if (bannersResult.data) {
      const mappedBanners = bannersResult.data
        .filter((b: any) => b.image_url || b.imagem_url)
        .map((b: any) => ({
          id: b.id,
          imageUrl: b.image_url || b.imagem_url,
          title: b.title || "",
          link: b.link || undefined,
          position: b.position,
          active: b.active ?? b.ativo ?? true,
          order: b.order || 0,
        }));
      await vault.replaceAll("banners", mappedBanners);
      await vault.setLastSync("banners");
    }
    onProgress(60);

    // Grava Configurações da Loja
    if (configResult.data) {
      const rawConfig = configResult.data as any;
      await vault.replaceAll("store_config", [
        {
          id: "singleton",
          freeShippingMin:
            rawConfig.free_shipping_min !== null &&
            rawConfig.free_shipping_min !== undefined
              ? Number(rawConfig.free_shipping_min)
              : undefined,
          shippingFee:
            rawConfig.shipping_fee !== null &&
            rawConfig.shipping_fee !== undefined
              ? Number(rawConfig.shipping_fee)
              : undefined,
          whatsappNumber: rawConfig.whatsapp_number,
          shareText: rawConfig.share_text,
          businessHours: rawConfig.business_hours,
          enableReviews: rawConfig.enable_reviews,
          enableCoupons: rawConfig.enable_coupons,
          logoUrl: rawConfig.logo_url,
          primaryColor: rawConfig.primary_color,
          themeMode: rawConfig.theme_mode,
          realTimeSalesAlerts: rawConfig.real_time_sales_alerts,
          pushMarketingEnabled: rawConfig.push_marketing_enabled,
          minAppVersion: rawConfig.min_app_version,
          originCep: rawConfig.origin_cep,
          shippingProvider: rawConfig.shipping_provider,
          enabledShippingMethods: rawConfig.enabled_shipping_methods,
        },
      ]);
      await vault.setLastSync("store_config");
    }
    onProgress(80);

    // Grava Cupons (Admin)
    if (isAdmin && couponsResult.data) {
      const mappedCoupons = couponsResult.data.map((c: any) => ({
        id: c.id,
        code: c.code,
        type: c.type,
        value: c.value,
        minPurchase: c.min_purchase ?? undefined,
        usageLimit: c.usage_limit ?? undefined,
        usageCount: c.used_count || c.usage_count || 0,
        validUntil: c.valid_until ?? undefined,
        active: c.active ?? true,
      }));
      await vault.replaceAll("coupons", mappedCoupons);
      await vault.setLastSync("coupons");
    }
    onProgress(100);

    console.log("[useDataVault] Full parallel hydration complete.");
  } catch (err) {
    console.error("[useDataVault] Hydration error (non-fatal):", err);
    onProgress(100);
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useDataVault(isAdmin = false, userId?: string): DataVaultState {
  const { isLeader } = useLeaderElection();
  const [isHydrated, setIsHydrated] = useState(false);
  const [isFirstBoot, setIsFirstBoot] = useState(false);
  const [hydrationProgress, setHydrationProgress] = useState(0);
  const [vault, setVault] = useState<DataVault | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    // Prevent double-init in StrictMode
    if (initRef.current) return;
    initRef.current = true;

    let cancelled = false;

    const init = async () => {
      try {
        // Step 1: Open IndexedDB + run migrations
        const v = await DataVault.init();
        if (cancelled) return;
        setVault(v);

        // Step 2: Check if this is first boot
        const productsSync = await v.getLastSync("products");
        const productCount = await v.count("products");

        if (productsSync === 0 && productCount === 0) {
          // First boot — check if localStorage has data to migrate
          const hasLocalStorage =
            localStorage.getItem("ikcous_products_cache") !== null ||
            localStorage.getItem("ikcous_store_config_cache") !== null;

          if (hasLocalStorage) {
            // Migrate localStorage → IndexedDB
            console.log(
              "[useDataVault] Migrating from localStorage → IndexedDB...",
            );
            await v.migrateFromLocalStorage();
            setIsHydrated(true);
          } else {
            // True first boot — hydrate from Supabase
            setIsFirstBoot(true);
            console.log(
              "[useDataVault] First boot detected. Hydrating from Supabase...",
            );
            await hydrateAllStores(v, isAdmin, (pct) => {
              if (!cancelled) setHydrationProgress(pct);
            });
            if (!cancelled) {
              setIsFirstBoot(false);
              setIsHydrated(true);
            }
          }
        } else {
          // IDB already has data — instant boot
          console.log(
            `[useDataVault] IndexedDB has ${productCount} products (last sync: ${new Date(productsSync).toLocaleString()}). Instant boot.`,
          );
          setIsHydrated(true);
        }

        // Step 3: Start RealtimeSyncEngine (only for logged-in users)
        if (userId && !cancelled) {
          const cleanup = RealtimeSyncEngine.start(v, isLeader, isAdmin);
          cleanupRef.current = cleanup;
        }
      } catch (err) {
        console.error("[useDataVault] Init failed:", err);
        // Graceful degradation: mark as hydrated so the app can still work via network
        if (!cancelled) setIsHydrated(true);
      }
    };

    init();

    return () => {
      cancelled = true;
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restart realtime when user changes (login/logout) or leadership changes
  useEffect(() => {
    if (!vault || !isHydrated) return;

    // Stop existing
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    // Restart for new user
    if (userId) {
      const cleanup = RealtimeSyncEngine.start(vault, isLeader, isAdmin);
      cleanupRef.current = cleanup;
    }

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [userId, vault, isHydrated, isLeader, isAdmin]);

  return {
    isHydrated,
    isFirstBoot,
    vault,
    hydrationProgress,
  };
}

// ─── Utility: Subscribe to sync events from React ────────────────────────────

/**
 * React hook to listen for realtime sync events on specific stores.
 * Re-renders the component when a matching event occurs.
 *
 * @param stores - Store names to listen for
 * @param callback - Called with the sync event
 */
export function useSyncListener(
  stores: StoreName[],
  callback: (event: SyncEvent) => void,
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const unsubscribe = RealtimeSyncEngine.onSync((event) => {
      if (stores.includes(event.store)) {
        callbackRef.current(event);
      }
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores.join(",")]);
}
