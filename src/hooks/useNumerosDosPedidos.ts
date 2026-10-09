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
  /** Recarrega já. */
  recarregar: () => Promise<void>;
  /**
   * Recarrega UMA vez ao fim da janela de coalescência — para tempo real e
   * ações: uma rajada de eventos custa uma rodada só, não uma por evento.
   */
  pedirRecarga: () => void;
}

type Contagens = Omit<NumerosDosPedidos, "recarregar" | "pedirRecarga">;

/**
 * Janela de coalescência das recargas pedidas por tempo real/ação. É a MESMA
 * janela de `ATRASO_COALESCENCIA_BADGES_MS` do `AdminLayout` (achado C4 do
 * laudo novos-ângulos 01/09): a primeira conferência é agendada e as demais
 * da janela são absorvidas. O teste `pedidos-numeros-do-topo` prende os dois
 * valores iguais.
 */
export const ATRASO_COALESCENCIA_NUMEROS_MS = 1000;

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
  const recargaAgendada = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      if (recargaAgendada.current) {
        clearTimeout(recargaAgendada.current);
        recargaAgendada.current = null;
      }
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

  const pedirRecarga = useCallback(() => {
    if (recargaAgendada.current) return;
    recargaAgendada.current = setTimeout(() => {
      recargaAgendada.current = null;
      if (montado.current) void recarregar();
    }, ATRASO_COALESCENCIA_NUMEROS_MS);
  }, [recarregar]);

  // O ÚNICO disparo automático: ao ficar ativa. Troca de filtro, busca ou
  // página NÃO recarrega — as contagens não dependem deles. Depois disso só
  // `pedirRecarga` (tempo real, ação na tela, volta da conexão).
  useEffect(() => {
    if (ativo) void recarregar();
  }, [ativo, recarregar]);

  return { ...contagens, recarregar, pedirRecarga };
}
