// @vitest-environment jsdom
//
// Cartão de avaliação — a foto da autora e o nome dela abrem o perfil, e os
// dois têm de se comportar IGUAL no teclado:
//  - com `userId` e `onNavigate`: viram botão (role + tabIndex 0), Enter e
//    Espaço abrem o perfil E seguram o comportamento padrão da tecla (Espaço
//    sem isso rola a página junto); outra tecla não faz nada nem é segurada;
//  - sem `userId` (vitrine pública, a view nunca o expõe) ou sem `onNavigate`:
//    nem a foto nem o nome viram botão nem entram na ordem do Tab — um "botão"
//    morto no teclado é pior que nenhum.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewCard } from "@/components/ui/custom/ReviewCard";
import type { Review, View } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class IntersectionObserverFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function avaliacao(extra: Partial<Review> = {}): Review {
  return {
    id: "r-teclado",
    productId: "p1",
    customerName: "Joana Prado",
    rating: 4,
    comment: "Chegou bem embalado",
    verified: false,
    helpful: 0,
    createdAt: "2026-10-01T12:00:00Z",
    ...extra,
  };
}

let raiz: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", IntersectionObserverFalso);
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});

afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function montar(review: Review, aoNavegar?: (view: View, id?: string) => void) {
  act(() => {
    raiz.render(<ReviewCard review={review} onNavigate={aoNavegar} />);
  });
}

function botoesDoAutor(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[role="button"]')];
}

/** Aperta a tecla no elemento; devolve se o comportamento padrão foi segurado. */
function apertar(alvo: HTMLElement, key: string): boolean {
  const evento = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    alvo.dispatchEvent(evento);
  });
  return evento.defaultPrevented;
}

describe("ReviewCard — foto e nome da autora no teclado", () => {
  it("com userId: a foto e o nome são DOIS botões alcançáveis pelo Tab", () => {
    montar(avaliacao({ userId: "u-77" }), vi.fn());
    const botoes = botoesDoAutor();
    expect(botoes).toHaveLength(2);
    for (const b of botoes) {
      expect(b.getAttribute("tabindex")).toBe("0");
    }
    // O segundo é o nome público ("Joana P."); o primeiro leva a foto (iniciais).
    expect(botoes[1].textContent).toBe("Joana P.");
    expect(botoes[0].textContent).toBe("JP");
  });

  it("foto: clique, Enter e Espaço abrem o perfil; Enter e Espaço seguram a tecla; 'a' não", () => {
    const aoNavegar = vi.fn<(view: View, id?: string) => void>();
    montar(avaliacao({ userId: "u-77" }), aoNavegar);
    const [foto] = botoesDoAutor();

    act(() => {
      foto.click();
    });
    expect(aoNavegar).toHaveBeenCalledTimes(1);

    expect(apertar(foto, "Enter")).toBe(true);
    expect(aoNavegar).toHaveBeenCalledTimes(2);
    expect(apertar(foto, " ")).toBe(true);
    expect(aoNavegar).toHaveBeenCalledTimes(3);

    expect(apertar(foto, "a")).toBe(false);
    expect(apertar(foto, "Tab")).toBe(false);
    expect(aoNavegar).toHaveBeenCalledTimes(3);
    expect(
      aoNavegar.mock.calls.every(
        ([view, id]) => view === "user-profile" && id === "u-77",
      ),
    ).toBe(true);
  });

  it("nome: Enter e Espaço abrem o perfil e seguram a tecla; 'a' não", () => {
    const aoNavegar = vi.fn<(view: View, id?: string) => void>();
    montar(avaliacao({ userId: "u-77" }), aoNavegar);
    const nome = botoesDoAutor()[1];

    expect(apertar(nome, "Enter")).toBe(true);
    expect(apertar(nome, " ")).toBe(true);
    expect(aoNavegar).toHaveBeenCalledTimes(2);

    expect(apertar(nome, "a")).toBe(false);
    expect(aoNavegar).toHaveBeenCalledTimes(2);
  });

  it("sem userId (vitrine pública): nada vira botão e nada entra no Tab", () => {
    const aoNavegar = vi.fn<(view: View, id?: string) => void>();
    montar(avaliacao({ userId: undefined }), aoNavegar);

    expect(botoesDoAutor()).toHaveLength(0);
    // O cartão inteiro não oferece nenhum elemento focável pelo `tabindex`.
    expect(host.querySelectorAll("[tabindex]")).toHaveLength(0);

    // A foto (iniciais) tocada ou com Enter não leva a lugar nenhum.
    const foto = [...host.querySelectorAll<HTMLElement>("span")].find(
      (s) => s.textContent === "JP",
    ) as HTMLElement;
    act(() => {
      foto.click();
    });
    expect(apertar(foto, "Enter")).toBe(false);
    expect(aoNavegar).not.toHaveBeenCalled();
  });

  it("com userId mas sem onNavigate: também não vira botão", () => {
    montar(avaliacao({ userId: "u-77" }), undefined);
    expect(botoesDoAutor()).toHaveLength(0);
    expect(host.querySelectorAll("[tabindex]")).toHaveLength(0);
  });
});
