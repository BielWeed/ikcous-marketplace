import type { EstadoDaConfigDoCartao } from "@/hooks/useConfigDoCartao";
import type { ConfigDoCartao } from "@/lib/config-do-cartao";

/**
 * Fábrica de estados do dublê de `useConfigDoCartao` (contrato discriminado:
 * carregando | erro | pronto). O CheckoutView tem efeitos e memos que
 * dependem da identidade do que o hook devolve — objeto NOVO a cada render já
 * causou laço infinito/timeout nesta suíte. Por isso cada config vira UM
 * estado `pronto`, memorizado, e os estados sem dado são constantes de módulo.
 */
export const ESTADO_CARREGANDO: EstadoDaConfigDoCartao = Object.freeze({
  estado: "carregando",
});

export const ESTADO_PRONTO_SEM_CARTAO: EstadoDaConfigDoCartao = Object.freeze({
  estado: "pronto",
  config: null,
});

const prontos = new WeakMap<ConfigDoCartao, EstadoDaConfigDoCartao>();

/** `pronto` com a config dada (ou `null` = cartão desligado de verdade). */
export function estadoPronto(
  config: ConfigDoCartao | null,
): EstadoDaConfigDoCartao {
  if (config === null) return ESTADO_PRONTO_SEM_CARTAO;
  let estado = prontos.get(config);
  if (!estado) {
    estado = Object.freeze({ estado: "pronto", config });
    prontos.set(config, estado);
  }
  return estado;
}
