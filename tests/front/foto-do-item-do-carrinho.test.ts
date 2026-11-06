// Carrinho e resumo do pedido mostravam SEMPRE a primeira foto do produto, mesmo
// quando a cliente escolheu uma cor que tem foto própria. O helper puro decide
// QUAL foto a linha mostra; o tratamento de miniatura/CDN continua nas telas.
import { fotoDoItemDoCarrinho } from "@/lib/foto-do-item-do-carrinho";
import type { CartItem, Product, ProductVariant } from "@/types";
import { describe, expect, it } from "vitest";

const FOTO_DO_PRODUTO = "https://loja.test/produto.jpg";
const FOTO_AZUL = "https://loja.test/azul.jpg";
const FOTO_ROSA = "https://loja.test/rosa.jpg";

const variacao = (
  id: string,
  extra: Partial<ProductVariant> = {},
): ProductVariant => ({
  id,
  productId: "p1",
  name: "Cor",
  value: id,
  stockIncrement: 5,
  active: true,
  ...extra,
});

const produto = (variants: ProductVariant[], images = [FOTO_DO_PRODUTO]) =>
  ({
    id: "p1",
    name: "Camiseta",
    description: "",
    price: 10,
    images,
    category: "geral",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    variants,
  }) as Product;

const linha = (p: Product, extra: Partial<CartItem> = {}): CartItem => ({
  product: p,
  quantity: 1,
  ...extra,
});

describe("fotoDoItemDoCarrinho", () => {
  it("cor com foto: mostra a foto da cor escolhida, não a do produto", () => {
    const p = produto([
      variacao("azul", { imageUrl: FOTO_AZUL }),
      variacao("rosa", { imageUrl: FOTO_ROSA }),
    ]);
    expect(fotoDoItemDoCarrinho(linha(p, { variantId: "rosa" }))).toBe(
      FOTO_ROSA,
    );
    expect(fotoDoItemDoCarrinho(linha(p, { variantId: "azul" }))).toBe(
      FOTO_AZUL,
    );
  });

  it("cor sem foto: cai na primeira foto do produto", () => {
    const p = produto([
      variacao("azul"),
      variacao("rosa", { imageUrl: FOTO_ROSA }),
    ]);
    expect(fotoDoItemDoCarrinho(linha(p, { variantId: "azul" }))).toBe(
      FOTO_DO_PRODUTO,
    );
  });

  it("foto da cor vazia ou só espaços não conta como foto", () => {
    const p = produto([variacao("azul", { imageUrl: "   " })]);
    expect(fotoDoItemDoCarrinho(linha(p, { variantId: "azul" }))).toBe(
      FOTO_DO_PRODUTO,
    );
  });

  it("item sem variação: foto do produto", () => {
    const p = produto([variacao("azul", { imageUrl: FOTO_AZUL })]);
    expect(fotoDoItemDoCarrinho(linha(p))).toBe(FOTO_DO_PRODUTO);
  });

  it("variação que não existe mais no produto: foto do produto, sem quebrar", () => {
    const p = produto([variacao("azul", { imageUrl: FOTO_AZUL })]);
    expect(fotoDoItemDoCarrinho(linha(p, { variantId: "sumiu" }))).toBe(
      FOTO_DO_PRODUTO,
    );
  });

  it("produto sem variações cadastradas (lista ausente): foto do produto", () => {
    const p = { ...produto([]), variants: undefined } as Product;
    expect(fotoDoItemDoCarrinho(linha(p, { variantId: "azul" }))).toBe(
      FOTO_DO_PRODUTO,
    );
  });

  it("duas escolhas (cadastro antigo): vale a primeira que tem foto, na ordem da linha", () => {
    const p = produto([
      variacao("p", { name: "Tamanho" }),
      variacao("azul", { imageUrl: FOTO_AZUL }),
    ]);
    expect(
      fotoDoItemDoCarrinho(
        linha(p, { variantId: "p", outrasVariantIds: ["azul"] }),
      ),
    ).toBe(FOTO_AZUL);
  });

  it("duas escolhas com foto nas duas: ganha a primeira da linha (variantId)", () => {
    const p = produto([
      variacao("azul", { imageUrl: FOTO_AZUL }),
      variacao("rosa", { imageUrl: FOTO_ROSA }),
    ]);
    expect(
      fotoDoItemDoCarrinho(
        linha(p, { variantId: "rosa", outrasVariantIds: ["azul"] }),
      ),
    ).toBe(FOTO_ROSA);
  });

  it("sem foto nenhuma (produto e cor): devolve undefined para a tela usar o espaço reservado", () => {
    const p = produto([variacao("azul")], []);
    expect(
      fotoDoItemDoCarrinho(linha(p, { variantId: "azul" })),
    ).toBeUndefined();
    expect(
      fotoDoItemDoCarrinho(
        linha({ ...p, images: undefined } as unknown as Product),
      ),
    ).toBeUndefined();
  });
});
