// @vitest-environment jsdom
//
// StarRating é exibição por padrão (LOJA-01). O que o teste de exibição
// (star-rating-exibicao-nao-e-clicavel) prova é o ASPECTO (sem cursor de
// clique, sem hover de campo). Faltava provar o COMPORTAMENTO: em modo de
// exibição, tocar numa estrela NÃO pode chamar `onRatingChange`, mesmo que o
// chamador tenha passado o callback (ProductCard, PremiumOffers e ProductView
// renderizam avaliação pura, e um clique ali só abre o produto). Medido por
// mutação: tirar a guarda `!readonly` do clique não derrubava teste algum.
// O caminho de campo de nota de verdade (`readonly={false}`) também fica
// provado: cada estrela devolve o SEU número, de 1 até `maxRating`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StarRating } from "@/components/ui/custom/StarRating";

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

const estrelas = () => [...hospedeiro.querySelectorAll("svg")];

async function tocarNaEstrela(numero: number) {
  await act(async () => {
    estrelas()[numero - 1].dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
  });
}

describe("StarRating — o toque só troca a nota quando é campo de nota", () => {
  it("em exibição (padrão), tocar numa estrela não chama o callback", async () => {
    const aoTrocar = vi.fn<(nota: number) => void>();
    await act(async () => {
      raiz.render(<StarRating rating={3} onRatingChange={aoTrocar} />);
    });

    await tocarNaEstrela(5);

    expect(aoTrocar).not.toHaveBeenCalled();
  });

  it("com readonly explícito, também não chama", async () => {
    const aoTrocar = vi.fn<(nota: number) => void>();
    await act(async () => {
      raiz.render(<StarRating rating={3} readonly onRatingChange={aoTrocar} />);
    });

    await tocarNaEstrela(1);

    expect(aoTrocar).not.toHaveBeenCalled();
  });

  it("como campo de nota (readonly={false}), cada estrela devolve o seu número", async () => {
    const aoTrocar = vi.fn<(nota: number) => void>();
    await act(async () => {
      raiz.render(
        <StarRating rating={3} readonly={false} onRatingChange={aoTrocar} />,
      );
    });

    for (const numero of [1, 2, 3, 4, 5]) await tocarNaEstrela(numero);

    expect(aoTrocar.mock.calls.map(([nota]) => nota)).toEqual([1, 2, 3, 4, 5]);
  });

  it("campo de nota sem callback não quebra ao tocar", async () => {
    await act(async () => {
      raiz.render(<StarRating rating={2} readonly={false} />);
    });

    await expect(tocarNaEstrela(4)).resolves.toBeUndefined();
  });

  it("maxRating customizado desenha e devolve até o seu último número", async () => {
    const aoTrocar = vi.fn<(nota: number) => void>();
    await act(async () => {
      raiz.render(
        <StarRating
          rating={1}
          maxRating={3}
          readonly={false}
          onRatingChange={aoTrocar}
        />,
      );
    });

    expect(estrelas()).toHaveLength(3);
    await tocarNaEstrela(3);

    expect(aoTrocar).toHaveBeenCalledExactlyOnceWith(3);
  });
});
