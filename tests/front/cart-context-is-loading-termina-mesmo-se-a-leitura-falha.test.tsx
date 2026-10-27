// @vitest-environment jsdom
//
// `isLoading` do carrinho SEMPRE termina (lote 238, caça 11-D #6). A tela
// "Carregando seu carrinho…" depende dele: se a leitura do carrinho da conta
// falhar (rede caiu, erro do banco), o carregando tem de acabar — senão a
// cliente ficaria presa olhando "Carregando" em vez do carrinho que está neste
// aparelho.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mundo = vi.hoisted(() => ({
  usuario: null as null | { id: string },
  itensNoBanco: [] as Array<Record<string, unknown>>,
  catalogo: [] as Array<Record<string, unknown>>,
  falhaNoCatalogo: false,
  falhaNoCarrinho: "nenhuma" as "nenhuma" | "erro-do-banco" | "rede-caiu",
  leiturasDoCatalogo: 0,
  avisos: [] as string[],
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

function idsDe(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.map(String) : [];
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => {
          if (
            tabela === "cart_items" &&
            mundo.falhaNoCarrinho === "rede-caiu"
          ) {
            return Promise.reject(new Error("rede caiu"));
          }
          if (
            tabela === "cart_items" &&
            mundo.falhaNoCarrinho === "erro-do-banco"
          ) {
            return Promise.resolve({
              data: null,
              error: { message: "permissão negada" },
            });
          }
          return Promise.resolve({
            data: tabela === "cart_items" ? mundo.itensNoBanco : [],
            error: null,
          });
        },
        in: async (_coluna: string, ids: unknown) => {
          if (tabela === "vw_produtos_public") {
            mundo.leiturasDoCatalogo += 1;
            if (mundo.falhaNoCatalogo) {
              return { data: null, error: { message: "rede caiu" } };
            }
            const pedidos = idsDe(ids);
            return {
              data: mundo.catalogo.filter((l) =>
                pedidos.includes(String(l.id)),
              ),
              error: null,
            };
          }
          return { data: [], error: null };
        },
      }),
    }),
    rpc: () => Promise.resolve({ error: null }),
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: mundo.usuario ? { user: mundo.usuario } : null },
        }),
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => Promise.resolve(),
  },
}));

vi.mock("sonner", () => {
  const registrar = (m: unknown) => {
    mundo.avisos.push(String(m));
  };
  return {
    toast: Object.assign(vi.fn(registrar), {
      error: registrar,
      info: registrar,
      success: registrar,
      warning: registrar,
    }),
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Mundo = { isLoading: boolean; cartLength: number };
let atual: Mundo;

function Sonda() {
  const { isLoading, cart } = useCartContext();
  useEffect(() => {
    atual = { isLoading, cartLength: cart.length };
  }, [isLoading, cart]);
  return null;
}

describe("CartContext — isLoading termina mesmo se a leitura do carrinho falhar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => void armazem.set(k, v),
      removeItem: (k: string) => void armazem.delete(k),
    });
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage = null;
        postMessage() {}
        close() {}
      },
    );
    mundo.usuario = { id: "u1" };
    mundo.itensNoBanco = [];
    mundo.catalogo = [];
    mundo.falhaNoCatalogo = false;
    mundo.falhaNoCarrinho = "nenhuma";
    mundo.leiturasDoCatalogo = 0;
    mundo.avisos = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
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
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
  }

  it("controle: leitura boa -> isLoading termina", async () => {
    await montar();
    expect(atual.isLoading).toBe(false);
  });

  it("a rede cai na leitura do carrinho da conta: isLoading termina", async () => {
    mundo.falhaNoCarrinho = "rede-caiu";
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    await montar();
    expect(atual.isLoading).toBe(false);
    erro.mockRestore();
  });

  it("o banco responde erro na leitura do carrinho: isLoading termina", async () => {
    mundo.falhaNoCarrinho = "erro-do-banco";
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    await montar();
    expect(atual.isLoading).toBe(false);
    erro.mockRestore();
  });
});
