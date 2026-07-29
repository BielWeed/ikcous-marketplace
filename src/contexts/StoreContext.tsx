import { hexToTailwindHsl } from "@/config/branding";
import { useAuth } from "@/hooks/useAuth";
import { useSyncListener } from "@/hooks/useDataVault";
import { useLeaderElection } from "@/hooks/useLeaderElection";
import { DataVault } from "@/lib/dataVault";
import { mapProductFromDB } from "@/lib/mappers";
import { RealtimeSyncEngine } from "@/lib/realtimeSyncEngine";
import { supabase } from "@/lib/supabase";
import type { CartItem, Product, ShippingOption, StoreConfig } from "@/types";
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { toast } from "sonner";

const defaultStoreConfig: StoreConfig = {
  freeShippingMin: 350,
  shippingFee: 15,
  whatsappNumber: "34999999999",
  shareText: "Olha que achei na IKCOUS!",
  businessHours: "Seg-Sáb: 9h às 18h",
  enableReviews: true,
  enableCoupons: true,
  primaryColor: "#000000",
  themeMode: "light",
  realTimeSalesAlerts: true,
  pushMarketingEnabled: false,
  originCep: "38500-000",
  shippingProvider: "flat_fee",
  enabledShippingMethods: ["sedex", "pac"],
  shippingCoverage: "national",
  localDeliveryFee: 10,
  localCepRange: "",
  homeSections: [
    { id: "new_arrivals", title: "Últimos Lançamentos", active: true },
    { id: "offers", title: "Ofertas Imperdíveis", active: true },
    { id: "bestsellers", title: "Destaques em Alta", active: true },
  ],
};

