import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase";

/** Status possíveis de uma linha de `order_refunds` (Task 1 do plano-mãe de
 * estorno, `20260907-plano-estorno-pelo-app.md`). */
export type StatusEstorno =
  | "solicitado"
  | "em_processamento"
  | "concluido"
  | "falhou"
  | "recusado";

export interface LinhaEstornoDoPedido {
  id: string;
  amount: number;
  status: StatusEstorno;
  solicitado_por: string;
  mp_status: string | null;
  mp_status_detail: string | null;
  tentativas: number;
  ultimo_erro: string | null;
  motivo: string | null;
  created_at: string;
  concluido_em: string | null;
}

// Não exportada de propósito: nada fora deste arquivo importa o TIPO do
// retorno por nome (quem consome o hook, ex. `EstornoCard`, só desestrutura
// os campos) — exportá-la só criaria um export órfão para o `knip`.
interface EstornosDoPedido {
  linhas: LinhaEstornoDoPedido[];
  /** = `marketplace_orders.total`. */
  pago: number;
  /** = `marketplace_orders.valor_estornado`. */
  devolvido: number;
  /** Soma das linhas ainda não concluídas (inclusive `sistema`, ex.:
   * chargeback em análise) — é a mesma conta que a RPC `solicitar_estorno`
   * faz para recusar um pedido maior que o saldo livre. */
  emCurso: number;
  /** `pago - devolvido - emCurso`. */
  disponivel: number;
  carregando: boolean;
  /** A leitura falhou; `pago`/`devolvido`/`disponivel` não são confiáveis. */
  erro: boolean;
  recarregar: () => void;
  solicitarEstorno: (args: {
    amount: number;
    motivo: string;
  }) => Promise<void>;
  /** Uma chamada de `solicitarEstorno` está em voo. */
  enviando: boolean;
}

// Dinheiro sempre em CENTAVOS inteiros antes de somar/subtrair — `50 - 4.23`
// em ponto flutuante dá `45.769999...`, não `45.77` (C1 do laudo do #438).
// A fonte (`numeric(12,2)`) já garante no máximo 2 casas, então arredondar
// para o inteiro mais próximo nunca perde centavo de verdade.
const paraCentavos = (valor: number) => Math.round(valor * 100);

const ESTADOS_EM_CURSO: readonly StatusEstorno[] = [
  "solicitado",
  "em_processamento",
];

const INTERVALO_DE_RECARGA_MS = 15_000;

const TEXTO_REGISTRADO_CRON =
  "Pedido de devolução registrado; o Mercado Pago é acionado em até 10 minutos.";

interface SaldoDoPedido {
  total: number;
  valor_estornado: number;
}

/**
 * Lê o saldo e o histórico de devoluções de UM pedido (`order_refunds` +
 * `marketplace_orders.valor_estornado`) e expõe `solicitarEstorno`, que
 * grava o pedido no ledger (RPC `solicitar_estorno`) e SÓ DEPOIS aciona o
 * Mercado Pago (edge `estornar-pagamento`) — nessa ordem, sempre: a linha
 * é o ledger, o clique é apenas o gatilho de EXECUÇÃO dela (arquitetura de
 * "ledger primeiro, execução depois" do plano-mãe).
 *
 * SEM REALTIME, de propósito: `order_refunds` não está na publication
 * `supabase_realtime` (só `marketplace_orders`, migration `20261061000000`)
 * e ligar exigiria uma migration nova — fora do escopo desta tarefa. No
 * lugar: recarrega ao montar, depois de cada ação, e — ENQUANTO existir
 * linha em `solicitado`/`em_processamento` — a cada 15s; o intervalo some
 * sozinho quando a última linha ativa se resolve, e é limpo no unmount.
 */
