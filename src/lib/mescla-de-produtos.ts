import type { Product } from "@/types";

// ─── Merge fino do evento de realtime na lista de produtos ──────────────────

export interface EventoDeMescla {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  id?: string;
  registro?: Product;
}

/**
 * Decide a próxima lista de produtos a partir de UM evento de realtime.
 *
 * C4 (laudo novos-ângulos 01/09): o listener de `products` relia TODO o
 * cofre e trocava o array inteiro a cada evento — identidade nova para
 * todos os objetos, memo dos cards inútil, e a Home inteira
 * re-renderizada porque a lojista mexeu num preço. Com o merge fino, só o
 * slot do registro afetado é trocado: os cards não tocados preservam a
 * identidade (e o memo) e ficam no lugar.
 *
 * Devolve `null` quando o evento não basta para decidir localmente
 * (catchUp, broadcast em massa, evento sem registro) — aí o chamador
 * relê o cofre inteiro, como sempre fez. Um DELETE de id ausente devolve
 * a MESMA lista: nada mudou, e React pula o re-render.
 *
 * Nunca muta a lista de entrada.
 */
export function mesclarProdutoNaLista(
  lista: Product[],
  evento: EventoDeMescla,
): Product[] | null {
  if (evento.eventType === "DELETE") {
    if (!evento.id) return null;
    const indice = lista.findIndex((p) => p.id === evento.id);
    if (indice < 0) return lista;
    const nova = lista.slice();
    nova.splice(indice, 1);
    return nova;
  }

  if (!evento.registro || !evento.id) return null;

  const indice = lista.findIndex((p) => p.id === evento.id);
  if (indice < 0) return [...lista, evento.registro];
  const nova = lista.slice();
  nova[indice] = evento.registro;
  return nova;
}
