import { useCallback, useEffect, useRef, useState } from "react";

import {
  FILTRO_POSTGREST_PARA_PREPARAR,
  STATUS_PARA_PREPARAR,
} from "@/lib/pedidos-para-preparar";
import { supabase } from "@/lib/supabase";

/**
 * Os números do topo de Pedidos (onda F do painel simples, F3). Cada um é
 * uma contagem só de cabeçalho (`head: true`) em `marketplace_orders`:
 *
 * - `paraPreparar`: a regra única de `src/lib/pedidos-para-preparar.ts` — o
 *   mesmo número do selo da aba e do "Pedidos para preparar" do Início. Não
 *   dá para usar `today_pending` da `get_admin_analytics_v2`: ela conta só o
 *   status, sem filtro de pagamento.
 * - `aguardandoPagamento`: status aberto com PIX/cartão ainda não pago
 *   (`payment_status = 'aguardando'`) — quem espera ali é a cliente.
 * - `aCaminho`: `status = 'shipping'`.
 *
 * `null` é "não sei" (consulta com erro ou que lançou) e a tela mostra "—";
 * nunca vira `0`, que afirmaria "nenhum pedido".
 */
export interface NumerosDosPedidos {
  paraPreparar: number | null;
  aguardandoPagamento: number | null;
  aCaminho: number | null;
  recarregar: () => Promise<void>;
}

type Contagens = Omit<NumerosDosPedidos, "recarregar">;

const NADA_CONTADO: Contagens = {
  paraPreparar: null,
  aguardandoPagamento: null,
  aCaminho: null,
};

/**
 * Roda UMA contagem. A construção da consulta fica DENTRO do `try` junto
 * com o `await`: dublê de teste (ou cliente) sem algum método lança na
 * construção, e isso também é "não sei", não tela quebrada.
 */
async function contar(
  montar: () => PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number | null> {
  try {
    const { count, error } = await montar();
    if (error || typeof count !== "number") return null;
    return count;
  } catch {
    return null;
  }
}

function contagemDePedidos() {
  return supabase
    .from("marketplace_orders")
    .select("*", { count: "exact", head: true });
}

export function useNumerosDosPedidos(ativo: boolean): NumerosDosPedidos {
  const [contagens, setContagens] = useState<Contagens>(NADA_CONTADO);
  // Guarda de rodada (mesmo padrão de `AdminLayout.tsx`, `fetchInitialCounts`):
  // várias rodadas podem estar em voo (montagem, tempo real, volta de foco);
  // só a mais nova grava, senão a velha que termina por último escreve um
  // número velho por cima do novo.
  const rodadaAtual = useRef(0);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const recarregar = useCallback(async () => {
    const rodada = ++rodadaAtual.current;
    const [paraPreparar, aguardandoPagamento, aCaminho] = await Promise.all([
      contar(() =>
        contagemDePedidos()
          .in("status", STATUS_PARA_PREPARAR)
          .or(FILTRO_POSTGREST_PARA_PREPARAR),
      ),
      contar(() =>
        contagemDePedidos()
          .in("status", STATUS_PARA_PREPARAR)
          .eq("payment_status", "aguardando"),
      ),
      contar(() => contagemDePedidos().eq("status", "shipping")),
    ]);
    if (!montado.current || rodada !== rodadaAtual.current) return;
    setContagens({ paraPreparar, aguardandoPagamento, aCaminho });
  }, []);

  useEffect(() => {
    if (ativo) void recarregar();
  }, [ativo, recarregar]);

  return { ...contagens, recarregar };
}
