// @vitest-environment jsdom
//
// Caça de provas fracas (carrinho, 24/11/2026): a leitura do carrinho salvo na
// conta que FALHA é refeita com espera crescente (2 s, 4 s, ...) enquanto o
// navegador está online. Com o navegador OFFLINE não se insiste: cada tentativa
// gastaria bateria à toa, e quem retoma é o evento `online`. Nenhum teste olhava
// o ramo offline da releitura (só o da gravação): tirar a guarda passava a
// suíte inteira. O que isto protege:
//   - online, a leitura que falhou volta sozinha (controle);
//   - offline, nenhuma releitura é agendada, por mais que o tempo passe;
//   - quando a rede volta, a leitura é refeita e o carrinho salvo aparece.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comPaginacao } from "./duble-consulta-paginada";

const mundo = vi.hoisted(() => ({
  falhar: true,
  leituras: 0,
  rpc: vi.fn(),
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
const produtos = [
  { id: "p1", nome: "Camiseta", preco_venda: 10, estoque: 20 },
].map((p) => ({ ...p, ativo: true, imagens: [] }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => {
          mundo.leituras += 1;
          return Promise.resolve(
            mundo.falhar
              ? { data: null, error: { message: "sem rede" } }
              : {
                  data: [
                    {
                      product_id: "p1",
                      variant_id: "",
                      quantity: 2,
                      updated_at: new Date(Date.now() - 1000).toISOString(),
                    },
                  ],
                  error: null,
                },
          );
        },
        in: comPaginacao(async (_coluna: string, ids: string[]) =>
          tabela === "product_variants"
            ? { data: [], error: null }
            : {
                data: produtos.filter((p) => ids.includes(p.id)),
                error: null,
              },
        ),
      }),
    }),
    auth: {
      getSession: async () => ({ data: { session: { user: usuario } } }),
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

let atual: ReturnType<typeof useCartContext>;
function Sonda() {
  const contexto = useCartContext();
  useEffect(() => {
    atual = contexto;
  }, [contexto]);
  return <output>{contexto.cartCount}</output>;
}
let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mundo.falhar = true;
  mundo.leituras = 0;
  mundo.rpc.mockResolvedValue({ error: null });
  localStorage.clear();
  sessionStorage.clear();
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

describe("carrinho: a leitura do carrinho salvo que falhou", () => {
  it("controle: com o navegador online, a leitura que falhou é refeita sozinha", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await montar();
    await passar(50);
    const primeiras = mundo.leituras;
    expect(primeiras).toBeGreaterThan(0);

    mundo.falhar = false;
    await passar(10_000);

    expect(mundo.leituras).toBeGreaterThan(primeiras);
    expect(atual.cart.map((i) => [i.product.id, i.quantity])).toEqual([
      ["p1", 2],
    ]);
  });

  it("com o navegador offline nenhuma releitura é agendada, por mais que o tempo passe", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await montar();
    await passar(50);
    const primeiras = mundo.leituras;
    expect(primeiras).toBeGreaterThan(0);

    mundo.falhar = false;
    await passar(10 * 60_000);

    expect(mundo.leituras).toBe(primeiras);
    expect(atual.cart).toEqual([]);
  });

  it("offline e depois online: o evento `online` refaz a leitura e o carrinho salvo aparece", async () => {
    const estado = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await montar();
    await passar(50);
    mundo.falhar = false;
    await passar(60_000);
    expect(atual.cart).toEqual([]);

    estado.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(atual.cart.map((i) => [i.product.id, i.quantity])).toEqual([
      ["p1", 2],
    ]);
  });
});
