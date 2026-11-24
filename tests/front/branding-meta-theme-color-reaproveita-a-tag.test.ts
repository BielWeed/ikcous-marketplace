// @vitest-environment jsdom
//
// A barra do celular acompanha a cor da loja pela tag
// `<meta name="theme-color">`. `applyThemeColor` roda a cada troca de cor (a
// semente do build, depois o banco, depois cada vez que a lojista salva), então
// o que importa é que continue havendo UMA tag só e que ela mostre sempre a
// última cor. Os testes vizinhos provam "cria quando falta"; aqui fica o resto:
// reaproveitar a tag existente (sem empilhar duplicadas) e não mexer em
// nenhuma outra meta da página.
import { applyThemeColor } from "@/config/branding";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const metasDeCor = () =>
  document.head.querySelectorAll('meta[name="theme-color"]');

beforeEach(() => {
  document.head.innerHTML = "";
});

afterEach(() => {
  document.head.innerHTML = "";
});

describe("applyThemeColor — uma tag só, sempre com a última cor", () => {
  it("cria a tag quando não existe e escreve a cor no content", () => {
    applyThemeColor("#1e3a8a");
    expect(metasDeCor()).toHaveLength(1);
    expect(metasDeCor()[0].getAttribute("content")).toBe("#1e3a8a");
  });

  it("chamadas seguidas reaproveitam a mesma tag e ficam com a última cor", () => {
    applyThemeColor("#1e3a8a");
    const primeira = metasDeCor()[0];
    applyThemeColor("#ffd400");
    applyThemeColor("#047857");

    expect(metasDeCor()).toHaveLength(1);
    expect(metasDeCor()[0]).toBe(primeira);
    expect(primeira.getAttribute("content")).toBe("#047857");
  });

  it("usa a tag que o HTML já trouxe, sem criar outra ao lado", () => {
    document.head.innerHTML =
      '<meta name="theme-color" content="#000000"><meta name="description" content="Loja">';
    applyThemeColor("#ffd400");

    expect(metasDeCor()).toHaveLength(1);
    expect(metasDeCor()[0].getAttribute("content")).toBe("#ffd400");
  });

  it("não mexe em nenhuma outra meta da página", () => {
    document.head.innerHTML =
      '<meta name="description" content="Loja"><meta name="viewport" content="width=device-width">';
    applyThemeColor("#ffd400");

    expect(
      document.head
        .querySelector('meta[name="description"]')
        ?.getAttribute("content"),
    ).toBe("Loja");
    expect(
      document.head
        .querySelector('meta[name="viewport"]')
        ?.getAttribute("content"),
    ).toBe("width=device-width");
    expect(document.head.querySelectorAll("meta")).toHaveLength(3);
  });
});
