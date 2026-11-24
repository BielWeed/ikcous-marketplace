// @vitest-environment jsdom
//
// Caça de provas fracas (carrinho, 24/11/2026): o reenvio do carrinho depois de
// uma gravação que falha com o navegador online segue uma escada de esperas
// (2 s, 4 s, 8 s, 16 s e 30 s, depois de cada falha) e PARA depois de 5
// reenvios. O teste que existia só exigia "no máximo 7 gravações", o que
// deixava passar tanto um reenvio a mais quanto um teto de espera trocado
// (30 s por 8 s). O que isto protege:
//   - a escada exata de esperas e o teto de 5 reenvios (6 gravações no total);
//   - a rede que volta (evento `online`) recomeça a escada do zero, mesmo
//     depois de os reenvios terem esgotado;
//   - uma gravação que dá certo também zera a conta: a próxima falha espera
//     2 s de novo, e não o que sobrou da escada.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { comPaginacao } from "./duble-consulta-paginada";

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
        in: comPaginacao(() => Promise.resolve({ data: [], error: null })),
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
const FALHA = { error: { message: "sem rede" } };

it("a escada de esperas é 2 s, 4 s, 8 s, 16 s e 30 s (cada reenvio sai 1 s depois da espera) e para em 6 gravações", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  mundo.rpc.mockResolvedValue(FALHA);
  await montar();
  await act(async () => atual().addToCart(produto));

  // Cada gravação sai 1 s depois de a espera acabar (a espera de gravação do
  // carrinho). Instantes (desde a edição): 1 s, 4 s, 9 s, 18 s, 35 s, 66 s.
  const conferencias: [number, number][] = [
    [900, 0],
    [1100, 1],
    [3900, 1],
    [4100, 2],
    [8900, 2],
    [9100, 3],
    [17900, 3],
    [18100, 4],
    [34900, 4],
    [35100, 5],
    [65900, 5],
    [66100, 6],
  ];
  let passou = 0;
  for (const [instante, gravacoes] of conferencias) {
    await avancar(instante - passou);
    passou = instante;
    expect(mundo.rpc, `aos ${instante} ms`).toHaveBeenCalledTimes(gravacoes);
  }

  // Esgotados os 5 reenvios, nada mais sai, por mais que o tempo passe.
  await avancar(10 * 60_000);
  expect(mundo.rpc).toHaveBeenCalledTimes(6);
});

it("a rede que volta depois de esgotados os reenvios recomeça a escada do zero", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  mundo.rpc.mockResolvedValue(FALHA);
  await montar();
  await act(async () => atual().addToCart(produto));
  await avancar(10 * 60_000);
  expect(mundo.rpc).toHaveBeenCalledTimes(6);

  // A rede volta: uma gravação nova sai e, falhando, a espera é a de 2 s
  // (não a 7ª da escada antiga, que nem existiria).
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
  await avancar(1100);
  expect(mundo.rpc).toHaveBeenCalledTimes(7);
  await avancar(3000);
  expect(mundo.rpc).toHaveBeenCalledTimes(8);
});

it("uma gravação que dá certo zera a conta: a próxima falha espera 2 s de novo", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  mundo.rpc
    .mockResolvedValueOnce(FALHA)
    .mockResolvedValueOnce(FALHA)
    .mockResolvedValueOnce(FALHA)
    .mockResolvedValueOnce({ error: null })
    .mockResolvedValue(FALHA);
  await montar();
  await act(async () => atual().addToCart(produto));
  // Três falhas (em 1 s, 4 s e 9 s) e a quarta gravação, em 18 s, dá certo.
  await avancar(18_500);
  expect(mundo.rpc).toHaveBeenCalledTimes(4);

  // Edição nova: a gravação sai 1 s depois, falha, e o reenvio vem em 2 s + 1 s.
  await act(async () => atual().addToCart(produto));
  await avancar(1100);
  expect(mundo.rpc).toHaveBeenCalledTimes(5);
  await avancar(3000);
  expect(mundo.rpc).toHaveBeenCalledTimes(6);
});
