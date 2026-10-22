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
    nationalShippingMin: 150,
    nationalBenefitScope: "todas",
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
      freeShippingCardStyle: "compacto",
      nationalShippingStrategy: "desligado",
      nationalShippingMin: 150,
      nationalBenefitScope: "todas",
    };
    estado.cartTotal = 129.9;
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => act(() => root.unmount()));
  function texto(elemento: Element | null) {
    return elemento?.textContent?.replace(/\s+/g, " ");
  }
  function montar() {
    act(() => root.render(<FreeShippingBlock />));
    return texto(container);
  }
  it("sem coluna continua completo, sem mudar o card atual", () => {
    estado.config.freeShippingCardStyle = undefined;
    expect(montar()).toContain("Falta pouquinho");
    expect(container.firstElementChild?.className).toContain("min-h-[172px]");
  });

  for (const soLocal of [false, true]) {
    describe(soLocal ? "somente entrega local" : "regras iguais", () => {
      beforeEach(() => {
        estado.config.nationalShippingStrategy = soLocal
          ? "desligado"
          : "acima_de_valor";
      });

      function conferirAnel(liberado: boolean, percentual: number) {
        const anel = container.querySelector("svg");
        expect(anel?.getAttribute("aria-hidden")).toBe("true");
        expect(anel?.getAttribute("width")).toBe("52");
        expect(anel?.getAttribute("height")).toBe("52");
        const circulos = anel?.querySelectorAll("circle");
        expect(circulos).toHaveLength(2);
        const arco = circulos?.[1];
        expect(arco?.getAttribute("r")).toBe("24");
        expect(arco?.getAttribute("stroke-linecap")).toBe("round");
        expect(arco?.getAttribute("pathLength")).toBe("100");
        expect(arco?.getAttribute("stroke-dasharray")).toBe("100");
        expect(Number(arco?.getAttribute("stroke-dashoffset"))).toBeCloseTo(
          100 - percentual,
        );
        expect(
          container.querySelector(liberado ? ".lucide-check" : ".lucide-truck"),
        ).not.toBeNull();
      }

      for (const total of [129.9, 0, 211.7]) {
        it(`compacto com R$ ${total} comunica a meta sem valores com barra`, () => {
          estado.cartTotal = total;
          const conteudo = montar();
          expect(texto(container.querySelector("p"))).toBe(
            `Frete grátis${soLocal ? " na cidade" : ""}`,
          );
          expect(texto(container.querySelector("h3"))).toBe(
            total >= 150
              ? "Liberado"
              : total
                ? "Faltam R$ 20,10"
                : "Faltam R$ 150,00",
          );
          const meta =
            total >= 150
              ? `Seu carrinho já ganhou entrega${soLocal ? " local" : ""} grátis!`
              : total
                ? "R$ 129,90 de R$ 150,00"
                : `A partir de R$ 150,00 em compras${soLocal ? ", na entrega local" : ""}.`;
          expect(texto(container.querySelector("p:last-child"))).toBe(meta);
          expect(conteudo).not.toContain("/");
          if (total >= 150) expect(conteudo).not.toContain("Faltam");

          const progresso = container.querySelector('[role="progressbar"]');
          expect(progresso?.contains(container.querySelector("svg"))).toBe(
            true,
          );
          expect(progresso?.getAttribute("aria-label")).toBe(
            "Progresso para o frete grátis",
          );
          expect(progresso?.getAttribute("aria-valuemin")).toBe("0");
          expect(progresso?.getAttribute("aria-valuemax")).toBe("100");
          expect(progresso?.getAttribute("aria-valuenow")).toBe(
            String(Math.floor(Math.min((total / 150) * 100, 100))),
          );
          expect(
            progresso?.getAttribute("aria-valuetext")?.replace(/\s/g, " "),
          ).toBe(
            `${total ? (total >= 150 ? "R$ 211,70" : "R$ 129,90") : "R$ 0,00"} de R$ 150,00 para o frete grátis`,
          );
          conferirAnel(total >= 150, Math.min((total / 150) * 100, 100));
        });
      }
      it("sempre grátis não inventa meta nem progressbar", () => {
        estado.config.freeShippingMin = 0.01;
        estado.config.nationalShippingStrategy = soLocal
          ? "desligado"
          : "sempre";
        estado.cartTotal = 0;
        expect(montar()).not.toMatch(/0,01|Faltam|\//);
        expect(texto(container.querySelector("p"))).toBe(
          `Frete grátis${soLocal ? " na cidade" : ""}`,
        );
        expect(texto(container.querySelector("h3"))).toBe("Liberado");
        expect(texto(container.querySelector("p:last-child"))).toBe(
          soLocal
            ? "Pedido com entrega local sai grátis."
            : "Qualquer pedido sai com entrega grátis.",
        );
        expect(container.querySelector('[role="progressbar"]')).toBeNull();
        conferirAnel(true, 100);
      });
    });
  }

  it("compacto atingido continua respeitando o arredondamento em centavos", () => {
    estado.cartTotal = 149.999;
    expect(montar()).not.toContain("Faltam");
    expect(texto(container.querySelector("h3"))).toBe("Liberado");
    expect(
      container
        .querySelectorAll("circle")[1]
        ?.getAttribute("stroke-dashoffset"),
    ).toBe("0");
  });
  it.each([-20, Number.NaN])(
    "anel protege progresso inválido (%s)",
    (total) => {
      estado.cartTotal = total;
      montar();
      expect(
        Number(
          container
            .querySelectorAll("circle")[1]
            ?.getAttribute("stroke-dashoffset"),
        ),
      ).toBe(100);
    },
  );
  it("compacto contém textos e valores grandes sem forçar largura mínima", () => {
    estado.config.freeShippingMin = 12345.67;
    estado.cartTotal = 1999.9;
    montar();
    const card = container.firstElementChild!;
    expect(card.className).toContain("w-full");
    expect(card.className).toContain("min-h-[84px]");
    expect(card.className).toContain("rounded-[22px]");
    const coluna = container.querySelector("h3")!.parentElement!;
    expect(coluna.className).toContain("min-w-0");
    // Contrato da Home: texto nunca é cortado; o cartão cresce (min-h).
    for (const linha of coluna.children)
      expect(linha.className).not.toMatch(/truncate|line-clamp|text-overflow/);
    expect(texto(container.querySelector("p:last-child"))).toBe(
      "R$ 1.999,90 de R$ 12.345,67",
    );
  });
  it("compacto não promete frete grátis quando a regra está desligada", () => {
    estado.config.freeShippingMin = 0;
    expect(montar()).toBe("");
  });
});
