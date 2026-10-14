import {
  aplicarCatalogoAoCarrinho,
  avisosDoCarrinho,
  montarCatalogo,
} from "@/lib/catalogo-do-carrinho";
import { mapProductFromDB } from "@/lib/mappers";
import { formatCurrency } from "@/lib/utils";
import type { CartItem } from "@/types";
import { describe, expect, it } from "vitest";

type Linha = Record<string, unknown>;

const linha = (extra: Linha = {}): Linha => ({
  id: "a",
  nome: "Camiseta",
  preco_venda: 10,
  estoque: 10,
  ativo: true,
  imagens: [],
  categoria: "geral",
  ...extra,
});

const variacao = (id: string, extra: Linha = {}): Linha => ({
  id,
  product_id: "a",
  name: "Tamanho",
  value: id,
  stock_increment: 10,
  price_override: null,
  active: true,
  ...extra,
});

const item = (
  produtoLinha: Linha,
  quantity: number,
  extra: Partial<CartItem> = {},
  variacoes: Linha[] = [],
): CartItem => ({
  product: mapProductFromDB({ ...produtoLinha, product_variants: variacoes }),
  quantity,
  lastModifiedAt: 1000,
  ...extra,
});

describe("aplicarCatalogoAoCarrinho", () => {
  it("nada mudou: devolve o MESMO array e os MESMOS itens", () => {
    const itens = [item(linha(), 2)];
    const catalogo = montarCatalogo(["a"], [linha()], []);
    const r = aplicarCatalogoAoCarrinho(itens, catalogo, 5000);
    expect(r).toBe(itens);
    expect(r[0]).toBe(itens[0]);
  });

  it("id que NÃO foi consultado fica como está (nunca vira 'sumiu')", () => {
    const itens = [item(linha({ id: "b" }), 1)];
    const catalogo = montarCatalogo(["a"], [linha()], []);
    expect(aplicarCatalogoAoCarrinho(itens, catalogo, 5000)).toBe(itens);
  });

  it("preço novo: troca só o produto; quantidade e carimbo da cliente ficam", () => {
    const itens = [item(linha(), 2)];
    const catalogo = montarCatalogo(["a"], [linha({ preco_venda: 12 })], []);
    const [novo] = aplicarCatalogoAoCarrinho(itens, catalogo, 5000);
    expect(novo.product.price).toBe(12);
    expect(novo.quantity).toBe(2);
    expect(novo.lastModifiedAt).toBe(1000);
  });

  it("quantidade acima do estoque desce ao que há e o carimbo é renovado", () => {
    const itens = [item(linha(), 5)];
    const catalogo = montarCatalogo(["a"], [linha({ estoque: 2 })], []);
    const [novo] = aplicarCatalogoAoCarrinho(itens, catalogo, 5000);
    expect(novo.quantity).toBe(2);
    expect(novo.lastModifiedAt).toBe(5000);
  });

  it("produto que não voltou (pausado) sai; o vizinho fica", () => {
    const itens = [item(linha(), 1), item(linha({ id: "b" }), 1)];
    const catalogo = montarCatalogo(["a", "b"], [linha({ id: "b" })], []);
    const r = aplicarCatalogoAoCarrinho(itens, catalogo, 5000);
    expect(r.map((i) => i.product.id)).toEqual(["b"]);
  });

  it("duas variações do mesmo produto: cada linha usa o estoque DA SUA variação", () => {
    const vs = [variacao("P", { stock_increment: 0 }), variacao("M")];
    const itens = [
      item(linha(), 1, { variantId: "P" }, [variacao("P"), variacao("M")]),
      item(linha(), 1, { variantId: "M" }, [variacao("P"), variacao("M")]),
    ];
    const catalogo = montarCatalogo(["a"], [linha()], vs);
    const r = aplicarCatalogoAoCarrinho(itens, catalogo, 5000);
    expect(r.map((i) => i.variantId)).toEqual(["M"]);
  });
});

describe("avisosDoCarrinho", () => {
  it("nada mudou: nenhum aviso", async () => {
    const catalogo = montarCatalogo(["a"], [linha()], []);
    expect(await avisosDoCarrinho([item(linha(), 2)], catalogo)).toEqual([]);
  });

  it("duas variações do mesmo produto sobem de preços diferentes: um aviso para CADA linha, com os valores dela", async () => {
    const antes = [
      variacao("P", { price_override: 20 }),
      variacao("M", { price_override: 30 }),
    ];
    const agora = [
      variacao("P", { price_override: 25 }),
      variacao("M", { price_override: 30 }),
    ];
    const itens = [
      item(linha(), 1, { variantId: "P", variantNames: "Tamanho: P" }, antes),
      item(linha(), 1, { variantId: "M", variantNames: "Tamanho: M" }, antes),
    ];
    const catalogo = montarCatalogo(["a"], [linha()], agora);
    const frases = await avisosDoCarrinho(itens, catalogo);
    expect(frases).toHaveLength(1);
    expect(frases[0]).toContain("Tamanho: P");
    expect(frases[0]).toContain(formatCurrency(20));
    expect(frases[0]).toContain(formatCurrency(25));
  });

  it("preço E estoque mudaram: as duas frases saem (aceitar o preço não leva a outra recusa)", async () => {
    const catalogo = montarCatalogo(
      ["a"],
      [linha({ preco_venda: 12, estoque: 1 })],
      [],
    );
    const frases = await avisosDoCarrinho([item(linha(), 3)], catalogo);
    expect(frases).toHaveLength(2);
    expect(frases.some((f) => f.includes("Só restam 1 unidade "))).toBe(true);
    expect(frases.some((f) => f.includes("mudou de"))).toBe(true);
  });

  it("item que sai (esgotado): só a frase de saída, sem 'o preço mudou'", async () => {
    const catalogo = montarCatalogo(
      ["a"],
      [linha({ preco_venda: 12, estoque: 0 })],
      [],
    );
    const frases = await avisosDoCarrinho([item(linha(), 3)], catalogo);
    expect(frases).toHaveLength(1);
    expect(frases[0]).toContain("esgotou");
  });
});
