// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), território ui/custom: o aviso de frete grátis
// da Home (`FreeShippingBlock`) tinha as frases e o estilo cobertos, mas estas
// bordas passavam com o defeito plantado:
//  - a barra de progresso falada ao leitor de tela (mínimo, máximo, valor
//    arredondado para baixo e "R$ X de R$ Y para o frete grátis");
//  - "Faltam R$ 0,50": a conta de quanto falta não pode arredondar centavos
//    para cima (R$ 1,00);
//  - carrinho vazio diz "Frete Grátis" (a meta), e a partir de 1 centavo já
//    diz "Falta pouquinho";
//  - o nome da cidade só aparece quando a loja entrega só na cidade;
//  - progresso pequeno (menos de 1%) já desenha um pedacinho do anel.
import { FreeShippingBlock } from "@/components/ui/custom/FreeShippingBlock";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  cartTotal: 0,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config }),
}));
vi.mock("@/contexts/CartContext", () => ({
  useCartContext: () => ({ cartTotal: estado.cartTotal }),
}));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("aviso de frete grátis da Home — barra falada, centavos, cidade", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    estado.config = {
      freeShippingMin: 150,
      freeShippingCardStyle: undefined,
      nationalShippingStrategy: "acima_de_valor",
      nationalShippingMin: 150,
      nationalBenefitScope: "todas",
    };
    estado.cartTotal = 0;
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => act(() => root.unmount()));

  const texto = (el: Element | null | undefined) =>
    (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  function montar() {
    act(() => root.render(<FreeShippingBlock />));
    return texto(container);
  }
  const barra = () =>
    container.querySelector('[role="progressbar"]') as HTMLElement | null;

  describe.each([
    ["cartão completo", undefined],
    ["cartão compacto", "compacto"],
  ])("%s", (_nome, estilo) => {
    beforeEach(() => {
      estado.config.freeShippingCardStyle = estilo;
    });

    it("a barra fala: de 0 a 100, valor arredondado para baixo e quanto já tem da meta", () => {
      estado.cartTotal = 100; // 66,67% da meta de 150
      montar();
      expect(barra()?.getAttribute("aria-valuemin")).toBe("0");
      expect(barra()?.getAttribute("aria-valuemax")).toBe("100");
      expect(barra()?.getAttribute("aria-valuenow")).toBe("66");
      expect(barra()?.getAttribute("aria-label")).toBe(
        "Progresso para o frete grátis",
      );
      expect(barra()?.getAttribute("aria-valuetext")?.replace(/\s/g, " ")).toBe(
        "R$ 100,00 de R$ 150,00 para o frete grátis",
      );
    });

    it("meta batida: a barra fala 100", () => {
      estado.cartTotal = 200;
      montar();
      expect(barra()?.getAttribute("aria-valuenow")).toBe("100");
    });

    it("faltam centavos: diz R$ 0,50, nunca arredonda para R$ 1,00", () => {
      estado.cartTotal = 149.5;
      expect(montar()).toContain("R$ 0,50");
      expect(montar()).not.toContain("R$ 1,00");
    });
  });

  it("meta com centavos de ponto flutuante (R$ 1,15): faltando 1 centavo NÃO libera o frete", () => {
    // 1,15 * 100 dá 114,99999999999999 em ponto flutuante: a conta tem de ser
    // feita em centavos arredondados, não cortados.
    estado.config.freeShippingMin = 1.15;
    estado.config.nationalShippingMin = 1.15;
    estado.cartTotal = 1.14;
    const conteudo = montar();
    expect(conteudo).toContain("R$ 0,01");
    expect(conteudo).not.toContain("Liberado");
    expect(barra()?.getAttribute("aria-valuenow")).toBe("99");
    estado.cartTotal = 1.15;
    expect(montar()).toContain("Liberado");
  });

  it("frete grátis para todo pedido (meta de R$ 0,01): não há barra para falar", () => {
    estado.config.freeShippingMin = 0.01;
    estado.config.nationalShippingMin = 0.01;
    estado.config.freeShippingCardStyle = "compacto";
    montar();
    expect(barra()).toBeNull();
  });

  describe("cartão completo", () => {
    it("carrinho vazio: o título é a meta ('Frete Grátis'), sem 'Falta pouquinho'", () => {
      estado.cartTotal = 0;
      const conteudo = montar();
      expect(conteudo).not.toContain("Falta pouquinho");
      expect(conteudo).toContain("Frete Grátis");
      expect(conteudo).toContain("A partir de R$ 150,00 em compras.");
    });

    it("com 1 centavo no carrinho já diz 'Falta pouquinho' e quanto falta", () => {
      estado.cartTotal = 0.01;
      const conteudo = montar();
      expect(conteudo).toContain("Falta pouquinho");
      expect(conteudo).toContain("Adicione mais R$ 149,99");
    });

    it("meta batida: 'Liberado' e nada de 'Faltam' nem 'Adicione mais'", () => {
      estado.cartTotal = 150;
      const conteudo = montar();
      expect(conteudo).toContain("Frete Grátis Liberado!");
      expect(conteudo).not.toContain("Adicione mais");
    });

    it("loja que entrega só na cidade mostra o nome da cidade", () => {
      estado.config.storeCity = "Campinas";
      estado.config.shippingCoverage = "local";
      montar();
      const cidade = container.querySelector(".uppercase");
      expect(texto(cidade)).toBe("Campinas");
    });

    it("loja com entrega nacional NÃO usa o nome da cidade para qualificar o grátis", () => {
      estado.config.storeCity = "Campinas";
      estado.config.shippingCoverage = "national";
      const conteudo = montar();
      expect(container.querySelector(".uppercase")).toBeNull();
      expect(conteudo).not.toContain("Campinas");
    });

    it("cobertura local, mas sem cidade cadastrada: nenhuma linha de cidade (nem vazia)", () => {
      estado.config.storeCity = "";
      estado.config.shippingCoverage = "local";
      montar();
      expect(container.querySelector(".uppercase")).toBeNull();
    });
  });

  describe("cartão compacto", () => {
    beforeEach(() => {
      estado.config.freeShippingCardStyle = "compacto";
    });

    it("com R$ 0,50 no carrinho: mostra o que tem da meta (não o convite de carrinho vazio)", () => {
      estado.cartTotal = 0.5;
      const conteudo = montar();
      expect(conteudo).toContain("R$ 0,50 de R$ 150,00");
      expect(conteudo).not.toContain("Compras a partir de");
      expect(conteudo).toContain("Faltam R$ 149,50");
    });

    it("carrinho vazio: o convite 'Compras a partir de R$ 150,00'", () => {
      estado.cartTotal = 0;
      expect(montar()).toContain("Compras a partir de R$ 150,00");
    });

    it("progresso pequeno (0,33%) já desenha um pedacinho do anel; zero não desenha", () => {
      // O anel é o primeiro desenho da tela (o ícone do caminhão vem depois).
      const circulos = () =>
        container.querySelector("svg")?.querySelectorAll("circle").length;
      estado.cartTotal = 0.5;
      montar();
      expect(circulos()).toBe(2); // trilho + arco
      estado.cartTotal = 0;
      montar();
      expect(circulos()).toBe(1); // só o trilho
    });
  });
});
