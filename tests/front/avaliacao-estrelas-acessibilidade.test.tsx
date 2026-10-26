// @vitest-environment jsdom
//
// Caça 8 (26/10/2026), item 3: as estrelas de nota eram botões mudos (o leitor
// de tela dizia só "botão") e com ~28 px de toque. Cada uma agora diz a nota,
// informa se está marcada e tem alvo de 44 px sem mudar o tamanho da estrela.
//
// UI-191 (G9): com `aria-pressed` o leitor dizia "4 botões pressionados" para a
// nota 4. Agora é um grupo de opções (radiogroup): UMA estrela marcada ("4 de 5
// estrelas, marcado"), Tab entra na marcada e as setas trocam a nota.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({ addReview: vi.fn() }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("ReviewForm — estrelas acessíveis", () => {
  it("cada estrela diz a nota, marca as escolhidas e tem alvo de 44 px", async () => {
    const { ReviewForm } = await import("@/components/ui/custom/ReviewForm");
    await act(async () => {
      raiz.render(<ReviewForm productId="p-1" initialRating={3} />);
    });
    const estrelas = [
      ...hospedeiro.querySelectorAll<HTMLButtonElement>(
        "button[aria-label$='de 5 estrelas']",
      ),
    ];
    expect(estrelas.map((b) => b.getAttribute("aria-label"))).toEqual([
      "1 de 5 estrelas",
      "2 de 5 estrelas",
      "3 de 5 estrelas",
      "4 de 5 estrelas",
      "5 de 5 estrelas",
    ]);
    // Só a estrela da NOTA está marcada (as outras acesas são desenho): não
    // há "3 botões pressionados" para o leitor de tela.
    expect(estrelas.map((b) => b.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "true",
      "false",
      "false",
    ]);
    expect(estrelas.every((b) => b.getAttribute("role") === "radio")).toBe(
      true,
    );
    expect(estrelas.some((b) => b.hasAttribute("aria-pressed"))).toBe(false);
    expect(
      hospedeiro
        .querySelector('[role="radiogroup"]')
        ?.getAttribute("aria-label"),
    ).toBe("Sua nota de satisfação");
    // 24 px da estrela + 2x10 px de respiro = 44 px; a margem negativa
    // devolve o espaço, então o desenho não anda.
    for (const b of estrelas) {
      expect(b.className).toContain("p-2.5");
      expect(b.className).toContain("-m-2");
    }
  });

  async function montar(initialRating?: number) {
    const { ReviewForm } = await import("@/components/ui/custom/ReviewForm");
    await act(async () => {
      raiz.render(<ReviewForm productId="p-1" initialRating={initialRating} />);
    });
    return () => [
      ...hospedeiro.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ];
  }

  function tecla(el: HTMLElement, key: string) {
    return act(async () => {
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });
  }

  it("Tab entra na estrela marcada (as outras ficam fora da ordem de Tab)", async () => {
    const estrelas = await montar(4);
    expect(estrelas().map((b) => b.tabIndex)).toEqual([-1, -1, -1, 0, -1]);
  });

  it("sem nota, Tab entra na primeira estrela", async () => {
    const estrelas = await montar();
    expect(estrelas().map((b) => b.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    expect(
      estrelas().every((b) => b.getAttribute("aria-checked") === "false"),
    ).toBe(true);
  });

  it("setas trocam a nota e levam o foco junto; param nas pontas", async () => {
    const estrelas = await montar(3);
    await tecla(estrelas()[2], "ArrowRight");
    expect(estrelas()[3].getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(estrelas()[3]);

    await tecla(estrelas()[3], "ArrowDown");
    expect(estrelas()[2].getAttribute("aria-checked")).toBe("true");

    await tecla(estrelas()[2], "End");
    expect(estrelas()[4].getAttribute("aria-checked")).toBe("true");
    await tecla(estrelas()[4], "ArrowRight");
    expect(estrelas()[4].getAttribute("aria-checked")).toBe("true");

    await tecla(estrelas()[4], "Home");
    expect(estrelas()[0].getAttribute("aria-checked")).toBe("true");
    await tecla(estrelas()[0], "ArrowLeft");
    expect(estrelas()[0].getAttribute("aria-checked")).toBe("true");
  });

  it("tocar numa estrela marca só ela; outra tecla qualquer não mexe na nota", async () => {
    const estrelas = await montar(2);
    await act(async () => {
      estrelas()[4].click();
    });
    expect(estrelas().map((b) => b.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "false",
      "false",
      "true",
    ]);
    await tecla(estrelas()[4], "a");
    expect(estrelas()[4].getAttribute("aria-checked")).toBe("true");
  });
});
