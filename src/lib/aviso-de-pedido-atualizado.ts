import { eAcaoPropriaDoPedido } from "@/lib/acao-propria-do-painel";
import { versaoMaisVelhaQueAMemoria } from "@/lib/versao-do-pedido";
import type { Order } from "@/types";

/**
 * Aviso da lojista "Pedido #N atualizado para…" (evento realtime de UPDATE).
 *
 * O `old` do evento NÃO é confiável: com RLS ligada o Supabase manda nele só a
 * chave primária, mesmo com REPLICA IDENTITY FULL. Por isso o "antes" vem do
 * pedido que já está na memória da tela (`completarOldDoEvento`, chamado pelo
 * `useOrders` ANTES de mesclar o evento). Sem ele, o aviso é neutro:
 * não afirma uma mudança de status que não deu para comparar.
 */
type EventoDePedido = {
  eventType?: string;
  old?: Record<string, unknown> | null;
  new?: Record<string, unknown> | null;
  [chave: string]: unknown;
};

/** Devolve o evento com `old.status`/`old.payment_status` preenchidos a partir
 * do pedido que a tela já tinha. O que o servidor mandou no `old` tem
 * prioridade; sem pedido na memória, o evento volta como veio.
 *
 * `old.updated_at` é o contrário: vale SEMPRE a versão da tela, quando ela a
 * tem. Ela é a régua de "evento atrasado" do aviso (`tipoDoAvisoDoPedido`), e
 * a lista descarta o evento comparando com a MEMÓRIA, não com o `old` do
 * servidor (que, se viesse completo, seria a versão anterior no banco —
 * sempre mais velha que o evento, e nunca barraria nada). */
export function completarOldDoEvento<T extends EventoDePedido>(
  evento: T,
  anterior:
    | (Pick<Order, "status" | "paymentStatus"> &
        Partial<Pick<Order, "updatedAt">>)
    | undefined,
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
      ...(anterior.updatedAt !== undefined
        ? { updated_at: anterior.updatedAt }
        : {}),
    },
  };
}

const PAGAMENTO_CONFIRMADO = new Set(["pago", "pago_apos_expirar"]);

function pagamentoConfirmado(valor: unknown): boolean {
  return typeof valor === "string" && PAGAMENTO_CONFIRMADO.has(valor);
}

/** Como no push, pagamento na entrega já nasce válido; a reserva online não. */
export function deveAvisarPedidoNovo(pedido: EventoDePedido["new"]): boolean {
  if (!pedido || pedido.canal === "presencial") return false;
  return (
    pagamentoConfirmado(pedido.payment_status) ||
    (pedido.payment_method !== "online" &&
      pedido.payment_status !== "aguardando")
  );
}

/**
 * "pagamento": o pagamento passou a pago agora. "status": o status mudou (e não
 * foi a própria lojista que acabou de pedir). `null`: nada novo para contar.
 * Sem o estado anterior no evento (`old` sem o campo) não dá para comparar:
 * avisa sem afirmar uma mudança de status.
 *
 * Evento estritamente mais velho que a versão da tela (`old.updated_at`, posto
 * por `completarOldDoEvento`) é `null`: a lista o descarta pela MESMA régua
 * (`versaoMaisVelhaQueAMemoria`), e o aviso não pode anunciar "atualizado
 * para Em preparo" com o pedido já Enviado na tela, nem "pagamento
 * confirmado" num pedido já estornado.
 */
export function tipoDoAvisoDoPedido(
  evento: EventoDePedido,
  agora: number = Date.now(),
): "pagamento" | "status" | "generico" | null {
  const antes = evento.old ?? undefined;
  const depois = evento.new ?? undefined;
  if (versaoMaisVelhaQueAMemoria(antes?.updated_at, depois?.updated_at)) {
    return null;
  }
  const pagamentoNovo = depois?.payment_status;
  if (
    antes &&
    antes.payment_status !== undefined &&
    antes.payment_status !== pagamentoNovo &&
    pagamentoConfirmado(pagamentoNovo)
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
  return typeof antes?.status === "string" ? "status" : "generico";
}
