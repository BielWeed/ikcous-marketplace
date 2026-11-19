import { lerDevolucoesDoPedido } from "@/lib/devolucao";
import { programarAvisoDeConsultaDoPainel } from "@/lib/prazo-da-requisicao";
import type { ResumoDevolucao } from "@/types/devolucao";
import { useCallback, useEffect, useRef, useState } from "react";

/** Lê as devoluções de um pedido para a ficha e a ação de desfazer. */
export function useDevolucoesDoPedidoAdmin(
  orderId: string,
  habilitado: boolean,
): {
  devolucoes: ResumoDevolucao[];
  carregando: boolean;
  erro: boolean;
  recarregar: () => void;
} {
  const [leitura, setLeitura] = useState<{
    orderId: string;
    devolucoes: ResumoDevolucao[];
    carregando: boolean;
    erro: boolean;
  } | null>(null);
  // Só a rodada mais recente pode escrever: ao tentar de novo (ou sair),
  // cancelamos o aviso e a consulta anterior, mesmo que ela ainda responda.
  const rodadaRef = useRef(0);
  const cancelarConsultaRef = useRef<(() => void) | null>(null);

  const carregar = useCallback(async () => {
    if (!habilitado) return;
    const rodada = ++rodadaRef.current;
    cancelarConsultaRef.current?.();
    const valeAinda = () => rodada === rodadaRef.current;

    setLeitura((anterior) =>
      anterior?.orderId === orderId
        ? { ...anterior, carregando: true }
        : { orderId, devolucoes: [], carregando: true, erro: false },
    );
    const cancelarAviso = programarAvisoDeConsultaDoPainel(() => {
      if (!valeAinda()) return;
      setLeitura((anterior) =>
        anterior?.orderId === orderId
          ? { ...anterior, carregando: false, erro: true }
          : anterior,
      );
    });
    const controle = new AbortController();
    const cancelar = () => {
      cancelarAviso();
      controle.abort();
    };
    cancelarConsultaRef.current = cancelar;

    let lista: ResumoDevolucao[] | null = null;
    try {
      const { supabase } = await import("@/lib/supabase");
      if (!valeAinda()) return;
      const consulta = supabase.rpc("devolucoes_do_pedido", {
        p_order_id: orderId,
      });
      const comSinal = consulta.abortSignal?.(controle.signal);
      const { data, error } = await (comSinal ?? consulta);
      if (!error) lista = lerDevolucoesDoPedido(data);
    } catch {
      // Falha de leitura não confirma que o pedido não tem devoluções.
    } finally {
      cancelarAviso();
      if (cancelarConsultaRef.current === cancelar) {
        cancelarConsultaRef.current = null;
      }
    }

    if (!valeAinda()) return;
    setLeitura((anterior) => ({
      orderId,
      devolucoes:
        lista ?? (anterior?.orderId === orderId ? anterior.devolucoes : []),
      carregando: false,
      erro: lista === null,
    }));
  }, [orderId, habilitado]);

  useEffect(() => {
    if (habilitado) void carregar();
    else setLeitura(null);
    return () => {
      rodadaRef.current += 1;
      cancelarConsultaRef.current?.();
    };
  }, [habilitado, carregar]);

  // Ausência de leitura, inclusive ao trocar de pedido no primeiro render,
  // não é o mesmo que uma lista vazia confirmada.
  const atual = habilitado && leitura?.orderId === orderId ? leitura : null;
  return {
    devolucoes: atual?.devolucoes ?? [],
    carregando: habilitado && (atual?.carregando ?? true),
    erro: atual?.erro ?? false,
    recarregar: () => void carregar(),
  };
}
