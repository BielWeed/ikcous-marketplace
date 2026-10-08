// Forma de entrega para EXIBIR na ficha do pedido (linha "Como vai: …").
//
// O checkout grava na nota do pedido "Frete Escolhido: <nome> (Prazo: <prazo>)"
// (`notaDoFreteEscolhido`, CheckoutView.tsx), e acrescenta essa linha no FIM de
// `notes`. Aqui só se LÊ para mostrar. A decisão de comprar etiqueta mora em
// `elegibilidade-da-etiqueta.ts` (que tem a sua própria leitura privada do
// nome) e não depende deste módulo: não unificar as duas — uma decide dinheiro,
// esta só desenha uma linha.

export interface FormaDeEntregaDaNota {
  nome: string;
  prazo: string;
}

/**
 * Lê a ÚLTIMA ocorrência da frase, nunca a primeira: texto livre escrito ANTES
 * dela (observação da cliente) pode conter a mesma frase e enganar um `.match()`
 * que para no primeiro achado. `null` quando não há frase completa.
 *
 * Único ajuste no texto: "1 dias" (o checkout não trata plural) vira "1 dia".
 */
export function formaDeEntregaDaNota(
  notes: unknown,
): FormaDeEntregaDaNota | null {
  if (typeof notes !== "string") return null;
  const casamentos = [
    ...notes.matchAll(/Frete Escolhido:\s*(.+?)\s*\(Prazo:\s*([^)]*)\)/g),
  ];
  const ultimo = casamentos.at(-1);
  const nome = ultimo?.[1]?.trim();
  const prazo = ultimo?.[2]?.trim();
  if (!nome || !prazo) return null;
  return { nome, prazo: prazo === "1 dias" ? "1 dia" : prazo };
}
