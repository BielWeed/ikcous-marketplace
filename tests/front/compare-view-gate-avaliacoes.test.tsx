// @vitest-environment jsdom
//
// Issue #202 (ADMIN-091): a tela de comparação continuava mostrando a linha
// "Avaliação" (estrelas + "4.5/5") mesmo com `store_config.enable_reviews =
// false`. A linha inteira some quando desligado -- não só o ícone de
// estrela, senão o texto "4.5/5" continuaria publicando a nota.
//
// POR QUE RENDER DE VERDADE (react-dom/client + jsdom), NÃO DUBLÊ DE REACT:
// mesmo raciocínio de product-view-gate-avaliacoes.test.tsx. CompareView não
// tem dependência de observers/carousel, então não precisa de stubs extras.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

let enableReviews = true;
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produtoA: Product = {
  id: "prod-a",
  name: "Produto A",
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
  rating: 4.5,
  reviewCount: 12,
};

const produtoB: Product = {
  ...produtoA,
  id: "prod-b",
  name: "Produto B",
  rating: 3.2,
  reviewCount: 4,
};

describe("CompareView — gate do interruptor de Avaliações (ADMIN-091, #202)", () => {
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
    enableReviews = true;
  });

  it("com o flag DESLIGADO, a linha 'Avaliação' inteira some (nem estrela, nem '4.5/5')", async () => {
    enableReviews = false;
    const { CompareView } = await import("@/views/customer/CompareView");

    await act(async () => {
      raiz.render(
        <CompareView
          products={[produtoA, produtoB]}
          onNavigate={() => {}}
          onRemoveProduct={() => {}}
          onClearAll={() => {}}
          onProductClick={() => {}}
        />,
      );
    });

    expect(hospedeiro.textContent).not.toContain("Avaliação");
    expect(hospedeiro.textContent).not.toContain("4.5/5");
    expect(hospedeiro.querySelectorAll("svg.lucide-star").length).toBe(0);
    // As outras linhas da tabela continuam (nenhum buraco na comparação).
    expect(hospedeiro.textContent).toContain("Preço");
    expect(hospedeiro.textContent).toContain("Estoque");
  });

  it("com o flag LIGADO, a linha 'Avaliação' continua exatamente como hoje", async () => {
    enableReviews = true;
    const { CompareView } = await import("@/views/customer/CompareView");

    await act(async () => {
      raiz.render(
        <CompareView
          products={[produtoA, produtoB]}
          onNavigate={() => {}}
          onRemoveProduct={() => {}}
          onClearAll={() => {}}
          onProductClick={() => {}}
        />,
      );
    });

    expect(hospedeiro.textContent).toContain("Avaliação");
    expect(hospedeiro.textContent).toContain("4.5/5");
    expect(
      hospedeiro.querySelectorAll("svg.lucide-star").length,
    ).toBeGreaterThan(0);
  });
});
