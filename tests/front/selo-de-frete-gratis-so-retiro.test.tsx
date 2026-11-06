// @vitest-environment jsdom
//
// Caça de 06/11/2026: loja "Só retiro" (sem entrega própria) com o frete
// grátis salvo antes de trocar o modo continuava mostrando o selo "Frete
// grátis" nos produtos, sem entrega nenhuma a que ele se referisse (a retirada
// já é grátis). A régua de "não há entrega para prometer grátis" é
// `semMetaDeFreteGratis` — o selo passa por ela DENTRO de `promessasDeFrete`,
// para nenhuma tela esquecer.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  fraseDoSeloDeFreteGratis,
  produtoTemFreteGratisPrometido,
  promessasDeFrete,
} from "@/lib/estrategias-de-frete";
import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FRETE = {
  freeShippingMin: 0.01, // "sempre"
  nationalShippingStrategy: "desligado" as const,
  nationalShippingMin: 0,
  nationalDiscountType: null,
  nationalDiscountValue: 0,
  nationalBenefitScope: "mais_barata" as const,
};

const SO_RETIRO_SO_NA_CIDADE = {
  ...FRETE,
  localDeliveryEnabled: false,
  enabledShippingMethods: ["store-pickup"],
  shippingCoverage: "local" as const,
};

// Só retiro, mas a loja ainda cota transportadora para fora da cidade.
const SO_RETIRO_COM_TRANSPORTADORA = {
  ...FRETE,
  nationalShippingStrategy: "sempre" as const,
  localDeliveryEnabled: false,
  enabledShippingMethods: ["store-pickup", "sedex"],
  shippingCoverage: "national" as const,
};

const COM_ENTREGA = {
  ...FRETE,
  localDeliveryEnabled: true,
  enabledShippingMethods: ["sedex", "pac"],
  shippingCoverage: "local" as const,
};

describe("selo de frete grátis em loja Só retiro (regra pura)", () => {
  it("Só retiro sem transportadora: nenhum canal promete, nem 'sempre' nem 'por produto'", () => {
    for (const freeShippingMin of [0.01, -1]) {
      const promessas = promessasDeFrete({
        ...SO_RETIRO_SO_NA_CIDADE,
        freeShippingMin,
      });
      expect(fraseDoSeloDeFreteGratis(promessas, true)).toBeNull();
      expect(fraseDoSeloDeFreteGratis(promessas, false)).toBeNull();
      expect(produtoTemFreteGratisPrometido(promessas, true)).toBe(false);
    }
  });

  it("Só retiro com a lista sem transportadora (cobertura nacional): também sem selo", () => {
    const promessas = promessasDeFrete({
      ...SO_RETIRO_SO_NA_CIDADE,
      shippingCoverage: "national",
    });
    expect(fraseDoSeloDeFreteGratis(promessas, true)).toBeNull();
  });

  it("controle: loja com entrega própria e frete grátis continua mostrando o selo", () => {
    const promessas = promessasDeFrete(COM_ENTREGA);
    expect(fraseDoSeloDeFreteGratis(promessas, false)).toBe(
      "Frete grátis na cidade",
    );
    expect(produtoTemFreteGratisPrometido(promessas, false)).toBe(true);
  });

  it("controle: Só retiro COM transportadora ativa mantém o selo do canal nacional", () => {
    const promessas = promessasDeFrete(SO_RETIRO_COM_TRANSPORTADORA);
    expect(produtoTemFreteGratisPrometido(promessas, false)).toBe(true);
  });

  it("controle: config sem os campos de entrega (como nos testes antigos) lê como loja que entrega", () => {
    const promessas = promessasDeFrete(FRETE);
    expect(fraseDoSeloDeFreteGratis(promessas, false)).toBe(
      "Frete grátis na cidade",
    );
  });
});

function criarProduto(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-so-retiro",
    name: "Produto de teste",
    description: "Descrição de teste",
    price: 79,
    images: ["https://example.com/img.png"],
    category: "geral",
    stock: 10,
    sold: 3,
    isActive: true,
    isBestseller: false,
    freeShipping: true,
    createdAt: new Date().toISOString(),
    rating: 4.5,
    reviewCount: 12,
    ...overrides,
  };
}

describe("ProductCard — o selo some em loja Só retiro", () => {
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

  async function renderizarCard(
    config: Parameters<typeof promessasDeFrete>[0],
  ) {
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    await act(async () => {
      raiz.render(
        <ProductCard
          product={criarProduto()}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={() => {}}
          showRating={false}
          priority
          promessasDeFrete={promessasDeFrete(config)}
        />,
      );
    });
  }

  it("Só retiro com cobertura local e frete grátis salvo: sem selo", async () => {
    await renderizarCard(SO_RETIRO_SO_NA_CIDADE);

    expect(hospedeiro.textContent).not.toMatch(/frete gr[áa]tis/i);
  });

  it("controle: loja com entrega e frete grátis salvo: o selo aparece", async () => {
    await renderizarCard(COM_ENTREGA);

    expect(hospedeiro.textContent).toContain("Frete grátis na cidade");
  });
});
