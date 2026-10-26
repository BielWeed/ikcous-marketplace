// @vitest-environment jsdom
//
// A prévia "Ver no app" mostrava o que a loja de verdade não mostra: estrelas
// "5.0 (15 avaliações)", uma avaliação de "Gabriel M.", uma pergunta com
// resposta inventada, "Envio rápido" mesmo com o produto esgotado e o selo de
// frete grátis só pela marca do produto. Aqui a prévia deixa de inventar:
// sem estrelas nem avaliações, estoque que reflete o produto e o selo que
// segue a mesma regra do card real (`fraseDoSeloDeFreteGratis`).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    shippingCoverage: "national" as "national" | "local",
    freeShippingMin: 0,
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const base = {
  name: "Produto de teste",
  description: "Descrição de teste",
  price: "100",
  costPrice: "50",
  originalPrice: "",
  stock: "10",
  category: "geral",
  images: [] as string[],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  variants: [],
};

describe("PhoneSimulator — a prévia não inventa nada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    mockConfig.freeShippingMin = 0;
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

  async function montar(
    modo: "card" | "page",
    formData: Omit<typeof base, "freeShipping" | "stock"> & {
      freeShipping?: boolean;
      stock?: string;
    } = base,
  ) {
    const { PhoneSimulator } = await import(
      "@/components/admin/PhoneSimulator"
    );
    await act(async () => {
      raiz.render(
        <PhoneSimulator
          onClose={() => {}}
          formData={{ ...base, ...formData }}
          previewMode={modo}
          setPreviewMode={() => {}}
          previewImgIndex={0}
          setPreviewImgIndex={() => {}}
          previewSelectedVariants={{}}
          setPreviewSelectedVariants={() => {}}
          activeDetailTab="description"
          setActiveDetailTab={() => {}}
        />,
      );
    });
  }

  const texto = () => document.body.textContent ?? "";

  it.each(["card", "page"] as const)(
    "produto sem avaliações: nada de estrelas, avaliação ou pergunta de exemplo (%s)",
    async (modo) => {
      await montar(modo);
      expect(texto()).not.toContain("★");
      expect(texto()).not.toContain("avaliações");
      expect(texto()).not.toContain("Avaliações");
      expect(texto()).not.toContain("Gabriel M.");
      expect(texto()).not.toContain("entregamos hoje");
    },
  );

  it("esgotado diz 'Esgotado' e não promete envio rápido", async () => {
    await montar("page", { ...base, stock: "0" });
    expect(texto()).toContain("Produto Esgotado");
    expect(texto()).not.toContain("Produto em estoque");
    expect(texto()).not.toContain("Envio rápido");
  });

  it("em estoque também não promete envio rápido", async () => {
    await montar("page");
    expect(texto()).not.toContain("Envio rápido");
  });

  it.each(["card", "page"] as const)(
    "selo de frete grátis: marca do produto sem a regra 'por produto' não mostra (%s)",
    async (modo) => {
      mockConfig.freeShippingMin = 0; // frete grátis desligado na loja
      await montar(modo, { ...base, freeShipping: true });
      expect(texto().toLowerCase()).not.toContain("frete gr");
    },
  );

  it.each(["card", "page"] as const)(
    "selo de frete grátis: regra 'por produto' + produto marcado mostra; sem marca não (%s)",
    async (modo) => {
      mockConfig.freeShippingMin = -1;
      await montar(modo, { ...base, freeShipping: true });
      expect(texto().toLowerCase()).toContain("frete grátis");
      act(() => {
        raiz.unmount();
      });
      raiz = createRoot(hospedeiro);
      await montar(modo, { ...base, freeShipping: false });
      expect(texto().toLowerCase()).not.toContain("frete gr");
    },
  );
});
