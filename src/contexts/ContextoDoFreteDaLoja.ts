import { listaComRetirada, retiradaLigadaNaLista } from "@/lib/guarda-de-frete";
import type { StoreConfig } from "@/types";
import { createContext, useContext } from "react";

/**
 * O CONTEXTO DA LOJA que uma cotação de frete responde (release 1.5.3 —
 * retirada na loja): provedor, transportadoras habilitadas, retirada ligada
 * e o endereço da loja (aparado). A edge `calculate-shipping` decide a lista
 * com esses campos; a ShippingCalculator carimba o cache do navegador com
 * este texto e recota quando ele muda — senão a tela ofereceria, por até
 * 2 h, a retirada que a loja desligou ou o endereço de onde ela saiu.
 * Lista NULL lê como a edge (`["sedex","pac"]`, via `listaComRetirada`).
 */
export function contextoDaLojaParaFrete(
  config:
    | Pick<
        StoreConfig,
        "shippingProvider" | "enabledShippingMethods" | "storeAddress"
      >
    | null
    | undefined,
): string {
  const metodos = config?.enabledShippingMethods;
  return JSON.stringify([
    config?.shippingProvider ?? "",
    [...listaComRetirada(metodos, false)].sort(),
    retiradaLigadaNaLista(metodos),
    (config?.storeAddress ?? "").trim(),
  ]);
}

/**
 * Contexto React PRÓPRIO (e não um campo do `useStore`): o StoreProvider o
 * fornece com o config real; sem provider — a calculadora montada sozinha,
 * ou um teste que troca o `@/contexts/StoreContext` inteiro por um dublê —
 * vale o contexto "sem config", estável, e nada quebra.
 */
export const ContextoDoFreteDaLoja = createContext<string>(
  contextoDaLojaParaFrete(undefined),
);

export function useContextoDoFreteDaLoja(): string {
  return useContext(ContextoDoFreteDaLoja);
}
