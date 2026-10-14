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

// "Você também pode gostar" levava peça com tamanho/cor ao carrinho SEM
// escolha (14/10/2026). O servidor recusa essa linha no pagamento ("Escolha
// uma variação para o produto X") e o carrinho não tem como escolher
// tamanho — então a linha sai do carrinho COM o aviso, antes de a cliente
// preencher o checkout. Mesma regra do servidor: só vale quando o produto tem
// variação ATIVA; produto sem variação (ou com todas desativadas) segue.
describe("linha SEM variação de produto que TEM variação ativa", () => {
  const duas = () => [variacao("P"), variacao("M")];

  it("aplicar: a linha sem tamanho sai; o vizinho sem variação fica", () => {
    const itens = [
      item(linha(), 1), // cópia velha: sem variações, sem variantId
      item(linha({ id: "b", nome: "Bolsa" }), 1),
    ];
    const catalogo = montarCatalogo(
      ["a", "b"],
      [linha(), linha({ id: "b", nome: "Bolsa" })],
      duas(),
    );
    const r = aplicarCatalogoAoCarrinho(itens, catalogo, 5000);
    expect(r.map((i) => i.product.id)).toEqual(["b"]);
  });

  it("aplicar: a linha COM a variação escolhida fica (linha legítima)", () => {
    const itens = [item(linha(), 1, { variantId: "P" }, duas())];
    const catalogo = montarCatalogo(["a"], [linha()], duas());
    expect(aplicarCatalogoAoCarrinho(itens, catalogo, 5000)).toBe(itens);
  });

  it("aplicar: variações TODAS desativadas = produto vendável pelo base; a linha fica", () => {
    const itens = [item(linha(), 1)];
    const catalogo = montarCatalogo(
      ["a"],
      [linha()],
      [variacao("P", { active: false })],
    );
    const r = aplicarCatalogoAoCarrinho(itens, catalogo, 5000);
    expect(r.map((i) => [i.product.id, i.quantity])).toEqual([["a", 1]]);
  });

  it("aplicar: produto que não foi consultado fica como está", () => {
    const itens = [item(linha(), 1)];
    const catalogo = montarCatalogo(["z"], [linha({ id: "z" })], []);
    expect(aplicarCatalogoAoCarrinho(itens, catalogo, 5000)).toBe(itens);
  });

  it("avisos: diz que falta escolher tamanho/cor e que a linha saiu — sem 'não está mais à venda' nem 'preço mudou'", async () => {
    const itens = [item(linha({ nome: "Vestido Midi" }), 1)];
    const catalogo = montarCatalogo(
      ["a"],
      [linha({ nome: "Vestido Midi", preco_venda: 12 })],
      duas(),
    );
    const frases = await avisosDoCarrinho(itens, catalogo);
    expect(frases).toHaveLength(1);
    expect(frases[0]).toContain('"Vestido Midi"');
    expect(frases[0]).toContain("tamanho");
    expect(frases[0]).toContain("saiu do seu carrinho");
    expect(frases[0]).not.toContain("não está mais à venda");
    expect(frases[0]).not.toContain("mudou de");
  });

  it("avisos: linha com a variação escolhida, produto sem variação e variações todas desativadas NÃO geram aviso", async () => {
    const comEscolha = item(linha(), 1, { variantId: "P" }, duas());
    const catalogoComVariacao = montarCatalogo(["a"], [linha()], duas());
    expect(await avisosDoCarrinho([comEscolha], catalogoComVariacao)).toEqual(
      [],
    );

    const semVariacao = item(linha({ id: "b" }), 1);
    const catalogoSem = montarCatalogo(["b"], [linha({ id: "b" })], []);
    expect(await avisosDoCarrinho([semVariacao], catalogoSem)).toEqual([]);

    const todasDesativadas = item(linha(), 1);
    const catalogoInativo = montarCatalogo(
      ["a"],
      [linha()],
      [variacao("P", { active: false })],
    );
    expect(await avisosDoCarrinho([todasDesativadas], catalogoInativo)).toEqual(
      [],
    );
  });
});
