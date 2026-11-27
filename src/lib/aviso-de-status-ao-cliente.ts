import { caminhoDoPedidoNoAviso } from "@/lib/alvo-do-aviso";
import { rotuloDoStatusParaACliente } from "@/lib/mensagem-do-status-no-whatsapp";
import {
  descricaoDePushSemConfirmacao,
  falhaDePushSemConfirmacao,
  motivoDaFalhaEmPortugues,
} from "@/lib/motivo-da-falha-de-push";
import { numeroDoPedido } from "@/lib/numero-do-pedido";
import { CAMPO_DO_CARIMBO_DO_AVISO } from "@/lib/ordem-do-aviso-do-pedido";
import { supabase } from "@/lib/supabase";
import type { Order, OrderStatus } from "@/types";
import { toast } from "sonner";

/** O que o aviso precisa saber do pedido: para quem vai e se é retirada. */
export type PedidoDoAviso = Pick<Order, "userId" | "retiradaNaLoja">;

/** Push de "seu pedido agora está: …" depois de o status ser gravado. Nunca
 *  lança: a falha vira aviso amarelo para a lojista.
 *
 *  Fonte única do aviso de status: a ficha do pedido
 *  (AdminOrdersView.handleStatusChange) chama ao gravar com rede, e a fila
 *  offline (useOrders, `processarFilaOfflineDePedidos`) chama quando a
 *  mudança guardada sem internet é gravada ao reconectar. Quem chama decide
 *  SE avisa (silencioso, pedido sem conta); o texto e o envio moram aqui. */
export async function avisarOClienteDoStatus(
  orderId: string,
  newStatus: OrderStatus,
  alvo: PedidoDoAviso,
) {
  // Carimbo de ordem do aviso, tirado AGORA (status já gravado), antes de
  // qualquer espera de rede: os avisos de status do mesmo pedido são
  // disparados sem esperar um pelo outro e podem chegar trocados. O aparelho
  // mantém na bandeja o de carimbo maior (`ordem-do-aviso-do-pedido.ts`).
  const emitidoEm = Date.now();
  try {
    const title = "Status do Pedido Atualizado";
    const body = `Seu pedido #${numeroDoPedido(orderId)} agora está: ${rotuloDoStatusParaACliente(newStatus, alvo.retiradaNaLoja)}`;

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;

    const { data: envio, error: erroDoInvoke } =
      await supabase.functions.invoke("send-push", {
        body: {
          targetUserId: alvo.userId,
          title,
          body,
          // Sem `url` o toque no aviso caía na vitrine ("/").
          url: caminhoDoPedidoNoAviso(orderId),
          data: {
            orderId,
            type: "order_status",
            [CAMPO_DO_CARIMBO_DO_AVISO]: emitidoEm,
          },
        },
        headers: token
          ? {
              Authorization: `Bearer ${token}`,
            }
          : {},
      });

    if (erroDoInvoke) throw erroDoInvoke;

    // `enviados` só existe na send-push depois da PUSH-010 (#80). O teste de
    // tipo é de propósito: contra a versão antiga da função, que respondia
    // `{ success: true }` sem contagem, isto não faz nada — em vez de acusar
    // falha em todo envio. `total` 0 = a cliente nunca ligou as notificações
    // (nenhum aparelho inscrito): não é falha, então não há o que acusar.
    if (
      typeof envio?.enviados === "number" &&
      envio.enviados === 0 &&
      envio.total !== 0
    ) {
      if (envio.falhas?.some(falhaDePushSemConfirmacao)) {
        toast.warning(
          "Status atualizado, mas não foi possível confirmar o envio do aviso",
          {
            description: descricaoDePushSemConfirmacao(
              envio.falhas,
              "O aviso ainda pode chegar à cliente",
            ),
          },
        );
        return;
      }

      // O motivo cru vem em inglês técnico ("push service respondeu 410
      // Gone"): a lojista lê a tradução, com a inicial maiúscula.
      const motivo = envio?.falhas?.[0]
        ? motivoDaFalhaEmPortugues(envio.falhas[0])
        : null;
      toast.warning("Status atualizado, mas o push não chegou", {
        description: motivo
          ? motivo.charAt(0).toUpperCase() + motivo.slice(1)
          : "Nenhum dispositivo deste cliente recebeu a notificação.",
      });
    }
  } catch (err) {
    console.error("Error sending status push:", err);
    toast.warning("Status atualizado, mas o push falhou", {
      description: "O cliente não foi notificado da mudança.",
    });
  }
}
