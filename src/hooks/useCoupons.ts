import { useState, useEffect, useCallback } from 'react';
import type { Coupon } from '@/types';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export function useCoupons(autoFetch: boolean = false) {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(autoFetch); // Only load if autofetching

  const fetchCoupons = useCallback(async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('coupons')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        if (error.code === 'PGRST116') {
          console.warn('Coupons access restricted to admins or active items.');
          setCoupons([]);
          return;
        }
        throw error;
      }

      const formattedCoupons: Coupon[] = data?.map((c) => ({
        id: c.id,
        code: c.code,
        type: c.type as 'percentage' | 'fixed',
        value: c.value,
        minPurchase: c.min_purchase ?? undefined,
        usageLimit: c.usage_limit ?? undefined,
        usageCount: (c as any).used_count || c.usage_count || 0, // Fallback for both old and new schema
        validUntil: c.valid_until ?? undefined,
        active: c.active ?? true
      })) || [];

      setCoupons(formattedCoupons);
    } catch (error: any) {
      console.error('Error fetching coupons:', error);
      if (error.code !== 'PGRST116') {
        toast.error('Não foi possível carregar os cupons.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (autoFetch) {
      fetchCoupons();
    }
  }, [fetchCoupons, autoFetch]);

  const validateCoupon = useCallback(async (code: string, subtotal: number): Promise<{ valid: boolean; discount: number; message?: string }> => {
    try {
      // SecOps: validate_coupon_secure_v2 es SECURITY DEFINER
      const { data, error } = await supabase.rpc('validate_coupon_secure_v2' as any, {
        p_code: code,
        p_subtotal: subtotal
      } as any);

      if (error) throw error;

      const result = (data as any)?.[0];
      if (!result) return { valid: false, discount: 0, message: 'Erro ao validar cupom' };

      return {
        valid: result.is_valid,
        discount: Number(result.discount_value),
        message: result.error_message
      };
    } catch (error) {
      console.error('Error validating coupon:', error);
      return { valid: false, discount: 0, message: 'Erro na conexão com servidor' };
    }
  }, []);

  const addCoupon = async (coupon: Omit<Coupon, 'id' | 'usageCount'>) => {
    try {
      const { data, error } = await supabase
        .from('coupons')
        .insert([{
          code: coupon.code,
          type: coupon.type,
          value: coupon.value,
          min_purchase: coupon.minPurchase,
          usage_limit: coupon.usageLimit,
          valid_until: coupon.validUntil,
          active: coupon.active ?? true,
          usage_count: 0
        }])
        .select()
        .single();

      if (error) throw error;

      toast.success('Cupom criado com sucesso');
      if (autoFetch) fetchCoupons();
      return data;
    } catch (error) {
      console.error('Error adding coupon:', error);
      toast.error('Erro ao criar cupom');
      throw error;
    }
  };

  const updateCoupon = async (id: string, updates: Partial<Coupon>) => {
    try {
      const { error } = await supabase
        .from('coupons')
        .update({
          code: updates.code,
          type: updates.type,
          value: updates.value,
          min_purchase: updates.minPurchase,
          usage_limit: updates.usageLimit,
          valid_until: updates.validUntil,
          active: updates.active
        })
        .eq('id', id);

      if (error) throw error;

      toast.success('Cupom atualizado');
      if (autoFetch) fetchCoupons();
    } catch (error) {
      console.error('Error updating coupon:', error);
      toast.error('Erro ao atualizar cupom');
      throw error;
    }
  };

  const deleteCoupon = async (id: string) => {
    try {
      const { error } = await supabase
        .from('coupons')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Cupom removido');
      if (autoFetch) fetchCoupons();
    } catch (error) {
      console.error('Error deleting coupon:', error);
      toast.error('Erro ao remover cupom');
      throw error;
    }
  };

  const getCouponStats = useCallback(async () => {
    try {
      const { data, error } = await (supabase.rpc as any)('get_coupon_stats');
      if (error) throw error;
      return (data as any)?.[0] || null;
    } catch (error) {
      console.error('Error getting coupon stats:', error);
      return null;
    }
  }, []);

  return {
    coupons,
    loading,
    validateCoupon,
    refreshCoupons: fetchCoupons,
    addCoupon,
    updateCoupon,
    deleteCoupon,
    getCouponStats
  };
}
