import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/hooks/useAuth";
import { useLeaderElection } from "@/hooks/useLeaderElection";
import { mapProductFromDB } from "@/lib/mappers";
import { supabase } from "@/lib/supabase";
import type { CartItem, Product, ShippingOption } from "@/types";
import React, {
  createContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { toast } from "sonner";
import { z } from "zod";

const MAX_ITEM_QUANTITY = 500; // Nuclear deterrent against inflation

const cartItemSchema = z.object({
  product: z.any(),
  quantity: z.number().int().positive().max(MAX_ITEM_QUANTITY),
  variantId: z.string().optional().nullable(),
  lastModifiedAt: z.number().optional(),
});

export interface CartState {
  cart: CartItem[];
  isLoading: boolean;
  cartTotal: number;
  cartCount: number;
  shippingFee: number;
  selectedShippingOption: ShippingOption | null;
}

export interface CartActions {
  addToCart: (
    product: Product,
    quantity?: number,
    variantId?: string,
    variantNames?: string,
  ) => void;
  removeFromCart: (productId: string, variantId?: string) => void;
  updateQuantity: (
    productId: string,
    quantity: number,
    variantId?: string,
  ) => void;
  clearCart: () => void;
  getCartTotal: () => number;
  getCartCount: () => number;
  setSelectedShippingOption: (option: ShippingOption | null) => void;
}

export interface CartContextType extends CartState, CartActions {}

const CartStateContext = createContext<CartState | undefined>(undefined);
const CartActionsContext = createContext<CartActions | undefined>(undefined);
const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_STORAGE_KEY = "marketplace_cart_v1";
const CART_TOMBSTONES_KEY = "marketplace_cart_tombstones_v1";

/** Tombstone entry: tracks when a cart item was intentionally deleted locally */
interface CartTombstone {
  key: string; // productId-variantId
  deletedAt: number; // epoch ms
}

function loadTombstones(): Map<string, CartTombstone> {
  try {
    const raw = localStorage.getItem(CART_TOMBSTONES_KEY);
    if (raw) {
      const parsed: CartTombstone[] = JSON.parse(raw);
      const map = new Map<string, CartTombstone>();
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7-day TTL
      parsed.forEach((t) => {
        if (t.deletedAt > cutoff) map.set(t.key, t);
      });
      return map;
    }
  } catch (e) {
    console.error("[CartContext] Failed to parse tombstones:", e);
  }
  return new Map();
}

function saveTombstones(map: Map<string, CartTombstone>) {
  try {
    localStorage.setItem(
      CART_TOMBSTONES_KEY,
      JSON.stringify(Array.from(map.values())),
    );
  } catch (e) {
    console.error("[CartContext] Failed to save tombstones:", e);
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { config } = useStore();
  const { user, loading: authLoading } = useAuth();
  const { isLeader } = useLeaderElection();
  const userId = user?.id;

  useEffect(() => {
    console.log("[CartContext-Trace] Init - Auth User:", userId || "null");
  }, [userId]);

  const [cart, setCart] = useState<CartItem[]>(() => {
    const saved = localStorage.getItem(CART_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // Sanity check: Filter and Validate with Zod
          return parsed
            .map((item) => {
              const result = cartItemSchema.safeParse(item);
              return result.success
                ? (result.data as unknown as CartItem)
                : null;
            })
            .filter((item): item is CartItem => item !== null);
        }
      } catch (e) {
        console.error("[CartContext] ⚠️ Failed to parse LocalStorage cart:", e);
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

    if (!userId) {
      setIsLoading(false);
      syncLocked.current = false;
      // IMPORTANT: We do NOT set isInitialLoad.current = false here.
      // We want it to stay true until an actual DB sync attempt for a user happens.
      return;
    }

    const safetyTimeout = setTimeout(() => {
      if (isInitialLoad.current || isLoading) {
        console.warn(
          "[CartContext] ⚠️ Safety timeout (8s) reached. Force unblocking cart loading.",
        );
        setIsLoading(false);
        syncLocked.current = false;
        isInitialLoad.current = false;
      }
    }, 8000);
    return () => clearTimeout(safetyTimeout);
  }, [isLoading, userId, authLoading]);

  // Persistence to LocalStorage
  useEffect(() => {
    // Only save to localStorage if we are not in the middle of an initial load
    if (!syncLocked.current && !isInitialLoad.current) {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    }
  }, [cart]);

  // Track which user we have already synced for
  const lastSessionUserId = useRef<string | null>(null);

  const syncFromDB = useCallback(
    async (force = false) => {
      if (authLoading) {
        console.log(
          "[CartContext] ⏳ Auth is still loading. Skipping syncFromDB.",
        );
        return;
      }

      if (!userId) {
        console.log("[CartContext] ℹ️ No user detected. Preserving local cart.");
        setIsLoading(false);
        syncLocked.current = false;
        isInitialLoad.current = false;
        return;
      }

      if (!isInitialLoad.current && !force) return;

      try {
        const startTime = Date.now();
        console.log(
          "[CartContext] 🔄 Sync from Supabase started (force: %s)...",
          force,
        );
        const { data: dbItems, error } = await supabase
          .from("cart_items")
          .select("*")
          .eq("user_id", userId);

        if (error) throw error;
        const endTime = Date.now();
        console.log(
          "[CartContext] ✅ Cart items fetch completed in %dms. Items:",
          endTime - startTime,
          dbItems?.length || 0,
        );

        if (dbItems) {
          const productIds = Array.from(
            new Set(dbItems.map((item) => item.product_id)),
          );

          let products: any[] = [];
          let variants: any[] = [];

          if (productIds.length > 0) {
            const { data: prodData, error: prodError } = await supabase
              .from("vw_produtos_public")
              .select("*")
              .in("id", productIds.filter((id) => id !== null) as string[]);

            if (prodError) throw prodError;
            products = prodData || [];

            const { data: varData, error: varError } = await supabase
              .from("product_variants")
              .select("*")
              .in(
                "product_id",
                productIds.filter((id) => id !== null) as string[],
              );

            if (varError) {
              console.error("[CartContext] Error fetching variants:", varError);
            }
            variants = varData || [];
          }

          const reconstructedCart: CartItem[] = dbItems
            .map((dbItem) => {
              const rawProduct = products.find(
                (p) => p.id === dbItem.product_id,
              );
              if (!rawProduct) return null;

              const productWithVariants = {
                ...rawProduct,
                product_variants: variants.filter(
                  (v) => v.product_id === rawProduct.id,
                ),
              };

              const item: CartItem = {
                product: mapProductFromDB(productWithVariants),
                quantity: dbItem.quantity,
                lastModifiedAt: dbItem.updated_at
                  ? new Date(dbItem.updated_at).getTime()
                  : 0,
              };
              if (dbItem.variant_id) item.variantId = dbItem.variant_id;
              if ((dbItem as any).variant_names)
                item.variantNames = (dbItem as any).variant_names;
              return item;
            })
            .filter((item): item is CartItem => item !== null);

          setCart((prev) => {
            const prevHash = JSON.stringify(prev);
            const reconHash = JSON.stringify(reconstructedCart);
            if (prevHash === reconHash) {
              // Skip updating state if the lists match exactly to prevent cycles
              return prev;
            }

            // If local cart is empty AND no tombstones exist, adopt remote
            const tombstones = loadTombstones();
            if (prev.length === 0 && tombstones.size === 0) {
              console.log(
                "[CartContext] ✅ Remote cart adopted (local was empty, no tombstones).",
              );
              return reconstructedCart.map((item) => ({
                ...item,
                lastModifiedAt: item.lastModifiedAt || Date.now(),
              }));
            }

            const mergedMap = new Map<string, CartItem>();

            // Add local items first (these carry local timestamps)
            prev.forEach((item) => {
              const key = `${item.product.id}-${item.variantId || ""}`;
              mergedMap.set(key, {
                ...item,
                lastModifiedAt: item.lastModifiedAt || 0,
              });
            });

            // Merge remote items using Last-Write-Wins with timestamps
            reconstructedCart.forEach((remoteItem) => {
              const key = `${remoteItem.product.id}-${remoteItem.variantId || ""}`;
              const remoteTs = remoteItem.lastModifiedAt || 0;

              const tombstone = tombstones.get(key);
              if (tombstone && tombstone.deletedAt > remoteTs) {
                return;
              }

              if (mergedMap.has(key)) {
                const local = mergedMap.get(key)!;
                const localTs = local.lastModifiedAt || 0;

                if (localTs >= remoteTs) {
                  // Local is newer
                } else {
                  // Remote is newer
                  mergedMap.set(key, {
                    ...remoteItem,
                    lastModifiedAt: remoteTs,
                  });
                }
              } else {
                mergedMap.set(key, { ...remoteItem, lastModifiedAt: remoteTs });
              }
            });

            const mergedArray = Array.from(mergedMap.values());
            return mergedArray;
          });
        }
      } catch (err) {
        console.error("[CartContext] ❌ Sync error:", err);
      } finally {
        syncLocked.current = false;
        setIsLoading(false);
        isInitialLoad.current = false;
      }
    },
    [userId, authLoading],
  );

  // Initial Sync from Supabase
  useEffect(() => {
    // Detection of user change: Reset state if the ID changes (null <-> UUID)
    const currentUserId = userId || null;
    if (currentUserId !== lastSessionUserId.current) {
      console.log(
        "[CartContext] ℹ️ User session changed. Resetting initial load state.",
      );
      isInitialLoad.current = true;
      syncLocked.current = true;
      lastSessionUserId.current = currentUserId;
    }

    syncFromDB();
  }, [userId, syncFromDB]);

  // Realtime subscription for cart updates
  useEffect(() => {
    const cartBc =
      typeof window !== "undefined"
        ? new BroadcastChannel("ikcous_cart_sync")
        : null;

    if (userId) {
      let channel: any = null;

      if (isLeader) {
        console.log(
          "[CartContext-Realtime] Leader tab subscribing to cart_items...",
        );
        channel = supabase
          .channel(`cart:${userId}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "cart_items",
              filter: `user_id=eq.${userId}`,
            },
            (payload: any) => {
              console.log(
                "[CartContext-Realtime] Cart changed in database:",
                payload.eventType,
              );
              // 1. Fetch fresh cart from DB
              syncFromDB(true);
              // 2. Notify other tabs
              cartBc?.postMessage({ type: "cart_update" });
            },
          )
          .subscribe();
      } else {
        console.log(
          "[CartContext-Realtime] Secondary tab listening to BroadcastChannel...",
        );
        if (cartBc) {
          cartBc.onmessage = (event) => {
            if (event.data?.type === "cart_update") {
              console.log(
                "[CartContext-Realtime-Secondary] Received cart update broadcast",
              );
              syncFromDB(true);
            }
          };
        }
      }

      return () => {
        if (channel) {
          supabase.removeChannel(channel).catch(() => {});
        }
        cartBc?.close();
      };
    }
    cartBc?.close();
  }, [userId, isLeader, syncFromDB]); // Added authLoading to deps

  const syncPending = useRef(false);
  const lastSyncedCart = useRef<string>("");

  // Sync back to Supabase (Atomic-ish Strategy)
  const syncToDB = useCallback(
    async (currentCart: CartItem[], immediate = false) => {
      if (!user || authLoading || isInitialLoad.current || syncLocked.current)
        return;

      const cartHash = JSON.stringify(currentCart);
      if (cartHash === lastSyncedCart.current && !immediate) return;

      syncPending.current = true;
      try {
        // Verify session before syncing to avoid transient auth errors
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          console.log(
            "[CartContext] Bypassing sync: session not active/ready in client",
          );
          syncPending.current = false;
          return;
        }

        console.log("[CartContext] 📤 Syncing to Supabase...");
        const itemMap = new Map<string, any>();
        currentCart.forEach((item) => {
          const variantId = item.variantId || "";
          const key = `${item.product.id}-${variantId}`;
          if (itemMap.has(key)) {
            itemMap.get(key).quantity += item.quantity;
          } else {
            itemMap.set(key, {
              product_id: item.product.id,
              variant_id: variantId,
              quantity: item.quantity,
              variant_names: item.variantNames || null,
              updated_at: item.lastModifiedAt
                ? new Date(item.lastModifiedAt).toISOString()
                : new Date().toISOString(),
            });
          }
        });

        const { error: syncError } = await (supabase.rpc as any)(
          "sync_cart_atomic",
          {
            p_cart_items: Array.from(itemMap.values()),
          },
        );

        if (syncError) throw syncError;
        lastSyncedCart.current = cartHash;
        syncPending.current = false;
      } catch (err) {
        console.error("[CartContext] ❌ DB Sync Failed:", err);
        syncPending.current = false;
      }
    },
    [user, authLoading],
  );

  useEffect(() => {
    if (isInitialLoad.current || syncLocked.current) return;

    const timer = setTimeout(() => {
      if (!syncPending.current) {
        syncToDB(cart);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [cart, syncToDB]);

  const addToCart = useCallback(
    (
      product: Product,
      quantity = 1,
      variantIdInput?: string,
      variantNamesInput?: string,
    ) => {
      // Session check removed to allow Guest Cart
      // Guest cart will be synced to DB once user logs in via syncFromDB logic
      if (!user || !user.id) {
        console.log("[CartContext] ℹ️ Guest adding to cart.");
      }

      const qToAdd = Math.max(Number(quantity) || 1, 1);
      const variantId =
        variantIdInput === "" || variantIdInput === null
          ? undefined
          : variantIdInput;
      const variantNames = variantNamesInput || undefined;

      console.log(
        `[CartContext-Trace] 🛒 addToCart confirmed for ${product.id}.`,
      );

      setCart((prev) => {
        const existingIndex = prev.findIndex(
          (item) =>
            item.product.id === product.id && item.variantId === variantId,
        );

        // Enforce stock limit
        const variant = variantId
          ? product.variants?.find((v) => v.id === variantId)
          : undefined;
        const availableStock = variant
          ? variant.stockIncrement
          : product.stock || 0;

        if (availableStock <= 0) {
          toast.error("Este produto está esgotado.");
          return prev;
        }

        if (existingIndex > -1) {
          const existing = prev[existingIndex];
          console.log(
            `[CartContext-Trace] ➕ Updating existing item. Current: ${existing.quantity}, Adding: ${qToAdd}`,
          );
          const nextQuantity = Math.min(
            existing.quantity + qToAdd,
            availableStock,
            MAX_ITEM_QUANTITY,
          );

          if (
            nextQuantity === availableStock &&
            existing.quantity + qToAdd > availableStock
          ) {
            toast.error(
              `Apenas ${availableStock} unidades disponíveis em estoque.`,
            );
          } else if (
            nextQuantity === MAX_ITEM_QUANTITY &&
            existing.quantity + qToAdd > MAX_ITEM_QUANTITY
          ) {
            console.error(
              `[CartContext-STOP] 🛑 QUANTITY CAP REACHED for ${product.id}.`,
            );
          }

          const newCart = [...prev];
          newCart[existingIndex] = {
            ...existing,
            quantity: nextQuantity,
            lastModifiedAt: Date.now(),
          };
          return newCart;
        }

        console.log("[CartContext-Trace] ✨ Adding new item to cart.");
        const validatedQuantity = Math.min(
          qToAdd,
          availableStock,
          MAX_ITEM_QUANTITY,
        );

        if (qToAdd > availableStock) {
          toast.error(`Apenas ${availableStock} unidades disponíveis.`);
        }

        // Stamp mutation timestamp for offline conflict resolution
        return [
          ...prev,
          {
            product,
            quantity: validatedQuantity,
            variantId,
            variantNames,
            lastModifiedAt: Date.now(),
          },
        ];
      });
    },
    [user],
  );

  const removeFromCart = useCallback(
    (productId: string, variantIdInput?: string) => {
      const variantId =
        variantIdInput === "" || variantIdInput === null
          ? undefined
          : variantIdInput;
      // Record tombstone so offline merge doesn't resurrect this item
      const key = `${productId}-${variantId || ""}`;
      const tombstones = loadTombstones();
      tombstones.set(key, { key, deletedAt: Date.now() });
      saveTombstones(tombstones);
      setCart((prev) =>
        prev.filter(
          (item) =>
            !(item.product.id === productId && item.variantId === variantId),
        ),
      );
      toast.info("Produto removido do carrinho");
    },
    [],
  );

  const updateQuantity = useCallback(
    (productId: string, quantity: number, variantIdInput?: string) => {
      const variantId =
        variantIdInput === "" || variantIdInput === null
          ? undefined
          : variantIdInput;
      if (quantity <= 0) {
        removeFromCart(productId, variantId);
        return;
      }

      setCart((prev) =>
        prev.map((item) => {
          if (item.product.id === productId && item.variantId === variantId) {
            const variant = variantId
              ? item.product.variants?.find((v) => v.id === variantId)
              : undefined;
            const availableStock = variant
              ? variant.stockIncrement
              : item.product.stock || 0;
            const nextQuantity = Math.min(
              quantity,
              availableStock,
              MAX_ITEM_QUANTITY,
            );

            if (quantity > availableStock) {
              if (availableStock <= 0) {
                toast.error("Este produto está esgotado.");
              } else {
                toast.error(
                  `Limite de estoque atingido (${availableStock} unidades).`,
                );
              }
            }

            return {
              ...item,
              quantity: nextQuantity,
              lastModifiedAt: Date.now(),
            };
          }
          return item;
        }),
      );
    },
    [removeFromCart],
  );

  const clearCart = useCallback(() => {
    // Tombstone all current items before clearing
    setCart((prev) => {
      const tombstones = loadTombstones();
      const now = Date.now();
      prev.forEach((item) => {
        const key = `${item.product.id}-${item.variantId || ""}`;
        tombstones.set(key, { key, deletedAt: now });
      });
      saveTombstones(tombstones);
      return [];
    });
    setSelectedShippingOption(null);
    localStorage.removeItem(CART_STORAGE_KEY);
    toast.info("Carrinho limpo");
  }, []);

  const [selectedShippingOption, setSelectedShippingOption] =
    React.useState<ShippingOption | null>(null);

  // Reset shipping option when cart becomes empty
  useEffect(() => {
    if (cart.length === 0) {
      setSelectedShippingOption(null);
    }
  }, [cart.length]);

  const cartTotal = React.useMemo(() => {
    return cart.reduce((total, item) => {
      const price = item.variantId
        ? item.product.variants?.find((v) => v.id === item.variantId)
            ?.priceOverride || item.product.price
        : item.product.price;
      return total + price * item.quantity;
    }, 0);
  }, [cart]);

  const cartCount = React.useMemo(() => {
    return cart.reduce((count, item) => count + item.quantity, 0);
  }, [cart]);

  const shippingFee = React.useMemo(() => {
    if (cart.length === 0) return 0;

    const hasFreeShippingItem = cart.some((item) => item.product.freeShipping);
    if (hasFreeShippingItem) return 0;

    if (
      config.freeShippingMin > 0 &&
      cartTotal >= config.freeShippingMin &&
      user
    )
      return 0;

    if (selectedShippingOption) {
      return selectedShippingOption.price;
    }

    return config.shippingFee;
  }, [
    cart,
    cartTotal,
    config.freeShippingMin,
    config.shippingFee,
    selectedShippingOption,
    user,
  ]);

  const cartTotalRef = useRef(cartTotal);
  const cartCountRef = useRef(cartCount);
  useEffect(() => {
    cartTotalRef.current = cartTotal;
    cartCountRef.current = cartCount;
  }, [cartTotal, cartCount]);

  const getCartTotal = useCallback(() => cartTotalRef.current, []);

  const getCartCount = useCallback(() => cartCountRef.current, []);

  const stateValue = React.useMemo(
    () => ({
      cart,
      isLoading,
      cartTotal,
      cartCount,
      shippingFee,
      selectedShippingOption,
    }),
    [
      cart,
      isLoading,
      cartTotal,
      cartCount,
      shippingFee,
      selectedShippingOption,
    ],
  );

  const actionsValue = React.useMemo(
    () => ({
      addToCart,
      removeFromCart,
      updateQuantity,
      clearCart,
      getCartTotal,
      getCartCount,
      setSelectedShippingOption,
    }),
    [
      addToCart,
      removeFromCart,
      updateQuantity,
      clearCart,
      getCartTotal,
      getCartCount,
    ],
  );

  const contextValue = React.useMemo(
    () => ({
      ...stateValue,
      ...actionsValue,
    }),
    [stateValue, actionsValue],
  );

  return (
    <CartStateContext.Provider value={stateValue}>
      <CartActionsContext.Provider value={actionsValue}>
        <CartContext.Provider value={contextValue}>
          {children}
        </CartContext.Provider>
      </CartActionsContext.Provider>
    </CartStateContext.Provider>
  );
}

export const useCartState = () => {
  const context = React.useContext(CartStateContext);
  if (context === undefined) {
    throw new Error("useCartState must be used within a CartProvider");
  }
  return context;
};

export const useCartActions = () => {
  const context = React.useContext(CartActionsContext);
  if (context === undefined) {
    throw new Error("useCartActions must be used within a CartProvider");
  }
  return context;
};

export const useCartContext = () => {
  const context = React.useContext(CartContext);
  if (context === undefined) {
    throw new Error("useCartContext must be used within a CartProvider");
  }
  return context;
};
