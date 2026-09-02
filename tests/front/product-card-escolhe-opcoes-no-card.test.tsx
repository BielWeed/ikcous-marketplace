// @vitest-environment jsdom
//
// Pedido do Gabriel (02/09): o botão "Escolher opções" do card deve abrir as
// opções NO PRÓPRIO CARD — sem levar para a tela do produto — e o card fica
// dinâmico: preço e imagem reagem à escolha.
//
// O CONTRATO NOVO (opcional e retrocompatível):
//   - Com a prop `onAddToCartWithVariants` presente: clicar em "Escolher
//     opções" EXPANDE o painel de opções no card (não navega); os chips
//     selecionam variações; o preço reflete o `priceOverride` da escolha;
//     "Adicionar" entrega (product, variantId, "Grupo: valor") para a prop;
//     grupo sem escolha → não adiciona; variação sem estoque → chip morto.
//   - Sem a prop: o botão continua fazendo o que fazia — levar para a tela
//     do produto (o teste irmão
//     card-nao-deixa-comprar-sem-escolher-a-variacao.test.tsx continua
//     valendo para esse caminho).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function criarVariantes(): ProductVariant[] {
  return [
    {
      id: "var-p",
      productId: "prod-caderno",
      name: "Tamanho",
      value: "P",
      stockIncrement: 5,
      active: true,
    },
    {
      id: "var-m",
      productId: "prod-caderno",
      name: "Tamanho",
      value: "M",
      stockIncrement: 3,
      priceOverride: 65,
      active: true,
    },
    {
      id: "var-g",
      productId: "prod-caderno",
      name: "Tamanho",
      value: "G",
      stockIncrement: 0,
      active: true,
    },
  ];
}

function criarDoisGrupos(): ProductVariant[] {
  return [
    ...criarVariantes(),
    {
      id: "var-cor-azul",
      productId: "prod-caderno",
      name: "Cor",
      value: "Azul",
      stockIncrement: 2,
      active: true,
    },
  ];
}

function criarProduto(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-caderno",
    name: "Caderno Bom",
    description: "Descrição de teste",
    price: 50,
    images: ["https://example.com/img.png"],
    category: "papelaria",
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

describe("ProductCard — escolher opções no próprio card", () => {
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
  });

  async function renderizarCard(
    produto: Product,
    props: {
      onProductClick?: (productId: string) => void;
      onAddToCartWithVariants?: (
        product: Product,
        variantId: string | undefined,
        variantNames: string,
      ) => void;
    } = {},
  ) {
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={props.onProductClick ?? vi.fn()}
          showRating={false}
          onAddToCartWithVariants={props.onAddToCartWithVariants}
        />,
      );
    });
  }

  // O botão de ação do card tem testid próprio porque o RÓTULO muda com o
  // estado ("Escolher opções" fechado, "Adicionar"/"Escolha acima" com o
  // painel aberto) — o testid é o identificador estável.
  const botaoDeAcao = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[data-testid="product-card-action"]',
    )!;

  it("clicar em 'Escolher opções' expande as opções NO card e não navega", async () => {
    const onProductClick = vi.fn();
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onProductClick,
      onAddToCartWithVariants: vi.fn(),
    });

    await act(async () => {
      botaoDeAcao()!.click();
    });

    // O painel abriu: os valores das variações estão visíveis no card.
    const textos = hospedeiro.textContent || "";
    expect(textos).toContain("P");
    expect(textos).toContain("M");
    expect(onProductClick).not.toHaveBeenCalled();
  });

  it("selecionar variação com preço próprio atualiza o PREÇO do card", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });

    // Antes da escolha: preço do produto. (formatCurrency usa espaço
    // não-quebrável entre "R$" e o número — afirmar só o número.)
    expect(hospedeiro.textContent).toContain("50,00");

    await act(async () => {
      botaoDeAcao()!.click();
    });
    const chipM = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "M",
    )!;
    await act(async () => {
      chipM.click();
    });

    // "M" tem priceOverride 65 — o card mostra o preço da escolha.
    expect(hospedeiro.textContent).toContain("65,00");
    expect(hospedeiro.textContent).not.toContain("50,00");
  });

  it("'Adicionar' com a escolha completa entrega variantId e nomes, sem navegar", async () => {
    const onProductClick = vi.fn();
    const onAddToCartWithVariants = vi.fn();
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onProductClick,
      onAddToCartWithVariants,
    });

    await act(async () => {
      botaoDeAcao()!.click();
    });
    const chipM = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "M",
    )!;
    await act(async () => {
      chipM.click();
    });
    const adicionar = botaoDeAcao();
    await act(async () => {
      adicionar.click();
    });

    expect(onAddToCartWithVariants).toHaveBeenCalledTimes(1);
    expect(onAddToCartWithVariants.mock.calls[0][0].id).toBe("prod-caderno");
    expect(onAddToCartWithVariants.mock.calls[0][1]).toBe("var-m");
    expect(onAddToCartWithVariants.mock.calls[0][2]).toBe("Tamanho: M");
    expect(onProductClick).not.toHaveBeenCalled();
  });

  it("dois grupos e só um escolhido: 'Adicionar' não entrega nada", async () => {
    const onAddToCartWithVariants = vi.fn();
    await renderizarCard(criarProduto({ variants: criarDoisGrupos() }), {
      onAddToCartWithVariants,
    });

    await act(async () => {
      botaoDeAcao()!.click();
    });
    const chipM = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "M",
    )!;
    await act(async () => {
      chipM.click();
    });
    const adicionar = botaoDeAcao();
    await act(async () => {
      adicionar.click();
    });

    expect(onAddToCartWithVariants).not.toHaveBeenCalled();
  });

  it("variação sem estoque: chip morto, não seleciona", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });

    await act(async () => {
      botaoDeAcao()!.click();
    });
    const chipG = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "G",
    )! as HTMLButtonElement;

    expect(chipG.disabled).toBe(true);
  });

  it("sem a prop nova, o botão continua levando para a tela do produto (retrocompatível)", async () => {
    const onProductClick = vi.fn();
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onProductClick,
    });

    await act(async () => {
      botaoDeAcao()!.click();
    });

    expect(onProductClick).toHaveBeenCalledWith("prod-caderno");
    expect(hospedeiro.textContent).not.toContain("Adicionar");
  });
});
