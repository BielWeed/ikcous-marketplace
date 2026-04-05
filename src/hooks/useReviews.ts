import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import type { Review } from '@/types';
import { toast } from 'sonner';

export interface AdminReview extends Review {
  userId: string;
  productName: string;
  merchantReply?: string;
}

export function useReviews() {
  const { user } = useAuth();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [adminReviews, setAdminReviews] = useState<AdminReview[]>([]);
  const [loading, setLoading] = useState(false);

  const getReviewsByProduct = useCallback(async (productId: string) => {
    try {
      setLoading(true);
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

      setReviews(formattedReviews);
    } catch (error: any) {
      console.error('Error fetching reviews:', error);
      toast.error('Erro ao carregar avaliações.');
    } finally {
      setLoading(false);
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
      setReviews(current =>
        current.map(review =>
          review.id === reviewId
            ? { ...review, helpful: review.helpful + 1 }
            : review
        )
      );

      const { error } = await supabase.rpc('increment_helpful' as any, { review_id: reviewId });

      if (error) {
        // Revert on error
        setReviews(current =>
          current.map(review =>
            review.id === reviewId
              ? { ...review, helpful: review.helpful - 1 }
              : review
          )
        );
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