export function useEstornosDoPedido(orderId: string): EstornosDoPedido {
  const [linhas, setLinhas] = useState<LinhaEstornoDoPedido[]>([]);
  const [pedido, setPedido] = useState<SaldoDoPedido | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const ativoRef = useRef(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [respostaLinhas, respostaPedido] = await Promise.all([
        supabase
          .from("order_refunds")
          .select(
            "id, amount, status, solicitado_por, mp_status, mp_status_detail, tentativas, ultimo_erro, motivo, created_at, concluido_em",
          )
          .eq("order_id", orderId)
          .order("created_at", { ascending: true }),
        supabase
          .from("marketplace_orders")
          .select("total, valor_estornado, payment_status")
          .eq("id", orderId)
          .single(),
      ]);

      if (!ativoRef.current) return;

      if (respostaLinhas.error || respostaPedido.error) {
        setErro(true);
        return;
      }

      setLinhas(
        (respostaLinhas.data ?? []) as unknown as LinhaEstornoDoPedido[],
      );
      setPedido(respostaPedido.data as unknown as SaldoDoPedido);
      setErro(false);
    } catch {
      if (ativoRef.current) setErro(true);
    } finally {
      if (ativoRef.current) setCarregando(false);
    }
  }, [orderId]);

  useEffect(() => {
    ativoRef.current = true;
    void carregar();
    return () => {
      ativoRef.current = false;
    };
  }, [carregar]);

  const temLinhaAtiva = linhas.some((linha) =>
    ESTADOS_EM_CURSO.includes(linha.status),
  );

  // O intervalo só existe enquanto houver linha ativa: pedido totalmente
  // resolvido (tudo `concluido`/`falhou`/`recusado`) para de recarregar
  // sozinho — não há nada em voo para confirmar a cada 15s.
  useEffect(() => {
    if (!temLinhaAtiva) return;
    const id = setInterval(() => {
      void carregar();
    }, INTERVALO_DE_RECARGA_MS);
    return () => clearInterval(id);
  }, [temLinhaAtiva, carregar]);

  const centavosPago = paraCentavos(pedido?.total ?? 0);
  const centavosDevolvido = paraCentavos(pedido?.valor_estornado ?? 0);
  const centavosEmCurso = linhas
    .filter((linha) => ESTADOS_EM_CURSO.includes(linha.status))
    .reduce((soma, linha) => soma + paraCentavos(linha.amount), 0);
  const centavosDisponivel = centavosPago - centavosDevolvido - centavosEmCurso;

  const solicitarEstorno = useCallback(
    async ({ amount, motivo }: { amount: number; motivo: string }) => {
      setEnviando(true);
      try {
        const { data, error } = await supabase.rpc("solicitar_estorno", {
          p_order_id: orderId,
          p_amount: amount,
          p_motivo: motivo,
        });

        // A RPC já devolve mensagem leiga, escrita para o lojista na
        // migration que a cria — não se traduz de novo aqui.
        if (error) {
          toast.error(error.message);
          return;
        }

        const refundId = (data as unknown as { refund_id?: string } | null)
          ?.refund_id;
        if (!refundId) {
          toast.error("Não consegui registrar o pedido de devolução.");
          return;
        }

        // A RPC deu certo: a linha já existe como `solicitado`. Se o
        // `invoke` falhar agora (rede/401/409/5xx), NÃO é falha do pedido —
        // o cron de reconciliação (`reconciliar-pagamentos`, ≤ 10 min) a
        // executa depois, com a mesma chave de idempotência. Por isso este
        // bloco nunca deixa o erro subir: ele só troca o aviso.
        try {
          const { error: erroDoInvoke } = await supabase.functions.invoke(
            "estornar-pagamento",
            { body: { refund_id: refundId } },
          );
          if (erroDoInvoke) toast.info(TEXTO_REGISTRADO_CRON);
        } catch {
          toast.info(TEXTO_REGISTRADO_CRON);
        }

        await carregar();
      } finally {
        setEnviando(false);
      }
    },
    [orderId, carregar],
  );

  return {
    linhas,
    pago: centavosPago / 100,
    devolvido: centavosDevolvido / 100,
    emCurso: centavosEmCurso / 100,
    disponivel: centavosDisponivel / 100,
    carregando,
    erro,
    recarregar: () => void carregar(),
    solicitarEstorno,
    enviando,
  };
}
