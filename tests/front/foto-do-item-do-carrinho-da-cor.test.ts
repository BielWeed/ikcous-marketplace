// A página do produto mostra a foto da COR escolhida mesmo quando o tamanho
// escolhido não tem foto própria (a foto da cor costuma estar numa linha só da
// grade). O carrinho e o resumo do pedido caíam direto na capa, que pode ser de
// outra cor. Aqui: a linha sem foto procura a foto da mesma cor antes da capa.
import { fotoDoItemDoCarrinho } from "@/lib/foto-do-item-do-carrinho";
import type { CartItem, Product, ProductVariant } from "@/types";
import { describe, expect, it } from "vitest";

const CAPA_VERMELHA = "https://loja.test/capa-vermelha.jpg";
const FOTO_AZUL = "https://loja.test/azul.jpg";
const FOTO_AZUL_G = "https://loja.test/azul-g.jpg";
const FOTO_ROSA = "https://loja.test/rosa.jpg";

const linhaDaGrade = (
  valor: string,
  extra: Partial<ProductVariant> = {},
  nome = "Cor / Tamanho",
): ProductVariant => ({
  id: valor,
  productId: "p1",
  name: nome,
  value: valor,
  stockIncrement: 5,
  active: true,
  ...extra,
});

const produto = (variants: ProductVariant[]) =>
  ({
    id: "p1",
    name: "Camiseta",
    description: "",
    price: 10,
    images: [CAPA_VERMELHA],
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

describe("fotoDoItemDoCarrinho: foto da cor quando o tamanho não tem foto", () => {
  it("Azul/M sem foto e Azul/P com foto: mostra a foto do azul, não a capa", () => {
    const p = produto([
      linhaDaGrade("Azul / P", { imageUrl: FOTO_AZUL }),
      linhaDaGrade("Azul / M"),
    ]);
    expect(fotoDoItemDoCarrinho(linha(p, { variantId: "Azul / M" }))).toBe(
      FOTO_AZUL,
    );
  });

  it("a linha com foto própria usa a própria, não a da cor", () => {
    const p = produto([
      linhaDaGrade("Azul / P", { imageUrl: FOTO_AZUL }),
      linhaDaGrade("Azul / G", { imageUrl: FOTO_AZUL_G }),
    ]);
    expect(fotoDoItemDoCarrinho(linha(p, { variantId: "Azul / G" }))).toBe(
      FOTO_AZUL_G,
    );
  });

  it("cor sem nenhuma foto na grade: a capa", () => {
    const p = produto([linhaDaGrade("Azul / P"), linhaDaGrade("Azul / M")]);
    expect(fotoDoItemDoCarrinho(linha(p, { variantId: "Azul / M" }))).toBe(
      CAPA_VERMELHA,
    );
  });

  it("outra cor tem foto mas a escolhida não: não usa a foto da outra cor", () => {
    const p = produto([
      linhaDaGrade("Rosa / P", { imageUrl: FOTO_ROSA }),
      linhaDaGrade("Azul / M"),
    ]);
    expect(fotoDoItemDoCarrinho(linha(p, { variantId: "Azul / M" }))).toBe(
      CAPA_VERMELHA,
    );
  });

  it("produto sem eixo de cor (só tamanho): a capa", () => {
    const p = produto([
      linhaDaGrade("P", { imageUrl: FOTO_AZUL }, "Tamanho"),
      linhaDaGrade("M", {}, "Tamanho"),
    ]);
    expect(fotoDoItemDoCarrinho(linha(p, { variantId: "M" }))).toBe(
      CAPA_VERMELHA,
    );
  });

  it("variação que sumiu do produto: a capa", () => {
    const p = produto([linhaDaGrade("Azul / P", { imageUrl: FOTO_AZUL })]);
    expect(fotoDoItemDoCarrinho(linha(p, { variantId: "Azul / XG" }))).toBe(
      CAPA_VERMELHA,
    );
  });

  it("foto da cor vazia ou só espaços não conta: a capa", () => {
    const p = produto([
      linhaDaGrade("Azul / P", { imageUrl: "   " }),
      linhaDaGrade("Azul / M"),
    ]);
    expect(fotoDoItemDoCarrinho(linha(p, { variantId: "Azul / M" }))).toBe(
      CAPA_VERMELHA,
    );
  });

  it("duas escolhas (cadastro antigo): a primeira com foto continua na frente", () => {
    const p = produto([
      linhaDaGrade("P", {}, "Tamanho"),
      linhaDaGrade("Azul", { imageUrl: FOTO_AZUL }, "Cor"),
      linhaDaGrade("Rosa", { imageUrl: FOTO_ROSA }, "Cor"),
    ]);
    expect(
      fotoDoItemDoCarrinho(
        linha(p, { variantId: "P", outrasVariantIds: ["Azul"] }),
      ),
    ).toBe(FOTO_AZUL);
  });
});
