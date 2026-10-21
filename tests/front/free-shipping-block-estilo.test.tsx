// @vitest-environment jsdom
import { FreeShippingBlock } from "@/components/ui/custom/FreeShippingBlock";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  config: {
    freeShippingMin: 150,
    freeShippingCardStyle: undefined as string | undefined,
    nationalShippingStrategy: "desligado",
  },
  cartTotal: 129.9,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config }),
}));
vi.mock("@/contexts/CartContext", () => ({
  useCartContext: () => ({ cartTotal: estado.cartTotal }),
}));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("estilo do card de frete na Home", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    estado.config = {
      freeShippingMin: 150,
      freeShippingCardStyle: undefined,
      nationalShippingStrategy: "desligado",
    };
    estado.cartTotal = 129.9;
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => act(() => root.unmount()));
  function montar() {
    act(() => root.render(<FreeShippingBlock />));
    return container.textContent!.replace(/\s+/g, " ");
  }
  it("sem coluna continua completo, sem mudar o card atual", () => {
    expect(montar()).toContain("Falta pouquinho");
    expect(container.firstElementChild?.className).toContain("min-h-[172px]");
  });
  it("compacto mostra falta em verde, cobertura local, progresso e valores", () => {
    estado.config.freeShippingCardStyle = "compacto";
    expect(montar()).toContain("Faltam R$ 20,10 p/ frete grátis na cidade");
    expect(container.firstElementChild?.className).toContain("min-h-[76px]");
    expect(
      container
        .querySelector("h3 .text-emerald-400")
        ?.textContent?.replace(/\s/g, " "),
    ).toBe("R$ 20,10");
    expect(
      container
        .querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow"),
    ).toBe("86");
    expect(container.textContent).toContain("129,90 / 150,00");
    expect(container.textContent).not.toContain("Falta pouquinho");
  });
  it("compacto com carrinho vazio mantém a meta inteira, sem truncar o texto", () => {
    estado.config.freeShippingCardStyle = "compacto";
    estado.cartTotal = 0;
    expect(montar()).toContain("Faltam R$ 150,00 p/ frete grátis na cidade");
    expect(container.innerHTML).not.toMatch(
      /truncate|line-clamp|whitespace-nowrap.*h3/,
    );
  });
  it("compacto atingido continua respeitando o arredondamento em centavos", () => {
    estado.config.freeShippingCardStyle = "compacto";
    estado.cartTotal = 149.999;
    expect(montar()).toContain("Frete grátis na cidade liberado");
    expect(container.textContent).not.toContain("Faltam");
  });
  it("compacto sempre grátis não inventa meta de um centavo", () => {
    estado.config.freeShippingCardStyle = "compacto";
    estado.config.freeShippingMin = 0.01;
    expect(montar()).toContain("Frete grátis na cidade liberado");
    expect(container.textContent).not.toContain("0,01");
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });
  it("compacto não promete frete grátis quando a regra está desligada", () => {
    estado.config.freeShippingCardStyle = "compacto";
    estado.config.freeShippingMin = 0;
    expect(montar()).toBe("");
  });
  it("regras iguais não restringem o anúncio à cidade", () => {
    estado.config.freeShippingCardStyle = "compacto";
    estado.config.nationalShippingStrategy = "acima_de_valor";
    Object.assign(estado.config, {
      nationalShippingMin: 150,
      nationalBenefitScope: "todas",
    });
    expect(montar()).not.toContain("na cidade");
  });
});
