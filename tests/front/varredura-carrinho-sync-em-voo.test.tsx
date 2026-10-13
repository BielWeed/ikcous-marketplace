// @vitest-environment jsdom
//
// Varredura de bugs (13/10/2026) — `CartContext`: o efeito que sincroniza o
// carrinho com o banco só dispara o `syncToDB` se NÃO houver outro em voo
// (`syncPending`). Se o CLIENTE mexe no carrinho enquanto uma
// sincronização anterior ainda espera o servidor (rede lenta: getSession +
// RPC passam de 1 s), o timer de 1 s cai com `syncPending` ligado, pula, e
// ninguém reagenda ao fim: a alteração só vai ao banco na próxima mudança do
// carrinho — o servidor (e os outros aparelhos) ficam com o carrinho velho.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { Product } from "@/types";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, resolvers } = vi.hoisted(() => ({
  rpc: vi.fn(),
  resolvers: [] as Array<() => void>,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
// Identidade ESTÁVEL entre renders, como no app: um objeto novo a cada render
// mudaria o `syncToDB` e reiniciaria o timer sem que o carrinho mudasse.
const USUARIO = { id: "u1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: USUARIO, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: {} } } }),
    },
    rpc,
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(() => Promise.resolve("ok")),
  },
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(id: string): Product {
  return {
    id,
    name: `Produto ${id}`,
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

let add: (p: Product) => void = () => {};
function Sonda() {
  const { addToCart } = useCartContext();
  useEffect(() => {
    add = (p) => addToCart(p, 1);
  }, [addToCart]);
  return null;
}

describe("CartContext — alteração feita com um sync em voo também chega ao banco", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    rpc.mockReset();
    resolvers.length = 0;
    rpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(() => resolve({ error: null }));
        }),
    );
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => void armazem.set(k, v),
      removeItem: (k: string) => void armazem.delete(k),
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("o carrinho mudou durante o sync lento: um segundo sync leva A e B", async () => {
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda />
        </CartProvider>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    await act(async () => add(produto("A")));
    // O timer de 1 s dispara o 1º sync, que fica esperando o servidor.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(rpc).toHaveBeenCalledTimes(1);

    // Com o 1º ainda em voo, o cliente adiciona B.
    await act(async () => add(produto("B")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    // O servidor responde ao 1º e o tempo corre.
    await act(async () => {
      resolvers[0]?.();
      await vi.advanceTimersByTimeAsync(50);
    });
    // O reenvio reabre o efeito (timer de 1 s) só ao sair do `act` acima.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(rpc).toHaveBeenCalledTimes(2);
    const enviados = (
      rpc.mock.calls[1][1] as { p_cart_items: { product_id: string }[] }
    ).p_cart_items.map((i) => i.product_id);
    expect(enviados.sort()).toEqual(["A", "B"]);
  });
});
