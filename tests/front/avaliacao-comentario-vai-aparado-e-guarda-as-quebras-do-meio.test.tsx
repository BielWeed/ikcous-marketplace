// @vitest-environment jsdom
//
// Prova de mutação (24/11/2026): trocar `values.comment.trim()` por
// `values.comment` em `ReviewForm.onSubmit` não derrubava nenhum teste — os
// testes vizinhos só mandam comentário VAZIO ou só de espaços. Um comentário
// real com espaço e linha em branco nas pontas (colado de outro app, ou o
// "Enter" a mais no fim) ia assim para o banco e para a vitrine da loja.
// O miolo (inclusive a quebra de linha entre dois parágrafos) não se mexe.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const addReview = vi.fn();

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({ addReview }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  addReview.mockReset();
  addReview.mockResolvedValue({ id: "r-1" });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function enviarComComentario(comentario: string) {
  const { ReviewForm } = await import("@/components/ui/custom/ReviewForm");
  await act(async () => {
    raiz.render(<ReviewForm productId="p-1" initialRating={5} />);
  });
  const area = hospedeiro.querySelector("textarea") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(area, comentario);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    hospedeiro
      .querySelector<HTMLButtonElement>('button[type="submit"]')
      ?.click();
  });
}

it("comentário com espaço e linha em branco nas pontas vai aparado", async () => {
  await enviarComComentario("  \n Chegou rápido e bem embalado.  \n\n");

  expect(addReview).toHaveBeenCalledTimes(1);
  expect(addReview).toHaveBeenCalledWith({
    productId: "p-1",
    rating: 5,
    comment: "Chegou rápido e bem embalado.",
  });
});

it("limite: a quebra de linha do MEIO fica como a cliente escreveu", async () => {
  await enviarComComentario(" Gostei muito.\n\nVoltarei a comprar. ");

  expect(addReview).toHaveBeenCalledWith({
    productId: "p-1",
    rating: 5,
    comment: "Gostei muito.\n\nVoltarei a comprar.",
  });
});
