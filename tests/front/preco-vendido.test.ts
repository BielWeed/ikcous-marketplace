// Laudo caça-bugs 31/08 (menor E): variação com preço 0 legítimo era
// cobrada pelo preço CHEIO do produto. O `priceOverride || product.price`
// trata 0 como ausência — e 0 é um PREÇO (brinde/kit), não "não informei".
// O servidor (`create_marketplace_order_v23/v24`) sempre soube disso:
// `COALESCE(v.price_override, p.preco_venda)` recusava o pedido com "os
// valores mudaram" enquanto as quatro telas mostravam outro total. Esta
// função única é o lado da tela da MESMA regra — as quatro cópias morrem
// aqui.
//
// O assassino de mutantes: trocar `??` por `||` de volta faz o caso do
// ZERO falhar — é exatamente o defeito que nasceu com este arquivo.

import { precoVendido } from "@/lib/preco-vendido";
import { describe, expect, it } from "vitest";

const produto = { price: 50 };
const variante = (priceOverride: number | null | undefined) => ({
  priceOverride,
});

describe("precoVendido — a mesma regra do COALESCE do servidor", () => {
  it("sem variação: preço do produto", () => {
    expect(precoVendido(produto, null)).toBe(50);
    expect(precoVendido(produto, undefined)).toBe(50);
  });

  it("variação sem override (null): preço do produto", () => {
    expect(precoVendido(produto, variante(null))).toBe(50);
  });

  it("override positivo: preço da variação", () => {
    expect(precoVendido(produto, variante(79.9))).toBe(79.9);
  });

  it("override ZERO é um preço: NÃO cai no preço do produto", () => {
    expect(precoVendido(produto, variante(0))).toBe(0);
  });

  it("variação que não existe mais no produto: preço do produto", () => {
    expect(precoVendido(produto, {} as any)).toBe(50);
  });
});
