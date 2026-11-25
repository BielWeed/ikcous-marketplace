// A relevância soma pontos por onde a busca aparece. Os testes vizinhos provam o
// nome IGUAL (100), o código EXATO e o peso por palavra; faltava a escada do
// meio, conta por conta: nome que COMEÇA com a busca (85), nome que apenas
// CONTÉM (50), categoria que contém (25), descrição (5) e código só PARCIAL (5)
// -- e o espaço duplo no meio do texto, que a conta junta antes de comparar.
// Cada número é a soma exata (inclui os 20 / 15 da palavra achada no nome / na
// categoria), para um ponto a menos em qualquer degrau derrubar a prova.
import { pontuadorDaBusca } from "@/lib/busca-de-produtos";
import { describe, expect, it } from "vitest";

type ProdutoDaBusca = Parameters<ReturnType<typeof pontuadorDaBusca>>[0];

const nota = (busca: string, produto: ProdutoDaBusca) =>
  pontuadorDaBusca(busca)(produto);

describe("relevância da busca: a escada do nome", () => {
  it("nome igual à busca: 100 + 20 da palavra", () => {
    expect(nota("bolsa", { name: "Bolsa", category: "Outros" })).toBe(120);
  });

  it("nome que COMEÇA com a busca: 85 + 20 da palavra", () => {
    expect(nota("bolsa", { name: "Bolsa Azul", category: "Outros" })).toBe(105);
  });

  it("nome que só CONTÉM a busca (no meio ou no fim): 50 + 20 da palavra", () => {
    expect(nota("bolsa", { name: "Minha Bolsa", category: "Outros" })).toBe(70);
    expect(
      nota("bolsa", { name: "Minha Bolsa Azul", category: "Outros" }),
    ).toBe(70);
  });

  it("a escada é estrita: igual > começa > contém", () => {
    const igual = nota("bolsa", { name: "Bolsa", category: "Outros" });
    const comeca = nota("bolsa", { name: "Bolsa Azul", category: "Outros" });
    const contem = nota("bolsa", { name: "Minha Bolsa", category: "Outros" });
    expect(igual).toBeGreaterThan(comeca);
    expect(comeca).toBeGreaterThan(contem);
    expect(contem).toBeGreaterThan(0);
  });
});

describe("relevância da busca: categoria, descrição e código parcial", () => {
  it("categoria igual à busca: 40 + 15 da palavra", () => {
    expect(nota("bolsa", { name: "Peça", category: "Bolsa" })).toBe(55);
  });

  it("categoria que CONTÉM a busca (no começo ou no meio): 25 + 15 da palavra", () => {
    expect(nota("bolsa", { name: "Peça", category: "Bolsa Azul" })).toBe(40);
    expect(nota("bolsa", { name: "Peça", category: "Minha Bolsa" })).toBe(40);
  });

  it("descrição que contém a busca em qualquer ponto: 5", () => {
    expect(
      nota("bolsa", {
        name: "Peça",
        category: "Outros",
        description: "Linda bolsa grande",
      }),
    ).toBe(5);
  });

  it("código que apenas CONTÉM a busca (no começo ou no meio): 5", () => {
    expect(
      nota("bolsa", { name: "Peça", category: "Outros", sku: "bolsa-1" }),
    ).toBe(5);
    expect(
      nota("bolsa", { name: "Peça", category: "Outros", sku: "xyz-bolsa-1" }),
    ).toBe(5);
  });

  it("código parcial de uma variação ativa também vale 5, e o de uma inativa não", () => {
    expect(
      nota("bolsa", {
        name: "Peça",
        category: "Outros",
        variants: [{ value: "P", active: true, sku: "xyz-bolsa-1" }],
      }),
    ).toBe(5);
    expect(
      nota("bolsa", {
        name: "Peça",
        category: "Outros",
        variants: [{ value: "P", active: false, sku: "xyz-bolsa-1" }],
      }),
    ).toBe(0);
  });
});

describe("relevância da busca: espaço duplo no meio do texto", () => {
  it("nome com espaço duplo ainda é IGUAL à busca", () => {
    expect(
      nota("bolsa azul", { name: "Bolsa   Azul", category: "Outros" }),
    ).toBe(140);
  });

  it("busca com espaço duplo ainda é igual ao nome", () => {
    expect(
      nota("bolsa   azul", { name: "Bolsa Azul", category: "Outros" }),
    ).toBe(140);
  });

  it("categoria com espaço duplo ainda é IGUAL à busca", () => {
    expect(nota("bolsa azul", { name: "Peça", category: "Bolsa  Azul" })).toBe(
      70,
    );
  });

  it("descrição com espaço duplo ainda contém a busca", () => {
    expect(
      nota("bolsa azul", {
        name: "Peça",
        category: "Outros",
        description: "linda bolsa   azul",
      }),
    ).toBe(5);
  });
});
