// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), território ui/custom: a lista de itens do
// carrinho (`CartItemsList`) tem números que a cliente lê e confia — e seis
// bordas passavam com o defeito plantado:
//  - o contador "N Itens Adicionados" somar as unidades (e dizer "1 Item" no
//    singular, "0 Itens" no plural);
//  - o aviso de carrinho muito grande aparecer só ACIMA de 50 linhas;
//  - o "Só N restante(s)" não aparecer para produto sem estoque (zero) e o
//    "Máximo disponível" só quando já está no teto;
//  - o "cada" só aparecer com 2 ou mais unidades;
//  - o selo "-1%" (um por cento) aparecer: só o "-0%" é escondido.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartItemsList } from "@/components/ui/custom/CartItemsList";
import type { CartItem, Product } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingFee: 10,
      freeShippingMin: 0,
      enableReviews: false,
      shippingCoverage: "local",
    },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(id: string, sobre: Partial<Product> = {}): Product {
  return {
    id,
    name: `Produto ${id}`,
    description: "",
    price: 20,
    images: [],
    category: "Casa",
    stock: 50,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    ...sobre,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

function montar(
  cart: CartItem[],
  handleClearCart = vi.fn(),
  removingId: string | null = null,
) {
  act(() => {
    raiz.render(
      <CartItemsList
        cart={cart}
        removingId={removingId}
        onUpdateQuantity={vi.fn()}
        onRemove={vi.fn()}
        handleClearCart={handleClearCart}
      />,
    );
  });
  return { handleClearCart };
}

const texto = () => (hospedeiro.textContent ?? "").replace(/\s/g, " ");

describe("CartItemsList — o contador de itens", () => {
  it("soma as UNIDADES das linhas, não as linhas (2 + 3 = 5)", () => {
    montar([
      { product: produto("a"), quantity: 2 },
      { product: produto("b"), quantity: 3 },
    ]);
    expect(texto()).toContain("5 Itens Adicionados");
  });

  it("uma única unidade fala no singular: '1 Item Adicionado'", () => {
    montar([{ product: produto("a"), quantity: 1 }]);
    expect(texto()).toContain("1 Item Adicionado");
    expect(texto()).not.toContain("1 Itens");
  });

  it("linha sem quantidade (dado antigo) não conta: '0 Itens Adicionados'", () => {
    montar([{ product: produto("a"), quantity: 0 }]);
    expect(texto()).toContain("0 Itens Adicionados");
    montar([{ product: produto("a") } as unknown as CartItem]);
    expect(texto()).toContain("0 Itens Adicionados");
  });

  it("carrinho vazio: '0 Itens Adicionados'", () => {
    montar([]);
    expect(texto()).toContain("0 Itens Adicionados");
  });
});

describe("CartItemsList — aviso de carrinho muito grande (acima de 50 linhas)", () => {
  const linhas = (n: number): CartItem[] =>
    Array.from({ length: n }, (_, i) => ({
      product: produto(`p${i}`),
      quantity: 1,
    }));

  it("com exatamente 50 linhas o aviso NÃO aparece", () => {
    montar(linhas(50));
    expect(texto()).not.toContain("Esvaziar carrinho");
    expect(texto()).not.toContain("Seu carrinho tem");
  });

  it("com 51 linhas o aviso aparece, diz o número e o botão esvazia o carrinho", () => {
    const { handleClearCart } = montar(linhas(51));
    expect(texto()).toContain("Seu carrinho tem 51 itens na lista");
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent === "Esvaziar carrinho",
    ) as HTMLButtonElement;
    expect(botao).toBeDefined();
    act(() => botao.click());
    expect(handleClearCart).toHaveBeenCalledTimes(1);
  });

  it("carrinho pequeno (3 linhas): sem aviso e sem botão de esvaziar", () => {
    montar(linhas(3));
    expect(texto()).not.toContain("Esvaziar carrinho");
  });
});

describe("CartItemsList — aviso de estoque da linha", () => {
  it("estoque 0: nenhum aviso de 'Só N restantes' (o item já está esgotado)", () => {
    montar([{ product: produto("a", { stock: 0 }), quantity: 1 }]);
    expect(texto()).not.toContain("Só 0");
    expect(texto()).not.toContain("restante");
  });

  it("estoque 1: 'Só 1 restante' no singular", () => {
    montar([{ product: produto("a", { stock: 1 }), quantity: 1 }]);
    expect(texto()).toContain("Só 1 restante");
    expect(texto()).not.toContain("restantes");
  });

  it("estoque 3: 'Só 3 restantes' no plural", () => {
    montar([{ product: produto("a", { stock: 3 }), quantity: 1 }]);
    expect(texto()).toContain("Só 3 restantes");
  });

  it("estoque 4 e a cliente ainda longe do teto: nenhum dos dois avisos", () => {
    montar([{ product: produto("a", { stock: 4 }), quantity: 1 }]);
    expect(texto()).not.toContain("Só 4");
    expect(texto()).not.toContain("Máximo disponível");
  });

  it("estoque 4 e já levando as 4: 'Máximo disponível: 4' explica o '+' travado", () => {
    montar([{ product: produto("a", { stock: 4 }), quantity: 4 }]);
    expect(texto()).toContain("Máximo disponível: 4");
    expect(texto()).not.toContain("Só 4");
  });

  it("estoque 3 levando as 3: o aviso é o 'Só 3 restantes', não o 'Máximo disponível'", () => {
    montar([{ product: produto("a", { stock: 3 }), quantity: 3 }]);
    expect(texto()).toContain("Só 3 restantes");
    expect(texto()).not.toContain("Máximo disponível");
  });
});

describe("CartItemsList — preço da linha", () => {
  it("'cada' só aparece com 2 ou mais unidades", () => {
    montar([{ product: produto("a"), quantity: 1 }]);
    expect(
      hospedeiro.querySelector('[data-testid="cart-item-preco-cada"]'),
    ).toBeNull();
    montar([{ product: produto("a"), quantity: 2 }]);
    expect(
      hospedeiro.querySelector('[data-testid="cart-item-preco-cada"]'),
    ).not.toBeNull();
  });

  it("desconto de 1% mostra o selo '-1%' (só o '-0%' é escondido)", () => {
    montar([
      {
        product: produto("a", { price: 99, originalPrice: 100 }),
        quantity: 1,
      },
    ]);
    expect(texto()).toContain("-1%");
    expect(texto()).toContain("Preço original");
  });

  it("desconto de 25% mostra '-25%' com o preço riscado", () => {
    montar([
      {
        product: produto("a", { price: 75, originalPrice: 100 }),
        quantity: 1,
      },
    ]);
    expect(texto()).toContain("-25%");
    expect(texto()).toContain("R$ 100,00");
    expect(texto()).toContain("R$ 75,00");
  });

  it("sem preço de antes (ou igual ao atual): sem selo, sem preço riscado", () => {
    montar([{ product: produto("a", { price: 20 }), quantity: 1 }]);
    expect(texto()).not.toContain("%");
    expect(texto()).not.toContain("Preço original");
    montar([
      {
        product: produto("a", { price: 20, originalPrice: 20 }),
        quantity: 1,
      },
    ]);
    expect(texto()).not.toContain("Preço original");
  });
});

describe("CartItemsList — a linha que está sendo removida fica esmaecida", () => {
  const linha = (idDoProduto: string) =>
    hospedeiro
      .querySelector(`[data-remover-item="${idDoProduto}-default"]`)
      ?.closest(".z-10") as HTMLElement;

  it("só a linha em remoção perde força (meia opacidade); a outra continua inteira", () => {
    montar(
      [
        { product: produto("a"), quantity: 1 },
        { product: produto("b"), quantity: 1 },
      ],
      vi.fn(),
      "a-default",
    );
    expect(linha("a").classList.contains("opacity-50")).toBe(true);
    expect(linha("b").classList.contains("opacity-50")).toBe(false);
  });

  it("nada em remoção: nenhuma linha esmaecida", () => {
    montar(
      [
        { product: produto("a"), quantity: 1 },
        { product: produto("b"), quantity: 1 },
      ],
      vi.fn(),
      null,
    );
    expect(linha("a").classList.contains("opacity-50")).toBe(false);
    expect(linha("b").classList.contains("opacity-50")).toBe(false);
  });
});
