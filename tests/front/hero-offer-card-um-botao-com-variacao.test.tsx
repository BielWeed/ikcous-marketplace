// @vitest-environment jsdom
//
// Decisão do Gabriel (27/09/2026, testando o preview): o carrossel "Ofertas
// Imperdíveis" (HeroOfferCard, dentro de PremiumOffers.tsx) mostrava DOIS
// botões com o MESMO rótulo "ESCOLHER OPÇÕES" quando o produto tem variação
// ativa -- o principal (preto, com ícone de carrinho) e o secundário
// (claro), os dois abrindo a MESMA tela do produto (ver comentário do
// código, HeroOfferCard.tsx ~266-269: os dois já tinham sido consertados
// para redirecionar, mas ninguém tirou a duplicata visual). Decisão: com
// variação ativa, mostra SÓ o botão principal; sem variação, continuam os
// dois de sempre ("Adicionar" + "Comprar").
//
// POR QUE RENDER DE VERDADE (react-dom/client + jsdom), NÃO DUBLÊ DE REACT:
// mesmo raciocínio de card-nao-deixa-comprar-sem-escolher-a-variacao.test.tsx
// -- fixture e helpers de botão copiados de lá (mesmo componente, mesmo
// container de CTAs).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant, StoreConfig } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mockConfig: Partial<StoreConfig> = {};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig }),
}));

vi.mock("@/contexts/CartContext", () => ({
  useCartContext: () => ({ cartTotal: 0 }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "cliente-teste" } }),
}));

function criarVariantes(ativas: boolean): ProductVariant[] {
  return [
    {
      id: "var-p",
      productId: "prod-camiseta",
      name: "Tamanho",
      value: "P",
      stockIncrement: 5,
      active: ativas,
    },
    {
      id: "var-m",
      productId: "prod-camiseta",
      name: "Tamanho",
      value: "M",
      stockIncrement: 5,
      active: ativas,
    },
  ];
}

function criarProduto(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-camiseta",
    name: "Camiseta",
    description: "Descrição de teste",
    price: 50,
    originalPrice: 80,
    images: ["https://example.com/img.png"],
    category: "roupas",
    stock: 10,
    sold: 3,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    rating: 4.5,
    reviewCount: 12,
    ...overrides,
  };
}

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("HeroOfferCard -- com variação ativa, some o segundo botão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    mockConfig = { freeShippingMin: 350, enableReviews: false };
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
  });

  async function renderizarOfertas(produto: Product) {
    const { PremiumOffers } = await import(
      "@/components/ui/custom/PremiumOffers"
    );
    await act(async () => {
      raiz.render(
        <PremiumOffers
          products={[produto]}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onAddToCart={() => {}}
          onQuickBuy={() => {}}
        />,
      );
    });
  }

  // Mesmo container que card-nao-deixa-comprar-sem-escolher-a-variacao.test.tsx
  // usa para o HeroOfferCard: a `div.flex.gap-2` que TEM botões dentro (a
  // outra, mais acima, é a linha de categoria/frete grátis).
  function containerDeCtas(hospedeiroEl: HTMLElement): HTMLDivElement {
    return Array.from(
      hospedeiroEl.querySelectorAll<HTMLDivElement>(".flex.gap-2"),
    ).find((d) => d.querySelector("button"))!;
  }

  it("com variação ativa: só UM botão ('Escolher opções')", async () => {
    const produto = criarProduto({ variants: criarVariantes(true) });

    await renderizarOfertas(produto);

    const botoes = containerDeCtas(hospedeiro).querySelectorAll("button");
    expect(botoes.length).toBe(1);
    expect(botoes[0].textContent).toContain("Escolher opções");
  });

  it("sem variação: continuam os DOIS botões, com os rótulos de hoje", async () => {
    const produto = criarProduto();

    await renderizarOfertas(produto);

    const botoes = containerDeCtas(hospedeiro).querySelectorAll("button");
    expect(botoes.length).toBe(2);
    expect(botoes[0].textContent).toContain("Adicionar");
    expect(botoes[1].textContent).toContain("Comprar");
  });

  it("variação inativa não conta: continuam os DOIS botões (mesma regra de sempre)", async () => {
    const produto = criarProduto({ variants: criarVariantes(false) });

    await renderizarOfertas(produto);

    const botoes = containerDeCtas(hospedeiro).querySelectorAll("button");
    expect(botoes.length).toBe(2);
  });
});
