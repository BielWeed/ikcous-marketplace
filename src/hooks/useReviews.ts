import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import type { Review } from '@/types';
import { toast } from 'sonner';

export interface AdminReview extends Review {
  userId: string;
  productName: string;
  merchantReply?: string;
}

const REVIEWS_CACHE_KEY_PREFIX = 'ikcous_reviews_cache_';
const memoryReviewsCache = new Map<string, Review[]>();

const getReviewsCache = (productId: string): Review[] | null => {
  if (memoryReviewsCache.has(productId)) {
    return memoryReviewsCache.get(productId)!;
  }
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(`${REVIEWS_CACHE_KEY_PREFIX}${productId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        memoryReviewsCache.set(productId, parsed);
        return parsed;
      }
    } catch (e) {
      console.error('Failed to parse reviews cache', e);
    }
  }
  return null;
};

const updateReviewsCache = (productId: string, newReviews: Review[]) => {
  memoryReviewsCache.set(productId, newReviews);
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(`${REVIEWS_CACHE_KEY_PREFIX}${productId}`, JSON.stringify(newReviews));
    } catch (e) {
      console.error('Failed to update reviews cache', e);
    }
  }
};

export function useReviews() {
  const { user } = useAuth();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [adminReviews, setAdminReviews] = useState<AdminReview[]>([]);
  const [loading, setLoading] = useState(false);
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
        .from('reviews' as any)
        .select(`
          *,
          user:public_profiles(full_name)
        `)
        .eq('product_id', productId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formattedReviews: Review[] = data.map((item: any) => ({
        id: item.id,
        productId: item.product_id,
        customerName: item.user?.full_name || 'Usuário Anônimo',
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
      console.error('Error fetching reviews:', error);
      toast.error('Erro ao carregar avaliações.');
    } finally {
      if (latestProductIdRef.current === productId) {
        setLoading(false);
      }
    }
  }, []);

  const addReview = useCallback(async (review: { productId: string, rating: number, comment: string }) => {
    try {
      // ZENITH v21.7: Rely on AuthContext's verified user
      if (!user) {
        toast.error('Você precisa estar logado para avaliar.');
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
        .from('reviews' as any)
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

      toast.success('Avaliação enviada com sucesso!');

      // Refresh reviews
      await getReviewsByProduct(review.productId);

      return data;
    } catch (error: any) {
      console.error('Error adding review:', error);
      toast.error('Erro ao enviar avaliação: ' + error.message);
      return null;
    }
  }, [getReviewsByProduct, user]);

  const markHelpful = useCallback(async (reviewId: string) => {
    try {
      // ZENITH v21.7: Rely on AuthContext's verified user
      if (!user) {
        toast.error('Faça login para marcar como útil.');
        return;
      }

      // Optimistic update
      let pId: string | undefined;
      setReviews(current => {
        const reviewObj = current.find(r => r.id === reviewId);
        pId = reviewObj?.productId;
        const updated = current.map(review =>
          review.id === reviewId
            ? { ...review, helpful: review.helpful + 1 }
            : review
        );
        if (pId) {
          updateReviewsCache(pId, updated);
        }
        return updated;
      });

      const { error } = await supabase.rpc('increment_helpful' as any, { review_id: reviewId });

      if (error) {
        // Revert on error
        setReviews(current => {
          const reviewObj = current.find(r => r.id === reviewId);
          const productId = reviewObj?.productId;
          const reverted = current.map(review =>
            review.id === reviewId
              ? { ...review, helpful: review.helpful - 1 }
              : review
          );
          if (productId) {
            updateReviewsCache(productId, reverted);
          }
          return reverted;
        });
        throw error;
      }
    } catch (error) {
      console.error('Error marking helpful:', error);
      toast.error('Erro ao marcar como útil.');
    }
  }, [user]);

  const getAllReviews = useCallback(async (
    page: number = 0,
    pageSize: number = 20,
    filters?: { rating?: number | 'all', search?: string }
  ) => {
    try {
      setLoading(true);
      let query = supabase
        .from('reviews' as any)
        .select(`
          *,
          user:public_profiles(full_name),
          product:produtos(nome)
        `, { count: 'exact' });

      if (filters?.rating && filters.rating !== 'all') {
        query = query.eq('rating', filters.rating);
      }

      if (filters?.search) {
        const q = `%${filters.search}%`;
        // Search in customer name, product name, or comment
        // Note: productName and customerName are in joined tables.
        query = query.or(`comment.ilike.${q},user.full_name.ilike.${q},product.nome.ilike.${q}`);
      }

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) throw error;

      const formatted: AdminReview[] = (data || []).map((item: any) => ({
        id: item.id,
        productId: item.product_id,
        userId: item.user_id,
        customerName: item.user?.full_name || 'Anônimo',
        productName: item.product?.nome || 'Produto removido',
        rating: item.rating,
        comment: item.comment || '',
        verified: item.verified ?? false,
        helpful: item.helpful ?? 0,
        createdAt: item.created_at,
        merchantReply: item.merchant_reply,
      }));

      setAdminReviews(formatted);
      return { reviews: formatted, total: count || 0 };
    } catch (error) {
      console.error('Error fetching all reviews:', error);
      toast.error('Erro ao carregar avaliações.');
      return { reviews: [], total: 0 };
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteReview = useCallback(async (reviewId: string) => {
    try {
      const { error } = await supabase
        .from('reviews' as any)
        .delete()
        .eq('id', reviewId);

      if (error) throw error;

      setAdminReviews(prev => prev.filter(r => r.id !== reviewId));
      toast.success('Avaliação removida.');
    } catch (error) {
      console.error('Error deleting review:', error);
      toast.error('Erro ao remover avaliação.');
    }
  }, []);

  const toggleVerified = useCallback(async (reviewId: string, currentVerified: boolean) => {
    try {
      const { error } = await supabase
        .from('reviews' as any)
        .update({ verified: !currentVerified })
        .eq('id', reviewId);

      if (error) throw error;

      setAdminReviews(prev =>
        prev.map(r =>
          r.id === reviewId ? { ...r, verified: !currentVerified } : r
        )
      );
      toast.success(!currentVerified ? 'Avaliação verificada.' : 'Verificação removida.');
    } catch (error) {
      console.error('Error toggling verified:', error);
      toast.error('Erro ao atualizar avaliação.');
    }
  }, []);

  const addMerchantReply = useCallback(async (reviewId: string, reply: string) => {
    try {
      // ZENITH v21.7: Rely on AuthContext's verified user
      if (!user) {
        toast.error('Administrador não autenticado.');
        return false;
      }

      // 1. Execute Atomic Reply & Log via RPC
      const { error } = await (supabase.rpc as any)('reply_review_atomic', {
        p_review_id: reviewId,
        p_reply: reply,
        p_admin_id: user.id
      });

      if (error) throw error;

      // 2. Optimistic Update
      setAdminReviews(prev =>
        prev.map(r =>
          r.id === reviewId ? { ...r, merchant_reply: reply } : r
        )
      );

      toast.success('Resposta enviada com sucesso!');
      return true;
    } catch (error) {
      console.error('Error adding merchant reply:', error);
      toast.error('Erro ao enviar resposta.');
      return false;
    }
  }, [user]);

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
  };
}

