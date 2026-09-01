import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { mensagemDeErroDoCupom } from "@/lib/erro-do-cupom";
import type { Coupon } from "@/types";
import type { Database } from "@/types/supabase";
import { cachedCouponsData, setCachedCouponsData } from "@/utils/admin_cache";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export function useCoupons(autoFetch = false) {
  const { isAdmin } = useAuth();
  const [coupons, setCoupons] = useState<Coupon[]>(
    () => cachedCouponsData || [],
  );
  const [loading, setLoading] = useState(() => autoFetch && !cachedCouponsData); // Skip initial loader if cache is available

  const fetchCoupons = useCallback(async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from("coupons")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        if (error.code === "PGRST116") {
          console.warn("Coupons access restricted to admins or active items.");
          setCoupons([]);
          setCachedCouponsData([]);
          return;
        }
        throw error;
      }

      const formattedCoupons: Coupon[] =
        data?.map((c) => ({
          id: c.id,
          code: c.code,
          type: c.type as "percentage" | "fixed",
          value: c.value,
          minPurchase: c.min_purchase ?? undefined,
          usageLimit: c.usage_limit ?? undefined,
          // PAINEL-12: schema so tem usage_count (baseline:423/689) — o
          // used_count era codigo morto. `?? 0` em vez de `|| 0`: 0 real
          // continua 0, null (coluna nao veio) nao vira 0 falso.
          usageCount: c.usage_count ?? 0,
          validUntil: c.valid_until ?? undefined,
          active: c.active ?? true,
        })) || [];

      setCachedCouponsData(formattedCoupons);
      setCoupons(formattedCoupons);
    } catch (error: any) {
      console.error("Error fetching coupons:", error);
      if (error.code !== "PGRST116") {
        toast.error("Não foi possível carregar os cupons.");
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

  const validateCoupon = useCallback(
    async (
      code: string,
      subtotal: number,
    ): Promise<{
      valid: boolean;
      discount: number;
      message?: string;
      /** Laudo 31/08 (E1): true = a CONSULTA falhou (não é recusa do cupom) — quem revalida em segundo plano mantém o cupom como está. */
      networkError?: boolean;
    }> => {
      try {
        // SecOps: validate_coupon_secure_v2 es SECURITY DEFINER
        const { data, error } = await supabase.rpc(
          "validate_coupon_secure_v2" as any,
          {
            p_code: code,
            p_subtotal: subtotal,
          } as any,
        );

        if (error) throw error;

        const result = data as any;
        if (!result)
          return {
            valid: false,
            discount: 0,
            message: "Erro ao validar cupom",
          };

        return {
          valid: result.is_valid,
          discount: Number(result.discount_value),
          message: result.error_message,
        };
      } catch (error) {
        console.error("Error validating coupon:", error);
        return {
          valid: false,
          discount: 0,
          message: "Erro na conexão com servidor",
          networkError: true,
        };
      }
    },
    [],
  );

  const addCoupon = async (coupon: Omit<Coupon, "id" | "usageCount">) => {
    if (!isAdmin) {
      toast.error("Permissão negada");
      return null;
    }
    try {
      const { data, error } = await supabase
        .from("coupons")
        .insert([
          {
            code: coupon.code,
            type: coupon.type,
            value: coupon.value,
            min_purchase: coupon.minPurchase,
            usage_limit: coupon.usageLimit,
            valid_until: coupon.validUntil,
            active: coupon.active ?? true,
            usage_count: 0,
          },
        ])
        .select()
        .single();

      if (error) throw error;

      toast.success("Cupom criado com sucesso");
      if (autoFetch) fetchCoupons();
      return data;
    } catch (error) {
      console.error("Error adding coupon:", error);
      // Laudo 0109 (A4): a recusa mais comum — código repetido — chegava
      // como aviso genérico; o lojista não tinha como saber o motivo real.
      toast.error(mensagemDeErroDoCupom(error, "Erro ao criar cupom"));
      throw error;
    }
  };

  const updateCoupon = async (id: string, updates: Partial<Coupon>) => {
    if (!isAdmin) {
      toast.error("Permissão negada");
      return;
    }

    // Optimistic Update
    const oldCoupons = [...coupons];
    setCoupons((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    );

    /*
      O UPDATE é montado por PRESENÇA DE CHAVE, não por valor (ADMIN-050, #96).

      Antes daqui saía um objeto com as sete chaves sempre presentes. Quem
      segurava os patches parciais de pé era um acidente: o `JSON.stringify` do
      supabase-js descarta chave `undefined` antes de virar SQL. O mesmo
      descarte causava o defeito — apagar a Validade mandava `undefined`, a
      coluna não ia no UPDATE, a data antiga sobrevivia, e a tela dizia "Cupom
      atualizado". Depois do vencimento o cupom parava de funcionar no checkout
      sem explicação.

      Trocar `undefined` por `null` no objeto fixo consertaria isso e quebraria
      coisa pior: `AdminCouponsView.tsx:564` liga/desliga cupom com
      `updateCoupon(id, { active })` — um patch de uma chave só. Com `null`
      forçado, cada clique no interruptor apagaria código, valor e validade.

      Com `in`, as duas intenções param de ser a mesma coisa:
        chave ausente  -> não mexe nesta coluna
        chave presente -> grava, e vazio vira NULL de verdade
    */
    type CouponUpdate = Database["public"]["Tables"]["coupons"]["Update"];
    const dbUpdates: CouponUpdate = {};
    if ("code" in updates) dbUpdates.code = updates.code;
    if ("type" in updates) dbUpdates.type = updates.type;
    if ("value" in updates) dbUpdates.value = updates.value;
    if ("minPurchase" in updates)
      dbUpdates.min_purchase = updates.minPurchase ?? null;
    if ("usageLimit" in updates)
      dbUpdates.usage_limit = updates.usageLimit ?? null;
    if ("validUntil" in updates)
      dbUpdates.valid_until = updates.validUntil ?? null;
    if ("active" in updates) dbUpdates.active = updates.active;

    try {
      const { error } = await supabase
        .from("coupons")
        .update(dbUpdates)
        .eq("id", id);

      if (error) throw error;

      toast.success("Cupom atualizado");
      if (autoFetch) fetchCoupons();
    } catch (error) {
      console.error("Error updating coupon:", error);
      // Mesma régua do addCoupon (laudo 0109, A4): trocar o código por um
      // que já existe é recusa de constraint, não "revise as regras".
      toast.error(mensagemDeErroDoCupom(error, "Erro ao atualizar cupom"));
      setCoupons(oldCoupons);
      throw error;
    }
  };

  const deleteCoupon = async (id: string) => {
    if (!isAdmin) {
      toast.error("Permissão negada");
      return;
    }
    try {
      const { error } = await supabase.from("coupons").delete().eq("id", id);

      if (error) throw error;

      toast.success("Cupom removido");
      if (autoFetch) fetchCoupons();
    } catch (error) {
      console.error("Error deleting coupon:", error);
      toast.error("Erro ao remover cupom");
      throw error;
    }
  };

  const getCouponStats = useCallback(async () => {
    if (!isAdmin) {
      toast.error("Permissão negada");
      return null;
    }
    try {
      const { data, error } = await (supabase.rpc as any)("get_coupon_stats");
      if (error) throw error;
      return (data as any)?.[0] || null;
    } catch (error) {
      console.error("Error getting coupon stats:", error);
      return null;
    }
  }, [isAdmin]);

  return {
    coupons,
    loading,
    validateCoupon,
    refreshCoupons: fetchCoupons,
    addCoupon,
    updateCoupon,
    deleteCoupon,
    getCouponStats,
  };
}
