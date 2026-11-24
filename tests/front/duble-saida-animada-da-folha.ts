// Dublê da animação de saída das folhas.
//
// O jsdom não tem CSS de animação: o `Presence` do Radix enxerga
// `animationName: none` e desmonta a folha NA HORA ao fechar, o que esconde o
// defeito "a folha some seca" (a tela-mãe desmontava a folha antes de a
// animação rodar). Este dublê faz o `getComputedStyle` dos elementos do Radix
// (os que têm `data-state`) responder que há animação de entrada/saída — e o
// teste termina a saída com `terminarSaida`, como o navegador faria.
import { vi } from "vitest";

export function simularSaidaAnimada(): void {
  if (typeof globalThis.CSS === "undefined" || !("escape" in globalThis.CSS)) {
    vi.stubGlobal("CSS", { escape: (texto: string) => texto });
  }
  const original = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (elemento: Element, pseudo?: string | null) => {
      const estado = elemento.getAttribute?.("data-state");
      if (estado !== "open" && estado !== "closed") {
        return original(elemento, pseudo);
      }
      // VIVO como o do navegador: o `Presence` guarda o objeto na montagem e o
      // relê ao fechar, então o nome da animação tem de seguir o `data-state`.
      return {
        get animationName() {
          return elemento.getAttribute("data-state") === "closed"
            ? "saida"
            : "entrada";
        },
        display: "block",
        visibility: "visible",
      } as unknown as CSSStyleDeclaration;
    },
  );
}

/** O navegador avisa `animationend` quando a saída termina. */
export function terminarSaida(elemento: Element): void {
  const evento = new Event("animationend", { bubbles: true });
  Object.defineProperty(evento, "animationName", { value: "saida" });
  elemento.dispatchEvent(evento);
}
