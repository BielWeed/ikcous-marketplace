// @vitest-environment jsdom
//
// Varredura de bugs (13/10/2026) — `CartContext.syncToDB` confere que existe
// uma sessão, mas não que ela é do usuário dono do carrinho que está
// enviando. A RPC `sync_cart_atomic` grava em `auth.uid()` da sessão de AGORA:
// se a sessão trocou entre o carrinho ser montado e o envio, o carrinho de A
// substituiria o de B no banco. A guarda aborta quando os ids divergem.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { Product } from "@/types";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, sessao } = vi.hoisted(() => ({
  rpc: vi.fn(),
  sessao: { dono: "u1" },
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
      getSession: () =>
        Promise.resolve({ data: { session: { user: { id: sessao.dono } } } }),
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

describe("CartContext — o carrinho só vai ao banco na sessão do próprio dono", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    rpc.mockReset();
    rpc.mockResolvedValue({ error: null });
    sessao.dono = "u1";
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

  async function montarEAdicionar() {
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
  }

  it("sessão de OUTRO usuário: o carrinho de A não é enviado", async () => {
    sessao.dono = "u2";
    await montarEAdicionar();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("controle: sessão do próprio usuário envia normalmente", async () => {
    await montarEAdicionar();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
