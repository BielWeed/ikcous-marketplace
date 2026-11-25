// @vitest-environment jsdom
//
// Caça por mutação em `src/contexts/CartContext.tsx` (24/11/2026): voltar do
// segundo plano relê o carrinho do banco no MÁXIMO a cada 15 segundos. O teste
// que existia só provava "vai e volta em meio segundo lê uma vez"; trocar os 15 s
// por 14 s (ou 16 s) passava. Aqui o número é medido nas duas pontas: com 14,95 s
// desde a última leitura ainda não relê, e logo depois dos 15 s relê.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comPaginacao } from "./duble-consulta-paginada";

const mundo = vi.hoisted(() => ({
  leiturasDoCarrinho: 0,
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
    from: (tabela: string) => ({
      select: () => ({
        eq: () => {
          if (tabela === "cart_items") mundo.leiturasDoCarrinho += 1;
          return Promise.resolve({ data: [], error: null });
        },
        in: comPaginacao(async () => ({ data: [], error: null })),
      }),
    }),
    auth: {
      getSession: async () => ({ data: { session: { user: usuario } } }),
    },
    rpc: async () => ({ error: null }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
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
let visibilidade: "visible" | "hidden";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mundo.leiturasDoCarrinho = 0;
  localStorage.clear();
  sessionStorage.clear();
  visibilidade = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibilidade,
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
  // biome-ignore lint/performance/noDelete: volta ao getter nativo do jsdom
  delete (document as unknown as Record<string, unknown>).visibilityState;
});

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function montar() {
  await act(async () =>
    raiz.render(
      <CartProvider>
        <Sonda />
      </CartProvider>,
    ),
  );
  await passar(1_100);
}
/** O app foi para o segundo plano, ficou `escondidoPorMs` lá e voltou. */
async function voltar(escondidoPorMs: number) {
  visibilidade = "hidden";
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await passar(escondidoPorMs);
  visibilidade = "visible";
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await passar(50);
}

describe("carrinho com conta: espera mínima entre duas leituras ao voltar do segundo plano", () => {
  it("14,95 s depois da última leitura NÃO relê; passados os 15 s, relê", async () => {
    await montar();
    expect(atual.cart).toEqual([]);

    // Primeira volta: a última leitura foi a da abertura, há mais de 15 s.
    await passar(60_000);
    await voltar(10);
    const aposAPrimeira = mundo.leiturasDoCarrinho;

    // 14,95 s depois do instante em que a primeira volta releu.
    await voltar(14_900 - 50);
    expect(mundo.leiturasDoCarrinho).toBe(aposAPrimeira);

    // Um pouco mais e passam dos 15 s: relê.
    await voltar(200);
    expect(mundo.leiturasDoCarrinho).toBe(aposAPrimeira + 1);
  });

  it("15 s redondos depois da última leitura já relê", async () => {
    await montar();
    await passar(60_000);
    await voltar(10);
    const aposAPrimeira = mundo.leiturasDoCarrinho;

    // `voltar` gasta 50 ms depois do evento "visível": 14,95 s escondido + 50 ms
    // = 15 s exatos entre um evento "visível" e o seguinte.
    await voltar(14_950);

    expect(mundo.leiturasDoCarrinho).toBe(aposAPrimeira + 1);
  });
});
