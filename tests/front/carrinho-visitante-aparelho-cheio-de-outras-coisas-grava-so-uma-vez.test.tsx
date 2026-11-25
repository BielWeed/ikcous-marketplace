// @vitest-environment jsdom
//
// Caça por mutação em `src/contexts/CartContext.tsx` (24/11/2026): visitante com
// o aparelho cheio. Se gravar o carrinho falha, o app só tenta DE NOVO quando
// conseguiu liberar espaço (apagando as cópias por produto). Cheio de outras
// coisas (nada a liberar), repetir a gravação seria gastar uma segunda falha
// igual à primeira: o app tenta uma vez e segue com o carrinho na memória.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { Product } from "@/types";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArmazenamentoComCota } from "./helpers/armazenamento-com-cota";

const CHAVE = "marketplace_cart_v1";

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

type Contexto = ReturnType<typeof useCartContext>;

function Sonda({ onEstado }: Readonly<{ onEstado: (c: Contexto) => void }>) {
  const contexto = useCartContext();
  useEffect(() => {
    onEstado(contexto);
  }, [contexto, onEstado]);
  return null;
}

describe("CartContext — aparelho cheio de coisas que não são cópias", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: Contexto;
  let armazem: ArmazenamentoComCota;

  beforeEach(() => {
    armazem = new ArmazenamentoComCota(20_000);
    vi.stubGlobal("localStorage", armazem);
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage = null;
        postMessage() {}
        close() {}
      },
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
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

  it("sem nada para liberar, a gravação do carrinho é tentada UMA vez e o carrinho segue na memória", async () => {
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda onEstado={(c) => (atual = c)} />
        </CartProvider>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    for (let i = 0; ; i += 1) {
      try {
        armazem.setItem(`favorites_visitante_p${i}`, "x".repeat(150));
      } catch {
        break;
      }
    }
    const tentativas = vi.spyOn(armazem, "setItem");

    await act(async () => {
      atual.addToCart(produto("A"), 1);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    const gravacoesDoCarrinho = tentativas.mock.calls.filter(
      ([chave]) => chave === CHAVE,
    );
    expect(gravacoesDoCarrinho).toHaveLength(1);
    expect(atual.cart.map((i) => i.product.id)).toEqual(["A"]);
    expect(armazem.getItem(CHAVE)).toBeNull();
  });
});
