import {
  rotuloDaVariacao,
  rotuloDaVariacaoGuardada,
} from "@/lib/rotulo-da-variacao";
import { supabase } from "@/lib/supabase";
import type { OrderItem } from "@/types";
import { useEffect, useMemo, useState } from "react";

type Item = Pick<
  OrderItem,
  "id" | "variantId" | "variacaoNomeNaCompra" | "variacaoValorNaCompra"
>;

export function chaveDoRotuloDaVariacao(item: Item): string {
  return item.id ?? item.variantId ?? "";
}

/** Rótulo por linha da compra, não por id do catálogo: compras feitas em
 * momentos diferentes podem ter retratos diferentes da mesma opção.
 * A ficha de devolução recebe só o id da linha e busca o retrato sob a RLS do
 * pedido. Meus pedidos já recebe os dois campos junto com os itens. */
export function useRotulosDasVariacoes(
  itens: readonly Item[] | null | undefined,
  lerHistorico = false,
): Record<string, string> {
  const [historico, setHistorico] = useState<{
    chave: string;
    rotulos: Map<string, string>;
  } | null>(null);
  const [catalogo, setCatalogo] = useState<Record<string, string>>({});

  const chaveDoHistorico = useMemo(() => {
    if (!lerHistorico) return "";
    const ids = new Set<string>();
    for (const item of itens ?? []) {
      if (item.id && item.variantId && !rotuloDaVariacaoGuardada(item)) {
        ids.add(item.id);
      }
    }
    return [...ids].sort().join(",");
  }, [itens, lerHistorico]);

  useEffect(() => {
    if (!chaveDoHistorico) return;
    let cancelado = false;
    const ler = async () => {
      const rotulos = new Map<string, string>();
      try {
        const { data, error } = await supabase
          .from("marketplace_order_items")
          .select("id, variacao_nome_na_compra, variacao_valor_na_compra")
          .in("id", chaveDoHistorico.split(","));
        if (!error) {
          for (const item of data ?? []) {
            const rotulo = rotuloDaVariacao(
              item.variacao_nome_na_compra,
              item.variacao_valor_na_compra,
            );
            if (rotulo) rotulos.set(item.id, rotulo);
          }
        }
      } catch {
        // Loja ainda sem a migração, ou leitura indisponível: vale a reserva.
      }
      if (!cancelado) setHistorico({ chave: chaveDoHistorico, rotulos });
    };
    void ler();
    return () => {
      cancelado = true;
    };
  }, [chaveDoHistorico]);

  const historicoLido =
    historico?.chave === chaveDoHistorico ? historico.rotulos : null;
  const chaveDosIds = useMemo(() => {
    if (chaveDoHistorico && !historicoLido) return "";
    const ids = new Set<string>();
    for (const item of itens ?? []) {
      if (
        item.variantId &&
        !rotuloDaVariacaoGuardada(item) &&
        !(item.id && historicoLido?.has(item.id))
      ) {
        ids.add(item.variantId);
      }
    }
    return [...ids].sort().join(",");
  }, [itens, chaveDoHistorico, historicoLido]);

  useEffect(() => {
    if (chaveDosIds === "") {
      setCatalogo({});
      return;
    }
    let cancelado = false;
    const ler = async () => {
      try {
        const { data, error } = await supabase
          .from("product_variants")
          .select("id, name, value")
          .in("id", chaveDosIds.split(","));
        if (cancelado || error || !data) return;
        const lidos: Record<string, string> = {};
        for (const v of data) {
          const rotulo = rotuloDaVariacao(v.name, v.value);
          if (rotulo) lidos[v.id] = rotulo;
        }
        setCatalogo(lidos);
      } catch {
        // Sem rótulo, a ficha mostra como sempre (nunca quebra por isto).
      }
    };
    void ler();
    return () => {
      cancelado = true;
    };
  }, [chaveDosIds]);

  return useMemo(() => {
    const rotulos: Record<string, string> = {};
    for (const item of itens ?? []) {
      const chave = chaveDoRotuloDaVariacao(item);
      const rotulo =
        rotuloDaVariacaoGuardada(item) ||
        (item.id && historicoLido?.get(item.id)) ||
        (item.variantId && catalogo[item.variantId]);
      // eslint-disable-next-line security/detect-object-injection -- a chave é o id (UUID) do item do pedido, nunca texto digitado
      if (chave && rotulo) rotulos[chave] = rotulo;
    }
    return rotulos;
  }, [itens, historicoLido, catalogo]);
}
