// @vitest-environment jsdom
//
// Visitante que navega muito enche o armazenamento do aparelho com as cópias
// por produto (recomendações, avaliações, perguntas). Cheio, o carrinho dele —
// que só mora ali — não era gravado: sumia ao fechar e abrir o app, sem aviso.
// Agora, se gravar o carrinho falha, as cópias (que se refazem com uma ida à
// rede) saem do aparelho e a gravação é tentada de novo.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { CartItem, Product } from "@/types";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArmazenamentoComCota } from "./helpers/armazenamento-com-cota";

const CHAVE = "marketplace_cart_v1";

const mundo = vi.hoisted(() => ({
  usuario: null as null | { id: string },
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
      getSession: () =>
        Promise.resolve({
          data: { session: mundo.usuario ? { user: mundo.usuario } : null },
        }),
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

describe("CartContext — carrinho do visitante com o aparelho cheio", () => {
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
    mundo.usuario = null;
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

  async function esperar(ms = 40) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }

  async function abrirOApp() {
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda onEstado={(c) => (atual = c)} />
        </CartProvider>,
      );
    });
    await esperar();
  }

  /** Enche o aparelho com `copias` de uma loja até não caber nem mais uma linha. */
  function encherCom(prefixo: string) {
    let i = 0;
    for (;;) {
      try {
        armazem.setItem(`${prefixo}p${i++}`, "x".repeat(150));
      } catch {
        return i - 1;
      }
    }
  }

  const guardado = () =>
    (JSON.parse(armazem.getItem(CHAVE) ?? "[]") as CartItem[]).map(
      (i) => i.product.id,
    );

  it("aparelho cheio de cópias: o carrinho é gravado e as cópias saem", async () => {
    await abrirOApp();
    const gravadas = encherCom("ikcous_recs_v2_cache_");
    expect(gravadas).toBeGreaterThan(10);
    // Prova de que o aparelho está mesmo cheio: um carrinho não cabe.
    expect(() =>
      armazem.setItem(CHAVE, JSON.stringify([{ product: produto("Z") }])),
    ).toThrow();

    await act(async () => {
      atual.addToCart(produto("A"), 1);
    });
    await esperar();

    expect(atual.cart.map((i) => i.product.id)).toEqual(["A"]);
    expect(guardado()).toEqual(["A"]);
    expect(
      armazem.chaves().filter((c) => c.startsWith("ikcous_recs_v2_cache_")),
    ).toEqual([]);
  });

  it("cheio de OUTRAS coisas (não são cópias): nada é apagado e o carrinho segue na memória", async () => {
    await abrirOApp();
    const gravadas = encherCom("favorites_visitante_");
    expect(gravadas).toBeGreaterThan(10);
    const antes = armazem.chaves().length;

    await act(async () => {
      atual.addToCart(produto("A"), 1);
    });
    await esperar();

    expect(atual.cart.map((i) => i.product.id)).toEqual(["A"]);
    expect(armazem.getItem(CHAVE)).toBeNull();
    expect(armazem.chaves()).toHaveLength(antes);
  });
});
