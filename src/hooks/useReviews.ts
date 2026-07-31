import { useAuth } from "@/hooks/useAuth";
import { useLeaderElection } from "@/hooks/useLeaderElection";
import { supabase } from "@/lib/supabase";
import type { Review } from "@/types";
import { cachedReviewsData, setCachedReviewsData } from "@/utils/admin_cache";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

export interface AdminReview extends Review {
  userId: string;
  productName: string;
  merchantReply?: string;
}

const REVIEWS_CACHE_KEY_PREFIX = "ikcous_reviews_cache_";
const memoryReviewsCache = new Map<string, Review[]>();

const getReviewsCache = (productId: string): Review[] | null => {
  if (memoryReviewsCache.has(productId)) {
    return memoryReviewsCache.get(productId)!;
  }
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(
        `${REVIEWS_CACHE_KEY_PREFIX}${productId}`,
      );
      if (stored) {
        const parsed = JSON.parse(stored);
        memoryReviewsCache.set(productId, parsed);
        return parsed;
      }
    } catch (e) {
      console.error("Failed to parse reviews cache", e);
    }
  }
  return null;
};

const updateReviewsCache = (productId: string, newReviews: Review[]) => {
  memoryReviewsCache.set(productId, newReviews);
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(
        `${REVIEWS_CACHE_KEY_PREFIX}${productId}`,
        JSON.stringify(newReviews),
      );
    } catch (e) {
      console.error("Failed to update reviews cache", e);
    }
  }
};

const bc =
  typeof window !== "undefined"
    ? new BroadcastChannel("ikcous_reviews_sync")
    : null;

