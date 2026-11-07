import { useCallback, useEffect, useState } from "react";

import { COLUNAS_DA_POLITICA, lerPolitica } from "@/lib/devolucao";
import {
  PRAZO_DA_CONSULTA_DO_CHECKOUT_MS,
  aguardarComPrazo,
  erroDeConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";
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
 *
 * A consulta tem prazo (rede "pendurada" conecta e não responde): estourar
 * vira `indisponivel`, e `tentarDeNovo` lê outra vez.
 */
export function usePoliticaDeTrocasDaLoja(
  ativo: boolean,
): EstadoDaPoliticaDeTrocas & { readonly tentarDeNovo: () => void } {
  const [estado, setEstado] = useState<EstadoDaPoliticaDeTrocas>(CARREGANDO);
  const [rodada, setRodada] = useState(0);
  const tentarDeNovo = useCallback(() => setRodada((r) => r + 1), []);

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    setEstado(CARREGANDO);
    void (async () => {
      try {
        const { data, error } = await aguardarComPrazo(
          Promise.resolve(
            supabase
              .from("politica_devolucao")
              .select(COLUNAS_DA_POLITICA)
              .eq("id", 1)
              .maybeSingle(),
          ),
          PRAZO_DA_CONSULTA_DO_CHECKOUT_MS,
          erroDeConsultaSemResposta,
        );
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
  }, [ativo, rodada]);

  return { ...estado, tentarDeNovo };
}
