import { eAcaoPropriaDoPedido } from "@/lib/acao-propria-do-painel";
import type { Order } from "@/types";

/**
 * Aviso da lojista "Pedido #N atualizado para…" (evento realtime de UPDATE).
 *
 * O `old` do evento NÃO é confiável: com RLS ligada o Supabase manda nele só a
 * chave primária, mesmo com REPLICA IDENTITY FULL. Por isso o "antes" vem do
 * pedido que já está na memória da tela (`completarOldDoEvento`, chamado pelo
 * `useOrders` ANTES de mesclar o evento) e, sem ele, o aviso sai como sempre
 * saiu — nunca se engole uma mudança que não deu para comparar.
 */
type EventoDePedido = {
  eventType?: string;
  old?: Record<string, unknown> | null;
  new?: Record<string, unknown> | null;
  [chave: string]: unknown;
};

/** Devolve o evento com `old.status`/`old.payment_status` preenchidos a partir
 * do pedido que a tela já tinha. O que o servidor mandou no `old` tem
 * prioridade; sem pedido na memória, o evento volta como veio. */
export function completarOldDoEvento<T extends EventoDePedido>(
  evento: T,
  anterior: Pick<Order, "status" | "paymentStatus"> | undefined,
): T {
  if (evento.eventType !== "UPDATE" || !anterior) return evento;
  const old = evento.old ?? {};
  return {
    ...evento,
    old: {
      ...old,
      status: old.status !== undefined ? old.status : anterior.status,
      payment_status:
        old.payment_status !== undefined
          ? old.payment_status
          : (anterior.paymentStatus ?? null),
    },
  };
}

const PAGAMENTO_CONFIRMADO = new Set(["pago", "pago_apos_expirar"]);

/**
 * "pagamento": o pagamento passou a pago agora. "status": o status mudou (e não
 * foi a própria lojista que acabou de pedir). `null`: nada novo para contar.
 * Sem o estado anterior no evento (`old` sem o campo) não dá para comparar:
 * avisa como antes.
 */
export function tipoDoAvisoDoPedido(
  evento: EventoDePedido,
  agora: number = Date.now(),
): "pagamento" | "status" | null {
  const antes = evento.old ?? undefined;
  const depois = evento.new ?? undefined;
  const pagamentoNovo = depois?.payment_status;
  if (
    antes &&
    antes.payment_status !== undefined &&
    antes.payment_status !== pagamentoNovo &&
    typeof pagamentoNovo === "string" &&
    PAGAMENTO_CONFIRMADO.has(pagamentoNovo)
  ) {
    return "pagamento";
  }
  const statusNovo = depois?.status;
  if (typeof antes?.status === "string" && antes.status === statusNovo) {
    return null;
  }
  const id = depois?.id;
  if (
    typeof id === "string" &&
    typeof statusNovo === "string" &&
    eAcaoPropriaDoPedido(id, statusNovo, agora)
  ) {
    return null;
  }
  return "status";
}
