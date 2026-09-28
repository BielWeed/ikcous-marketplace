import { useAuth } from "@/hooks/useAuth";
import { cupomDoBanco } from "@/lib/cupom-do-banco";
import { mensagemDeErroDoCupom } from "@/lib/erro-do-cupom";
import { supabase } from "@/lib/supabase";
import type { Coupon } from "@/types";
import type { Database } from "@/types/database.types";
import { cachedCouponsData, setCachedCouponsData } from "@/utils/admin_cache";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

/** Uma linha da busca de clientes do painel (sem CPF). */
export interface ClienteEncontradoParaCupom {
  readonly id: string;
  readonly full_name: string | null;
  readonly email: string | null;
}

/** Uma conta na lista de um cupom exclusivo (painel). */
export interface ClienteDoCupom {
  readonly id: string;
  readonly nome: string | null;
  readonly email: string | null;
}

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

      // PAINEL-12 + frente B: o mapeador único (usage_count só, alcance).
      const formattedCoupons: Coupon[] =
        data?.map((c) => cupomDoBanco(c)) || [];

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
            // Frente B: só vai quando NÃO é o padrão — criar cupom secreto
            // continua funcionando com o banco de antes da 20261187000000.
            ...(coupon.alcance && coupon.alcance !== "codigo"
              ? { alcance: coupon.alcance }
              : {}),
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
    // Frente B: o alcance só vai quando o form o MUDOU (o form só manda a
    // chave nesse caso) — editar um cupom continua funcionando com o banco
    // de antes da migration 20261187000000.
    if ("alcance" in updates && updates.alcance)
      dbUpdates.alcance = updates.alcance;

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
      // Laudo #2 (L-7): cupom com pedido no histórico é recusado pela FK
      // (23503) — apagar é impossível de verdade, e o erro genérico escondia
      // a saída que existe: DESATIVAR o cupom.
      const codigo = (error as { code?: string })?.code ?? "";
      const mensagem = String((error as { message?: string })?.message ?? "");
      if (
        codigo === "23503" ||
        mensagem.includes("foreign key") ||
        mensagem.includes("23503")
      ) {
        toast.error("Este cupom não pode ser apagado", {
          description:
            "Ele já está ligado a pedidos do histórico. Para que ninguém mais o use, DESATIVE-o na lista de cupons.",
          duration: 8000,
        });
      } else {
        toast.error("Erro ao remover cupom");
      }
      throw error;
    }
  };

  /** Contas que podem usar um cupom exclusivo (RPC admin, sem CPF). */
  const lerClientesDoCupom = useCallback(
    async (couponId: string): Promise<ClienteDoCupom[]> => {
      const { data, error } = await supabase.rpc("admin_cupom_clientes", {
        p_coupon_id: couponId,
      });
      if (error) throw error;
      return (data ?? []).map((l) => ({
        id: l.user_id,
        nome: l.nome,
        email: l.email,
      }));
    },
    [],
  );

  /** Troca a lista inteira (atômica no servidor; gate is_admin()). */
  const definirClientesDoCupom = useCallback(
    async (couponId: string, clientes: readonly string[]): Promise<void> => {
      const { error } = await supabase.rpc("admin_cupom_definir_clientes", {
        p_coupon_id: couponId,
        p_clientes: [...clientes],
      });
      if (error) throw error;
    },
    [],
  );

  /** Busca de contas para a lista do exclusivo (mesma RPC da tela de
   * Clientes e do balcão; gate de admin no servidor; sem CPF). */
  const buscarClientesParaCupom = useCallback(
    async (termo: string): Promise<ClienteEncontradoParaCupom[]> => {
      const { data, error } = await supabase.rpc("get_admin_customers_paged", {
        p_search: termo,
        p_sort_field: "created_at",
        p_sort_direction: "desc",
        p_page: 0,
        p_page_size: 8,
      });
      if (error) throw error;
      const linhas = ((data as { data?: unknown[] } | null)?.data ??
        []) as Array<Record<string, unknown>>;
      return linhas.map((l) => ({
        id: String(l.id),
        full_name: typeof l.full_name === "string" ? l.full_name : null,
        email: typeof l.email === "string" ? l.email : null,
      }));
    },
    [],
  );

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
    lerClientesDoCupom,
    definirClientesDoCupom,
    buscarClientesParaCupom,
  };
}
