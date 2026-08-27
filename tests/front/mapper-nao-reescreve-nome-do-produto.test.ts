import { describe, expect, it } from "vitest";

import { mapProductFromDB } from "@/lib/mappers";

/**
 * `mapProductFromDB` tinha um `if` escondido que trocava o nome "boobie
 * goods" (e "Boobie Goods") por "Bobbie Goods" antes de devolver o produto.
 * Quem manda no catálogo é a lojista: o que ela digitou no cadastro é o que
 * tem de aparecer na loja, sem reescrita silenciosa no código.
 */
function linhaDoBanco(extra: Record<string, unknown> = {}) {
  return {
    id: "prod-1",
    name: "Caneta 3D",
    description: "",
    price: 10,
    estoque: 7,
    ativo: true,
    created_at: "2026-08-24T10:00:00.000Z",
    ...extra,
  } as any;
}

describe("mapProductFromDB não reescreve o nome do produto", () => {
  it('"boobie goods" (minúsculo) chega igual ao que a lojista digitou', () => {
    expect(mapProductFromDB(linhaDoBanco({ name: "boobie goods" })).name).toBe(
      "boobie goods",
    );
  });

  it('"Boobie Goods" (capitalizado) também chega sem reescrita', () => {
    expect(mapProductFromDB(linhaDoBanco({ name: "Boobie Goods" })).name).toBe(
      "Boobie Goods",
    );
  });

  it("qualquer outro nome continua passando direto, como já era", () => {
    expect(
      mapProductFromDB(linhaDoBanco({ name: "Caneca Térmica" })).name,
    ).toBe("Caneca Térmica");
  });
});
