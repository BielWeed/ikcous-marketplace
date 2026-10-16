// @vitest-environment jsdom
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { CartItem, Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mundo = vi.hoisted(() => ({
  usuario: { id: "A" },
  rpc: vi.fn(),
  aoMudar: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario, loading: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));
// O catálogo não altera os itens: estes testes isolam a mesclagem e a escrita.
vi.mock("@/lib/catalogo-do-carrinho", () => ({
  montarCatalogo: () => ({}),
  aplicarCatalogoAoCarrinho: (itens: CartItem[]) => itens,
  avisosDoCarrinho: async () => [],
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
        in: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
    auth: {
      getSession: async () => ({ data: { session: { user: mundo.usuario } } }),
    },
    rpc: mundo.rpc,
    channel: () => ({
      on: (...args: unknown[]) => {
        mundo.aoMudar.mockImplementation(args.at(-1) as () => void);
        return { subscribe: () => ({}) };
      },
    }),
    removeChannel: async () => {},
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto = {
  id: "p1",
  name: "Produto",
  price: 10,
  images: [],
  stock: 10,
} as unknown as Product;
const observar = vi.fn();
function Sonda() {
  observar(useCartContext());
  return null;
}
const atual = () =>
  observar.mock.calls.at(-1)![0] as ReturnType<typeof useCartContext>;
let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mundo.rpc.mockResolvedValue({ error: null });
  const valores = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => valores.get(k) ?? null,
    setItem: (k: string, v: string) => void valores.set(k, v),
    removeItem: (k: string) => void valores.delete(k),
  });
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      close() {}
    },
  );
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
async function montar() {
  await act(async () => {
    raiz.render(
      <CartProvider>
        <Sonda />
      </CartProvider>,
    );
  });
}
async function avancar() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
}

it("a marca de exclusão de outra aba tira o item local da mesclagem e do próximo envio", async () => {
  localStorage.setItem(
    "marketplace_cart_v1",
    JSON.stringify([
      {
        product: produto,
        quantity: 1,
        lastModifiedAt: Date.now() - 1000,
      },
    ]),
  );
  await montar();
  expect(atual().cart).toHaveLength(1);
  // A outra aba removeu p1 e publicou a marca no armazenamento compartilhado.
  localStorage.setItem(
    "marketplace_cart_tombstones_v1",
    JSON.stringify([{ key: "p1-", deletedAt: Date.now() }]),
  );
  await act(async () => mundo.aoMudar({ eventType: "DELETE" }));
  expect(atual().cart).toEqual([]);
  await avancar();
  expect(mundo.rpc).toHaveBeenLastCalledWith("sync_cart_atomic", {
    p_cart_items: [],
  });
});

it("reenvia ao voltar online sem mexer no carrinho e remove o listener ao desmontar", async () => {
  const removerListener = vi.spyOn(window, "removeEventListener");
  await montar();
  await act(async () => atual().addToCart(produto));
  mundo.rpc.mockResolvedValueOnce({ error: { message: "sem rede" } });
  await avancar();
  expect(mundo.rpc).toHaveBeenCalledTimes(1);
  await avancar();
  expect(mundo.rpc).toHaveBeenCalledTimes(1);
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
  await avancar();
  expect(mundo.rpc).toHaveBeenCalledTimes(2);
  expect(mundo.rpc.mock.calls[1]).toEqual(mundo.rpc.mock.calls[0]);
  act(() => raiz.unmount());
  expect(removerListener).toHaveBeenCalledWith("online", expect.any(Function));
});
