import { lerDevolucaoDetalhe, lerDevolucoesDoPedido } from "@/lib/devolucao";
import {
  PRAZO_DA_CONSULTA_DO_PAINEL_MS,
  aguardarComPrazo,
  programarAvisoDeConsultaDoPainel,
} from "@/lib/prazo-da-requisicao";
import type { ResumoDevolucao } from "@/types/devolucao";
import { useCallback, useEffect, useRef, useState } from "react";

/** Lê as devoluções de um pedido para a ficha e a ação de desfazer. */
export function useDevolucoesDoPedidoAdmin(
  orderId: string,
  habilitado: boolean,
  conferirReembolsoManual = false,
): {
  devolucoes: ResumoDevolucao[];
  carregando: boolean;
  erro: boolean;
  recarregar: () => void;
  /** Reais; null enquanto não conferido, undefined quando não solicitado. */
  valorReembolsadoManual?: number | null;
} {
  const [leitura, setLeitura] = useState<{
    orderId: string;
    devolucoes: ResumoDevolucao[];
    carregando: boolean;
    erro: boolean;
    valorReembolsadoManual: number | null;
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
        ? { ...anterior, carregando: true, valorReembolsadoManual: null }
        : {
            orderId,
            devolucoes: [],
            carregando: true,
            erro: false,
            valorReembolsadoManual: null,
          },
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
    let valorReembolsadoManual: number | null = null;
    try {
      const { supabase } = await import("@/lib/supabase");
      if (!valeAinda()) return;
      const consulta = supabase.rpc("devolucoes_do_pedido", {
        p_order_id: orderId,
      });
      const comSinal = consulta.abortSignal?.(controle.signal);
      const { data, error } = await (comSinal ?? consulta);
      if (!error) lista = lerDevolucoesDoPedido(data);

      if (conferirReembolsoManual && lista && valeAinda()) {
        const idsConcluidos = new Set(
          lista.filter((d) => d.status === "concluida").map((d) => d.id),
        );
        if (idsConcluidos.size === 0) {
          valorReembolsadoManual = 0;
        } else {
          // A lista já vale para a ficha e para desfazer o recebimento.
          // O recibo precisa conferir o detalhe sem travar essas outras ações.
          cancelarAviso();
          setLeitura({
            orderId,
            devolucoes: lista,
            carregando: false,
            erro: false,
            valorReembolsadoManual: null,
          });
          const valores = await aguardarComPrazo(
            Promise.all(
              Array.from(idsConcluidos, async (id) => {
                const detalheRpc = supabase.rpc("devolucao_detalhe", {
                  p_id: id,
                });
                const { data, error } = await (detalheRpc.abortSignal?.(
                  controle.signal,
                ) ?? detalheRpc);
                const detalhe = error ? null : lerDevolucaoDetalhe(data);
                if (
                  !detalhe ||
                  detalhe.id !== id ||
                  detalhe.order_id !== orderId ||
                  detalhe.status !== "concluida"
                ) {
                  throw new Error("Não foi possível conferir a devolução.");
                }
                if (!detalhe.reembolso_manual) return 0;
                if (
                  detalhe.resolucao_final !== "reembolso" ||
                  detalhe.valor_reembolso === null ||
                  detalhe.valor_reembolso <= 0
                ) {
                  throw new Error("Valor do reembolso manual não confirmado.");
                }
                return Math.round(detalhe.valor_reembolso * 100);
              }),
            ),
            PRAZO_DA_CONSULTA_DO_PAINEL_MS,
            () => new Error("Sem resposta na conferência do reembolso."),
          );
          valorReembolsadoManual =
            valores.reduce((total, centavos) => total + centavos, 0) / 100;
        }
      }
    } catch {
      // Não confundir falha de leitura com ausência de devolução/reembolso.
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
      valorReembolsadoManual,
    }));
  }, [orderId, habilitado, conferirReembolsoManual]);

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
    valorReembolsadoManual: conferirReembolsoManual
      ? (atual?.valorReembolsadoManual ?? null)
      : undefined,
  };
}
