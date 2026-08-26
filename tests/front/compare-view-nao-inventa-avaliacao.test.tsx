// @vitest-environment jsdom
//
// LOJA-01 (auditoria 26/08/2026): a linha "Avaliação" da tela de comparação
// decidia estrela-vs-"Sem avaliações" checando `product.rating` (truthy).
// Como `produtos.rating` nasce com `DEFAULT 5` e nunca é recalculado, esse
// campo é sempre verdadeiro -- então TODO produto caía no ramo da estrela,
// mesmo sem uma avaliação sequer, e `getBestValue("rating")` sempre achava
// um "melhor" mesmo comparando dois produtos nunca avaliados.
//
// A correção troca o critério para `reviewCount > 0`, que é o que
// realmente diz se existe avaliação por trás do número.
//
// POR QUE RENDER DE VERDADE, NÃO DUBLÊ: mesmo raciocínio de
// compare-view-gate-avaliacoes.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    // Flag sempre LIGADO -- este arquivo prova outro eixo (reviewCount), já
    // coberto separadamente por compare-view-gate-avaliacoes.test.tsx.
    config: { enableReviews: true },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produtoNuncaAvaliado: Product = {
  id: "prod-nunca-avaliado",
  name: "Produto Nunca Avaliado",
  description: "",
  price: 100,
  images: [],
  category: "geral",
  stock: 10,
  sold: 3,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  // DEFAULT do banco -- nenhuma avaliação por trás.
  rating: 5,
  reviewCount: 0,
};

const produtoAvaliado: Product = {
  ...produtoNuncaAvaliado,
  id: "prod-avaliado",
  name: "Produto Avaliado",
  rating: 3.2,
  reviewCount: 4,
};

describe("CompareView — não inventa avaliação sem reviewCount (LOJA-01)", () => {
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

  it("dois produtos nunca avaliados: a linha 'Avaliação' mostra 'Sem avaliações' nos dois, sem estrela nenhuma", async () => {
    const outroNuncaAvaliado: Product = {
      ...produtoNuncaAvaliado,
      id: "prod-nunca-avaliado-2",
      name: "Produto Nunca Avaliado 2",
    };
    const { CompareView } = await import("@/views/customer/CompareView");

    await act(async () => {
      raiz.render(
        <CompareView
          products={[produtoNuncaAvaliado, outroNuncaAvaliado]}
          onNavigate={() => {}}
          onRemoveProduct={() => {}}
          onClearAll={() => {}}
          onProductClick={() => {}}
        />,
      );
    });

    expect(hospedeiro.querySelectorAll("svg.lucide-star").length).toBe(0);
    // A linha continua na tabela (não é o gate do flag, que apaga a linha
    // inteira) -- só o CONTEÚDO da célula é honesto.
    expect(hospedeiro.textContent).toContain("Avaliação");
    expect(hospedeiro.textContent).toContain("Sem avaliações");
    expect(hospedeiro.textContent).not.toContain("5.0/5");
  });

  it("um avaliado e um não: só o avaliado mostra estrela; o não avaliado mostra 'Sem avaliações'", async () => {
    const { CompareView } = await import("@/views/customer/CompareView");

    await act(async () => {
      raiz.render(
        <CompareView
          products={[produtoNuncaAvaliado, produtoAvaliado]}
          onNavigate={() => {}}
          onRemoveProduct={() => {}}
          onClearAll={() => {}}
          onProductClick={() => {}}
        />,
      );
    });

    expect(hospedeiro.querySelectorAll("svg.lucide-star").length).toBe(5);
    expect(hospedeiro.textContent).toContain("3.2/5");
    expect(hospedeiro.textContent).toContain("Sem avaliações");
  });

  it("os dois produtos avaliados: comportamento de hoje preservado (estrelas nos dois, sem 'Sem avaliações')", async () => {
    const outroAvaliado: Product = {
      ...produtoAvaliado,
      id: "prod-avaliado-2",
      name: "Produto Avaliado 2",
      rating: 4.5,
      reviewCount: 12,
    };
    const { CompareView } = await import("@/views/customer/CompareView");

    await act(async () => {
      raiz.render(
        <CompareView
          products={[produtoAvaliado, outroAvaliado]}
          onNavigate={() => {}}
          onRemoveProduct={() => {}}
          onClearAll={() => {}}
          onProductClick={() => {}}
        />,
      );
    });

    expect(hospedeiro.querySelectorAll("svg.lucide-star").length).toBe(10);
    expect(hospedeiro.textContent).not.toContain("Sem avaliações");
  });
});
