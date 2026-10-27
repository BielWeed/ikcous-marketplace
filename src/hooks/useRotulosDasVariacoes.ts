import { rotuloDaVariacao } from "@/lib/rotulo-da-variacao";
import { supabase } from "@/lib/supabase";
import { useEffect, useMemo, useState } from "react";

/**
 * O texto da variação de cada linha do pedido ("Cor Azul · Tamanho M"), por id
 * da variação. O pedido só guarda o `variantId`; quem diz qual foi a escolha é
 * `product_variants` — a mesma leitura e o mesmo rótulo que o painel usa na
 * ficha da loja (`OrderDetail.tsx`).
 *
 * É um enfeite que ajuda a cliente a distinguir duas linhas do mesmo produto
 * (camiseta M e camiseta G): se a leitura falhar, o mapa fica vazio e a ficha
 * aparece como sempre, sem rótulo e sem erro.
 */
export function useRotulosDasVariacoes(
  itens: ReadonlyArray<{ variantId?: string }> | null | undefined,
): Record<string, string> {
  const [rotulos, setRotulos] = useState<Record<string, string>>({});

  // Chave estável: o efeito só roda de novo quando o CONJUNTO de ids muda.
  const chaveDosIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of itens ?? []) {
      if (item.variantId) ids.add(item.variantId);
    }
    return [...ids].sort().join(",");
  }, [itens]);

  useEffect(() => {
    if (chaveDosIds === "") {
      setRotulos({});
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
        setRotulos(lidos);
      } catch {
        // Sem rótulo, a ficha mostra como sempre (nunca quebra por isto).
      }
    };
    void ler();
    return () => {
      cancelado = true;
    };
  }, [chaveDosIds]);

  return rotulos;
}
