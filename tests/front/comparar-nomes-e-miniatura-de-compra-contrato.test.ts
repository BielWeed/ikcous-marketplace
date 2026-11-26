// Dois auxiliares de vitrine sem teste direto:
//   · `compararNomes` ordena categorias e resultados da busca em português:
//     número como número ("Tamanho 2" antes de "Tamanho 10"), sem distinguir
//     maiúscula nem acento, e acentuada logo depois da base (nunca no fim).
//   · `miniaturaDeCompra` é a foto pequena do carrinho/pedidos; a MESMA string
//     é a que o aquecedor de cache baixa, então largura e qualidade são
//     contrato: mudou um lado, o aquecimento deixa de servir a tela.
import { compararNomes } from "@/lib/comparar-nomes";
import { miniaturaDeCompra } from "@/lib/miniatura-de-compra";
import { describe, expect, it } from "vitest";

const ordenar = (nomes: string[]) => [...nomes].sort(compararNomes);

describe("compararNomes", () => {
  it("compara número como número, não letra a letra", () => {
    expect(ordenar(["Tamanho 10", "Tamanho 2", "Tamanho 1"])).toEqual([
      "Tamanho 1",
      "Tamanho 2",
      "Tamanho 10",
    ]);
  });

  it("maiúscula e minúscula empatam (a ordem dos dois fica a de entrada)", () => {
    expect(compararNomes("camisa", "CAMISA")).toBe(0);
    expect(compararNomes("Camisa", "camisa")).toBe(0);
  });

  it("acento não separa nomes que só diferem nele", () => {
    expect(compararNomes("Maçã", "Maca")).toBe(0);
    expect(compararNomes("Pão", "pao")).toBe(0);
  });

  it("acentuada entra no lugar da letra-base, não depois do z", () => {
    expect(ordenar(["Zebra", "Ávila", "Bola", "Árvore", "Abelha"])).toEqual([
      "Abelha",
      "Árvore",
      "Ávila",
      "Bola",
      "Zebra",
    ]);
  });

  it("a regra é a do português: 'ñ' é só um 'n' com sinal (em espanhol viria depois do 'n' inteiro)", () => {
    expect(ordenar(["Nz", "Ñandu", "Na"])).toEqual(["Na", "Ñandu", "Nz"]);
  });

  it("devolve negativo, positivo e zero no sentido do JavaScript", () => {
    expect(compararNomes("a", "b")).toBeLessThan(0);
    expect(compararNomes("b", "a")).toBeGreaterThan(0);
    expect(compararNomes("a", "a")).toBe(0);
  });

  it("é uma função solta: pode ser passada direto ao sort, sem `this`", () => {
    const { compararNomes: solta } = { compararNomes };
    expect(["b", "a"].sort(solta)).toEqual(["a", "b"]);
  });
});

describe("miniaturaDeCompra", () => {
  const original =
    "https://gnjsrucsmjkajijrakzr.supabase.co/storage/v1/object/public/produtos/foto.png";

  it("foto do Storage vira a miniatura de 160 px com qualidade 70", () => {
    expect(miniaturaDeCompra(original)).toBe(
      "https://gnjsrucsmjkajijrakzr.supabase.co/storage/v1/render/image/public/produtos/foto.png?width=160&resize=contain&quality=70",
    );
  });

  it("troca a consulta que já existia em vez de empilhar parâmetros", () => {
    expect(miniaturaDeCompra(`${original}?v=3`)).toBe(
      "https://gnjsrucsmjkajijrakzr.supabase.co/storage/v1/render/image/public/produtos/foto.png?width=160&resize=contain&quality=70",
    );
  });

  it("endereço de fora do Storage volta intacto", () => {
    expect(miniaturaDeCompra("https://cdn.exemplo.com/a.png")).toBe(
      "https://cdn.exemplo.com/a.png",
    );
    expect(miniaturaDeCompra("data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA",
    );
  });

  it("sem foto devolve texto vazio, nunca 'undefined' nem 'null'", () => {
    expect(miniaturaDeCompra(undefined)).toBe("");
    expect(miniaturaDeCompra(null)).toBe("");
    expect(miniaturaDeCompra("")).toBe("");
  });
});