interface StoreContextType {
  config: StoreConfig;
  isLoaded: boolean;
  products: Product[];
  loadingProducts: boolean;
  updateConfig: (updates: Partial<StoreConfig>) => Promise<void>;
  refresh: (options?: { onlyConfig?: boolean }) => Promise<void>;
  fetchProducts: () => Promise<void>;
  calculateShipping: (
    cart: CartItem[],
    selectedOption?: ShippingOption | null,
  ) => number;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

export function StoreProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { isAdmin, loading } = useAuth();
  const { isLeader } = useLeaderElection();
  const vaultRef = useRef<DataVault | null>(null);
  const [config, setConfig] = useState<StoreConfig>(defaultStoreConfig);
  const [isLoaded, setIsLoaded] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  // ── DataVault: Load config from IDB on mount (instant, <5ms) ──
  useEffect(() => {
    let cancelled = false;
    const loadFromVault = async () => {
      try {
        const vault = await DataVault.init();
        vaultRef.current = vault;

        // Load config from IDB
        const cachedConfig = await vault.getById<any>(
          "store_config",
          "singleton",
        );
        if (cachedConfig && !cancelled) {
          const { id: _id, ...configData } = cachedConfig;
          const merged = { ...defaultStoreConfig, ...configData };
          setConfig(merged);
          setIsLoaded(true);
          // Apply branding immediately
          if (merged.primaryColor) {
            document.documentElement.style.setProperty(
              "--primary",
              hexToTailwindHsl(merged.primaryColor),
            );
          }
          if (merged.themeMode === "dark" || merged.themeMode === "glass") {
            document.documentElement.classList.add("dark");
            if (merged.themeMode === "glass") {
              document.documentElement.setAttribute("data-theme-mode", "glass");
            }
          } else {
            document.documentElement.classList.remove("dark");
            document.documentElement.removeAttribute("data-theme-mode");
          }
        }

        // Load products from IDB
        const cachedProducts = await vault.getAll<Product>("products");
        if (cachedProducts.length > 0 && !cancelled) {
          setProducts(cachedProducts);
          setLoadingProducts(false);
        }
      } catch (err) {
        console.error(
          "[StoreContext] DataVault load failed, purging cache stores and fetching from network:",
          err,
        );
        try {
          const vault = vaultRef.current || (await DataVault.init());
          if (vault) {
            const stores: import("@/lib/dataVault").StoreName[] = [
              "products",
              "categories",
              "banners",
              "store_config",
              "coupons",
              "product_variants",
              "_meta",
            ];
            await Promise.all(
              stores.map((s) => vault.clear(s).catch(() => {})),
            );
          }
        } catch (clearErr) {
          console.error(
            "[StoreContext] Failed to clear DataVault stores:",
            clearErr,
          );
        }
        // Fallback to let UI load from network instead of hanging on loader
        setIsLoaded(true);
        setLoadingProducts(true);
      }
    };
    loadFromVault();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyBranding = useCallback((primaryColor?: string) => {
    if (primaryColor) {
      document.documentElement.style.setProperty(
        "--primary",
        hexToTailwindHsl(primaryColor),
      );
    }
  }, []);

  useEffect(() => {
    if (config.primaryColor) {
      applyBranding(config.primaryColor);
    }

    // Sync theme mode with DOM
    if (config.themeMode) {
      const root = document.documentElement;
      if (config.themeMode === "dark") {
        root.classList.add("dark");
        root.removeAttribute("data-theme-mode");
      } else if (config.themeMode === "glass") {
        root.classList.add("dark");
        root.setAttribute("data-theme-mode", "glass");
      } else {
        root.classList.remove("dark");
        root.removeAttribute("data-theme-mode");
      }
    }
  }, [config.primaryColor, config.themeMode, applyBranding]);

  const mapConfig = useCallback((data: any): StoreConfig => {
    const getVal = (snake: string, camel: string, fallback: any) => {
      if (data[snake] !== undefined && data[snake] !== null) return data[snake];
      if (data[camel] !== undefined && data[camel] !== null) return data[camel];
      return fallback;
    };

    const freeMin = getVal(
      "free_shipping_min",
      "freeShippingMin",
      defaultStoreConfig.freeShippingMin,
    );
    const shipFee = getVal(
      "shipping_fee",
      "shippingFee",
      defaultStoreConfig.shippingFee,
    );
    const localFee = getVal(
      "local_delivery_fee",
      "localDeliveryFee",
      defaultStoreConfig.localDeliveryFee,
    );

    return {
      freeShippingMin: Number(freeMin),
      shippingFee: Number(shipFee),
      whatsappNumber: getVal(
        "whatsapp_number",
        "whatsappNumber",
        defaultStoreConfig.whatsappNumber,
      ),
      shareText: getVal(
        "share_text",
        "shareText",
        defaultStoreConfig.shareText,
      ),
      businessHours: getVal(
        "business_hours",
        "businessHours",
        defaultStoreConfig.businessHours,
      ),
      enableReviews: getVal(
        "enable_reviews",
        "enableReviews",
        defaultStoreConfig.enableReviews,
      ),
      enableCoupons: getVal(
        "enable_coupons",
        "enableCoupons",
        defaultStoreConfig.enableCoupons,
      ),
      logoUrl: getVal("logo_url", "logoUrl", undefined),
      primaryColor: getVal(
        "primary_color",
        "primaryColor",
        defaultStoreConfig.primaryColor,
      ),
      themeMode: getVal(
        "theme_mode",
        "themeMode",
        defaultStoreConfig.themeMode,
      ),
      realTimeSalesAlerts: getVal(
        "real_time_sales_alerts",
        "realTimeSalesAlerts",
        defaultStoreConfig.realTimeSalesAlerts,
      ),
      pushMarketingEnabled: getVal(
        "push_marketing_enabled",
        "pushMarketingEnabled",
        defaultStoreConfig.pushMarketingEnabled,
      ),
      minAppVersion: getVal("min_app_version", "minAppVersion", undefined),
      originCep: getVal(
        "origin_cep",
        "originCep",
        defaultStoreConfig.originCep,
      ),
      shippingProvider: getVal(
        "shipping_provider",
        "shippingProvider",
        defaultStoreConfig.shippingProvider,
      ),
      enabledShippingMethods: getVal(
        "enabled_shipping_methods",
        "enabledShippingMethods",
        defaultStoreConfig.enabledShippingMethods,
      ),
      shippingCoverage: getVal(
        "shipping_coverage",
        "shippingCoverage",
        defaultStoreConfig.shippingCoverage,
      ),
      localDeliveryFee: Number(localFee),
      localCepRange: getVal(
        "local_cep_range",
        "localCepRange",
        defaultStoreConfig.localCepRange,
      ),
      homeSections: getVal(
        "home_sections",
        "homeSections",
        defaultStoreConfig.homeSections,
      ),
    };
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const tableSource = isAdmin ? "store_config" : "v_store_config";
      const { data, error } = await supabase
        .from(tableSource as any)
        .select("*")
        .single();

      if (error) {
        console.error("[StoreContext] Config fetch error:", error);
        if (isAdmin && error.code === "PGRST116") {
          // Initialize if missing (admin only)
          const dbInsert = {
            id: 1,
            free_shipping_min: 350,
            shipping_fee: 15,
            whatsapp_number: defaultStoreConfig.whatsappNumber,
            share_text: defaultStoreConfig.shareText,
            business_hours: defaultStoreConfig.businessHours,
            enable_reviews: defaultStoreConfig.enableReviews,
            enable_coupons: defaultStoreConfig.enableCoupons,
            primary_color: defaultStoreConfig.primaryColor,
            theme_mode: defaultStoreConfig.themeMode,
            real_time_sales_alerts: defaultStoreConfig.realTimeSalesAlerts,
            push_marketing_enabled: defaultStoreConfig.pushMarketingEnabled,
            origin_cep: defaultStoreConfig.originCep,
            shipping_provider: defaultStoreConfig.shippingProvider,
            enabled_shipping_methods: defaultStoreConfig.enabledShippingMethods,
            shipping_coverage: defaultStoreConfig.shippingCoverage,
            local_delivery_fee: defaultStoreConfig.localDeliveryFee,
            local_cep_range: defaultStoreConfig.localCepRange,
            home_sections: defaultStoreConfig.homeSections,
          };

          const { data: newData, error: insertError } = (await supabase
            .from("store_config")
            .insert([dbInsert as any])
            .select()
            .single()) as any;

          if (!insertError && newData) {
            const mapped = mapConfig(newData);
            setConfig((prev) => {
              const isIdentical = Object.keys(mapped).every((k) => {
                if (k === "enabledShippingMethods") {
                  const arrA = mapped[k] || [];
                  const arrB = prev[k] || [];
                  if (arrA.length !== arrB.length) return false;
                  return arrA.every((v, i) => v === arrB[i]);
                }
                return (mapped as any)[k] === (prev as any)[k];
              });
              if (isIdentical) return prev;
              vaultRef.current
                ?.put("store_config", { id: "singleton", ...mapped })
                .catch(() => {});
              return mapped;
            });
            applyBranding(mapped.primaryColor);
          }
        }
      } else if (data) {
        const mapped = mapConfig(data);
        setConfig((prev) => {
          const isIdentical = Object.keys(mapped).every((k) => {
            if (k === "enabledShippingMethods") {
              const arrA = mapped[k] || [];
              const arrB = prev[k] || [];
              if (arrA.length !== arrB.length) return false;
              return arrA.every((v, i) => v === arrB[i]);
            }
            return (mapped as any)[k] === (prev as any)[k];
          });
          if (isIdentical) return prev;
          vaultRef.current
            ?.put("store_config", { id: "singleton", ...mapped })
            .catch(() => {});
          return mapped;
        });
        applyBranding(mapped.primaryColor);
      }
    } catch (err) {
      console.error("[StoreContext] Config error:", err);
    } finally {
      setIsLoaded(true);
    }
  }, [isAdmin, mapConfig, applyBranding]);

  const fetchProducts = useCallback(async () => {
    // Stale-While-Revalidate: IDB data already loaded in mount effect.
    // This function always fetches fresh data from Supabase (background revalidation).

    try {
      let data: any[] | null = null;
      let error: any = null;

      // Only query admin view if admin is verified and auth is not loading
      if (isAdmin && !loading) {
        const res = await supabase
          .from("vw_produtos_admin")
          .select("*, product_variants(*)")
          .is("deleted_at", null)
          .limit(200)
          .order("data_cadastro", { ascending: false });
        data = res.data;
        error = res.error;
      }

      // Fallback to public view if not admin or if admin query failed (e.g., PGRST205 or unauthenticated)
      if (!isAdmin || loading || error) {
        const publicRes = await supabase
          .from("vw_produtos_public")
          .select("*, product_variants(*)")
          .limit(200)
          .order("data_cadastro", { ascending: false });
        
        if (publicRes.error && error) {
          throw error;
        } else if (publicRes.data) {
          data = publicRes.data;
          error = null;
        }
      }

      if (error) throw error;

      if (data && data.length > 0) {
        const mapped = (data as any[]).map((item: any) =>
          mapProductFromDB(item),
        );

        setProducts((prev) => {
          if (JSON.stringify(prev) === JSON.stringify(mapped)) return prev;
          // Persist to DataVault (non-blocking)
          vaultRef.current
            ?.replaceAll("products", mapped)
            .then(() => {
              vaultRef.current?.setLastSync("products");
            })
            .catch(() => {});
          return mapped;
        });
      } else {
        setProducts((prev) => (prev.length === 0 ? prev : []));
      }
    } catch (err) {
      console.error("[StoreContext] Products fetch error:", err);
    } finally {
      setLoadingProducts(false);
    }
  }, [isAdmin, loading]);

  const updateConfig = useCallback(
    async (updates: Partial<StoreConfig>) => {
      try {
        if (!isAdmin) {
          toast.error("Acesso negado");
          return;
        }

        const dbUpdates: any = {};
        if (updates.freeShippingMin !== undefined)
          dbUpdates.free_shipping_min = updates.freeShippingMin;
        if (updates.shippingFee !== undefined)
          dbUpdates.shipping_fee = updates.shippingFee;
        if (updates.whatsappNumber !== undefined)
          dbUpdates.whatsapp_number = updates.whatsappNumber;
        if (updates.shareText !== undefined)
          dbUpdates.share_text = updates.shareText;
        if (updates.businessHours !== undefined)
          dbUpdates.business_hours = updates.businessHours;
        if (updates.enableReviews !== undefined)
          dbUpdates.enable_reviews = updates.enableReviews;
        if (updates.enableCoupons !== undefined)
          dbUpdates.enable_coupons = updates.enableCoupons;
        if (updates.logoUrl !== undefined) dbUpdates.logo_url = updates.logoUrl;
        if (updates.primaryColor !== undefined)
          dbUpdates.primary_color = updates.primaryColor;
        if (updates.themeMode !== undefined)
          dbUpdates.theme_mode = updates.themeMode;
        if (updates.realTimeSalesAlerts !== undefined)
          dbUpdates.real_time_sales_alerts = updates.realTimeSalesAlerts;
        if (updates.pushMarketingEnabled !== undefined)
          dbUpdates.push_marketing_enabled = updates.pushMarketingEnabled;
        if (updates.minAppVersion !== undefined)
          dbUpdates.min_app_version = updates.minAppVersion;
        if (updates.originCep !== undefined)
          dbUpdates.origin_cep = updates.originCep;
        if (updates.shippingProvider !== undefined)
          dbUpdates.shipping_provider = updates.shippingProvider;
        if (updates.enabledShippingMethods !== undefined)
          dbUpdates.enabled_shipping_methods = updates.enabledShippingMethods;
        if (updates.shippingCoverage !== undefined)
          dbUpdates.shipping_coverage = updates.shippingCoverage;
        if (updates.localDeliveryFee !== undefined)
          dbUpdates.local_delivery_fee = updates.localDeliveryFee;
        if (updates.localCepRange !== undefined)
          dbUpdates.local_cep_range = updates.localCepRange;
        if (updates.homeSections !== undefined)
          dbUpdates.home_sections = updates.homeSections;

        const { error } = await (supabase.rpc as any)("upsert_store_config", {
          config_json: dbUpdates,
        });

        if (error) throw error;

        setConfig((prev) => {
          const newConfig = { ...prev, ...updates };
          // Persist to DataVault
          vaultRef.current
            ?.put("store_config", { id: "singleton", ...newConfig })
            .catch(() => {});
          return newConfig;
        });
        if (updates.primaryColor) applyBranding(updates.primaryColor);
        toast.success("Configurações salvas");
      } catch (err) {
        console.error("[StoreContext] Update error:", err);
        toast.error("Erro ao salvar as configurações");
      }
    },
    [isAdmin, applyBranding],
  );

  useEffect(() => {
    console.log(
      "[StoreContext] Effect triggered. loading:",
      loading,
      "isAdmin:",
      isAdmin,
    );
    fetchConfig();
    fetchProducts();
  }, [fetchConfig, fetchProducts]);

  // ── Realtime Sync: Start/Stop engine ──
  useEffect(() => {
    if (!isLoaded || !vaultRef.current) return;

    console.log(
      `[StoreContext] Starting RealtimeSyncEngine (isLeader: ${isLeader}, isAdmin: ${isAdmin})`,
    );
    const cleanup = RealtimeSyncEngine.start(
      vaultRef.current,
      isLeader,
      isAdmin,
    );

    return () => {
      cleanup();
    };
  }, [isLoaded, isLeader, isAdmin]);

  // ── Realtime Sync: Listen for changes applied by RealtimeSyncEngine ──
  useSyncListener(
    ["store_config"],
    useCallback(
      (event) => {
        if (event.store === "store_config" && event.newRecord) {
          const mapped = mapConfig(event.newRecord);
          if (
            mapped.minAppVersion &&
            mapped.minAppVersion !== config.minAppVersion
          ) {
            console.log(
              "[StoreContext] New mandatory version detected via Realtime!",
            );
          }
          setConfig(mapped);
          applyBranding(mapped.primaryColor);
        }
      },
      [mapConfig, applyBranding, config.minAppVersion],
    ),
  );

  useSyncListener(
    ["products"],
    useCallback(async () => {
      // Re-read products from DataVault when Realtime updates them
      if (vaultRef.current) {
        const freshProducts =
          await vaultRef.current.getAll<Product>("products");
        if (freshProducts.length > 0) {
          setProducts(freshProducts);
        }
      }
    }, []),
  );

  const calculateShipping = useCallback(
    (cart: CartItem[], selectedOption?: ShippingOption | null) => {
      if (cart.length === 0) return 0;

      const hasFreeShippingItem = cart.some(
        (item) => item.product.freeShipping,
      );
      if (hasFreeShippingItem) return 0;

      const totalAmount = cart.reduce((sum, item) => {
        const price = item.variantId
          ? item.product.variants?.find((v) => v.id === item.variantId)
              ?.priceOverride || item.product.price
          : item.product.price;
        return sum + price * item.quantity;
      }, 0);

      if (config.freeShippingMin > 0 && totalAmount >= config.freeShippingMin)
        return 0;

      if (selectedOption) {
        return selectedOption.price;
      }

      return config.shippingFee;
    },
    [config.freeShippingMin, config.shippingFee],
  );

  const refresh = useCallback(
    async (options?: { onlyConfig?: boolean }) => {
      if (options?.onlyConfig) {
        await fetchConfig();
      } else {
        await fetchConfig();
        await fetchProducts();
      }
    },
    [fetchConfig, fetchProducts],
  );

  const contextValue = React.useMemo(
    () => ({
      config,
      isLoaded,
      products,
      loadingProducts,
      updateConfig,
      refresh,
      fetchProducts,
      calculateShipping,
    }),
    [
      config,
      isLoaded,
      products,
      loadingProducts,
      updateConfig,
      refresh,
      fetchProducts,
      calculateShipping,
    ],
  );

  return (
    <StoreContext.Provider value={contextValue}>
      {children}
    </StoreContext.Provider>
  );
}

export const useStore = () => {
  const context = useContext(StoreContext);
  if (context === undefined) {
    throw new Error("useStore must be used within a StoreProvider");
  }
  return context;
};
