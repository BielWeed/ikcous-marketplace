import { NotificationContext } from "@/contexts/NotificationContextCore";
import { useContext, useEffect } from "react";

/**
 * Quem abre a tela de um pedido já viu os avisos dele: marca como lidos, no
 * sino, os avisos ainda não lidos DESSE pedido. Sem isto, tocar no aviso do
 * celular (ou abrir o pedido por "Meus pedidos") deixava a bolinha do sino
 * acesa, e o contador só crescia a cada mudança de status.
 *
 * Lê o contexto com `useContext` (e não com `useNotificationCenter`, que
 * lança): a tela do pedido também abre sem o provedor do sino, e aí isto é
 * simplesmente nada.
 *
 * O efeito depende de "há aviso não lido deste pedido" (um booleano), não da
 * lista: marcar zera o booleano e o efeito para; um UPDATE que falhe não o
 * zera, mas também não o religa — sem repetição em laço. Um aviso novo do
 * mesmo pedido que chegue com a tela aberta religa o booleano e é marcado.
 */
export function useMarcarAvisosDoPedidoComoLidos(orderId: string): void {
  const centro = useContext(NotificationContext);
  const marcar = centro?.markOrderAsRead;
  const temAvisoNaoLido =
    centro?.notifications.some((n) => !n.read && n.order_id === orderId) ??
    false;

  useEffect(() => {
    if (temAvisoNaoLido && marcar) void marcar(orderId);
  }, [orderId, temAvisoNaoLido, marcar]);
}
