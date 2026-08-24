import { describe, expect, it } from "vitest";

import { mapProductFromDB } from "@/lib/mappers";

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

describe("mapProductFromDB repassa o estoque minimo", () => {
  it("traz o valor quando o produto tem um proprio", () => {
    expect(
      mapProductFromDB(linhaDoBanco({ estoque_minimo: 2 })).estoqueMinimo,
    ).toBe(2);
  });

  it("traz zero como ZERO, nao como ausente", () => {
    expect(
      mapProductFromDB(linhaDoBanco({ estoque_minimo: 0 })).estoqueMinimo,
    ).toBe(0);
  });

  it("traz null quando a coluna e' nula", () => {
    expect(
      mapProductFromDB(linhaDoBanco({ estoque_minimo: null })).estoqueMinimo,
    ).toBeNull();
  });
});
