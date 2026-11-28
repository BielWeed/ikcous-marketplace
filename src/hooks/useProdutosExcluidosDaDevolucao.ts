import {
  PRAZO_DA_CONSULTA_DO_PAINEL_MS,
  aguardarComPrazo,
  erroDeConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";
import { supabase } from "@/lib/supabase";
import type { ItemDevolvido } from "@/types/devolucao";
import { useCallback, useEffect, useState } from "react";

// A peça de produto EXCLUÍDO não volta ao estoque (20261659000000): a conclusão
// grava o carimbo `reestocado_em` (a peça voltou para a loja) mas não soma
// estoque nenhum. A ficha não pode dizer "voltou ao estoque" desse item.
//
// Quem prova é o banco: o produto do item (ou, sem ele, o pai da variação) com
// `deleted_at` ATÉ o carimbo da volta — excluído depois, a peça voltou ao
// estoque de verdade antes. Em `vw_produtos_admin` (a visão do painel NÃO
// filtra os excluídos). Id ausente da resposta, erro e demora são "não sei": a
// linha fica como sempre foi ("voltou ao estoque"), nunca um aviso falso.
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Excluidos = ReadonlyMap<string, string>;
const NENHUM: Excluidos = new Map();

interface Leitura {
  chave: string;
  /** produto -> deleted_at */
  excluidos: Excluidos;
  /** variação -> produto (só das que vieram sem produto) */
  pais: ReadonlyMap<string, string>;
}

async function consultar<T>(consulta: PromiseLike<T>): Promise<T> {
  return aguardarComPrazo(
    Promise.resolve(consulta),
    PRAZO_DA_CONSULTA_DO_PAINEL_MS,
    () => erroDeConsultaSemResposta(),
  );
}

function produtoDoItem(
  item: ItemDevolvido,
  pais: ReadonlyMap<string, string>,
): string | null {
  if (item.product_id) return item.product_id;
  return item.variant_id ? (pais.get(item.variant_id) ?? null) : null;
}

/**
 * `(item) => true` quando a peça do item voltou de um produto que JÁ estava
 * excluído na hora da volta (e por isso não foi ao estoque).
 */
export function useItensDeProdutoExcluido(
  itens: readonly ItemDevolvido[] | undefined,
): (item: ItemDevolvido) => boolean {
  const voltaram = (itens ?? []).filter((i) => i.reestocado_em != null);
  const produtos = [
    ...new Set(
      voltaram
        .map((i) => i.product_id)
        .filter((id): id is string => !!id && ID.test(id)),
    ),
  ].sort();
  const variacoesSemProduto = [
    ...new Set(
      voltaram
        .filter((i) => !i.product_id)
        .map((i) => i.variant_id)
        .filter((id): id is string => !!id && ID.test(id)),
    ),
  ].sort();
  const chave = `${produtos.join(",")}|${variacoesSemProduto.join(",")}`;
  const [lida, setLida] = useState<Leitura | null>(null);

  useEffect(() => {
    if (chave === "|") return;
    // A chave carrega as duas listas (ordenadas): a consulta muda só quando elas mudam.
    const [deProdutos, deVariacoes] = chave.split("|");
    const produtos = deProdutos ? deProdutos.split(",") : [];
    const variacoesSemProduto = deVariacoes ? deVariacoes.split(",") : [];
    let cancelada = false;
    (async () => {
      try {
        const pais = new Map<string, string>();
        if (variacoesSemProduto.length > 0) {
          const { data, error } = await consultar(
            supabase
              .from("product_variants")
              .select("id, product_id")
              .in("id", variacoesSemProduto),
          );
          if (error || cancelada) return;
          for (const v of (data ?? []) as {
            id: string | null;
            product_id: string | null;
          }[])
            if (v.id && v.product_id) pais.set(v.id, v.product_id);
        }
        const ids = [...new Set([...produtos, ...pais.values()])];
        if (ids.length === 0) return;
        const { data, error } = await consultar(
          supabase
            .from("vw_produtos_admin")
            .select("id, deleted_at")
            .in("id", ids),
        );
        if (error || cancelada) return;
        const excluidos = new Map<string, string>();
        for (const p of (data ?? []) as {
          id: string | null;
          deleted_at: string | null;
        }[])
          if (p.id && p.deleted_at) excluidos.set(p.id, p.deleted_at);
        setLida({ chave, excluidos, pais });
      } catch {
        // Sem resposta ou erro: "não sei" — a linha fica como sempre.
      }
    })();
    return () => {
      cancelada = true;
    };
  }, [chave]);

  const valida = lida?.chave === chave ? lida : null;
  const excluidos = valida?.excluidos ?? NENHUM;
  const pais = valida?.pais;

  return useCallback(
    (item: ItemDevolvido) => {
      if (!item.reestocado_em || excluidos.size === 0) return false;
      const produto = produtoDoItem(item, pais ?? new Map());
      const excluidoEm = produto ? excluidos.get(produto) : undefined;
      if (!excluidoEm) return false;
      const quando = Date.parse(excluidoEm);
      const volta = Date.parse(item.reestocado_em);
      // Data ilegível: "não sei".
      if (Number.isNaN(quando) || Number.isNaN(volta)) return false;
      return quando <= volta;
    },
    [excluidos, pais],
  );
}
