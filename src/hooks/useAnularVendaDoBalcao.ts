// Anular venda do balcão (migration 20261204000000). O único lugar do app que
// chama `anular_venda_presencial`; a tela (recibo do PDV e ficha do pedido)
// só pede o motivo e mostra o que aconteceu.
//
// A RPC é idempotente: repetir o toque numa venda já anulada devolve
// `ja_anulada: true` SEM estornar nem devolver estoque de novo. É por isso que
// uma falha de rede no meio é segura de repetir.
//
// O erro do Supabase sobe CRU (com `code` e `message`): quem traduz para
// português é `mensagemDaFalhaDaAnulacao` (src/lib/anulacao-do-balcao.ts),
// chamada pela tela — traduzir em dois lugares criaria duas verdades.

import { clearAnalyticsCache } from "@/hooks/useAnalytics";
import { supabase } from "@/lib/supabase";
import { useCallback } from "react";

export interface ResultadoDaAnulacao {
  readonly orderId: string;
  /** `true` quando a venda JÁ estava anulada (duplo toque): nada foi mexido. */
  readonly jaAnulada: boolean;
}

/** Lê a resposta da RPC pela FORMA; resposta torta é erro, nunca "deu certo". */
export function lerRespostaDaAnulacao(dados: unknown): ResultadoDaAnulacao {
  if (typeof dados === "object" && dados !== null) {
    const { order_id: orderId, ja_anulada: jaAnulada } = dados as {
      order_id?: unknown;
      ja_anulada?: unknown;
    };
    if (typeof orderId === "string" && typeof jaAnulada === "boolean") {
      return { orderId, jaAnulada };
    }
  }
  throw new Error("Resposta inesperada do servidor ao anular a venda.");
}

export function useAnularVendaDoBalcao(): {
  readonly anular: (
    orderId: string,
    motivo: string,
  ) => Promise<ResultadoDaAnulacao>;
} {
  const anular = useCallback(async (orderId: string, motivo: string) => {
    const { data, error } = await supabase.rpc("anular_venda_presencial", {
      p_order_id: orderId,
      p_motivo: motivo,
    });
    if (error) throw error;
    const resultado = lerRespostaDaAnulacao(data);
    // Os números de venda do painel (Clientes, Relatórios, o topo de
    // Pedidos) mudam com a anulação (o Financeiro desconta): sem isto o
    // painel serviria o resultado guardado em cache de módulo.
    clearAnalyticsCache();
    return resultado;
  }, []);
  return { anular };
}
