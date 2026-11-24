// Caça de provas fracas (carrinho, 24/11/2026): "estoque curto" é estoque MENOR
// que a quantidade da linha. Levar exatamente o que há no estoque é um pedido
// que o banco aceita, e a tela não pode avisar nem recusar por isso. O teste
// existente só tinha estoque folgado (5 para 2) e estoque faltando; trocar o
// `<` por `<=` passava a suíte inteira e a cliente com a ÚLTIMA unidade no
// carrinho era barrada no pagamento.
import { reconferirCarrinho } from "@/lib/reconferirCarrinho";
import type { CartItem, Product } from "@/types";
import { describe, expect, it } from "vitest";

const produto = (id: string, price: number): Product => ({
  id,
  name: `Produto ${id}`,
  description: "",
  price,
  images: [],
  category: "geral",
  stock: 99,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-08-28T00:00:00Z",
});
const item = (id: string, price: number, quantity: number): CartItem => ({
  product: produto(id, price),
  quantity,
});
const leitor = (estoque: number) => ({
  lerProdutos: async () => [
    { id: "a", nome: "Produto a", preco: 10, estoque, ativo: true },
  ],
});

describe("reconferirCarrinho: estoque igual à quantidade", () => {
  it("levar exatamente o estoque que há: nenhuma mudança e o banco não recusa", async () => {
    const r = await reconferirCarrinho([item("a", 10, 3)], leitor(3));

    expect(r).toEqual({ mudancas: [], oBancoRecusaria: false });
  });

  it("controle: um a menos que a quantidade é estoque curto", async () => {
    const r = await reconferirCarrinho([item("a", 10, 3)], leitor(2));

    expect(r.mudancas).toEqual([
      { productId: "a", nome: "Produto a", tipo: "estoque", de: 3, para: 2 },
    ]);
    expect(r.oBancoRecusaria).toBe(true);
  });
});