export function useReviews() {
  const { user, isAdmin } = useAuth();
  const { isLeader } = useLeaderElection();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [adminReviews, setAdminReviews] = useState<AdminReview[]>(() => {
    return isAdmin && cachedReviewsData ? cachedReviewsData : [];
  });
  const [loading, setLoading] = useState(() => isAdmin && !cachedReviewsData);
  const latestProductIdRef = useRef<string | null>(null);

  const getReviewsByProduct = useCallback(async (productId: string) => {
    latestProductIdRef.current = productId;

    // 1. SWR Cache Sync
    const cached = getReviewsCache(productId);
    if (cached) {
      setReviews(cached);
      setLoading(false);
    } else {
      setReviews([]); // Clear previous product reviews if not cached
      setLoading(true);
    }

    try {
      const { data, error } = await supabase
        .from("reviews" as any)
        .select(`
          *,
          user:public_profiles(full_name, avatar_url)
        `)
        .eq("product_id", productId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const formattedReviews: Review[] = data.map((item: any) => ({
        id: item.id,
        productId: item.product_id,
        userId: item.user_id,
        customerName: item.user?.full_name || "Usuário Anônimo",
        customerAvatar: item.user?.avatar_url || undefined,
        rating: item.rating,
        comment: item.comment,
        verified: item.verified,
        helpful: item.helpful,
        createdAt: item.created_at,
      }));

      if (latestProductIdRef.current === productId) {
        setReviews(formattedReviews);
      }
      updateReviewsCache(productId, formattedReviews);
    } catch (error: any) {
      console.error("Error fetching reviews:", error);
      toast.error("Erro ao carregar avaliações.");
    } finally {
      if (latestProductIdRef.current === productId) {
        setLoading(false);
      }
    }
  }, []);

  const addReview = useCallback(
    async (review: { productId: string; rating: number; comment: string }) => {
      try {
        // ZENITH v21.7: Rely on AuthContext's verified user
        if (!user) {
          toast.error("Você precisa estar logado para avaliar.");
          return null;
        }

        // Check if user already reviewed (optional, good practice)
        /*
      const { data: existing } = await supabase
        .from('reviews')
        .select('id')
        .eq('product_id', review.productId)
        .eq('user_id', user.id)
        .single();
      
      if (existing) {
        toast.error('Você já avaliou este produto.');
        return null;
      }
      */

        const { data, error } = await supabase
          .from("reviews" as any)
          .insert({
            product_id: review.productId,
            user_id: user.id,
            rating: review.rating,
            comment: review.comment,
            // verified: true // Logic to check if user bought product could go here later
          })
          .select()
          .single();

        if (error) throw error;

        toast.success("Avaliação enviada com sucesso!");

        // Refresh reviews
        await getReviewsByProduct(review.productId);

        return data;
      } catch (error: any) {
        console.error("Error adding review:", error);
        toast.error(`Erro ao enviar avaliação: ${error.message}`);
        return null;
      }
    },
    [getReviewsByProduct, user],
  );

  const markHelpful = useCallback(
    async (reviewId: string) => {
      try {
        // ZENITH v21.7: Rely on AuthContext's verified user
        if (!user) {
          toast.error("Faça login para marcar como útil.");
          return;
        }

        // Optimistic update
        let pId: string | undefined;
        setReviews((current) => {
          const reviewObj = current.find((r) => r.id === reviewId);
          pId = reviewObj?.productId;
          const updated = current.map((review) =>
            review.id === reviewId
              ? { ...review, helpful: review.helpful + 1 }
              : review,
          );
          if (pId) {
            updateReviewsCache(pId, updated);
          }
          return updated;
        });

        const { error } = await supabase.rpc("increment_helpful" as any, {
          review_id: reviewId,
        });

        if (error) {
          // Revert on error
          setReviews((current) => {
            const reviewObj = current.find((r) => r.id === reviewId);
            const productId = reviewObj?.productId;
            const reverted = current.map((review) =>
              review.id === reviewId
                ? { ...review, helpful: review.helpful - 1 }
                : review,
            );
            if (productId) {
              updateReviewsCache(productId, reverted);
            }
            return reverted;
          });
          throw error;
        }
      } catch (error) {
        console.error("Error marking helpful:", error);
        toast.error("Erro ao marcar como útil.");
      }
    },
    [user],
  );

  const getAllReviews = useCallback(
    async (
      page = 0,
      pageSize = 20,
      filters?: { rating?: number | "all"; search?: string; silent?: boolean },
    ) => {
      try {
        if (!filters?.silent) {
          setLoading(true);
        }

        // High Optimization: If Admin, run single unified RPC on Supabase
        if (isAdmin) {
          const { data, error } = await (supabase.rpc as any)(
            "get_admin_reviews_paged",
            {
              p_search: filters?.search || "",
              p_rating:
                filters?.rating !== undefined
                  ? filters.rating.toString()
                  : "all",
              p_page: page,
              p_page_size: pageSize,
            },
          );

          if (error) throw error;

          const rpcData = data as any;
          const reviewsList = rpcData?.data || [];
          const totalCount = rpcData?.total_count || 0;
          const averageRating = Number(rpcData?.average_rating) || 0;
          const globalVerifiedCount = Number(rpcData?.total_verified) || 0;
          const globalRepliedCount = Number(rpcData?.total_replied) || 0;

          const formatted: AdminReview[] = reviewsList.map((item: any) => ({
            id: item.id,
            productId: item.product_id,
            userId: item.user_id,
            customerName: item.user?.full_name || "Anônimo",
            productName: item.product?.nome || "Produto removido",
            rating: item.rating,
            comment: item.comment || "",
            verified: item.verified ?? false,
            helpful: item.helpful ?? 0,
            createdAt: item.created_at,
            merchantReply: item.merchant_reply,
          }));

          if (isAdmin) {
            setCachedReviewsData(formatted);
          }
          setAdminReviews(formatted);
          return {
            reviews: formatted,
            total: totalCount,
            averageRating,
            globalVerifiedCount,
            globalRepliedCount,
          };
        }

        // Guest/Non-admin fallback flow (original)
        let query: any = supabase.from("reviews" as any);

        let profileFilter: string[] = [];
        let productFilter: string[] = [];

        if (filters?.search) {
          // Sanitizar a query para remover caracteres que quebram o parser do PostgREST no .or()
          const sanitizedSearch = filters.search.replace(/[()[\],.:\\]/g, "");
          const q = `%${sanitizedSearch}%`;

          // Pre-fetch profiles and products matching the search query to bypass PostgREST join OR limitation
          // Limited to 25 to prevent URL length overflow (HTTP 414) in PostgREST
          const { data: profiles } = await supabase
            .from("public_profiles")
            .select("id")
            .ilike("full_name", q)
            .limit(25);
          const profileIds = profiles?.map((p: any) => p.id) || [];
          profileFilter =
            profileIds.length > 0
              ? profileIds
              : ["00000000-0000-0000-0000-000000000000"];

          const { data: products } = await supabase
            .from("vw_produtos_admin")
            .select("id")
            .ilike("nome", q)
            .limit(25);
          const productIds = products?.map((p: any) => p.id) || [];
          productFilter =
            productIds.length > 0
              ? productIds
              : ["00000000-0000-0000-0000-000000000000"];

          query = query
            .select(
              `
          *,
          user:public_profiles(full_name),
          product:produtos(nome)
        `,
              { count: "exact" },
            )
            .or(
              `comment.ilike.${q},user_id.in.(${profileFilter.join(",")}),product_id.in.(${productFilter.join(",")})`,
            );
        } else {
          query = query.select(
            `
          *,
          user:public_profiles(full_name),
          product:produtos(nome)
        `,
            { count: "exact" },
          );
        }

        if (filters?.rating && filters.rating !== "all") {
          query = query.eq("rating", filters.rating);
        }

        const { data, error, count } = await query
          .order("created_at", { ascending: false })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) throw error;

        // Compute dynamic average rating and global statistics for matching filters using optimized database-side RPC
        let averageRating = 0;
        let globalVerifiedCount = 0;
        let globalRepliedCount = 0;

        const { data: metricsData, error: metricsError } = await (
          supabase.rpc as any
        )("get_reviews_metrics", {
          p_search: filters?.search || null,
          p_rating:
            filters?.rating && filters.rating !== "all"
              ? Number(filters.rating)
              : null,
        });

        if (!metricsError && metricsData && metricsData.length > 0) {
          const metrics = metricsData[0];
          averageRating = Number(metrics.average_rating) || 0;
          globalVerifiedCount = Number(metrics.total_verified) || 0;
          globalRepliedCount = Number(metrics.total_replied) || 0;
        } else if (metricsError) {
          console.error(
            "[useReviews] Failed to fetch aggregate metrics via RPC:",
            metricsError,
          );
        }

        const formatted: AdminReview[] = (data || []).map((item: any) => ({
          id: item.id,
          productId: item.product_id,
          userId: item.user_id,
          customerName: item.user?.full_name || "Anônimo",
          productName: item.product?.nome || "Produto removido",
          rating: item.rating,
          comment: item.comment || "",
          verified: item.verified ?? false,
          helpful: item.helpful ?? 0,
          createdAt: item.created_at,
          merchantReply: item.merchant_reply,
        }));

        setAdminReviews(formatted);
        return {
          reviews: formatted,
          total: count || 0,
          averageRating,
          globalVerifiedCount,
          globalRepliedCount,
        };
      } catch (error) {
        console.error("Error fetching all reviews:", error);
        toast.error("Erro ao carregar avaliações.");
        return { reviews: [], total: 0, averageRating: 0 };
      } finally {
        setLoading(false);
      }
    },
    [isAdmin],
  );

  const deleteReview = useCallback(
    async (reviewId: string) => {
      if (!isAdmin) {
        toast.error("Permissão negada");
        return;
      }
      try {
        const { error } = await supabase
          .from("reviews" as any)
          .delete()
          .eq("id", reviewId);

        if (error) throw error;

        setAdminReviews((prev) => prev.filter((r) => r.id !== reviewId));
        toast.success("Avaliação removida.");
      } catch (error) {
        console.error("Error deleting review:", error);
        toast.error("Erro ao remover avaliação.");
      }
    },
    [isAdmin],
  );

  const toggleVerified = useCallback(
    async (reviewId: string, currentVerified: boolean) => {
      if (!isAdmin) {
        toast.error("Permissão negada");
        return;
      }
      try {
        const { error } = await supabase
          .from("reviews" as any)
          .update({ verified: !currentVerified })
          .eq("id", reviewId);

        if (error) throw error;

        setAdminReviews((prev) =>
          prev.map((r) =>
            r.id === reviewId ? { ...r, verified: !currentVerified } : r,
          ),
        );
        toast.success(
          !currentVerified ? "Avaliação verificada." : "Verificação removida.",
        );
      } catch (error) {
        console.error("Error toggling verified:", error);
        toast.error("Erro ao atualizar avaliação.");
      }
    },
    [isAdmin],
  );

  const addMerchantReply = useCallback(
    async (reviewId: string, reply: string) => {
      if (!isAdmin) {
        toast.error("Permissão negada");
        return false;
      }
      try {
        // ZENITH v21.7: Rely on AuthContext's verified user
        if (!user) {
          toast.error("Administrador não autenticado.");
          return false;
        }

        // 1. Execute Atomic Reply & Log via RPC
        const { error } = await (supabase.rpc as any)("reply_review_atomic", {
          p_review_id: reviewId,
          p_reply: reply,
        });

        if (error) throw error;

        // 2. Optimistic Update
        setAdminReviews((prev) =>
          prev.map((r) =>
            r.id === reviewId ? { ...r, merchantReply: reply } : r,
          ),
        );

        toast.success("Resposta enviada com sucesso!");
        return true;
      } catch (error) {
        console.error("Error adding merchant reply:", error);
        toast.error("Erro ao enviar resposta.");
        return false;
      }
    },
    [user, isAdmin],
  );

  const subscribeToReviews = useCallback(
    (onChange?: () => void, productId?: string) => {
      const channelId = productId ? `reviews_prod_${productId}` : "reviews_all";

      let channel: any = null;
      let listener: any = null;

      if (isLeader) {
        console.log(
          `[Realtime-Reviews] Leader tab subscribing to: ${channelId}`,
        );
        channel = supabase.channel(channelId).on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "reviews",
            ...(productId ? { filter: `product_id=eq.${productId}` } : {}),
          },
          (payload) => {
            console.log("[Realtime-Reviews] Review change:", payload.eventType);
            bc?.postMessage({ type: "reviews_change", productId, payload });
            if (onChange) {
              onChange();
            } else if (productId) {
              getReviewsByProduct(productId);
            } else {
              getAllReviews(0, 20, { silent: true });
            }
          },
        );

        channel.subscribe((status: any, err?: any) => {
          if (status === "SUBSCRIBED") {
            console.log("[Realtime-Reviews] Active: %s", channelId);
          } else if (status === "CHANNEL_ERROR") {
            const errMessage =
              err?.message || (typeof err === "string" ? err : "");
            const isNormalClose =
              errMessage.includes("1000") || errMessage.includes("normal");
            const isAbnormalClose =
              errMessage.includes("1006") || errMessage.includes("abnormal");
            if (isNormalClose) {
              console.log(
                "[Realtime-Reviews] Channel closed normally in %s (socket closed: 1000)",
                channelId,
              );
            } else if (isAbnormalClose) {
              console.warn(
                "[Realtime-Reviews] Channel closed abnormally in %s (socket closed: 1006). SDK will auto-reconnect.",
                channelId,
              );
            } else {
              console.error(
                "[Realtime-Reviews] Error in %s:",
                channelId,
                err?.message || err,
              );
            }
          }
        });
      } else {
        console.log(
          "[Realtime-Reviews] Secondary tab listening via BroadcastChannel: %s",
          channelId,
        );
        if (bc) {
          listener = (event: MessageEvent) => {
            if (
              event.data?.type === "reviews_change" &&
              event.data?.productId === productId
            ) {
              console.log(
                "[Realtime-Reviews-Secondary] Received change signal from Leader tab",
              );
              if (onChange) {
                onChange();
              } else if (productId) {
                getReviewsByProduct(productId);
              } else {
                getAllReviews(0, 20, { silent: true });
              }
            }
          };
          bc.addEventListener("message", listener);
        }
      }

      return () => {
        if (channel) {
          console.log(`[Realtime-Reviews] Cleaning up channel: ${channelId}`);
          supabase.removeChannel(channel).catch(() => {});
        }
        if (listener && bc) {
          console.log(
            `[Realtime-Reviews] Cleaning up BroadcastChannel listener: ${channelId}`,
          );
          bc.removeEventListener("message", listener);
        }
      };
    },
    [isLeader, getReviewsByProduct, getAllReviews],
  );

  return {
    reviews,
    adminReviews,
    loading,
    getReviewsByProduct,
    addReview,
    markHelpful,
    getAllReviews,
    deleteReview,
    toggleVerified,
    addMerchantReply,
    subscribeToReviews,
  };
}
