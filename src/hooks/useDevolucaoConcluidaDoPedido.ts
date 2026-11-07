import { useEffect, useState } from "react";

import {
  type LinhaDoLivro,
  devolucaoConcluidaPorInteiro,
} from "@/lib/devolucao-do-dinheiro-concluida";
import { supabase } from "@/lib/supabase";
import type { Order } from "@/types";

interface Prova {
  orderId: string;
  total: number;
  concluida: boolean;
}

/**
 * Na ficha do pedido da lojista: este pedido ENTREGUE e `estornado` foi
 * devolvido por inteiro pelo app (devolução concluída), e não perdido numa
 * contestação no cartão? Só então o selo pode ficar neutro — a regra está em
 * `devolucaoConcluidaPorInteiro`.
 *
 * Lê só o livro `order_refunds` DESTE pedido, uma vez, e só no cruzamento que
 * importa (entregue + estornado): nos demais pedidos nem consulta. A mesma
 * tabela e a mesma permissão (RLS `order_refunds_admin_all`) de
 * `useEstornosDoPedido`.
 *
 * O padrão é SEMPRE `false` (alerta): enquanto lê, se a leitura falha, se o
 * pedido não é esse cruzamento. A ficha (`OrderDetail`) não desmonta ao trocar
 * de pedido, então a prova guarda de QUEM é e o total em que foi medida — a
 * resposta do pedido anterior nunca vale para o seguinte.
 */
export function useDevolucaoConcluidaDoPedido(
  order: Pick<Order, "id" | "total" | "status" | "paymentStatus">,
): boolean {
  const { id, total, status, paymentStatus } = order;
  const habilitado = status === "delivered" && paymentStatus === "estornado";
  const [prova, setProva] = useState<Prova | null>(null);

  useEffect(() => {
    if (!habilitado) return;
    let vivo = true;
    (async () => {
      let concluida = false;
      try {
        const { data, error } = await supabase
          .from("order_refunds")
          .select("amount, status, solicitado_por")
          .eq("order_id", id)
          .eq("status", "concluido");
        concluida =
          !error &&
          devolucaoConcluidaPorInteiro(
            data as unknown as LinhaDoLivro[] | null,
            total,
          );
      } catch {
        concluida = false;
      }
      if (vivo) setProva({ orderId: id, total, concluida });
    })();
    return () => {
      vivo = false;
    };
  }, [habilitado, id, total]);

  return (
    habilitado &&
    prova !== null &&
    prova.orderId === id &&
    prova.total === total &&
    prova.concluida
  );
}
