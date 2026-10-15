// Para onde o toque no aviso "status do pedido" leva a cliente. O service
// worker abre SÓ `data.url` da notificação, e a edge `send-push` grava
// `url || "/"` — sem `url` no disparo, tocar no aviso abria a vitrine em vez do
// pedido. O formato é o mesmo que o app usa na própria barra de endereço
// (`/order-details?id=<id>`, ver `handleNavigate` em App.tsx) e que
// `navegarPorUrl` (NotificationsView) já entende.
export function urlDoPedidoNoPush(orderId: string): string {
  return `/order-details?id=${encodeURIComponent(orderId)}`;
}
