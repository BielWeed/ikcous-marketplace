import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { mapProductFromDB } from '@/lib/mappers';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { DataVault } from '@/lib/dataVault';
import { useSyncListener } from '@/hooks/useDataVault';
import type { StoreConfig, Product, CartItem } from '@/types';

const defaultStoreConfig: StoreConfig = {
    freeShippingMin: 350,
    shippingFee: 15,
    whatsappNumber: '34999999999',
    shareText: 'Olha que achei na IKCOUS!',
    businessHours: 'Seg-Sáb: 9h às 18h',
    enableReviews: true,
    enableCoupons: true,
    primaryColor: '#000000',
    themeMode: 'light',
    realTimeSalesAlerts: true,
    pushMarketingEnabled: false
};

interface StoreContextType {
    config: StoreConfig;
    isLoaded: boolean;
    products: Product[];
    loadingProducts: boolean;
    updateConfig: (updates: Partial<StoreConfig>) => Promise<void>;
    refresh: () => Promise<void>;
    fetchProducts: () => Promise<void>;
    calculateShipping: (cart: CartItem[]) => number;
}

 
export const StoreContext = createContext<StoreContextType | undefined>(undefined);

export function StoreProvider({ children }: Readonly<{ children: React.ReactNode }>) {
    const { isAdmin } = useAuth();
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
                const cachedConfig = await vault.getById<any>('store_config', 'singleton');
                if (cachedConfig && !cancelled) {
                    const { id: _id, ...configData } = cachedConfig;
                    const merged = { ...defaultStoreConfig, ...configData };
                    setConfig(merged);
                    setIsLoaded(true);
                    // Apply branding immediately
                    if (merged.primaryColor) {
                        document.documentElement.style.setProperty('--primary', merged.primaryColor);
                    }
                    if (merged.themeMode === 'dark' || merged.themeMode === 'glass') {
                        document.documentElement.classList.add('dark');
                        if (merged.themeMode === 'glass') {
                            document.documentElement.setAttribute('data-theme-mode', 'glass');
                        }
                    } else {
                        document.documentElement.classList.remove('dark');
                        document.documentElement.removeAttribute('data-theme-mode');
                    }
                }

                // Load products from IDB
                const cachedProducts = await vault.getAll<Product>('products');
                if (cachedProducts.length > 0 && !cancelled) {
                    setProducts(cachedProducts);
                    setLoadingProducts(false);
                }
            } catch (err) {
                console.error('[StoreContext] DataVault load failed, will fetch from network:', err);
            }
        };
        loadFromVault();
        return () => { cancelled = true; };
    }, []);

    const applyBranding = useCallback((primaryColor?: string) => {
        if (primaryColor) {
            document.documentElement.style.setProperty('--primary', primaryColor);
        }
    }, []);

    useEffect(() => {
        if (config.primaryColor) {
            applyBranding(config.primaryColor);
        }
        
        // Sync theme mode with DOM
        if (config.themeMode) {
            const root = document.documentElement;
            if (config.themeMode === 'dark') {
                root.classList.add('dark');
                root.removeAttribute('data-theme-mode');
            } else if (config.themeMode === 'glass') {
                root.classList.add('dark');
                root.setAttribute('data-theme-mode', 'glass');
            } else {
                root.classList.remove('dark');
                root.removeAttribute('data-theme-mode');
            }
        }
    }, [config.primaryColor, config.themeMode, applyBranding]);

    const mapConfig = useCallback((data: any): StoreConfig => {
        return {
            freeShippingMin: data.free_shipping_min ?? defaultStoreConfig.freeShippingMin,
            shippingFee: data.shipping_fee ?? defaultStoreConfig.shippingFee,
            whatsappNumber: data.whatsapp_number ?? defaultStoreConfig.whatsappNumber,
            shareText: data.share_text ?? defaultStoreConfig.shareText,
            businessHours: data.business_hours ?? defaultStoreConfig.businessHours,
            enableReviews: data.enable_reviews ?? defaultStoreConfig.enableReviews,
            enableCoupons: data.enable_coupons ?? defaultStoreConfig.enableCoupons,
            logoUrl: data.logo_url,
            primaryColor: data.primary_color ?? defaultStoreConfig.primaryColor,
            themeMode: data.theme_mode ?? defaultStoreConfig.themeMode,
            realTimeSalesAlerts: data.real_time_sales_alerts ?? defaultStoreConfig.realTimeSalesAlerts,
            pushMarketingEnabled: data.push_marketing_enabled ?? defaultStoreConfig.pushMarketingEnabled,
            minAppVersion: data.min_app_version,
        };
    }, []);

    const fetchConfig = useCallback(async () => {
        try {
            const tableSource = isAdmin ? 'store_config' : 'v_store_config';
            const { data, error } = await supabase
                .from(tableSource as any)
                .select('*')
                .single();

            if (error) {
                console.error('[StoreContext] Config fetch error:', error);
                if (isAdmin && error.code === 'PGRST116') {
                    // Initialize if missing (admin only)
                    const { data: newData, error: insertError } = await supabase
                        .from('store_config')
                        .insert([ { id: 1, ...defaultStoreConfig, free_shipping_min: 350, shipping_fee: 15 } as any ])
                        .select()
                        .single() as any;

                    if (!insertError && newData) {
                        const mapped = mapConfig(newData);
                        setConfig(mapped);
                        applyBranding(mapped.primaryColor);
                        // Persist to DataVault
                        vaultRef.current?.put('store_config', { id: 'singleton', ...mapped }).catch(() => {});
                    }
                }
            } else if (data) {
                const mapped = mapConfig(data);
                setConfig(mapped);
                applyBranding(mapped.primaryColor);
                // Persist to DataVault
                vaultRef.current?.put('store_config', { id: 'singleton', ...mapped }).catch(() => {});
            }
        } catch (err) {
            console.error('[StoreContext] Config error:', err);
        } finally {
            setIsLoaded(true);
        }
    }, [isAdmin, mapConfig, applyBranding]);

    const fetchProducts = useCallback(async () => {
        // Stale-While-Revalidate: IDB data already loaded in mount effect.
        // This function always fetches fresh data from Supabase (background revalidation).

        try {
            let query: any;
            if (isAdmin) {
                query = supabase.from('produtos').select('*').is('deleted_at', null).limit(200).order('data_cadastro', { ascending: false });
            } else {
                query = supabase.from('vw_produtos_public').select('*').limit(200).order('data_cadastro', { ascending: false });
            }
            
            const { data, error } = await query;
            
            if (error) throw error;
            
            if (data && data.length > 0) {
                const productIds = (data as any[]).map((p: any) => p.id).filter((id): id is string => !!id);
                const { data: variants, error: varError } = await supabase
                    .from('product_variants')
                    .select('*')
                    .in('product_id', productIds);
                
                if (varError) throw varError;

                const mapped = (data as any[]).map((item: any) => mapProductFromDB({
                    ...item,
                    product_variants: variants?.filter(v => v.product_id === item.id) || []
                }));
                
                setProducts(mapped);
                // Persist to DataVault (non-blocking)
                vaultRef.current?.replaceAll('products', mapped).then(() => {
                    vaultRef.current?.setLastSync('products');
                }).catch(() => {});
            } else {
                setProducts([]);
            }
        } catch (err) {
            console.error('[StoreContext] Products fetch error:', err);
        } finally {
            setLoadingProducts(false);
        }
    }, [isAdmin]);

    const updateConfig = useCallback(async (updates: Partial<StoreConfig>) => {
        try {
            if (!isAdmin) {
                toast.error('Acesso negado');
                return;
            }

            const dbUpdates: any = {};
            if (updates.freeShippingMin !== undefined) dbUpdates.free_shipping_min = updates.freeShippingMin;
            if (updates.shippingFee !== undefined) dbUpdates.shipping_fee = updates.shippingFee;
            if (updates.whatsappNumber !== undefined) dbUpdates.whatsapp_number = updates.whatsappNumber;
            if (updates.shareText !== undefined) dbUpdates.share_text = updates.shareText;
            if (updates.businessHours !== undefined) dbUpdates.business_hours = updates.businessHours;
            if (updates.enableReviews !== undefined) dbUpdates.enable_reviews = updates.enableReviews;
            if (updates.enableCoupons !== undefined) dbUpdates.enable_coupons = updates.enableCoupons;
            if (updates.logoUrl !== undefined) dbUpdates.logo_url = updates.logoUrl;
            if (updates.primaryColor !== undefined) dbUpdates.primary_color = updates.primaryColor;
            if (updates.themeMode !== undefined) dbUpdates.theme_mode = updates.themeMode;
            if (updates.realTimeSalesAlerts !== undefined) dbUpdates.real_time_sales_alerts = updates.realTimeSalesAlerts;
            if (updates.pushMarketingEnabled !== undefined) dbUpdates.push_marketing_enabled = updates.pushMarketingEnabled;
            if (updates.minAppVersion !== undefined) dbUpdates.min_app_version = updates.minAppVersion;

            const { error } = await (supabase.rpc as any)('upsert_store_config', {
                config_json: dbUpdates
            });

            if (error) throw error;

            setConfig(prev => {
                const newConfig = { ...prev, ...updates };
                // Persist to DataVault
                vaultRef.current?.put('store_config', { id: 'singleton', ...newConfig }).catch(() => {});
                return newConfig;
            });
            if (updates.primaryColor) applyBranding(updates.primaryColor);
            toast.success('Configurações salvas');
        } catch (err) {
            console.error('[StoreContext] Update error:', err);
            toast.error('Erro ao salvar as configurações');
        }
    }, [isAdmin, applyBranding]);

    useEffect(() => {
        console.log('[StoreContext] Effect triggered. isAdmin:', isAdmin);
        fetchConfig();
        fetchProducts();
    }, [fetchConfig, fetchProducts, isAdmin]);

    // ── Realtime Sync: Listen for changes applied by RealtimeSyncEngine ──
    useSyncListener(['store_config'], useCallback((event) => {
        if (event.store === 'store_config' && event.newRecord) {
            const mapped = mapConfig(event.newRecord);
            if (mapped.minAppVersion && mapped.minAppVersion !== config.minAppVersion) {
                console.log('[StoreContext] New mandatory version detected via Realtime!');
            }
            setConfig(mapped);
            applyBranding(mapped.primaryColor);
        }
    }, [mapConfig, applyBranding, config.minAppVersion]));

    useSyncListener(['products'], useCallback(async () => {
        // Re-read products from DataVault when Realtime updates them
        if (vaultRef.current) {
            const freshProducts = await vaultRef.current.getAll<Product>('products');
            if (freshProducts.length > 0) {
                setProducts(freshProducts);
            }
        }
    }, []));

    const calculateShipping = useCallback((cart: CartItem[]) => {
        if (cart.length === 0) return 0;
        
        const hasFreeShippingItem = cart.some(item => item.product.freeShipping);
        if (hasFreeShippingItem) return 0;

        const totalAmount = cart.reduce((sum, item) => {
            const price = item.variantId
                ? item.product.variants?.find(v => v.id === item.variantId)?.priceOverride || item.product.price
                : item.product.price;
            return sum + (price * item.quantity);
        }, 0);

        if (config.freeShippingMin > 0 && totalAmount >= config.freeShippingMin) return 0;
        
        return config.shippingFee;
    }, [config.freeShippingMin, config.shippingFee]);

    const refresh = useCallback(async () => {
        await fetchConfig();
        await fetchProducts();
    }, [fetchConfig, fetchProducts]);

    const contextValue = React.useMemo(() => ({
        config,
        isLoaded,
        products,
        loadingProducts,
        updateConfig,
        refresh,
        fetchProducts,
        calculateShipping
    }), [config, isLoaded, products, loadingProducts, updateConfig, refresh, fetchProducts, calculateShipping]);

    return (
        <StoreContext.Provider value={contextValue}>
            {children}
        </StoreContext.Provider>
    );
}

 
export const useStore = () => {
    const context = useContext(StoreContext);
    if (context === undefined) {
        throw new Error('useStore must be used within a StoreProvider');
    }
    return context;
};
