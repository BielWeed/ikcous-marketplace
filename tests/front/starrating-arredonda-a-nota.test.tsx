// @vitest-environment jsdom
//
// Caça 30 (06/11/2026): a nota 4,6 a 4,9 aparecia com só 4 estrelas pintadas
// (`starValue <= rating` arredondava sempre para baixo), então uma nota "4,9"
// parecia pior do que é. As estrelas arredondam para o inteiro mais próximo:
// 4,5 a 4,9 pintam 5, 4,4 pinta 4. A nota falada (sr-only) segue exata.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StarRating } from "@/components/ui/custom/StarRating";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("StarRating — a nota arredonda ao inteiro mais próximo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  function pintadas(rating: number): number {
    act(() => {
      raiz.render(<StarRating rating={rating} />);
    });
    return hospedeiro.querySelectorAll("svg.fill-yellow-400").length;
  }

  it("4,9 pinta 5 estrelas", () => {
    expect(pintadas(4.9)).toBe(5);
  });

  it("4,6 pinta 5 estrelas", () => {
    expect(pintadas(4.6)).toBe(5);
  });

  it("4,4 continua pintando 4 estrelas", () => {
    expect(pintadas(4.4)).toBe(4);
  });

  it("nota inteira não muda: 3 pinta 3, 0 pinta nenhuma", () => {
    expect(pintadas(3)).toBe(3);
    expect(pintadas(0)).toBe(0);
  });

  it("a nota falada segue exata (4,9 de 5), sem arredondar", () => {
    pintadas(4.9);
    expect(hospedeiro.querySelector(".sr-only")?.textContent).toBe("4,9 de 5");
  });
});
