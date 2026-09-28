// @vitest-environment jsdom
//
// Onda 0 do plano app-cliente-desktop (F1.3, contrato C13): helper de teste
// que devolve "como o className seria no celular", removendo todo token cujo
// PRIMEIRO variante é `lg`, `xl` ou `2xl`. É o padrão de teste A da spec
// (§4.4): `classesDoCelular(el.className)` tem de bater byte a byte com o
// literal de hoje, provando que a classe de computador foi ACRESCENTADA, não
// editada (R2). Não é fonte do app -- vive em `tests/front/`, ao lado de
// quem consome.
//
// jsdom (não "node" puro) só por causa do teste de elemento SVG abaixo, que
// precisa de `document.createElementNS` de verdade.
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

describe("classesDoCelular — contrato C13", () => {
  it("remove tokens de computador empilhados e mantém md:/sem prefixo, com espaços normalizados", () => {
    expect(classesDoCelular("px-4 lg:px-8 lg:hover:bg-x md:w-1")).toBe(
      "px-4 md:w-1",
    );
  });

  it("normaliza espaço duplo, tab e quebra de linha entre tokens", () => {
    expect(classesDoCelular("px-4   lg:px-8\tmd:w-1\n  py-2")).toBe(
      "px-4 md:w-1 py-2",
    );
  });

  it("normaliza espaço nas pontas", () => {
    expect(classesDoCelular("  px-4 lg:px-8  ")).toBe("px-4");
  });

  it("remove xl: e 2xl: também, inclusive empilhados", () => {
    expect(
      classesDoCelular("grid-cols-2 xl:grid-cols-5 2xl:max-w-[1440px] gap-4"),
    ).toBe("grid-cols-2 gap-4");
  });

  it("não remove token que só CONTÉM lg/xl/2xl sem ser o primeiro variante", () => {
    // "large-token" não é um variante `lg:`; "hover:lg-x" tem "hover" como
    // primeiro variante, não "lg".
    expect(classesDoCelular("large-token hover:lg-x")).toBe(
      "large-token hover:lg-x",
    );
  });

  it("string vazia ou só com tokens de computador vira string vazia", () => {
    expect(classesDoCelular("")).toBe("");
    expect(classesDoCelular("lg:flex xl:hidden")).toBe("");
  });

  it("aceita className de elemento SVG (SVGAnimatedString), não só string -- <svg>/<path>/ícone não devolvem string direto de .className", () => {
    const svg = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    ) as SVGSVGElement;
    svg.setAttribute("class", "px-4 lg:px-8 lg:hover:bg-x md:w-1");

    // Prova que o DOM de teste concorda que isto NÃO é string (senão o
    // teste provaria só que string funciona, de novo).
    expect(typeof svg.className).not.toBe("string");
    expect(svg.className.baseVal).toBe("px-4 lg:px-8 lg:hover:bg-x md:w-1");

    expect(classesDoCelular(svg.className)).toBe("px-4 md:w-1");
  });
});
