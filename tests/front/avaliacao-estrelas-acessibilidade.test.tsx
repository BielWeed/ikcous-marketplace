// @vitest-environment jsdom
//
// Caça 8 (26/10/2026), item 3: as estrelas de nota eram botões mudos (o leitor
// de tela dizia só "botão") e com ~28 px de toque. Cada uma agora diz a nota,
// informa se está marcada e tem alvo de 44 px sem mudar o tamanho da estrela.
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
    expect(estrelas.map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "true",
      "true",
      "true",
      "false",
      "false",
    ]);
    // 24 px da estrela + 2x10 px de respiro = 44 px; a margem negativa
    // devolve o espaço, então o desenho não anda.
    for (const b of estrelas) {
      expect(b.className).toContain("p-2.5");
      expect(b.className).toContain("-m-2");
    }
  });
});
