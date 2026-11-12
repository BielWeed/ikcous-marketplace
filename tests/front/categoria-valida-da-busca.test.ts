import { categoriaValidaDaBusca } from "@/lib/categoria-valida-da-busca";
import { describe, expect, it } from "vitest";

describe("categoria válida da busca", () => {
  it("categoria renomeada cai em Todas", () => {
    expect(categoriaValidaDaBusca("Capas", [{ category: "Proteções" }])).toBe(
      "Todas",
    );
  });
  it("mantém categoria existente com caixa e espaços diferentes", () => {
    expect(categoriaValidaDaBusca("Capas", [{ category: " CAPAS " }])).toBe(
      "Capas",
    );
  });
  it("lista vazia não decide", () => {
    expect(categoriaValidaDaBusca("Capas", [])).toBe("Capas");
  });
  it("carregamento não decide sobre lista anterior", () => {
    expect(
      categoriaValidaDaBusca("Capas", [{ category: "Proteções" }], true),
    ).toBe("Capas");
  });
  it("Todas continua Todas", () => {
    expect(categoriaValidaDaBusca("Todas", [{ category: "Proteções" }])).toBe(
      "Todas",
    );
  });
  it("categoria ativa sem produto visível não é descartada", () => {
    expect(
      categoriaValidaDaBusca("Capas", [{ category: "Proteções" }], false, [
        { name: "Capas", isActive: true },
      ]),
    ).toBe("Capas");
  });
  it("categoria que só os produtos têm continua escolhível", () => {
    expect(
      categoriaValidaDaBusca("Capas", [{ category: "Capas" }], false, [
        { name: "Proteções", isActive: true },
      ]),
    ).toBe("Capas");
  });
  it("categoria renomeada some da lista e dos produtos: cai em Todas", () => {
    expect(
      categoriaValidaDaBusca("Capas", [{ category: "Proteções" }], false, [
        { name: "Proteções", isActive: true },
      ]),
    ).toBe("Todas");
  });
  it("categoria escondida não mantém o filtro", () => {
    expect(
      categoriaValidaDaBusca("Capas", [{ category: "Capas" }], false, [
        { name: "Capas", isActive: false },
      ]),
    ).toBe("Todas");
  });
});
