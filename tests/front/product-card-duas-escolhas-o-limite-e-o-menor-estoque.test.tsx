// @vitest-environment jsdom
//
// Produto de cadastro antigo (cor e tamanho em linhas separadas de
// `product_variants`): levar "Azul + M" precisa de azul E de M. O que a cliente
// pode levar é o MENOR dos dois estoques, e o seletor de quantidade da folha do
// card tem de parar aí -- nem no maior, nem no último que ela tocou.
//
// Mutação medida (`Math.min(...selecionadasObjs...)` -> `Math.max(...)` em
// `ProductCard.tsx`): `product-card-duas-escolhas-separadas`,
// `product-card-escolhe-opcoes-na-folha` e `card-marca-sozinho-a-opcao-unica`
// ficavam verdes (os 74 testes). Com o máximo, o "+" deixava a cliente pedir 5
// de uma combinação que tem 2, e a folha entregava ao carrinho a quantidade que
// ela mesma não conseguiria comprar.
// Modelo estrutural copiado de product-card-duas-escolhas-separadas.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    message: vi.fn(),
    custom: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const variante = (
  id: string,
  name: string,
  value: string,
  stockIncrement: number,
): ProductVariant => ({
  id,
  productId: "prod-camiseta",
  name,
  value,
  stockIncrement,
  active: true,
});

const camiseta = (variants: ProductVariant[]): Product => ({
  id: "prod-camiseta",
  name: "Camiseta",
  description: "Descrição de teste",
  price: 50,
  images: ["https://example.com/img.png"],
  category: "roupas",
  stock: 16,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  rating: 4.5,
  reviewCount: 12,
  variants,
});

describe("ProductCard — com cor e tamanho separados, o limite da folha é o MENOR estoque", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let entregar: ReturnType<
    typeof vi.fn<
      (
        product: Product,
        variantId: string | undefined,
        variantNames: string,
        quantity?: number,
      ) => void
    >
  >;

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
    entregar =
      vi.fn<
        (
          product: Product,
          variantId: string | undefined,
          variantNames: string,
          quantity?: number,
        ) => void
      >();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizarCard(produto: Product) {
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={vi.fn()}
          showRating={false}
          onAddToCartWithVariants={entregar}
        />,
      );
    });
  }

  const cta = () =>
    document.querySelector<HTMLButtonElement>(
      'button[data-testid="product-card-options-add"]',
    )!;
  const chip = (texto: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) =>
        b.getAttribute("aria-label") === texto ||
        // Opção com a última unidade se anuncia "Rosa, última unidade".
        b
          .getAttribute("aria-label")
          ?.startsWith(`${texto}, `) ||
        b.textContent?.trim() === texto,
    )!;
  const mais = () =>
    document.querySelector<HTMLButtonElement>(
      'button[aria-label="Aumentar quantidade"]',
    )!;
  // O número vigente é o ÚLTIMO span (o número animado deixa os antigos no DOM
  // do jsdom, sem timers) -- mesma leitura de product-card-escolhe-opcoes-na-folha.
  const numeroDaQuantidade = () => {
    const spans = document.querySelectorAll<HTMLElement>(
      '[aria-live="polite"] span',
    );
    return spans[spans.length - 1]!.textContent!.trim();
  };
  const linha = (nome: string) =>
    Array.from(
      document.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
    ).find((b) => b.getAttribute("aria-label")?.startsWith(`${nome}:`))!;

  async function abrirFolha() {
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>(
          'button[data-testid="product-card-action"]',
        )!
        .click();
    });
  }

  // [cor, tamanho, estoque da cor, estoque do tamanho, o menor dos dois]
  it.each([
    ["Azul", "M", 5, 2, 2],
    ["Azul", "P", 5, 4, 4],
    ["Rosa", "M", 1, 2, 1],
  ])(
    "%s + %s (cor %i, tamanho %i): o '+' para em %i e a folha entrega essa quantidade",
    async (cor, tamanho, estoqueDaCor, estoqueDoTamanho, menor) => {
      const variantes = [
        variante("vc-azul", "Cor", "Azul", cor === "Azul" ? estoqueDaCor : 5),
        variante("vc-rosa", "Cor", "Rosa", cor === "Rosa" ? estoqueDaCor : 5),
        variante(
          "vt-p",
          "Tamanho",
          "P",
          tamanho === "P" ? estoqueDoTamanho : 4,
        ),
        variante(
          "vt-m",
          "Tamanho",
          "M",
          tamanho === "M" ? estoqueDoTamanho : 2,
        ),
      ];
      await renderizarCard(camiseta(variantes));
      await abrirFolha();
      await act(async () => chip(tamanho).click());
      // A fileira de cor pode estar recolhida depois de escolher o tamanho.
      if (!chip(cor)) await act(async () => linha("Cor").click());
      await act(async () => chip(cor).click());

      // Toca no "+" até travar: ele TEM de travar no menor dos dois estoques.
      for (
        let i = 0;
        i < menor + 3 && mais().getAttribute("aria-disabled") !== "true";
        i++
      ) {
        await act(async () => mais().click());
      }
      expect(mais().getAttribute("aria-disabled")).toBe("true");
      expect(numeroDaQuantidade()).toBe(String(menor));

      await act(async () => cta().click());
      expect(entregar).toHaveBeenCalledTimes(1);
      expect(entregar.mock.calls[0]?.[3]).toBe(menor);
    },
  );
});
