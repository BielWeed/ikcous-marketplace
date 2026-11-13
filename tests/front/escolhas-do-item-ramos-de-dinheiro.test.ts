// Ramo de dinheiro do preço da escolha: preço ZERO na variação é brinde, não
// "sem preço". Só ausência (undefined) cai para o preço do produto.
import { describe, expect, it } from "vitest";

import { precoDaEscolha } from "@/lib/escolhas-do-item";
import type { ProductVariant } from "@/types";

function variacao(extra: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: "vt-1",
    productId: "p-1",
    name: "Cor",
    value: "Azul",
    stockIncrement: 1,
    active: true,
    ...extra,
  };
}

describe("precoDaEscolha — ramos de dinheiro", () => {
  it("variação com preço 0 (brinde) cobra R$ 0, não o preço do produto", () => {
    expect(
      precoDaEscolha({ price: 50 }, [variacao({ priceOverride: 0 })]),
    ).toBe(0);
  });

  it("variação sem preço próprio cai para o preço do produto", () => {
    expect(precoDaEscolha({ price: 50 }, [variacao()])).toBe(50);
  });
});
