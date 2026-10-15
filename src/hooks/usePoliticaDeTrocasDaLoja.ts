import { useEffect, useState } from "react";

import { COLUNAS_DA_POLITICA, lerPolitica } from "@/lib/devolucao";
import { supabase } from "@/lib/supabase";
import type { PoliticaDevolucao } from "@/types/devolucao";

export type EstadoDaPoliticaDeTrocas =
  | { readonly estado: "carregando"; readonly politica: null }
  | { readonly estado: "pronto"; readonly politica: PoliticaDevolucao }
  | { readonly estado: "indisponivel"; readonly politica: null };

const CARREGANDO: EstadoDaPoliticaDeTrocas = {
  estado: "carregando",
  politica: null,
};
const INDISPONIVEL: EstadoDaPoliticaDeTrocas = {
  estado: "indisponivel",
  politica: null,
};

/**
 * A política de trocas e devoluções que a lojista configurou, lida por
 * QUALQUER visitante (a tabela `politica_devolucao` tem leitura pública de
 * propósito: a cliente vê as regras antes de comprar — migration
 * 20261175000000, colunas sem `updated_by` desde 20261215000000).
 *
 * `ativo` evita a leitura enquanto ninguém olha (a folha do produto e do
 * checkout só consulta quando abre). Três estados honestos: `carregando`,
 * `pronto` e `indisponivel` — falha de rede ou banco sem a tabela NÃO vira
 * "a loja não tem política": a tela mostra só o mínimo da lei.
 */
export function usePoliticaDeTrocasDaLoja(
  ativo: boolean,
): EstadoDaPoliticaDeTrocas {
  const [estado, setEstado] = useState<EstadoDaPoliticaDeTrocas>(CARREGANDO);

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    setEstado(CARREGANDO);
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("politica_devolucao")
          .select(COLUNAS_DA_POLITICA)
          .eq("id", 1)
          .maybeSingle();
        if (!vivo) return;
        const lida = !error && data ? lerPolitica(data) : null;
        setEstado(lida ? { estado: "pronto", politica: lida } : INDISPONIVEL);
      } catch {
        if (vivo) setEstado(INDISPONIVEL);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [ativo]);

  return estado;
}
