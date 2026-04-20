import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { mapProductFromDB } from '@/lib/mappers';
import type { Product, CartItem } from '@/types';
import { toast } from 'sonner';

const MAX_ITEM_QUANTITY = 500; // Nuclear deterrent against inflation

const cartItemSchema = z.object({
    product: z.any(),
    quantity: z.number().int().positive().max(MAX_ITEM_QUANTITY),
    variantId: z.string().optional().nullable(),
});

interface CartContextType {
    cart: CartItem[];
    addToCart: (product: Product, quantity?: number, variantId?: string) => void;
    removeFromCart: (productId: string, variantId?: string) => void;
    updateQuantity: (productId: string, quantity: number, variantId?: string) => void;
    clearCart: () => void;
    getCartTotal: () => number;
    getCartCount: () => number;
    isLoading: boolean;
}

// eslint-disable-next-line react-refresh/only-export-components
export const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_STORAGE_KEY = 'marketplace_cart_v1';


export function CartProvider({ children }: { children: React.ReactNode }) {
    const { user, loading: authLoading } = useAuth();
    console.log('[CartContext-Trace] Init - Auth User:', user?.id || 'null');
    const [cart, setCart] = useState<CartItem[]>(() => {
        const saved = localStorage.getItem(CART_STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    // Sanity check: Filter and Validate with Zod
                    return parsed
                        .map(item => {
                            const result = cartItemSchema.safeParse(item);
                            return result.success ? (result.data as unknown as CartItem) : null;
                        })
                        .filter((item): item is CartItem => item !== null);
                }
            } catch (e) {
                console.error('[CartContext] ⚠️ Failed to parse LocalStorage cart:', e);
            }
        }
        return [];
    });

    const [isLoading, setIsLoading] = useState(true);
    const isInitialLoad = useRef(true);
    const syncLocked = useRef(true); // Guard for initial hydration

    // Safety timeout: Only runs if auth is NOT loading but we are still stuck
    useEffect(() => {
        if (authLoading) return;

        if (!user) {
            setIsLoading(false);
            syncLocked.current = false;
            // IMPORTANT: We do NOT set isInitialLoad.current = false here.
            // We want it to stay true until an actual DB sync attempt for a user happens.
            return;
        }

        const safetyTimeout = setTimeout(() => {
            if (isInitialLoad.current || isLoading) {
                console.warn('[CartContext] ⚠️ Safety timeout (8s) reached. Force unblocking cart loading.');
                setIsLoading(false);
                syncLocked.current = false;
                isInitialLoad.current = false;
            }
        }, 8000);
        return () => clearTimeout(safetyTimeout);
    }, [isLoading, user, authLoading]);

    // Persistence to LocalStorage
    useEffect(() => {
        // Only save to localStorage if we are not in the middle of an initial load
        if (!syncLocked.current && !isInitialLoad.current) {
            localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
        }
    }, [cart]);

    // Track which user we have already synced for
    const lastSessionUserId = useRef<string | null>(null);

    // Initial Sync from Supabase
    useEffect(() => {
        let isMounted = true;
        
        // Detection of user change: Reset state if the ID changes (null <-> UUID)
        const currentUserId = user?.id || null;
        if (currentUserId !== lastSessionUserId.current) {
            console.log('[CartContext] ℹ️ User session changed. Resetting initial load state.');
            isInitialLoad.current = true;
            syncLocked.current = true;
            lastSessionUserId.current = currentUserId;
        }

        async function syncFromDB() {
            if (authLoading) {
                console.log('[CartContext] ⏳ Auth is still loading. Skipping syncFromDB.');
                return;
            }

            if (!user) {
                console.log('[CartContext] ℹ️ No user detected. Preserving local cart.');
                if (isMounted) {
                    setIsLoading(false);
                    syncLocked.current = false;
                    isInitialLoad.current = false;
                }
                return;
            }

            if (!isInitialLoad.current) return;

            try {
                const startTime = Date.now();
                console.log('[CartContext] 🔄 Initial sync from Supabase started...');
                const { data: dbItems, error } = await supabase
                    .from('cart_items')
                    .select('*')
                    .eq('user_id', user.id);

                if (error) throw error;
                const endTime = Date.now();
                console.log(`[CartContext] ✅ Cart items fetch completed in ${endTime - startTime}ms. Items:`, dbItems?.length || 0);
                if (!isMounted) return;

                if (dbItems && dbItems.length > 0) {
                    const productIds = Array.from(new Set(dbItems.map(item => item.product_id)));
                    // Fetch products from the public view
                    const { data: products, error: prodError } = await supabase
                        .from('vw_produtos_public')
                        .select('*')
                        .in('id', productIds.filter(id => id !== null) as string[]);

                    if (prodError) throw prodError;

                    // Fetch variants for these products
                    const { data: variants, error: varError } = await supabase
                        .from('product_variants')
                        .select('*')
                        .in('product_id', productIds.filter(id => id !== null) as string[]);

                    if (varError) {
                        console.error('[CartContext] Error fetching variants:', varError);
                    }

                    const reconstructedCart: CartItem[] = (dbItems || []).map(dbItem => {
                        const rawProduct = products?.find(p => p.id === dbItem.product_id);
                        if (!rawProduct) return null;

                        // Attach variants to the product object before mapping
                        const productWithVariants = {
                            ...rawProduct,
                            product_variants: variants?.filter(v => v.product_id === rawProduct.id) || []
                        };

                        const item: CartItem = {
                            product: mapProductFromDB(productWithVariants),
                            quantity: dbItem.quantity
                        };
                        if (dbItem.variant_id) item.variantId = dbItem.variant_id;
                        return item;
                    }).filter((item): item is CartItem => item !== null);

                    setCart(prev => {
                        // If local cart is empty, just take the remote one
                        if (prev.length === 0) {
                            console.log('[CartContext] ✅ Remote cart adopted (local was empty).');
                            return reconstructedCart;
                        }

                        const mergedMap = new Map<string, CartItem>();

                        // Add local items (priority for recent locally added items)
                        prev.forEach(item => {
                            const key = `${item.product.id}-${item.variantId || ''}`;
                            mergedMap.set(key, item);
                        });

                        // Merging remote items
                        reconstructedCart.forEach(remoteItem => {
                            const key = `${remoteItem.product.id}-${remoteItem.variantId || ''}`;
                            if (mergedMap.has(key)) {
                                const local = mergedMap.get(key)!;
                                // If collision, use the larger quantity up to max to avoid losing data
                                local.quantity = Math.min(Math.max(local.quantity, remoteItem.quantity), MAX_ITEM_QUANTITY);
                            } else {
                                mergedMap.set(key, remoteItem);
                            }
                        });

                        const mergedArray = Array.from(mergedMap.values());
                        console.log('[CartContext] ✅ Merge complete. Total items:', mergedArray.length);
                        return mergedArray;
                    });
                } else {
                    console.log('[CartContext] ℹ️ Remote cart is empty. Keeping local items if any.');
                }
            } catch (err) {
                console.error('[CartContext] ❌ Sync error:', err);
            } finally {
                if (isMounted) {
                    syncLocked.current = false;
                    setIsLoading(false);
                    isInitialLoad.current = false;
                }
            }
        }

        syncFromDB();
        return () => { isMounted = false; };
    }, [user, authLoading]); // Added authLoading to deps

    const syncPending = useRef(false);
    const lastSyncedCart = useRef<string>('');

    // Sync back to Supabase (Atomic-ish Strategy)
    const syncToDB = useCallback(async (currentCart: CartItem[], immediate = false) => {
        if (!user || authLoading || isInitialLoad.current || syncLocked.current) return;

        const cartHash = JSON.stringify(currentCart);
        if (cartHash === lastSyncedCart.current && !immediate) return;

        syncPending.current = true;
        try {
            console.log('[CartContext] 📤 Syncing to Supabase...');
            const itemMap = new Map<string, any>();
            currentCart.forEach(item => {
                const variantId = item.variantId || '';
                const key = `${item.product.id}-${variantId}`;
                if (itemMap.has(key)) {
                    itemMap.get(key).quantity += item.quantity;
                } else {
                    itemMap.set(key, { product_id: item.product.id, variant_id: variantId, quantity: item.quantity });
                }
            });

            const { error: syncError } = await (supabase.rpc as any)('sync_cart_atomic', {
                p_cart_items: Array.from(itemMap.values())
            });

            if (syncError) throw syncError;
            lastSyncedCart.current = cartHash;
            syncPending.current = false;
        } catch (err) {
            console.error('[CartContext] ❌ DB Sync Failed:', err);
            syncPending.current = false;
        }
    }, [user, authLoading]);

    useEffect(() => {
        if (isInitialLoad.current || syncLocked.current) return;

        const timer = setTimeout(() => {
            if (!syncPending.current) {
                syncToDB(cart);
            }
        }, 1000);

        return () => clearTimeout(timer);
    }, [cart, syncToDB]);

    const addToCart = useCallback((product: Product, quantity: number = 1, variantIdInput?: string) => {
        // Session check removed to allow Guest Cart
        // Guest cart will be synced to DB once user logs in via syncFromDB logic
        if (!user || !user.id) {
            console.log('[CartContext] ℹ️ Guest adding to cart.');
        }
        
        const qToAdd = Math.max(Number(quantity) || 1, 1);
        const variantId = (variantIdInput === '' || variantIdInput === null) ? undefined : variantIdInput;
        
        console.log(`[CartContext-Trace] 🛒 addToCart confirmed for ${product.id}.`);

        setCart(prev => {
            const existingIndex = prev.findIndex(item =>
                item.product.id === product.id &&
                item.variantId === variantId
            );

            // Enforce stock limit
            const variant = variantId ? product.variants?.find(v => v.id === variantId) : undefined;
            const availableStock = variant && variant.stock !== undefined ? variant.stock : (product.stock || 0);

            if (existingIndex > -1) {
                const existing = prev[existingIndex];
                console.log(`[CartContext-Trace] ➕ Updating existing item. Current: ${existing.quantity}, Adding: ${qToAdd}`);
                const nextQuantity = Math.min(existing.quantity + qToAdd, availableStock, MAX_ITEM_QUANTITY);

                if (nextQuantity === availableStock && (existing.quantity + qToAdd) > availableStock) {
                    toast.error(`Apenas ${availableStock} unidades disponíveis em estoque.`);
                } else if (nextQuantity === MAX_ITEM_QUANTITY && (existing.quantity + qToAdd) > MAX_ITEM_QUANTITY) {
                    console.error(`[CartContext-STOP] 🛑 QUANTITY CAP REACHED for ${product.id}.`);
                }

                const newCart = [...prev];
                newCart[existingIndex] = { ...existing, quantity: nextQuantity };
                return newCart;
            }

            console.log(`[CartContext-Trace] ✨ Adding new item to cart.`);
            const validatedQuantity = Math.min(qToAdd, availableStock, MAX_ITEM_QUANTITY);

            if (qToAdd > availableStock) {
                toast.error(`Apenas ${availableStock} unidades disponíveis.`);
            }

            return [...prev, { product, quantity: validatedQuantity, variantId }];
        });
        toast.success('Produto adicionado ao carrinho!');
    }, [user]);

    const removeFromCart = useCallback((productId: string, variantIdInput?: string) => {
        const variantId = (variantIdInput === '' || variantIdInput === null) ? undefined : variantIdInput;
        setCart(prev => prev.filter(item =>
            !(item.product.id === productId && item.variantId === variantId)
        ));
        toast.info('Produto removido do carrinho');
    }, []);

    const updateQuantity = useCallback((productId: string, quantity: number, variantIdInput?: string) => {
        const variantId = (variantIdInput === '' || variantIdInput === null) ? undefined : variantIdInput;
        if (quantity <= 0) {
            removeFromCart(productId, variantId);
            return;
        }

        setCart(prev => prev.map(item => {
            if (item.product.id === productId && item.variantId === variantId) {
                const variant = variantId ? item.product.variants?.find(v => v.id === variantId) : undefined;
                const availableStock = variant && variant.stock !== undefined ? variant.stock : (item.product.stock || 0);
                const nextQuantity = Math.min(quantity, availableStock, MAX_ITEM_QUANTITY);

                if (quantity > availableStock) {
                    toast.error(`Limite de estoque atingido (${availableStock} unidades).`);
                }

                return { ...item, quantity: nextQuantity };
            }
            return item;
        }));
    }, [removeFromCart]);

    const clearCart = useCallback(() => {
        setCart([]);
        localStorage.removeItem(CART_STORAGE_KEY);
        toast.info('Carrinho limpo');
    }, []);


    const getCartTotal = useCallback(() => {
        return cart.reduce((total, item) => {
            const price = item.variantId
                ? item.product.variants?.find(v => v.id === item.variantId)?.priceOverride || item.product.price
                : item.product.price;
            return total + (price * item.quantity);
        }, 0);
    }, [cart]);

    const getCartCount = useCallback(() => {
        return cart.reduce((count, item) => count + item.quantity, 0);
    }, [cart]);

    const contextValue = React.useMemo(() => ({
        cart,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
        getCartTotal,
        getCartCount,
        isLoading
    }), [cart, addToCart, removeFromCart, updateQuantity, clearCart, getCartTotal, getCartCount, isLoading]);

    return (
        <CartContext.Provider value={contextValue}>
            {children}
        </CartContext.Provider>
    );
}


// eslint-disable-next-line react-refresh/only-export-components
export const useCartContext = () => {
    const context = React.useContext(CartContext);
    if (context === undefined) {
        throw new Error('useCartContext must be used within a CartProvider');
    }
    return context;
};
