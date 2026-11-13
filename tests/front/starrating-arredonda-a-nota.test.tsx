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

  // 13/11/2026: o catálogo recebe a média JÁ arredondada a 1 casa pela view
  // (`round(avg, 1)`) e a ficha do produto recebe a média cheia. Com 5 notas 5
  // e 6 notas 4 (4,4545...) o catálogo mostrava 5 estrelas e a ficha, que diz
  // "4,5", pintava 4. As estrelas saem do MESMO número que a tela exibe: a
  // média arredondada a 1 casa.
  it("média cheia 4,4545 (a ficha) pinta as mesmas 5 estrelas que o 4,5 do catálogo", () => {
    const media = (5 * 5 + 6 * 4) / 11;
    expect(media).toBeCloseTo(4.4545, 3);
    expect(pintadas(media)).toBe(5);
    expect(hospedeiro.querySelector(".sr-only")?.textContent).toBe("4,5 de 5");
    expect(pintadas(Math.round(media * 10) / 10)).toBe(5);
  });

  it("valores limite da média: 4,44 pinta 4; 4,45, 4,5 e 4,95 pintam 5; 0 e 5 não mudam", () => {
    expect(pintadas(4.44)).toBe(4);
    expect(pintadas(4.45)).toBe(5);
    expect(pintadas(4.5)).toBe(5);
    expect(pintadas(4.95)).toBe(5);
    expect(pintadas(0)).toBe(0);
    expect(pintadas(5)).toBe(5);
  });

  it("3,45 (arredonda a 3,5 na tela) pinta 4; 3,44 (3,4) pinta 3", () => {
    expect(pintadas(3.45)).toBe(4);
    expect(pintadas(3.44)).toBe(3);
  });

  it("a nota falada segue exata (4,9 de 5), sem arredondar", () => {
    pintadas(4.9);
    expect(hospedeiro.querySelector(".sr-only")?.textContent).toBe("4,9 de 5");
  });
});
