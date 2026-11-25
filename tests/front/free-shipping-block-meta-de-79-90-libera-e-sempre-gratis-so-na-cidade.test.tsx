// @vitest-environment jsdom
//
// Aviso de frete grátis (Home e carrinho) — duas bordas sem guarda:
//  1. A meta TAMBÉM tem de ser contada em centavos arredondados, não só o total
//     do carrinho: R$ 79,90 vira 7990,000000000001 em ponto flutuante, e uma
//     compra de exatamente R$ 79,90 aparecia como "Faltam R$ 0,00" em vez de
//     "Liberado". Uma compra de R$ 79,89 continua faltando 1 centavo.
//  2. Loja que dá frete grátis SEMPRE na entrega local (e cobra a transportadora):
//     o cartão completo diz "na cidade" e "entrega local", nunca "toda a loja";
//     já a loja que dá grátis em tudo diz "toda a loja".
import { AvisoDeFreteGratis } from "@/components/ui/custom/FreeShippingBlock";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({ config: {} as Record<string, unknown> }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config }),
}));
vi.mock("@/contexts/CartContext", () => ({
  useCartContext: () => ({ cartTotal: 0 }),
}));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

const texto = () => (container.textContent ?? "").replace(/\s+/g, " ").trim();
function montar(cartTotal: number) {
  act(() => root.render(<AvisoDeFreteGratis cartTotal={cartTotal} />));
  return texto();
}
const barra = () =>
  container.querySelector('[role="progressbar"]') as HTMLElement | null;

describe("meta de R$ 79,90 (ponto flutuante: 79,9 x 100 = 7990,000000000001)", () => {
  describe.each([
    ["cartão completo", undefined],
    ["cartão compacto", "compacto"],
  ])("%s", (_nome, estilo) => {
    beforeEach(() => {
      estado.config = {
        freeShippingMin: 79.9,
        freeShippingCardStyle: estilo,
        nationalShippingStrategy: "acima_de_valor",
        nationalShippingMin: 79.9,
        nationalBenefitScope: "todas",
      };
    });

    it("compra de exatamente R$ 79,90 libera o frete (nada de 'Faltam R$ 0,00')", () => {
      const conteudo = montar(79.9);
      expect(conteudo).toContain("Liberado");
      expect(conteudo).not.toContain("Faltam");
      expect(conteudo).not.toContain("Adicione mais");
      expect(barra()?.getAttribute("aria-valuenow")).toBe("100");
    });

    it("compra de R$ 79,89 ainda falta 1 centavo e a barra fala 99", () => {
      const conteudo = montar(79.89);
      expect(conteudo).not.toContain("Liberado");
      expect(conteudo).toContain("R$ 0,01");
      expect(barra()?.getAttribute("aria-valuenow")).toBe("99");
    });
  });
});

describe("cartão completo, frete grátis SEMPRE", () => {
  beforeEach(() => {
    estado.config = {
      freeShippingMin: 0.01,
      freeShippingCardStyle: undefined,
    };
  });

  it("grátis só na entrega local: diz 'na cidade' e 'entrega local'", () => {
    estado.config.nationalShippingStrategy = "desligado";
    const conteudo = montar(0);
    expect(conteudo).toContain("Entrega na cidade");
    expect(conteudo).toContain("Frete grátis na cidade");
    expect(conteudo).toContain("Pedido com entrega local sai grátis.");
    expect(conteudo).not.toContain("Toda a loja");
    expect(conteudo).not.toContain("Qualquer pedido");
    expect(barra()?.getAttribute("aria-valuenow") ?? null).toBeNull();
  });

  it("grátis em tudo (local e transportadora): diz 'toda a loja'", () => {
    estado.config.nationalShippingStrategy = "sempre";
    const conteudo = montar(0);
    expect(conteudo).toContain("Toda a loja");
    expect(conteudo).toContain("Frete grátis em toda a loja");
    expect(conteudo).toContain("Qualquer pedido sai com entrega grátis.");
    expect(conteudo).not.toContain("na cidade");
    expect(conteudo).not.toContain("entrega local");
  });
});
