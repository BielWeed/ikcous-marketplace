// @vitest-environment jsdom
// Protege qToAdd: uma adição inválida vale 1 e nunca vira retirada do carrinho.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { Product } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/lib/supabase", () => {
  const canal = { on: () => canal, subscribe: () => canal };
  return {
    supabase: {
      channel: () => canal,
      removeChannel: async () => {},
      rpc: async () => ({ error: new Error("sem rede") }),
      from: () => {
        throw new Error("sem rede");
      },
    },
  };
});
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const produto: Product = {
  id: "p1",
  name: "Produto de teste",
  description: "",
  price: 10,
  images: [],
  category: "geral",
  stock: 20,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
};

type Contexto = ReturnType<typeof useCartContext>;

function Sonda({ onEstado }: Readonly<{ onEstado: (c: Contexto) => void }>) {
  const contexto = useCartContext();
  useEffect(() => onEstado(contexto), [contexto, onEstado]);
  return null;
}

describe("CartContext — quantidade inválida não subtrai uma adição", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: Contexto;

  beforeEach(async () => {
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
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda
            onEstado={(contexto) => {
              atual = contexto;
            }}
          />
        </CartProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([-2, 0, Number.NaN, "abc"])(
    "carrinho vazio, quantidade %s: entra uma unidade e o subtotal é R$ 10",
    async (quantidade) => {
      let entrou = 0;
      await act(async () => {
        // Entrada malformada em tempo de execução, apesar do contrato numérico.
        entrou = atual.addToCart(produto, quantidade as number);
      });

      expect(atual.cart).toHaveLength(1);
      expect(atual.cart[0].quantity).toBe(1);
      expect(atual.getCartTotal()).toBe(10);
      expect(entrou).toBe(1);
    },
  );

  it("com 3 unidades, adicionar -2 não retira duas: ficam 4 e subtotal R$ 40", async () => {
    await act(async () => {
      atual.addToCart(produto, 3);
    });
    expect(atual.cart[0].quantity).toBe(3);
    expect(atual.getCartTotal()).toBe(30);

    await act(async () => {
      atual.addToCart(produto, -2);
    });

    expect(atual.cart[0].quantity).toBe(4);
    expect(atual.getCartTotal()).toBe(40);
  });

  it("controle: adicionar 2 mantém a quantidade válida e subtotal R$ 20", async () => {
    await act(async () => {
      atual.addToCart(produto, 2);
    });
    expect(atual.cart[0].quantity).toBe(2);
    expect(atual.getCartTotal()).toBe(20);
  });
});
