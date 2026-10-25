// A comparação "o que a lojista mudou" do salvar de produto, em função pura.
// A prova pela tela está em admin-product-form-salvar-so-o-que-mudou.
import { describe, expect, it } from "vitest";

import {
  camposQueMudaram,
  variacoesQueMudaram,
} from "@/utils/campos-mexidos-do-produto";

describe("camposQueMudaram", () => {
  it("só devolve o que mudou", () => {
    expect(
      camposQueMudaram({ name: "A", price: 10 }, { name: "A", price: 12 }),
    ).toEqual({ price: 10 });
  });

  it("mudou para vazio (null) continua indo como null", () => {
    expect(
      camposQueMudaram({ originalPrice: null }, { originalPrice: 99 }),
    ).toEqual({ originalPrice: null });
  });

  it("vazio que continua vazio não vai", () => {
    expect(
      camposQueMudaram({ originalPrice: null }, { originalPrice: null }),
    ).toEqual({});
  });

  it("era vazio e ganhou valor vai", () => {
    expect(camposQueMudaram({ costPrice: 5 }, { costPrice: null })).toEqual({
      costPrice: 5,
    });
  });

  it("undefined do lado de cá é 'não mexi': nunca vai (a guarda do hook o descartaria de qualquer jeito)", () => {
    expect(camposQueMudaram({ weightKg: undefined }, { weightKg: 3 })).toEqual(
      {},
    );
  });

  it("lista de fotos compara por conteúdo e por ordem", () => {
    expect(
      camposQueMudaram({ images: ["a", "b"] }, { images: ["a", "b"] }),
    ).toEqual({});
    expect(
      camposQueMudaram({ images: ["b", "a"] }, { images: ["a", "b"] }),
    ).toEqual({ images: ["b", "a"] });
    expect(camposQueMudaram({ images: [] }, { images: ["a"] })).toEqual({
      images: [],
    });
  });

  it("campo que a base não tem conta como mudado", () => {
    expect(camposQueMudaram({ sku: "X" }, {} as { sku: string })).toEqual({
      sku: "X",
    });
  });
});

const v = (extra: Record<string, unknown> = {}) => ({
  id: "v1",
  name: "Cor",
  value: "Rosa",
  stockIncrement: 3,
  active: true,
  ...extra,
});

describe("variacoesQueMudaram", () => {
  it("variação igual à de abertura fica de fora", () => {
    expect(variacoesQueMudaram([v()], [v()])).toEqual([]);
  });

  it("sku vazio e ausente são a mesma coisa", () => {
    expect(variacoesQueMudaram([v({ sku: "" })], [v()])).toEqual([]);
  });

  it("cada campo gravado conta: nome, valor, código, barras, estoque, preço próprio, ligada, foto", () => {
    for (const mudanca of [
      { name: "Tam" },
      { value: "Azul" },
      { sku: "NOVO" },
      { codigoBarras: "789" },
      { stockIncrement: 4 },
      { priceOverride: 55 },
      { active: false },
      { imageUrl: "https://x/y.jpg" },
    ]) {
      expect(variacoesQueMudaram([v(mudanca)], [v()])).toHaveLength(1);
    }
  });

  it("apagar o preço próprio (era 55, ficou sem) é mudança", () => {
    expect(
      variacoesQueMudaram(
        [v({ priceOverride: undefined })],
        [v({ priceOverride: 55 })],
      ),
    ).toHaveLength(1);
  });

  it("variação nova (temp-) e variação que a tela não leu ao abrir sempre vão", () => {
    expect(
      variacoesQueMudaram([v({ id: "temp-1" })], [v({ id: "temp-1" })]),
    ).toHaveLength(1);
    expect(variacoesQueMudaram([v({ id: "v9" })], [v()])).toHaveLength(1);
  });

  it("mexer numa não arrasta as outras", () => {
    const atuais = [
      v(),
      v({ id: "v2", value: "Azul", priceOverride: 65 }),
      v({ id: "v3", value: "Verde", name: "Cor!" }),
    ];
    const iniciais = [
      v(),
      v({ id: "v2", value: "Azul", priceOverride: 65 }),
      v({ id: "v3", value: "Verde" }),
    ];
    expect(variacoesQueMudaram(atuais, iniciais).map((x) => x.id)).toEqual([
      "v3",
    ]);
  });
});
