// @vitest-environment jsdom
//
// Defeito carrinho-checkout-1, lado da VITRINE: o card (folha "Escolher
// opções") também entregava ao carrinho só o id da primeira escolha
// (`selecionadasObjs[0]?.id`) de um produto de cadastro antigo, com a cor e o
// tamanho em linhas separadas de product_variants. Agora entrega a chave das
// duas escolhas, na ordem do cadastro. Produto de UM grupo segue com o id puro.
// Modelo estrutural copiado de product-card-escolhe-opcoes-na-folha.test.tsx.
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

const doisGrupos = () => [
  variante("vc-azul", "Cor", "Azul", 5),
  variante("vc-rosa", "Cor", "Rosa", 5),
  variante("vt-p", "Tamanho", "P", 4),
  variante("vt-m", "Tamanho", "M", 2),
];

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

describe("ProductCard — cor e tamanho de cadastro antigo viram UMA combinação no carrinho", () => {
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

  const folha = () =>
    document.querySelector<HTMLDivElement>(
      '[data-testid="product-card-options-sheet"]',
    )!;
  const cta = () =>
    document.querySelector<HTMLButtonElement>(
      'button[data-testid="product-card-options-add"]',
    )!;
  const chip = (texto: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) =>
        b.getAttribute("aria-label") === texto ||
        b.textContent?.trim() === texto,
    )!;
  const linha = (nome: string) =>
    Array.from(
      folha().querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
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

  it("Azul (pré-escolhida) + M entrega a chave das duas escolhas e os dois nomes", async () => {
    await renderizarCard(camiseta(doisGrupos()));
    await abrirFolha();
    await act(async () => chip("M").click());
    await act(async () => cta().click());

    expect(entregar).toHaveBeenCalledTimes(1);
    expect(entregar.mock.calls[0].slice(1)).toEqual([
      "vc-azul~vt-m",
      "Cor: Azul, Tamanho: M",
      1,
    ]);
  });

  it("trocar a cor muda a combinação: Rosa + P é outra chave", async () => {
    await renderizarCard(camiseta(doisGrupos()));
    await abrirFolha();
    await act(async () => chip("P").click());
    await act(async () => linha("Cor").click());
    await act(async () => chip("Rosa").click());
    await act(async () => cta().click());

    expect(entregar.mock.calls[0].slice(1)).toEqual([
      "vc-rosa~vt-p",
      "Cor: Rosa, Tamanho: P",
      1,
    ]);
  });

  it("produto com UM grupo só segue entregando o id puro", async () => {
    await renderizarCard(
      camiseta([
        variante("vt-p", "Tamanho", "P", 4),
        variante("vt-m", "Tamanho", "M", 2),
      ]),
    );
    await abrirFolha();
    await act(async () => chip("M").click());
    await act(async () => cta().click());

    expect(entregar.mock.calls[0].slice(1)).toEqual(["vt-m", "Tamanho: M", 1]);
  });
});
