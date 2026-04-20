import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { mapProductFromDB } from '@/lib/mappers';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
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

// eslint-disable-next-line react-refresh/only-export-components
export const StoreContext = createContext<StoreContextType | undefined>(undefined);

export function StoreProvider({ children }: Readonly<{ children: React.ReactNode }>) {
    const { user, isAdmin } = useAuth();
    const [config, setConfig] = useState<StoreConfig>(defaultStoreConfig);
    const [isLoaded, setIsLoaded] = useState(false);
    const [products, setProducts] = useState<Product[]>([]);
    const [loadingProducts, setLoadingProducts] = useState(true);

    const applyBranding = useCallback((primaryColor?: string) => {
        if (primaryColor) {
            document.documentElement.style.setProperty('--primary', primaryColor);
        }
    }, []);

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
            whatsappApiUrl: data.whatsapp_api_url,
            whatsappApiKey: data.whatsapp_api_key,
            whatsappApiInstance: data.whatsapp_api_instance,
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
                        .insert([ { ...defaultStoreConfig, free_shipping_min: 350, shipping_fee: 15 } ])
                        .select()
                        .single() as any;

                    if (!insertError && newData) {
                        const mapped = mapConfig(newData);
                        setConfig(mapped);
                        applyBranding(mapped.primaryColor);
                    }
                }
            } else if (data) {
                const mapped = mapConfig(data);
                setConfig(mapped);
                applyBranding(mapped.primaryColor);
            }
        } catch (err) {
            console.error('[StoreContext] Config error:', err);
        } finally {
            setIsLoaded(true);
        }
    }, [isAdmin, mapConfig, applyBranding]);

    const fetchProducts = useCallback(async () => {
        setLoadingProducts(true);
        try {
            let query: any;
            if (isAdmin) {
                query = supabase.from('produtos').select('*');
            } else {
                query = supabase.from('vw_produtos_public').select('*');
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
            if (updates.whatsappApiUrl !== undefined) dbUpdates.whatsapp_api_url = updates.whatsappApiUrl;
            if (updates.whatsappApiKey !== undefined) dbUpdates.whatsapp_api_key = updates.whatsappApiKey;
            if (updates.whatsappApiInstance !== undefined) dbUpdates.whatsapp_api_instance = updates.whatsappApiInstance;

            const { error } = await (supabase.rpc as any)('upsert_store_config', {
                config_json: dbUpdates
            });

            if (error) throw error;

            setConfig(prev => ({ ...prev, ...updates }));
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

    // Config Realtime
    useEffect(() => {
        if (!user) return;
        
        const channel = supabase
            .channel('store_config_changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'store_config'
            }, (payload) => {
                if (payload.new) {
                    const mapped = mapConfig(payload.new);
                    // Verificação proativa de versão mínima
                    if (mapped.minAppVersion && mapped.minAppVersion !== config.minAppVersion) {
                        console.log('[StoreContext] New mandatory version detected via Realtime!');
                    }
                    setConfig(mapped);
                    applyBranding(mapped.primaryColor);
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user, mapConfig, applyBranding, config.minAppVersion]);

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

    const contextValue = React.useMemo(() => ({
        config,
        isLoaded,
        products,
        loadingProducts,
        updateConfig,
        refresh: async () => {
            await fetchConfig();
            await fetchProducts();
        },
        fetchProducts,
        calculateShipping
    }), [config, isLoaded, products, loadingProducts, updateConfig, fetchConfig, fetchProducts, calculateShipping]);

    return (
        <StoreContext.Provider value={contextValue}>
            {children}
        </StoreContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useStore = () => {
    const context = useContext(StoreContext);
    if (context === undefined) {
        throw new Error('useStore must be used within a StoreProvider');
    }
    return context;
};
