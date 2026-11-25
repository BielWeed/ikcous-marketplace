// @vitest-environment jsdom
//
// Caça por mutação em `src/contexts/CartContext.tsx` (24/11/2026): dois números
// do carregamento do carrinho de quem tem conta que nenhum teste fixava.
//   - A leitura do carrinho salvo na conta que FALHA é refeita com espera
//     crescente: 2 s, 4 s, 8 s, 16 s e 30 s (o teto), e PARA depois de 5
//     releituras (6 leituras no total). Os testes que existiam só olhavam se ela
//     voltava, não QUANDO nem QUANTAS vezes.
//   - Leitura que nunca responde: a tela não fica carregando para sempre; aos 8 s
//     o carregamento é destravado (e não antes: 7,999 s ainda é espera normal).
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comPaginacao } from "./duble-consulta-paginada";

const mundo = vi.hoisted(() => ({
  modo: "falha" as "falha" | "trava",
  leituras: 0,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
const usuario = { id: "u1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => {
          mundo.leituras += 1;
          if (mundo.modo === "trava") return new Promise(() => {});
          return Promise.resolve({
            data: null,
            error: { message: "sem rede" },
          });
        },
        in: comPaginacao(async () => ({ data: [], error: null })),
      }),
    }),
    auth: {
      getSession: async () => ({ data: { session: { user: usuario } } }),
    },
    rpc: async () => ({ error: null }),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: async () => {},
  },
}));
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let atual: ReturnType<typeof useCartContext>;
function Sonda() {
  const contexto = useCartContext();
  useEffect(() => {
    atual = contexto;
  }, [contexto]);
  return null;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mundo.modo = "falha";
  mundo.leituras = 0;
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      close() {}
    },
  );
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
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
  await act(async () =>
    raiz.render(
      <CartProvider>
        <Sonda />
      </CartProvider>,
    ),
  );
}
async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("carrinho com conta: a leitura que falha é refeita em 2, 4, 8, 16 e 30 segundos e para", () => {
  it("cada releitura sai na hora certa e, depois da 5ª, nenhuma outra", async () => {
    await montar();
    expect(mundo.leituras).toBe(1);

    // [quanto tempo passar, quantas leituras já foram feitas]. Instantes das
    // releituras (desde a abertura): 2 s, 6 s, 14 s, 30 s e 60 s.
    const conferencias: [number, number][] = [
      [1_999, 1],
      [2, 2],
      [3_998, 2],
      [2, 3],
      [7_998, 3],
      [2, 4],
      [15_998, 4],
      [2, 5],
      [29_998, 5],
      [2, 6],
    ];
    for (const [passou, leituras] of conferencias) {
      await passar(passou);
      expect(mundo.leituras).toBe(leituras);
    }

    // Esgotou: por mais que o tempo passe, ela não insiste mais.
    await passar(10 * 60_000);
    expect(mundo.leituras).toBe(6);
  });
});

describe("carrinho com conta: leitura que nunca responde", () => {
  it("segue 'carregando' até 7,999 s e é destravada aos 8 s", async () => {
    mundo.modo = "trava";
    await montar();
    expect(atual.isLoading).toBe(true);

    await passar(7_999);
    expect(atual.isLoading).toBe(true);

    await passar(1);
    expect(atual.isLoading).toBe(false);
  });
});
