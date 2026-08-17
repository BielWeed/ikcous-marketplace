import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { CartItem, Product } from "@/types";
// @vitest-environment jsdom
//
// Achado da revisão (17/08/2026): `cartItemSchema` em CartContext.tsx não
// declarava `variantNames`, e o Zod descarta chave desconhecida no
// `safeParse` da hidratação — um item salvo no localStorage com a variação
// escolhida (ex.: "Tamanho M") voltava sem ela ao reabrir a página, e isso
// também esvaziava a nota do pedido em CheckoutView.tsx (a mesma chave
// alimenta os dois). Esta suíte prova que a hidratação preserva o campo.
import { act } from "react";
import { useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingFee: 0, freeShippingMin: 0 },
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// de tests/front/checkout-summary-bar.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(): Product {
  return {
    id: "prod-1",
    name: "Produto com variação",
    description: "",
    price: 10,
    images: [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
  };
}

/** Não renderiza nada — só empurra o `cart` atual para fora do contexto a
 * cada render, para o teste inspecionar sem precisar de um consumidor de
 * UI de verdade. */
function CartReader({
  onCart,
}: Readonly<{ onCart: (cart: CartItem[]) => void }>) {
  const { cart } = useCartContext();
  useEffect(() => {
    onCart(cart);
  }, [cart, onCart]);
  return null;
}

describe("CartContext — hidratação preserva variantNames", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("um item salvo com variantNames sobrevive ao safeParse da hidratação", async () => {
    localStorage.setItem(
      "marketplace_cart_v1",
      JSON.stringify([
        {
          product: produto(),
          quantity: 1,
          variantId: "var-1",
          variantNames: "Tamanho M",
          lastModifiedAt: Date.now(),
        },
      ]),
    );

    let cartCapturado: CartItem[] = [];
    await act(async () => {
      raiz.render(
        <CartProvider>
          <CartReader
            onCart={(cart) => {
              cartCapturado = cart;
            }}
          />
        </CartProvider>,
      );
    });

    expect(cartCapturado).toHaveLength(1);
    expect(cartCapturado[0].variantNames).toBe("Tamanho M");
  });

  it("um item salvo sem variantNames continua hidratando normalmente", async () => {
    localStorage.setItem(
      "marketplace_cart_v1",
      JSON.stringify([
        {
          product: produto(),
          quantity: 3,
          lastModifiedAt: Date.now(),
        },
      ]),
    );

    let cartCapturado: CartItem[] = [];
    await act(async () => {
      raiz.render(
        <CartProvider>
          <CartReader
            onCart={(cart) => {
              cartCapturado = cart;
            }}
          />
        </CartProvider>,
      );
    });

    expect(cartCapturado).toHaveLength(1);
    expect(cartCapturado[0].quantity).toBe(3);
    expect(cartCapturado[0].variantNames).toBeUndefined();
  });
});
