/**
 * Etiqueta do Melhor Envio que o app JÁ SABE que foi cancelada (27/11/2026).
 *
 * `shipping_label_id` nunca é apagado do pedido: a etiqueta cancelada no
 * Melhor Envio continua ali. Quem sabe do cancelamento é o histórico de envio
 * (`order_shipping_events`): o "Atualizar rastreio" da ficha do pedido
 * (`melhor-envio-etiqueta`, action `consultar_rastreio`) grava um evento
 * `rastreio_consultado` com `payload.status_etiqueta` (o status que o ME
 * devolveu) e `payload.label_id`. Cancelada no ME é estado final: um evento
 * dizendo "cancelada" vale para sempre para aquele id.
 *
 * Usado pelo push da rotina (`aviso-de-cancelamento-do-cliente.ts`) e pelo
 * sino e pela ficha do painel (`src/utils/avisos-do-lojista.ts`,
 * `src/lib/elegibilidade-da-etiqueta.ts`) — uma régua só.
 */

/** "canceled"/"cancelled" (o ME já devolveu as duas grafias), sem caixa nem espaço. */
export function statusDaEtiquetaCancelada(status: unknown): boolean {
  if (typeof status !== "string") return false;
  const normalizado = status.trim().toLowerCase();
  return normalizado === "canceled" || normalizado === "cancelled";
}

/**
 * Ids de etiqueta que algum `rastreio_consultado` do histórico viu cancelados.
 * Entrada que não é lista, linha sem objeto e `label_id` que não é texto não
 * contam: na dúvida a etiqueta NÃO é dada como cancelada (o aviso de "cancele
 * a etiqueta" continua — lado seguro do dinheiro).
 */
export function etiquetasCanceladasNoHistorico(eventos: unknown): Set<string> {
  const canceladas = new Set<string>();
  if (!Array.isArray(eventos)) return canceladas;
  for (const evento of eventos) {
    if (!evento || typeof evento !== "object") continue;
    if ((evento as { event_type?: unknown }).event_type !== "rastreio_consultado") continue;
    const payload = (evento as { payload?: unknown }).payload;
    if (!payload || typeof payload !== "object") continue;
    const { label_id: labelId, status_etiqueta: status } = payload as {
      label_id?: unknown;
      status_etiqueta?: unknown;
    };
    if (typeof labelId !== "string" || labelId.trim() === "") continue;
    if (statusDaEtiquetaCancelada(status)) canceladas.add(labelId);
  }
  return canceladas;
}
