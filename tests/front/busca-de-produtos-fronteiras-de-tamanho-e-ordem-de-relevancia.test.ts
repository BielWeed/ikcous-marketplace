// Caça por mutação (24/11/2026), `busca-de-produtos`: fronteiras de tamanho
// que decidem se uma palavra vale como TRECHO ou como PALAVRA INTEIRA, e a
// ORDEM da relevância (nome exato > começa com > contém; categoria exata >
// categoria que contém; descrição; código). As provas comparam produtos entre
// si — não fixam o número de pontos, só quem vem na frente de quem.
import {
  pontuadorDaBusca,
  produtoCombinaComBusca,
} from "@/lib/busca-de-produtos";
import { describe, expect, it } from "vitest";

const base = { name: "Camisa", category: "Roupas", description: "" };

describe("busca — palavra curta contra o valor de uma variação", () => {
  const verde = {
    ...base,
    variants: [{ value: "Verde", active: true, stockIncrement: 1 }],
  };

  it("duas letras só acham variação como palavra inteira, nunca como trecho ('ve' não acha Verde)", () => {
    expect(produtoCombinaComBusca(verde, "ve")).toBe(false);
  });

  it("três letras já valem como trecho ('ver' acha Verde)", () => {
    expect(produtoCombinaComBusca(verde, "ver")).toBe(true);
  });

  it("'gg' acha o tamanho GG inteiro, mas não o GGG", () => {
    const gg = {
      ...base,
      variants: [{ value: "GG", active: true, stockIncrement: 1 }],
    };
    const ggg = {
      ...base,
      variants: [{ value: "GGG", active: true, stockIncrement: 1 }],
    };
    expect(produtoCombinaComBusca(gg, "gg")).toBe(true);
    expect(produtoCombinaComBusca(ggg, "gg")).toBe(false);
  });
});

describe("busca — singular derivado de 4 letras vale como trecho (de 3, só como palavra inteira)", () => {
  it("'flores' acha 'Florzinha' (flor, 4 letras, por trecho)", () => {
    expect(
      produtoCombinaComBusca({ ...base, name: "Florzinha rosa" }, "flores"),
    ).toBe(true);
  });

  it("'cores' (cor, 3 letras) NÃO acha 'Corrente' por trecho, mas acha a palavra inteira 'Cor'", () => {
    expect(
      produtoCombinaComBusca({ ...base, name: "Corrente dourada" }, "cores"),
    ).toBe(false);
    expect(
      produtoCombinaComBusca({ ...base, name: "Cor da estação" }, "cores"),
    ).toBe(true);
  });
});

describe("busca — ordem da relevância", () => {
  const nota = (
    busca: string,
    produto: {
      name: string;
      category?: string;
      description?: string;
      sku?: string;
      variants?: {
        value: string;
        active: boolean;
        stockIncrement?: number;
        sku?: string;
      }[];
    },
  ) => pontuadorDaBusca(busca)({ category: "Outros", ...produto });

  it("nome igual à busca > nome que começa com ela > nome que só a contém", () => {
    const exato = nota("bolsa", { name: "Bolsa" });
    const comeca = nota("bolsa", { name: "Bolsa grande" });
    const contem = nota("bolsa", { name: "Grande bolsa" });
    expect(exato).toBeGreaterThan(comeca);
    expect(comeca).toBeGreaterThan(contem);
    expect(contem).toBeGreaterThan(0);
  });

  it("categoria igual à busca > categoria que a contém > palavra só no nome (plural)", () => {
    const exata = nota("vestidos", { name: "Peça", category: "Vestidos" });
    const contem = nota("vestidos", {
      name: "Peça",
      category: "Vestidos de festa",
    });
    // "vestidos" não está contido em "Vestido azul": só a palavra no singular.
    const soNoNome = nota("vestidos", { name: "Vestido azul" });
    expect(exata).toBeGreaterThan(contem);
    expect(contem).toBeGreaterThan(soNoNome);
  });

  it("achar na descrição pontua; não achar, não", () => {
    const comDescricao = nota("pelucia", {
      name: "Urso",
      description: "Uma pelucia macia",
    });
    const semDescricao = nota("pelucia", { name: "Urso", description: "" });
    expect(comDescricao).toBeGreaterThan(semDescricao);
  });

  it("código exato do produto > código parcial > nenhum", () => {
    const exato = nota("ab12", { name: "Peça", sku: "AB12" });
    const parcial = nota("ab12", { name: "Peça", sku: "AB123" });
    const nenhum = nota("ab12", { name: "Peça", sku: "ZZ99" });
    expect(exato).toBeGreaterThan(parcial);
    expect(parcial).toBeGreaterThan(nenhum);
  });

  it("o código exato vence até o melhor casamento de nome", () => {
    const porCodigo = nota("bolsa", { name: "Peça", sku: "bolsa" });
    const porNome = nota("bolsa", { name: "Bolsa", description: "bolsa" });
    expect(porCodigo).toBeGreaterThan(porNome);
  });

  it("o código de uma variação INATIVA não pontua; o da ativa sim", () => {
    const ativa = nota("v-77", {
      name: "Peça",
      variants: [{ value: "P", active: true, stockIncrement: 1, sku: "V-77" }],
    });
    const inativa = nota("v-77", {
      name: "Peça",
      variants: [{ value: "P", active: false, stockIncrement: 1, sku: "V-77" }],
    });
    expect(ativa).toBeGreaterThan(inativa);
  });
});
