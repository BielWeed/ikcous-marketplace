import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import type { Address } from "@/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const LISTA_VAZIA: Address[] = [];

interface EstadoDaLista {
  /** Conta dueña de `itens`. A lista só é exposta para ELA. */
  dono: string | null;
  itens: Address[];
}

function carregarCacheDoDisco(id: string | null | undefined): Address[] {
  if (!id || typeof window === "undefined") return [];
  try {
    const cached = localStorage.getItem(`ikcous_addresses_cache_${id}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.error("Error loading cached addresses:", e);
  }
  return [];
}

export function useAddresses() {
  const { user } = useAuth();
  // Identidade da conta: resposta em voo da conta ANTERIOR (troca/logout)
  // não grava estado nem cache.
  const usuarioAtualRef = useRef(user?.id);
  // A lista nasce vinculada à conta corrente e só é exposta para ela — nem
  // no primeiro render após a troca a lista da conta anterior aparece.
  const [estado, setEstado] = useState<EstadoDaLista>(() => ({
    dono: user?.id ?? null,
    itens: carregarCacheDoDisco(user?.id),
  }));
  const [loading, setLoading] = useState(false);

  const addresses =
    estado.dono === (user?.id ?? null) ? estado.itens : LISTA_VAZIA;

  useEffect(() => {
    usuarioAtualRef.current = user?.id;
  }, [user?.id]);

  // Troca de conta: recarrega o cache DA CONTA CORRENTE.
  useEffect(() => {
    const id = user?.id ?? null;
    setEstado({ dono: id, itens: carregarCacheDoDisco(id) });
  }, [user?.id]);

  const fetchAddresses = useCallback(async () => {
    if (!user) return;
    const idDaBusca = user.id;
    const cacheKey = `ikcous_addresses_cache_${idDaBusca}`;
    let hasCache = false;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        hasCache = true;
      }
    } catch {
      // ignore localStorage issues
    }

    if (!hasCache) {
      setLoading(true);
    }
    try {
      const { data, error } = await supabase
        .from("user_addresses")
        .select("*")
        .eq("user_id", idDaBusca)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) throw error;
      // Resposta da conta anterior não grava nada.
      if (usuarioAtualRef.current !== idDaBusca) return;
      const mapped = (data || []).map((a) => ({
        id: a.id,
        user_id: a.user_id,
        name: a.name,
        recipient_name: a.recipient_name,
        cep: a.cep,
        street: a.street,
        number: a.number,
        complement: a.complement,
        neighborhood: a.neighborhood,
        city: a.city,
        state: a.state,
        reference: a.reference,
        is_default: a.is_default || false,
      }));
      setEstado({ dono: idDaBusca, itens: mapped });
      localStorage.setItem(cacheKey, JSON.stringify(mapped));
    } catch (error) {
      if (usuarioAtualRef.current !== idDaBusca) return;
      console.error("Error fetching addresses:", error);
      toast.error("Erro ao carregar endereços");
    } finally {
      if (usuarioAtualRef.current === idDaBusca) {
        setLoading(false);
      }
    }
  }, [user]);

  const addAddress = async (address: Omit<Address, "id" | "user_id">) => {
    if (!user) return null;
    const idDaConta = user.id;
    try {
      // If this is the first address, make it default automatically
      const isFirst = addresses.length === 0;
      const newAddress = {
        ...address,
        user_id: user.id,
        is_default: isFirst ? true : address.is_default,
      };

      const { data, error } = await supabase
        .from("user_addresses")
        .insert(newAddress)
        .select()
        .single();

      if (error) throw error;
      // Resposta da conta anterior não grava nada, nem avisa sucesso.
      if (usuarioAtualRef.current !== idDaConta) return null;

      const formattedAddress: Address = {
        id: data.id,
        user_id: data.user_id,
        name: data.name,
        recipient_name: data.recipient_name,
        cep: data.cep,
        street: data.street,
        number: data.number,
        complement: data.complement,
        neighborhood: data.neighborhood,
        city: data.city,
        state: data.state,
        reference: data.reference,
        is_default: data.is_default || false,
      };

      setEstado((prev) => {
        // Estado trocou de dono em voo: não escreve.
        if (prev.dono !== idDaConta) return prev;
        let updated: Address[];
        // If new address is default, update others
        if (formattedAddress.is_default) {
          updated = [
            formattedAddress,
            ...prev.itens.map((a) => ({ ...a, is_default: false })),
          ];
        } else {
          updated = [...prev.itens, formattedAddress];
        }
        localStorage.setItem(
          `ikcous_addresses_cache_${idDaConta}`,
          JSON.stringify(updated),
        );
        return { dono: idDaConta, itens: updated };
      });

      toast.success("Endereço adicionado com sucesso");
      return formattedAddress;
    } catch (error) {
      if (usuarioAtualRef.current !== idDaConta) return null;
      console.error("Error adding address:", error);
      toast.error("Erro ao adicionar endereço");
      return null;
    }
  };

  const updateAddress = async (id: string, updates: Partial<Address>) => {
    if (!user) return false;
    const idDaConta = user.id;
    try {
      const { data, error } = await supabase
        .from("user_addresses")
        .update(updates)
        .eq("id", id)
        .eq("user_id", user.id)
        .select()
        .single();

      if (error) throw error;
      // Resposta da conta anterior não grava nada, nem avisa sucesso.
      if (usuarioAtualRef.current !== idDaConta) return false;

      const formattedAddress: Address = {
        id: data.id,
        user_id: data.user_id,
        name: data.name,
        recipient_name: data.recipient_name,
        cep: data.cep,
        street: data.street,
        number: data.number,
        complement: data.complement,
        neighborhood: data.neighborhood,
        city: data.city,
        state: data.state,
        reference: data.reference,
        is_default: data.is_default || false,
      };

      setEstado((prev) => {
        // Estado trocou de dono em voo: não escreve.
        if (prev.dono !== idDaConta) return prev;
        let updated: Address[];
        if (updates.is_default) {
          updated = prev.itens
            .map((a) =>
              a.id === id ? formattedAddress : { ...a, is_default: false },
            )
            .sort((a, b) =>
              a.is_default === b.is_default ? 0 : a.is_default ? -1 : 1,
            );
        } else {
          updated = prev.itens.map((a) => (a.id === id ? formattedAddress : a));
        }
        localStorage.setItem(
          `ikcous_addresses_cache_${idDaConta}`,
          JSON.stringify(updated),
        );
        return { dono: idDaConta, itens: updated };
      });

      toast.success("Endereço atualizado");
      return true;
    } catch (error) {
      if (usuarioAtualRef.current !== idDaConta) return false;
      console.error("Error updating address:", error);
      toast.error("Erro ao atualizar endereço");
      return false;
    }
  };

  const deleteAddress = async (id: string) => {
    if (!user) return false;
    const idDaConta = user.id;
    try {
      const { error } = await supabase
        .from("user_addresses")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);

      if (error) throw error;
      // Resposta da conta anterior não grava nada, nem avisa sucesso.
      if (usuarioAtualRef.current !== idDaConta) return false;

      setEstado((prev) => {
        // Estado trocou de dono em voo: não escreve.
        if (prev.dono !== idDaConta) return prev;
        const updated = prev.itens.filter((a) => a.id !== id);
        localStorage.setItem(
          `ikcous_addresses_cache_${idDaConta}`,
          JSON.stringify(updated),
        );
        return { dono: idDaConta, itens: updated };
      });
      toast.success("Endereço removido");
      return true;
    } catch (error) {
      if (usuarioAtualRef.current !== idDaConta) return false;
      console.error("Error deleting address:", error);
      toast.error("Erro ao remover endereço");
      return false;
    }
  };

  return {
    addresses,
    loading,
    fetchAddresses,
    addAddress,
    updateAddress,
    deleteAddress,
  };
}
