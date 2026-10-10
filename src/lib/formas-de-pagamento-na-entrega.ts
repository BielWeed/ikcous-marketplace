// FORMAS DE PAGAMENTO POR LOJA (25/09/2026): cada loja liga/desliga pix,
// cartão e dinheiro na entrega/retirada (store_config.formas_pagamento_
// entrega, migration 20261174000000). "online" (PIX pelo app) NÃO mora
// aqui — continua em store_config.pagamento_online, lido pela ficha da
// loja (pagamentoOnlineLigado()).
export type FormaDePagamentoNaEntrega = "pix" | "card" | "cash";

// Ordem CANÔNICA (não a ordem de clique) — fonte única para o painel admin
// (3 switches, sempre nesta ordem) e para o fallback de checkout
// (`primeiraFormaDePagamentoDisponivel`, guarda-de-frete.ts): a prioridade
// nunca depende de qual switch a lojista tocou primeiro.
const TODAS_AS_FORMAS: readonly FormaDePagamentoNaEntrega[] = [
  "pix",
  "card",
  "cash",
];

export const FORMAS_DE_PAGAMENTO_NA_ENTREGA_EM_ORDEM = TODAS_AS_FORMAS;

function ehFormaConhecida(valor: unknown): valor is FormaDePagamentoNaEntrega {
  return valor === "pix" || valor === "card" || valor === "cash";
}

/**
 * Normaliza o que veio do banco (StoreContext.mapConfig) ou do cache
 * offline para a lista de formas "na entrega" que a loja realmente aceita.
 * Ausente, não-array, ou com QUALQUER elemento fora do conjunto conhecido
 * cai no PADRÃO (as três) — MESMO comportamento de hoje: loja velha sem a
 * coluna, ou linha corrompida, nunca muda sozinha. Um elemento desconhecido
 * NÃO é filtrado em silêncio (perderia parte da configuração real sem
 * avisar); falha para o padrão inteiro. Ordem PRESERVADA para o
 * subconjunto válido — o servidor nunca reordena (StoreContext,
 * "texto_array").
 */
export function formasPagamentoNaEntregaValidas(
  valor: unknown,
): FormaDePagamentoNaEntrega[] {
  if (!Array.isArray(valor)) return [...TODAS_AS_FORMAS];
  if (!valor.every(ehFormaConhecida)) return [...TODAS_AS_FORMAS];
  return [...valor];
}
