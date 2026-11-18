import { useCallback, useEffect, useRef, useState } from "react";

import { aoAnularVenda } from "@/lib/avisa-anulacao-do-balcao";
import {
  FILTRO_POSTGREST_PARA_PREPARAR,
  PAGAMENTOS_A_CONFERIR_EM_ABERTO,
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
 * - `abertosComPagamentoAConferir`: status aberto com pagamento recusado ou
 *   estornado (`PAGAMENTOS_A_CONFERIR_EM_ABERTO`). Não é cartão nem entra em
 *   contador nenhum: alimenta só o aviso sob os cartões (revisão, S3).
 *
 * `null` é "não sei" (consulta com erro ou que lançou) e a tela mostra "—"
 * (ou esconde o aviso); nunca vira `0`, que afirmaria "nenhum pedido".
 */
export interface NumerosDosPedidos {
  paraPreparar: number | null;
  aguardandoPagamento: number | null;
  aCaminho: number | null;
  abertosComPagamentoAConferir: number | null;
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
  abertosComPagamentoAConferir: null,
};

/**
 * Roda UMA contagem. A construção da consulta fica DENTRO do `try` junto
 * com o `await`: dublê de teste (ou cliente) sem algum método lança na
 * construção, e isso também é "não sei", não tela quebrada.
 */
async function contar(
  montar: () => PromiseLike<{
    count: number | null;
    error: unknown;
    status?: number;
  }>,
): Promise<number | null | "sem_acesso"> {
  try {
    const { count, error, status } = await montar();
    if (status === 401 || status === 403) return "sem_acesso";
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

const CONSULTAS = {
  paraPreparar: () =>
    contagemDePedidos()
      .in("status", STATUS_PARA_PREPARAR)
      .or(FILTRO_POSTGREST_PARA_PREPARAR),
  aguardandoPagamento: () =>
    contagemDePedidos()
      .in("status", STATUS_PARA_PREPARAR)
      .eq("payment_status", "aguardando"),
  aCaminho: () => contagemDePedidos().eq("status", "shipping"),
  abertosComPagamentoAConferir: () =>
    contagemDePedidos()
      .in("status", STATUS_PARA_PREPARAR)
      .in("payment_status", PAGAMENTOS_A_CONFERIR_EM_ABERTO),
} satisfies Record<keyof Contagens, Parameters<typeof contar>[0]>;

const CONSULTAS_POR_CAMPO = Object.entries(CONSULTAS) as [
  keyof Contagens,
  Parameters<typeof contar>[0],
][];
const ESPERAS_DAS_RETENTATIVAS_MS = [1000, 2000, 4000] as const;

export function useNumerosDosPedidos(ativo: boolean): NumerosDosPedidos {
  const [contagens, setContagens] = useState<Contagens>(NADA_CONTADO);
  // Várias rodadas podem estar em voo (montagem, tempo real, volta de foco);
  // só a mais nova grava, inclusive quando uma retentativa já saiu.
  const rodadaAtual = useRef(0);
  const telaAtiva = useRef(false);
  const recargaAgendada = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retentativaAgendada = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Limite por tela montada, não por evento de foco/tempo real.
  const retentativasFeitas = useRef(0);
  const cancelarRetentativa = useCallback(() => {
    if (retentativaAgendada.current !== null) {
      clearTimeout(retentativaAgendada.current);
      retentativaAgendada.current = null;
    }
  }, []);

  useEffect(() => {
    telaAtiva.current = ativo;
    const rodadaRef = rodadaAtual;
    return () => {
      telaAtiva.current = false;
      ++rodadaRef.current;
      if (recargaAgendada.current !== null) {
        clearTimeout(recargaAgendada.current);
        recargaAgendada.current = null;
      }
      cancelarRetentativa();
    };
  }, [ativo, cancelarRetentativa]);

  const recarregar = useCallback(async () => {
    if (!telaAtiva.current) return;
    const rodada = ++rodadaAtual.current;
    cancelarRetentativa();

    const aindaAtual = () =>
      telaAtiva.current && rodada === rodadaAtual.current;
    async function consultar(consultas: typeof CONSULTAS_POR_CAMPO) {
      const resultados = await Promise.all(
        consultas.map(async (consulta) => ({
          consulta,
          valor: await contar(consulta[1]),
        })),
      );
      if (!aindaAtual()) return;

      const parciais = Object.fromEntries(
        resultados.map(({ consulta: [campo], valor }) => [
          campo,
          valor === "sem_acesso" ? null : valor,
        ]),
      );
      const falharam = resultados
        .filter(({ valor }) => valor === null)
        .map(({ consulta }) => consulta);
      setContagens((anteriores) => ({ ...anteriores, ...parciais }));

      const espera = ESPERAS_DAS_RETENTATIVAS_MS[retentativasFeitas.current];
      if (
        !falharam.length ||
        espera === undefined ||
        document.visibilityState !== "visible"
      ) {
        return;
      }
      retentativaAgendada.current = setTimeout(() => {
        retentativaAgendada.current = null;
        if (aindaAtual() && document.visibilityState === "visible") {
          ++retentativasFeitas.current;
          void consultar(falharam);
        }
      }, espera);
    }

    await consultar(CONSULTAS_POR_CAMPO);
  }, [cancelarRetentativa]);

  const pedirRecarga = useCallback(() => {
    if (!telaAtiva.current || recargaAgendada.current !== null) return;
    recargaAgendada.current = setTimeout(() => {
      recargaAgendada.current = null;
      void recarregar();
    }, ATRASO_COALESCENCIA_NUMEROS_MS);
  }, [recarregar]);

  // Venda do balcão anulada: o que estava "entregue" sai das contagens.
  useEffect(
    () => (ativo ? aoAnularVenda(() => pedirRecarga()) : undefined),
    [ativo, pedirRecarga],
  );

  // Volta do app para a frente (tela desbloqueada, outra aba do navegador):
  // a conexão ao vivo dorme com a tela bloqueada e os pedidos que chegaram
  // nesse meio-tempo não geram evento nenhum. A lista já se relê ao voltar
  // (`useOrders`); sem isto o topo ficava no número de antes. Pelo mesmo
  // `pedirRecarga`: a janela de coalescência junta voltas seguidas numa
  // rodada só, e não há relógio próprio.
  useEffect(() => {
    if (!ativo) return;
    const aoVoltarParaAFrente = () => {
      if (document.visibilityState === "visible") {
        pedirRecarga();
      } else {
        cancelarRetentativa();
        // Uma resposta da rodada antiga também perde a vez de agendar.
        ++rodadaAtual.current;
      }
    };
    document.addEventListener("visibilitychange", aoVoltarParaAFrente);
    return () =>
      document.removeEventListener("visibilitychange", aoVoltarParaAFrente);
  }, [ativo, cancelarRetentativa, pedirRecarga]);

  // O disparo automático de montagem: ao ficar ativa. Troca de filtro, busca
  // ou página NÃO recarrega — as contagens não dependem deles. Depois disso
  // `pedirRecarga` (tempo real, ação na tela, volta da conexão, volta do app
  // para a frente).
  useEffect(() => {
    if (ativo) void recarregar();
  }, [ativo, recarregar]);

  return { ...contagens, recarregar, pedirRecarga };
}
