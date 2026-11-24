// @vitest-environment jsdom
//
// O teclado das estrelas de nota (ReviewForm, grupo de opções) tem SEIS teclas
// de navegação, e os testes de avaliacao-estrelas-acessibilidade só exercitam
// quatro delas para o lado que importa: ArrowRight sobe, ArrowDown desce,
// Home e End vão às pontas. Medido por mutação: apagar a seta para CIMA, ou a
// seta para a ESQUERDA, não derrubava teste nenhum (a esquerda só era tocada
// na ponta, onde "não faz nada" e "some" parecem iguais).
//
// Aqui cada seta é provada no MEIO da escala, onde subir/descer é visível, e
// as teclas de navegação não podem deixar a página rolar (preventDefault),
// enquanto qualquer outra tecla passa livre. O campo de comentário também
// carrega o teto do banco (CHECK de 1000) como atributo, que é o que segura a
// digitação e o texto colado.
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

async function montar(initialRating?: number) {
  const { ReviewForm } = await import("@/components/ui/custom/ReviewForm");
  await act(async () => {
    raiz.render(<ReviewForm productId="p-1" initialRating={initialRating} />);
  });
  return () => [
    ...hospedeiro.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  ];
}

/** Aperta a tecla e devolve se o navegador foi impedido de rolar a página. */
async function tecla(el: HTMLElement, key: string): Promise<boolean> {
  const evento = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    el.dispatchEvent(evento);
  });
  return evento.defaultPrevented;
}

const marcada = (estrelas: HTMLButtonElement[]): number =>
  estrelas.findIndex((b) => b.getAttribute("aria-checked") === "true") + 1;

describe("ReviewForm — cada tecla de navegação das estrelas", () => {
  it.each([
    ["ArrowUp", 3, 4],
    ["ArrowRight", 3, 4],
    ["ArrowDown", 3, 2],
    ["ArrowLeft", 3, 2],
    ["Home", 3, 1],
    ["End", 3, 5],
  ])(
    "%s na nota %i leva à nota %i, com o foco junto",
    async (key, de, para) => {
      const estrelas = await montar(de);

      await tecla(estrelas()[de - 1], key);

      expect(marcada(estrelas())).toBe(para);
      expect(document.activeElement).toBe(estrelas()[para - 1]);
    },
  );

  it.each([
    ["ArrowUp", 5, 5],
    ["ArrowRight", 5, 5],
    ["ArrowDown", 1, 1],
    ["ArrowLeft", 1, 1],
  ])("%s na ponta (nota %i) fica na nota %i", async (key, de, para) => {
    const estrelas = await montar(de);

    await tecla(estrelas()[de - 1], key);

    expect(marcada(estrelas())).toBe(para);
  });

  it("as teclas de navegação seguram a rolagem da página; as outras passam livres", async () => {
    const estrelas = await montar(3);

    for (const key of [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
    ]) {
      const botao = estrelas()[marcada(estrelas()) - 1];
      expect(await tecla(botao, key), key).toBe(true);
    }

    for (const key of ["a", "Tab", "Enter", "PageUp"]) {
      const botao = estrelas()[marcada(estrelas()) - 1];
      expect(await tecla(botao, key), key).toBe(false);
    }
  });

  it("o campo de comentário segura a digitação no teto de 1000 do banco", async () => {
    await montar();

    const campo = hospedeiro.querySelector("textarea");

    expect(campo?.maxLength).toBe(1000);
    expect(
      hospedeiro.querySelector("[data-testid=contador-comentario]")
        ?.textContent,
    ).toBe("0/1000");
  });
});
