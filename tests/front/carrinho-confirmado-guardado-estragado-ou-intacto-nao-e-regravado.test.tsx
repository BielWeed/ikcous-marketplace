// @vitest-environment jsdom
//
// Caça por mutação em `src/contexts/CartContext.tsx` (24/11/2026): a lista das
// linhas que o banco já confirmou ter (guardada no aparelho, por conta) é podada
// quando a cliente mexe no carrinho. Ela só é mexida quando há mesmo o que
// podar:
//  - lista inteira em dia com o carrinho: nada é regravado;
//  - lista que sobrou de uma versão antiga ou que alguém estragou (dono que não
//    é texto) é ignorada, não "consertada" por cima;
//  - um item que não é texto no meio das entradas é descartado ao ler e não
//    puxa regravação sozinho;
//  - linha que o carrinho de agora não tem mais sai da lista (controle).
import { CartProvider } from "@/contexts/CartContext";
import type { CartItem, Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CHAVE_CARRINHO = "marketplace_cart_v1";
const CHAVE_CONFIRMADO = "marketplace_cart_confirmado_v1";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
        in: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
    rpc: () => Promise.resolve({ error: null }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => Promise.resolve(),
  },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }),
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
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}

function linha(id: string, quantity: number): CartItem {
  return {
    product: produto(id),
    quantity,
    lastModifiedAt: 1_760_000_000_000,
  };
}

describe("CartContext — lista das linhas confirmadas pelo banco", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  let gravacoesDaLista: number;

  beforeEach(() => {
    armazem = new Map<string, string>();
    gravacoesDaLista = 0;
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (k === CHAVE_CONFIRMADO) gravacoesDaLista += 1;
        armazem.set(k, v);
      },
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
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function abrirOApp(carrinho: CartItem[], confirmado: unknown) {
    armazem.set(CHAVE_CARRINHO, JSON.stringify(carrinho));
    const textoDaLista = JSON.stringify(confirmado);
    armazem.set(CHAVE_CONFIRMADO, textoDaLista);
    await act(async () => {
      raiz.render(<CartProvider>{null}</CartProvider>);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    return textoDaLista;
  }

  it("a lista bate com o carrinho: nada a podar, nada é regravado", async () => {
    const texto = await abrirOApp([linha("p1", 2)], {
      uid: "u1",
      entradas: ["p1-=2"],
    });

    expect(gravacoesDaLista).toBe(0);
    expect(armazem.get(CHAVE_CONFIRMADO)).toBe(texto);
  });

  it("uma linha da lista que o carrinho já não tem sai dela; as outras ficam", async () => {
    await abrirOApp([linha("p1", 2)], {
      uid: "u1",
      entradas: ["p1-=2", "p9-=1"],
    });

    expect(JSON.parse(armazem.get(CHAVE_CONFIRMADO) ?? "{}")).toEqual({
      uid: "u1",
      entradas: ["p1-=2"],
    });
    expect(gravacoesDaLista).toBe(1);
  });

  it("a quantidade da linha mudou desde a confirmação: a entrada velha sai", async () => {
    await abrirOApp([linha("p1", 3)], { uid: "u1", entradas: ["p1-=2"] });

    expect(JSON.parse(armazem.get(CHAVE_CONFIRMADO) ?? "{}")).toEqual({
      uid: "u1",
      entradas: [],
    });
  });

  it("lista com dono que não é texto é ignorada: fica exatamente como estava", async () => {
    const texto = await abrirOApp([linha("p1", 2)], {
      uid: 7,
      entradas: ["p9-=1"],
    });

    expect(gravacoesDaLista).toBe(0);
    expect(armazem.get(CHAVE_CONFIRMADO)).toBe(texto);
  });

  it("entrada que não é texto no meio da lista é descartada ao ler e, sozinha, não força regravação", async () => {
    const texto = await abrirOApp([linha("p1", 2)], {
      uid: "u1",
      entradas: [7, "p1-=2"],
    });

    expect(gravacoesDaLista).toBe(0);
    expect(armazem.get(CHAVE_CONFIRMADO)).toBe(texto);
  });
});
