// @vitest-environment jsdom
//
// Vitrine da cliente, dois ajustes de classe (o desenho continua o mesmo):
//  - alvos de toque de 44 px: botão do card de produto ("Carrinho" / "Escolher
//    opções"), "Adicionar"/"Comprar" das ofertas e "Útil" da avaliação eram de
//    ~29 a ~35 px; a área de toque cresce por dentro (`min-h-11`);
//  - texto de 10 px em cinza claro (zinc-400, ~2,5:1) vira zinc-600 (AA):
//    data da avaliação, títulos da busca e o aviso da imagem.
import { readFileSync } from "node:fs";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductCard } from "@/components/ui/custom/ProductCard";
import { ReviewCard } from "@/components/ui/custom/ReviewCard";
import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const produto: Product = {
  id: "prod-toque",
  name: "Camiseta Lisa",
  description: "",
  price: 50,
  images: ["https://example.com/img.png"],
  category: "roupas",
  stock: 40,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  rating: 5,
  reviewCount: 0,
};

const fonte = (caminho: string) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do próprio repositório
  readFileSync(caminho, "utf-8");

describe("vitrine — alvos de toque de 44 px e texto miúdo legível", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: false,
      media: consulta,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.doUnmock("@/contexts/StoreContext");
  });

  it("botão do card de produto tem min-h-11", async () => {
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={() => {}}
          priority
          showRating={false}
        />,
      );
    });
    const botao = hospedeiro.querySelector(
      '[data-testid="product-card-action"]',
    );
    expect(botao).not.toBeNull();
    expect(botao?.className).toContain("min-h-11");
  });

  it("'Adicionar' e 'Comprar' das ofertas têm min-h-11", async () => {
    vi.doMock("@/contexts/StoreContext", () => ({
      useStore: () => ({
        config: { enableReviews: false, freeShippingMin: 0 },
      }),
    }));
    const { PremiumOffers } = await import(
      "@/components/ui/custom/PremiumOffers"
    );
    await act(async () => {
      raiz.render(
        <PremiumOffers
          products={[{ ...produto, originalPrice: 80 }]}
          favorites={[]}
          onToggleFavorite={vi.fn()}
          onProductClick={vi.fn()}
          onAddToCart={vi.fn()}
          onQuickBuy={vi.fn()}
        />,
      );
    });
    const doTexto = (texto: string) =>
      Array.from(hospedeiro.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === texto,
      );
    expect(doTexto("Adicionar")?.className).toContain("min-h-11");
    expect(doTexto("Comprar")?.className).toContain("min-h-11");
  });

  it("'Útil' da avaliação tem min-h-11 e a data é zinc-600", async () => {
    await act(async () => {
      raiz.render(
        <ReviewCard
          review={{
            id: "a",
            productId: "p",
            customerName: "Ana",
            rating: 5,
            comment: "",
            helpful: 2,
            verified: true,
            createdAt: "2026-10-01T12:00:00Z",
          }}
        />,
      );
    });
    const util = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Útil"),
    );
    expect(util?.className).toContain("min-h-11");
    const data = Array.from(hospedeiro.querySelectorAll("span")).find(
      (s) =>
        s.className.includes("text-[10px]") &&
        /\d{2}\/\d{2}\/\d{4}|\d{1,2} de /.test(s.textContent ?? ""),
    );
    expect(data).toBeDefined();
    expect(data?.className).toContain("text-zinc-600");
    expect(data?.className).not.toContain("text-zinc-400");
  });

  it("o esqueleto das ofertas reserva os mesmos 44 px dos botões", () => {
    const home = fonte("src/views/customer/HomeView.tsx");
    expect(home).not.toContain("h-[35px]");
  });

  it.each([
    ["src/components/ui/custom/SearchBar.tsx", 3],
    ["src/views/customer/SearchView.tsx", 3],
    ["src/components/LazyImage.tsx", 1],
  ])(
    "%s: nenhum texto de 10 px em zinc-400 nos títulos",
    (caminho, trocados) => {
      const linhas = fonte(caminho).split("\n");
      const miudosClaros = linhas.filter(
        (l) => l.includes("text-[10px]") && /(?<![\w:-])text-zinc-400/.test(l),
      );
      expect(miudosClaros).toEqual([]);
      const miudosLegiveis = linhas.filter(
        (l) => l.includes("text-[10px]") && l.includes("text-zinc-600"),
      );
      expect(miudosLegiveis.length).toBeGreaterThanOrEqual(trocados);
    },
  );
});
