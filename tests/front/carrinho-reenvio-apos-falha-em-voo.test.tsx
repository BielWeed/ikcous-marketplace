// @vitest-environment jsdom
// A gravação do carrinho falha com o navegador ainda online (ou o evento
// `online` chega durante a gravação em voo): sem reagendar, o carrinho ficava
// sem sincronizar até outro evento. O reenvio é limitado (backoff + teto).
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mundo = vi.hoisted(() => ({
  usuario: { id: "A" },
  rpc: vi.fn(),
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
vi.mock("@/lib/catalogo-do-carrinho", () => ({
  montarCatalogo: () => ({}),
  aplicarCatalogoAoCarrinho: (itens: unknown[]) => itens,
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
      on: () => ({ subscribe: () => ({}) }),
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
// Em passos curtos: o `act` só aplica o estado do React (o que reabre o
// efeito do reenvio) quando ele termina, e o reenvio nasce de um estado.
async function avancar(ms: number) {
  for (let t = 0; t < ms; t += 500) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(500, ms - t));
    });
  }
}
/** Uma gravação que fica no ar até o teste decidir como ela termina. */
function gravacaoEmVoo() {
  let resolver!: (v: { error: unknown }) => void;
  const promessa = new Promise<{ error: unknown }>((r) => {
    resolver = r;
  });
  mundo.rpc.mockReturnValueOnce(promessa);
  return resolver;
}
const FALHA = { error: { message: "sem rede" } };

it("o evento online que chega com a gravação em voo não se perde quando ela falha", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  await montar();
  const terminar = gravacaoEmVoo();
  await act(async () => atual().addToCart(produto));
  await avancar(1100);
  expect(mundo.rpc).toHaveBeenCalledTimes(1);
  // O evento chega com a gravação ainda no ar: o ouvinte o ignora.
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
  await act(async () => terminar(FALHA));
  await avancar(40_000);
  expect(mundo.rpc).toHaveBeenCalledTimes(2);
  expect(mundo.rpc.mock.calls[1]).toEqual(mundo.rpc.mock.calls[0]);
});

it("edição feita com a gravação em voo vai ao banco quando essa gravação falha com o navegador online", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  await montar();
  const terminar = gravacaoEmVoo();
  await act(async () => atual().addToCart(produto));
  await avancar(1100);
  expect(mundo.rpc).toHaveBeenCalledTimes(1);
  // Segunda edição enquanto a primeira ainda espera o servidor.
  await act(async () => atual().addToCart(produto));
  await avancar(1100);
  expect(mundo.rpc).toHaveBeenCalledTimes(1);
  await act(async () => terminar(FALHA));
  await avancar(40_000);
  expect(mundo.rpc).toHaveBeenCalledTimes(2);
  const itens = (mundo.rpc.mock.calls[1][1] as { p_cart_items: unknown[] })
    .p_cart_items as { quantity: number }[];
  expect(itens).toHaveLength(1);
  expect(itens[0].quantity).toBe(2);
});

it("falha repetida com o navegador online não vira laço: o reenvio tem teto", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  mundo.rpc.mockResolvedValue(FALHA);
  await montar();
  await act(async () => atual().addToCart(produto));
  await avancar(1100);
  expect(mundo.rpc).toHaveBeenCalledTimes(1);
  // Mais do que sobra para esgotar qualquer backoff razoável.
  await avancar(10 * 60_000);
  const chamadas = mundo.rpc.mock.calls.length;
  expect(chamadas).toBeGreaterThan(1);
  expect(chamadas).toBeLessThanOrEqual(7);
  await avancar(10 * 60_000);
  expect(mundo.rpc).toHaveBeenCalledTimes(chamadas);
});

it("com o navegador offline a falha não reagenda: quem retoma é o evento online", async () => {
  const estado = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await montar();
  mundo.rpc.mockResolvedValueOnce(FALHA);
  await act(async () => atual().addToCart(produto));
  await avancar(1100);
  expect(mundo.rpc).toHaveBeenCalledTimes(1);
  await avancar(10 * 60_000);
  expect(mundo.rpc).toHaveBeenCalledTimes(1);
  estado.mockReturnValue(true);
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
  await avancar(1100);
  expect(mundo.rpc).toHaveBeenCalledTimes(2);
});

it("desmontar cancela o reenvio agendado", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  mundo.rpc.mockResolvedValue(FALHA);
  await montar();
  await act(async () => atual().addToCart(produto));
  await avancar(1100);
  expect(mundo.rpc).toHaveBeenCalledTimes(1);
  act(() => raiz.unmount());
  await avancar(10 * 60_000);
  expect(mundo.rpc).toHaveBeenCalledTimes(1);
  // afterEach desmonta de novo: raiz nova só para ele não falhar.
  raiz = createRoot(hospedeiro);
});
