// Acesso ao armazenamento do navegador que NUNCA lança.
//
// Chrome com "Bloquear todos os cookies e dados de sites", Safari com
// "Bloquear todos os cookies" e certos modos privados/WebViews fazem o próprio
// ACESSO a `localStorage` / `sessionStorage` lançar SecurityError — antes de
// qualquer getItem. `try` em volta do getItem não alcança isso: o acesso à
// propriedade fica de fora. Quem lê no arranque da loja ou do checkout (efeito
// de montagem, valor inicial de estado) passa por aqui: sem armazenamento, o
// valor é o padrão (nada salvo) e a tela abre — nenhuma mensagem de erro para
// quem compra.

import type { ArmazenamentoSimples } from "./chave-do-pedido";

const SEM_ARMAZENAMENTO: ArmazenamentoSimples = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

/** `localStorage`, ou um armazenamento vazio quando o navegador o bloqueia. */
export function localStorageSeguro(): ArmazenamentoSimples {
  try {
    return globalThis.localStorage ?? SEM_ARMAZENAMENTO;
  } catch {
    return SEM_ARMAZENAMENTO;
  }
}

/** `sessionStorage`, ou um armazenamento vazio quando o navegador o bloqueia. */
export function sessionStorageSeguro(): ArmazenamentoSimples {
  try {
    return globalThis.sessionStorage ?? SEM_ARMAZENAMENTO;
  } catch {
    return SEM_ARMAZENAMENTO;
  }
}
