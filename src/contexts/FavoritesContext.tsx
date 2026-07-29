import { useAuth } from "@/hooks/useAuth";
import { useLeaderElection } from "@/hooks/useLeaderElection";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useProducts } from "@/hooks/useProducts";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types";
import React, { createContext, useState, useEffect, useCallback } from "react";
import { toast } from "sonner";

const FAVORITES_KEY = "ikcous_favorites";

interface FavoritesContextType {
  favorites: Product[];
  toggleFavorite: (product: Product) => void;
  isFavorite: (productId: string) => boolean;
  loading: boolean;
}

export const FavoritesContext = createContext<FavoritesContextType | undefined>(
  undefined,
);

export function FavoritesProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { user } = useAuth();
  const { isLeader } = useLeaderElection();
  const { products: allProducts } = useProducts();
  const [localFavorites, setLocalFavorites] = useLocalStorage<Product[]>(
    FAVORITES_KEY,
    [],
  );
  const [dbFavoriteIds, setDbFavoriteIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDbFavorites = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("favorites")
        .select("product_id")
        .eq("user_id", user.id);

      if (error) {
        console.error("Error fetching favorites", error);
      } else if (data) {
        const newIds = data.map((f) => f.product_id);
        setDbFavoriteIds(newIds);
      }
    } catch (err) {
      console.error("Fetch favorites failed", err);
    }
  }, [user]);

  // 1. Sync Logic: When User logs in, merge Local -> DB
  useEffect(() => {
    if (!user) {
      setDbFavoriteIds([]);
      setLoading(false);
      return;
    }

    const syncFavorites = async () => {
      setLoading(true);

      try {
        // A. Push Local to DB (Merge)
        if (localFavorites.length > 0) {
          const promises = localFavorites.map((p) =>
            supabase
              .from("favorites")
              .upsert(
                { user_id: user.id, product_id: p.id },
                { onConflict: "user_id, product_id", ignoreDuplicates: true },
              ),
          );
          await Promise.all(promises);

          // After sync, replace state with server data and clear local storage
          setLocalFavorites([]); // Clear local state
          if (typeof window !== "undefined") {
            localStorage.removeItem(FAVORITES_KEY); // Explicitly remove from localStorage
          }
          toast.success("Seus favoritos locais foram sincronizados!");
        }

        // B. Fetch from DB
        await fetchDbFavorites();
      } catch (err) {
        console.error("Sync failed", err);
      } finally {
        setLoading(false);
      }
    };

    syncFavorites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, fetchDbFavorites]);

  // Realtime Sync for Favorites
  useEffect(() => {
    const bc =
      typeof window !== "undefined"
        ? new BroadcastChannel("ikcous_favorites_sync")
        : null;
    let channel: any = null;
    let bcListener: ((event: MessageEvent) => void) | null = null;

    if (user) {
      if (isLeader) {
        console.log(
          "[Favorites] Leader tab subscribing to database favorites...",
        );
        channel = supabase
          .channel(`favorites:${user.id}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "favorites",
              filter: `user_id=eq.${user.id}`,
            },
            () => {
              console.log(
                "[Favorites-Leader] Favorites change detected in database",
              );
              fetchDbFavorites();
              bc?.postMessage({ type: "favorites_update" });
            },
          )
          .subscribe((status: any, err?: any) => {
            if (status === "CHANNEL_ERROR") {
              const isNormalClose =
                err?.message?.includes("1000") ||
                err?.message?.includes("normal") ||
                (typeof err === "string" &&
                  (err.includes("1000") || err.includes("normal")));
              if (isNormalClose) {
                console.log(
                  "[Favorites] Channel closed normally (socket closed: 1000)",
                );
              } else {
                console.error(
                  "[Favorites] Channel error:",
                  err?.message || err,
                );
              }
            }
          });
      } else {
        console.log(
          "[Favorites] Secondary tab listening via BroadcastChannel...",
        );
        if (bc) {
          bcListener = (event: MessageEvent) => {
            if (event.data?.type === "favorites_update") {
              console.log(
                "[Favorites-Secondary] Favorites update received via BroadcastChannel",
              );
              fetchDbFavorites();
            }
          };
          bc.addEventListener("message", bcListener);
        }
      }
    }

    return () => {
      if (channel) {
        supabase.removeChannel(channel).catch(() => {});
      }
      if (bcListener && bc) {
        bc.removeEventListener("message", bcListener);
      }
      bc?.close();
    };
  }, [user, isLeader, fetchDbFavorites]);

  // 2. Computed Favorites List
  const favorites = React.useMemo(() => {
    return user
      ? allProducts.filter((p) => dbFavoriteIds.includes(p.id))
      : localFavorites;
  }, [user, allProducts, dbFavoriteIds, localFavorites]);

  // 3. Actions
  const addToFavorites = useCallback(
    async (product: Product) => {
      if (user) {
        // Optimistic
        setDbFavoriteIds((prev) => [...prev, product.id]);
        const { error } = await supabase
          .from("favorites")
          .insert({ user_id: user.id, product_id: product.id });

        if (error) {
          console.error(error);
          toast.error("Erro ao salvar favorito");
          setDbFavoriteIds((prev) => prev.filter((id) => id !== product.id));
        } else {
          toast.success("Adicionado aos favoritos");
        }
      } else {
        setLocalFavorites((prev) => {
          if (prev.find((p) => p.id === product.id)) return prev;
          return [...prev, product];
        });
        toast.success("Adicionado aos favoritos");
      }
    },
    [user, setLocalFavorites],
  );

  const removeFromFavorites = useCallback(
    async (productId: string) => {
      if (user) {
        // Optimistic
        setDbFavoriteIds((prev) => prev.filter((id) => id !== productId));
        const { error } = await supabase
          .from("favorites")
          .delete()
          .eq("user_id", user.id)
          .eq("product_id", productId);

        if (error) {
          console.error(error);
          toast.error("Erro ao remover favorito");
          setDbFavoriteIds((prev) => [...prev, productId]);
        } else {
          toast.success("Removido dos favoritos");
        }
      } else {
        setLocalFavorites((prev) => prev.filter((p) => p.id !== productId));
        toast.success("Removido dos favoritos");
      }
    },
    [user, setLocalFavorites],
  );

  const toggleFavorite = useCallback(
    (product: Product) => {
      const isFav = user
        ? dbFavoriteIds.includes(product.id)
        : localFavorites.some((p) => p.id === product.id);
      if (isFav) {
        removeFromFavorites(product.id);
      } else {
        addToFavorites(product);
      }
    },
    [user, dbFavoriteIds, localFavorites, removeFromFavorites, addToFavorites],
  );

  const isFavorite = useCallback(
    (productId: string) => {
      if (user) return dbFavoriteIds.includes(productId);
      return localFavorites.some((p) => p.id === productId);
    },
    [user, dbFavoriteIds, localFavorites],
  );

  const contextValue = React.useMemo(
    () => ({
      favorites,
      toggleFavorite,
      isFavorite,
      loading,
    }),
    [favorites, toggleFavorite, isFavorite, loading],
  );

  return (
    <FavoritesContext.Provider value={contextValue}>
      {children}
    </FavoritesContext.Provider>
  );
}
