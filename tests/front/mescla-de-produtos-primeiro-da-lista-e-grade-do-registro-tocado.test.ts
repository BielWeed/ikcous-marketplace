// Duas lacunas do merge de realtime da lista de produtos:
//  1. o PRIMEIRO produto da lista (posição 0) também é achado, trocado e
//     removido — a busca por posição tem de tratar 0 como "achou";
//  2. `registroTocadoSobreARespostaDoProduto`: o produto que o tempo real tocou
//     durante a consulta do catálogo. A grade (variações) é a UNIÃO por id: parte
//     da resposta, a variação do registro vence a de mesmo id, a que só o
//     registro tem entra no fim, e o estoque é recalculado sobre a união.
import { describe, expect, it } from "vitest";

import {
  mesclarProdutoNaLista,
  registroTocadoSobreARespostaDoProduto,
} from "@/lib/mescla-de-produtos";
import type { Product, ProductVariant } from "@/types";

function produto(id: string, extra: Partial<Product> = {}): Product {
  return {
    id,
    name: `Produto ${id}`,
    description: "",
    price: 10,
    images: [],
    category: "geral",
    stock: 0,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function variacao(
  id: string,
  estoque: number,
  extra: Partial<ProductVariant> = {},
): ProductVariant {
  return {
    id,
    productId: "p1",
    name: "Tamanho",
    value: id.toUpperCase(),
    stockIncrement: estoque,
    active: true,
    ...extra,
  };
}

describe("mesclarProdutoNaLista: o primeiro da lista conta", () => {
  const lista = [produto("p1"), produto("p2"), produto("p3")];

  it("DELETE do primeiro produto tira ele e só ele", () => {
    const nova = mesclarProdutoNaLista(lista, {
      eventType: "DELETE",
      id: "p1",
    });

    expect(nova?.map((p) => p.id)).toEqual(["p2", "p3"]);
    expect(nova?.[0]).toBe(lista[1]);
    expect(lista.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("UPDATE do primeiro produto troca no lugar, sem duplicar no fim", () => {
    const atualizado = produto("p1", { price: 99 });
    const nova = mesclarProdutoNaLista(lista, {
      eventType: "UPDATE",
      id: "p1",
      registro: atualizado,
    });

    expect(nova?.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(nova?.[0]).toBe(atualizado);
    expect(nova?.[1]).toBe(lista[1]);
  });

  it("INSERT de id que já é o primeiro da lista também troca no lugar", () => {
    const reinserido = produto("p1", { price: 55 });
    const nova = mesclarProdutoNaLista(lista, {
      eventType: "INSERT",
      id: "p1",
      registro: reinserido,
    });

    expect(nova).toHaveLength(3);
    expect(nova?.[0]).toBe(reinserido);
  });
});

describe("registroTocadoSobreARespostaDoProduto: a grade é a união por id", () => {
  it("sem grade na resposta, vale o registro do jeito que veio", () => {
    const registro = produto("p1", { stock: 4 });

    expect(registroTocadoSobreARespostaDoProduto(registro, undefined)).toBe(
      registro,
    );
    expect(registroTocadoSobreARespostaDoProduto(registro, produto("p1"))).toBe(
      registro,
    );
    expect(
      registroTocadoSobreARespostaDoProduto(
        registro,
        produto("p1", { variants: [] }),
      ),
    ).toBe(registro);
  });

  it("variação do registro vence a de mesmo id; a só do registro entra no fim", () => {
    const daResposta = produto("p1", {
      variants: [variacao("a", 5), variacao("b", 3)],
    });
    const registro = produto("p1", {
      stock: 999,
      variants: [variacao("b", 7, { priceOverride: 99 }), variacao("c", 2)],
    });

    const resultado = registroTocadoSobreARespostaDoProduto(
      registro,
      daResposta,
    );

    expect(resultado.variants?.map((v) => v.id)).toEqual(["a", "b", "c"]);
    expect(resultado.variants?.[1]).toBe(registro.variants?.[0]);
    expect(resultado.variants?.[1]?.priceOverride).toBe(99);
    expect(resultado.variants?.[0]).toBe(daResposta.variants?.[0]);
    // estoque recalculado sobre a união: 5 + 7 + 2 (não o 999 do registro)
    expect(resultado.stock).toBe(14);
    expect(resultado.id).toBe("p1");
  });

  it("registro sem grade própria devolve a grade da resposta inteira", () => {
    const daResposta = produto("p1", {
      variants: [variacao("a", 5), variacao("b", 3)],
    });
    const registro = produto("p1", { stock: 1 });

    const resultado = registroTocadoSobreARespostaDoProduto(
      registro,
      daResposta,
    );

    expect(resultado.variants?.map((v) => v.id)).toEqual(["a", "b"]);
    expect(resultado.stock).toBe(8);
  });

  it("variação desligada não soma no estoque da união", () => {
    const daResposta = produto("p1", {
      variants: [variacao("a", 5), variacao("b", 3, { active: false })],
    });

    const resultado = registroTocadoSobreARespostaDoProduto(
      produto("p1"),
      daResposta,
    );

    expect(resultado.stock).toBe(5);
  });

  describe("sem nenhuma variação ativa o produto vende pelo estoque de base", () => {
    const desligadas = produto("p1", {
      variants: [variacao("a", 5, { active: false })],
    });

    it("usa o estoque de base do registro, inclusive zero", () => {
      expect(
        registroTocadoSobreARespostaDoProduto(
          produto("p1", { stock: 9, estoqueDeBase: 12 }),
          desligadas,
        ).stock,
      ).toBe(12);
      expect(
        registroTocadoSobreARespostaDoProduto(
          produto("p1", { stock: 9, estoqueDeBase: 0 }),
          desligadas,
        ).stock,
      ).toBe(0);
    });

    it("sem estoque de base, cai no estoque do próprio registro", () => {
      expect(
        registroTocadoSobreARespostaDoProduto(
          produto("p1", { stock: 8 }),
          desligadas,
        ).stock,
      ).toBe(8);
    });
  });
});
