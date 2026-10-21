import { normalizarNumeroMototaxi } from "@/components/admin/minha-loja/contato";
import { supabase } from "@/lib/supabase";
import { useCallback, useEffect, useState } from "react";

export interface ConfigMototaxi {
  whatsapp: string | null;
  nome: string | null;
}

/** Só componentes do painel. Nunca passa pelo StoreContext, vault ou storage público. */
export function useMototaxi(active?: boolean) {
  const [config, setConfig] = useState<ConfigMototaxi | null>(null);
  const [erro, setErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);
  useEffect(() => {
    let atual = true;
    async function ler() {
      try {
        const { data, error } = await supabase
          .from("config_mototaxi")
          .select("whatsapp,nome")
          .eq("id", 1)
          .maybeSingle();
        if (!atual) return;
        if (error) throw error;
        setConfig(data ?? { whatsapp: null, nome: null });
        setErro(false);
      } catch {
        if (atual) {
          setConfig(null);
          setErro(true);
        }
      }
    }
    void ler();
    return () => {
      atual = false;
    };
  }, [active, tentativa]);

  const salvar = async (valor: ConfigMototaxi): Promise<boolean> => {
    const whatsapp = normalizarNumeroMototaxi(valor.whatsapp);
    if (valor.whatsapp?.trim() && !whatsapp) return false;
    const nome = valor.nome?.trim() || null;
    if (nome && nome.length > 80) return false;
    try {
      const { data, error } = await supabase.rpc("salvar_config_mototaxi", {
        p_whatsapp: whatsapp,
        p_nome: nome,
      });
      if (
        error ||
        !data ||
        Array.isArray(data) ||
        typeof data !== "object" ||
        data.whatsapp !== whatsapp ||
        data.nome !== nome
      )
        return false;
      setConfig({ whatsapp, nome });
      setErro(false);
      return true;
    } catch {
      return false;
    }
  };
  return { config, erro, recarregar, salvar };
}
