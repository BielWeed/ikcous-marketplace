// A ficha da devolucao diz "voltou sem tamanho" POR ITEM (20261653000000): o
// banco devolve os itens da devolucao que deixaram peca esperando, gravados na
// hora da conclusao. Loja sem a migration: a leitura antiga, por produto, so
// para o item sem variacao (o unico que a 20261642000000 sozinha poe no
// cantinho). Ids inventados.
import {
  itemEsperaTamanho,
  lerItensQueEsperamTamanho,
} from "@/lib/pecas-sem-tamanho";
import { describe, expect, it } from "vitest";

const VOLTOU = "2026-11-27T13:00:00Z";
const item = (
  id: string,
  variant: string | null,
  reestocado: string | null = VOLTOU,
  produto: string | null = "p-1",
) => ({
  id,
  product_id: produto,
  variant_id: variant,
  reestocado_em: reestocado,
});

describe("lerItensQueEsperamTamanho", () => {
  it("le as linhas da RPC", () => {
    expect(
      lerItensQueEsperamTamanho([
        { devolucao_item_id: "di-1" },
        { devolucao_item_id: "di-2" },
      ]),
    ).toEqual(["di-1", "di-2"]);
    expect(lerItensQueEsperamTamanho([])).toEqual([]);
  });

  it("forma torta = nao sei (null)", () => {
    for (const torta of [
      null,
      undefined,
      {},
      "di-1",
      [null],
      [{}],
      [{ devolucao_item_id: null }],
      [{ devolucao_item_id: "" }],
      [{ devolucao_item_id: 7 }],
    ])
      expect(lerItensQueEsperamTamanho(torta)).toBeNull();
  });
});

describe("itemEsperaTamanho", () => {
  const porItem = { porItem: new Set(["di-M"]) };

  it("pelo item: o do tamanho desligado espera, mesmo COM variacao", () => {
    expect(itemEsperaTamanho(item("di-M", "v-M"), porItem)).toBe(true);
  });

  it("pelo item: outro item do MESMO produto, de tamanho ligado e creditado, voltou ao estoque", () => {
    expect(itemEsperaTamanho(item("di-P", "v-P"), porItem)).toBe(false);
    expect(itemEsperaTamanho(item("di-sem", null), porItem)).toBe(false);
  });

  it("item que nao voltou (sem reestocado_em) nunca espera", () => {
    expect(itemEsperaTamanho(item("di-M", "v-M", null), porItem)).toBe(false);
  });

  it("nao sei (null): ninguem espera", () => {
    expect(itemEsperaTamanho(item("di-M", "v-M"), null)).toBe(false);
  });

  it("loja sem a 20261653000000: por produto, so o item SEM variacao", () => {
    const porProduto = { porProdutoSemVariacao: new Set(["p-1"]) };
    expect(itemEsperaTamanho(item("di-1", null), porProduto)).toBe(true);
    expect(itemEsperaTamanho(item("di-2", "v-M"), porProduto)).toBe(false);
    expect(
      itemEsperaTamanho(item("di-3", null, VOLTOU, "p-9"), porProduto),
    ).toBe(false);
    expect(
      itemEsperaTamanho(item("di-4", null, VOLTOU, null), porProduto),
    ).toBe(false);
  });
});
