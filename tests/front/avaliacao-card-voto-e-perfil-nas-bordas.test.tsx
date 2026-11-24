// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), cartão de avaliação da vitrine, fronteiras
// que nenhum teste vigiava:
//  1. O botão "Útil" aceita handler SÍNCRONO (devolve `undefined`) além do que
//     devolve Promise<boolean> (contrato declarado na prop `onHelpful`).
//     `undefined` significa "valeu": só `false` destrava o botão. Trocar o teste
//     por "valeu verdadeiro" deixava o voto síncrono sem marcação.
//  2. Quando a tela fornece `jaVotou` (a marcação vinda do banco), ela manda
//     sobre o estado local: logout/troca de conta devolve `false` e o botão
//     tem de reabrir, mesmo que este cartão tenha votado antes.
//  3. Avaliação da vitrine pública NÃO tem `userId` (a view nunca o expõe):
//     tocar no nome ou na foto não pode navegar para um perfil `undefined`.
//     Com `userId`, Enter e Espaço abrem o perfil e outra tecla não.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewCard } from "@/components/ui/custom/ReviewCard";
import type { Review, View } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function avaliacao(extra: Partial<Review> = {}): Review {
  return {
    id: "r1",
    productId: "p1",
    customerName: "Maria Souza",
    rating: 5,
    comment: "Gostei",
    verified: false,
    helpful: 3,
    createdAt: "2026-10-01T12:00:00Z",
    ...extra,
  };
}

let raiz: Root;
let host: HTMLDivElement;
class IntersectionObserverFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

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

const botaoUtil = () =>
  [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Útil"),
  ) as HTMLButtonElement;

// A tela só mostra o primeiro nome e a inicial do sobrenome ("Maria S.").
const spanDoNome = () =>
  [...host.querySelectorAll("span")].find(
    (s) => s.textContent === "Maria S.",
  ) as HTMLSpanElement;

describe("ReviewCard — voto Útil: o que o handler devolve", () => {
  it("handler síncrono (devolve undefined) conta como voto feito: o botão trava", async () => {
    const aoVotar = vi.fn<(id: string) => void>();
    act(() => {
      raiz.render(<ReviewCard review={avaliacao()} onHelpful={aoVotar} />);
    });

    await act(async () => {
      botaoUtil().click();
    });

    expect(aoVotar).toHaveBeenCalledExactlyOnceWith("r1");
    expect(botaoUtil().disabled).toBe(true);
  });

  it("handler que devolve false (voto recusado) NÃO trava: dá para tentar de novo", async () => {
    const aoVotar = vi
      .fn<(id: string) => Promise<boolean>>()
      .mockResolvedValue(false);
    act(() => {
      raiz.render(<ReviewCard review={avaliacao()} onHelpful={aoVotar} />);
    });

    await act(async () => {
      botaoUtil().click();
    });

    expect(botaoUtil().disabled).toBe(false);
  });

  it("jaVotou do banco manda: voltou a false (logout), o botão reabre mesmo depois de ter votado aqui", async () => {
    const aoVotar = vi
      .fn<(id: string) => Promise<boolean>>()
      .mockResolvedValue(true);
    act(() => {
      raiz.render(
        <ReviewCard review={avaliacao()} jaVotou={false} onHelpful={aoVotar} />,
      );
    });
    await act(async () => {
      botaoUtil().click();
    });
    // Com a marcação do banco ainda falsa, o botão segue o banco.
    expect(botaoUtil().disabled).toBe(false);

    act(() => {
      raiz.render(
        <ReviewCard review={avaliacao()} jaVotou onHelpful={aoVotar} />,
      );
    });
    expect(botaoUtil().disabled).toBe(true);

    act(() => {
      raiz.render(
        <ReviewCard review={avaliacao()} jaVotou={false} onHelpful={aoVotar} />,
      );
    });
    expect(botaoUtil().disabled).toBe(false);
  });
});

describe("ReviewCard — tocar no autor", () => {
  it("avaliação sem userId (vitrine pública): tocar no nome não navega nem vira botão", () => {
    const aoNavegar = vi.fn<(view: View, id?: string) => void>();
    act(() => {
      raiz.render(
        <ReviewCard
          review={avaliacao({ userId: undefined })}
          onNavigate={aoNavegar}
        />,
      );
    });

    act(() => {
      spanDoNome().click();
      spanDoNome().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(spanDoNome().getAttribute("role")).toBeNull();
    expect(aoNavegar).not.toHaveBeenCalled();
  });

  it("com userId: clique, Enter e Espaço abrem o perfil; outra tecla não", () => {
    const aoNavegar = vi.fn<(view: View, id?: string) => void>();
    act(() => {
      raiz.render(
        <ReviewCard
          review={avaliacao({ userId: "u-9" })}
          onNavigate={aoNavegar}
        />,
      );
    });
    const tecla = (key: string) =>
      act(() => {
        spanDoNome().dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        );
      });

    expect(spanDoNome().getAttribute("role")).toBe("button");
    act(() => {
      spanDoNome().click();
    });
    expect(aoNavegar).toHaveBeenCalledTimes(1);
    tecla("Enter");
    expect(aoNavegar).toHaveBeenCalledTimes(2);
    tecla(" ");
    expect(aoNavegar).toHaveBeenCalledTimes(3);
    tecla("a");
    expect(aoNavegar).toHaveBeenCalledTimes(3);
    expect(
      aoNavegar.mock.calls.every(
        ([v, id]) => v === "user-profile" && id === "u-9",
      ),
    ).toBe(true);
  });
});
