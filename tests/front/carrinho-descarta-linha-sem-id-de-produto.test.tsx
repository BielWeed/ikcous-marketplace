// @vitest-environment jsdom
//
// LINHA DO CARRINHO SEM `product.id` NÃO ENTRA NO CARRINHO (caça 4, K2/C7,
// 25/10/2026).
//
// O DEFEITO: o esquema que valida o carrinho guardado no aparelho (Zod)
// aceitava `product` como "qualquer objeto" -- inclusive um sem `id`. Essa
// linha sumia da LISTA (a tela só desenha linhas com id), mas continuava no
// TOTAL e na contagem: a cliente via itens a menos do que pagava, e o
// checkout mandaria `product_id` vazio ao banco.
//
// O CONSERTO: o esquema exige `product.id` texto não vazio; linha inválida é
// descartada ao carregar -- as outras linhas, de produto válido, ficam.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { Product } from "@/types";
import { act } from "react";
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(id: string, price: number): Product {
  return {
    id,
    name: `Produto ${id}`,
    description: "",
    price,
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

type Leitura = { linhas: number; total: number; contagem: number };

function Leitor({ aoLer }: Readonly<{ aoLer: (leitura: Leitura) => void }>) {
  const { cart, cartTotal, cartCount } = useCartContext();
  aoLer({ linhas: cart.length, total: cartTotal, contagem: cartCount });
  return null;
}

describe("CartContext — linha sem product.id é descartada ao carregar (K2)", () => {
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

  async function abrirComCarrinhoGuardado(linhas: unknown[]): Promise<Leitura> {
    localStorage.setItem("marketplace_cart_v1", JSON.stringify(linhas));
    let leitura: Leitura = { linhas: -1, total: -1, contagem: -1 };
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Leitor
            aoLer={(l) => {
              leitura = l;
            }}
          />
        </CartProvider>,
      );
    });
    return leitura;
  }

  it("produto sem id some do carrinho, do total e da contagem", async () => {
    const semId = { name: "Sem id", price: 10 };
    const leitura = await abrirComCarrinhoGuardado([
      { product: semId, quantity: 2 },
    ]);

    expect(leitura).toEqual({ linhas: 0, total: 0, contagem: 0 });
  });

  it("id vazio, número ou nulo também são descartados", async () => {
    const leitura = await abrirComCarrinhoGuardado([
      { product: { ...produto("x", 10), id: "" }, quantity: 1 },
      { product: { ...produto("x", 10), id: 7 }, quantity: 1 },
      { product: { ...produto("x", 10), id: null }, quantity: 1 },
    ]);

    expect(leitura).toEqual({ linhas: 0, total: 0, contagem: 0 });
  });

  it("a linha inválida cai e a de produto válido fica, com o total certo", async () => {
    const leitura = await abrirComCarrinhoGuardado([
      { product: { name: "Sem id", price: 99 }, quantity: 3 },
      { product: produto("prod-1", 10), quantity: 2 },
    ]);

    expect(leitura).toEqual({ linhas: 1, total: 20, contagem: 2 });
  });

  it("carrinho só de linhas válidas segue intacto (controle)", async () => {
    const leitura = await abrirComCarrinhoGuardado([
      { product: produto("prod-1", 10), quantity: 2 },
      { product: produto("prod-2", 5), quantity: 1, variantId: "v1" },
    ]);

    expect(leitura).toEqual({ linhas: 2, total: 25, contagem: 3 });
  });
});
