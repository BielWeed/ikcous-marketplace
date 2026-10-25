// @vitest-environment jsdom
//
// CAÇA 4 (24/10/2026), achado C6: ao concluir a compra, o checkout tira do
// carrinho linha a linha (`removeFromCart`) quando o carrinho mudou durante o
// envio — e cada linha disparava "Produto removido do carrinho" por cima da
// tela de sucesso. O aviso só faz sentido quando a PESSOA remove; a tirada por
// conclusão de compra é silenciosa (mesmo desenho do `clearCart`).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { CartItem, Product } from "@/types";

const toastInfo = vi.fn();

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    info: (...args: unknown[]) => toastInfo(...args),
    success: vi.fn(),
    warning: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto: Product = {
  id: "prod-1",
  name: "Produto Teste",
  description: "",
  price: 10,
  images: [],
  category: "geral",
  stock: 5,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
};

type Contexto = ReturnType<typeof useCartContext>;

function Sonda({ onEstado }: Readonly<{ onEstado: (c: Contexto) => void }>) {
  const contexto = useCartContext();
  useEffect(() => {
    onEstado(contexto);
  }, [contexto, onEstado]);
  return null;
}

describe("CartContext — 'Produto removido do carrinho' só aparece quando a pessoa remove", () => {
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
    toastInfo.mockClear();
    const item: CartItem = {
      product: produto,
      quantity: 1,
      lastModifiedAt: Date.now(),
    };
    localStorage.setItem("marketplace_cart_v1", JSON.stringify([item]));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda onEstado={(c) => (atual = c)} />
        </CartProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("remover pelo botão (sem opção) tira o item e avisa", async () => {
    expect(atual.cart).toHaveLength(1);

    await act(async () => {
      atual.removeFromCart("prod-1");
    });

    expect(atual.cart).toHaveLength(0);
    expect(toastInfo).toHaveBeenCalledWith("Produto removido do carrinho");
  });

  it("remover por conclusão de compra (silencioso) tira o item sem nenhum aviso", async () => {
    expect(atual.cart).toHaveLength(1);

    await act(async () => {
      atual.removeFromCart("prod-1", undefined, { silencioso: true });
    });

    expect(atual.cart).toHaveLength(0);
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("o silencioso continua deixando a marca de remoção: o item não volta pelo sync", async () => {
    await act(async () => {
      atual.removeFromCart("prod-1", undefined, { silencioso: true });
    });

    const marcas = JSON.parse(
      localStorage.getItem("marketplace_cart_tombstones_v1") ?? "[]",
    );
    expect(JSON.stringify(marcas)).toContain("prod-1");
  });
});
