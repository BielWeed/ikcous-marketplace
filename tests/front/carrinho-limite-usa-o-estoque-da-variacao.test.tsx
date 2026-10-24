// @vitest-environment jsdom
//
// Defeito (carrinho-checkout-3): na linha do carrinho com tamanho/cor, o "+" e
// o aviso "Só N restantes" olhavam o estoque do produto INTEIRO
// (`item.product.stock`), não o da variação escolhida. Produto com 10 no total
// e só 2 no tamanho P deixava a cliente subir para 3 e o aviso nem aparecia; o
// servidor recusava no fim. A fonte certa é `estoqueDaLinha`
// (src/lib/escolhas-do-item.ts), a mesma que o CartContext usa para o limite.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingFee: 10, freeShippingMin: 0, enableReviews: false },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function variante(
  id: string,
  name: string,
  value: string,
  stockIncrement: number,
) {
  return {
    id,
    productId: "prod-camisa",
    name,
    value,
    stockIncrement,
    active: true,
  };
}

const camisa: Product = {
  id: "prod-camisa",
  name: "Camisa Teste",
  description: "",
  price: 50,
  images: [],
  category: "Roupa",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
  variants: [
    variante("var-p", "Tamanho", "P", 2),
    variante("var-m", "Tamanho", "M", 8),
    variante("var-azul", "Cor", "Azul", 5),
  ],
};

describe("CartItemsList — o limite da linha é o estoque da VARIAÇÃO escolhida", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onUpdateQuantity = vi.fn();

  beforeEach(() => {
    onUpdateQuantity.mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizar(cart: CartItem[]) {
    const { CartItemsList } = await import(
      "@/components/ui/custom/CartItemsList"
    );
    await act(async () => {
      raiz.render(
        <CartItemsList
          cart={cart}
          removingId={null}
          onUpdateQuantity={onUpdateQuantity}
          onRemove={() => {}}
          handleClearCart={() => {}}
        />,
      );
    });
    return hospedeiro;
  }

  const mais = (host: HTMLElement, indice = 0) =>
    host
      .querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Aumentar quantidade"]',
      )
      .item(indice);

  it("tamanho P com 2 no estoque (produto tem 10): '+' trava em 2 e o aviso diz 'Só 2 restantes'", async () => {
    const host = await renderizar([
      { product: camisa, quantity: 2, variantId: "var-p" },
    ]);

    expect(mais(host).disabled).toBe(true);
    expect(host.textContent).toContain("Só 2 restantes");
  });

  it("tamanho M com 8 no estoque: '+' livre e sem aviso de pouco estoque", async () => {
    const host = await renderizar([
      { product: camisa, quantity: 2, variantId: "var-m" },
    ]);

    expect(mais(host).disabled).toBe(false);
    expect(host.textContent).not.toContain("restante");
  });

  it("produto sem variação segue igual: limite e aviso vêm do estoque do produto", async () => {
    const host = await renderizar([
      { product: { ...camisa, variants: undefined, stock: 2 }, quantity: 1 },
    ]);

    expect(mais(host).disabled).toBe(false);
    expect(host.textContent).toContain("Só 2 restantes");
  });

  it("linha corrompida sem produto (localStorage antigo) não derruba as outras linhas", async () => {
    const corrompida = { quantity: 1 } as unknown as CartItem;
    const host = await renderizar([
      corrompida,
      { product: camisa, quantity: 1, variantId: "var-m" },
    ]);

    expect(host.textContent).toContain("Camisa Teste");
    expect(
      host.querySelectorAll('button[aria-label="Aumentar quantidade"]'),
    ).toHaveLength(1);
  });

  it("estoque dividido entre linhas: Azul-P e Azul-M dividem os 5 azuis", async () => {
    const azulM: CartItem = {
      product: camisa,
      quantity: 3,
      variantId: "var-azul",
      outrasVariantIds: ["var-m"],
    };
    const azulP: CartItem = {
      product: camisa,
      quantity: 2,
      variantId: "var-azul",
      outrasVariantIds: ["var-p"],
    };
    const host = await renderizar([azulM, azulP]);

    // Azul-M: 5 azuis - 2 (da outra linha) = 3 -> já está no teto.
    expect(mais(host, 0).disabled).toBe(true);
    // Azul-P: 5 - 3 = 2, mas P só tem 2 -> teto 2, já no limite.
    expect(mais(host, 1).disabled).toBe(true);
    expect(host.textContent).toContain("Só 3 restantes");
    expect(host.textContent).toContain("Só 2 restantes");
  });
});
