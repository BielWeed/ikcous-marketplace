// @vitest-environment jsdom
//
// Laudo de acessibilidade 05/09 — onda 1, item M8: a nota (ex.: "4,5")
// nunca era falada; as estrelas do StarRating são desenho puro, e "é bem
// avaliado?" ficava sem resposta para leitor de tela em TODOS os usos
// (ProductCard, PremiumOffers, ProductView, ReviewCard, UserProfileView).
// A correção é NO COMPONENTE — texto sr-only com a nota em pt-BR junto a
// estrelas aria-hidden — então este render prova os seis usos de uma vez.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StarRating } from "@/components/ui/custom/StarRating";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("StarRating — a nota é falada (laudo 05/09, M8)", () => {
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

  function montar(props: React.ComponentProps<typeof StarRating>) {
    act(() => {
      raiz.render(<StarRating {...props} />);
    });
  }

  it('meio ponto vira "4,5 de 5" (vírgula, pt-BR), escondido do visual', () => {
    montar({ rating: 4.5 });
    const falado = hospedeiro.querySelector(".sr-only");
    expect(falado?.textContent).toBe("4,5 de 5");
  });

  it('nota inteira vira "4 de 5", sem vírgula fantasma', () => {
    montar({ rating: 4 });
    const falado = hospedeiro.querySelector(".sr-only");
    expect(falado?.textContent).toBe("4 de 5");
  });

  it("maxRating customizado entra na frase falada", () => {
    montar({ rating: 7, maxRating: 10 });
    const falado = hospedeiro.querySelector(".sr-only");
    expect(falado?.textContent).toBe("7 de 10");
  });

  it("as estrelas em si ficam mudas (aria-hidden) para o leitor", () => {
    montar({ rating: 3 });
    const estrelas = hospedeiro.querySelector('[aria-hidden="true"]');
    expect(estrelas).not.toBeNull();
    // o bloco mudo é quem carrega os SVGs das estrelas
    expect(estrelas?.querySelectorAll("svg").length).toBe(5);
  });
});
