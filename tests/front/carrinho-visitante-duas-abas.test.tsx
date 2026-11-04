// @vitest-environment jsdom
//
// Carrinho de quem NÃO está logado com duas abas (ou janelas) abertas.
//
// DEFEITO: o carrinho do visitante só vive na memória da aba + localStorage, e
// cada aba regravava o carrinho INTEIRO dela a cada mudança. Visitante com o app
// em duas abas: a aba 1 põe o produto A; a aba 2 (aberta antes, vazia) põe o B e
// grava [B] por cima de [A]. Ao recarregar, só o B. Agora a aba ouve o evento
// "storage" (que o navegador só dispara nas OUTRAS abas) e adota o carrinho que
// a outra gravou; o último a gravar vence, sem fusão inventada.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import {
  criarGerenciadorDeChave,
  impressaoDaCompra,
} from "@/lib/chave-do-pedido";
import type { CartItem, Product } from "@/types";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function item(id: string, quantity = 1): CartItem {
  return { product: produto(id), quantity, lastModifiedAt: 1_760_000_000_000 };
}

type Contexto = ReturnType<typeof useCartContext>;

function Sonda({ onEstado }: Readonly<{ onEstado: (c: Contexto) => void }>) {
  const contexto = useCartContext();
  useEffect(() => {
    onEstado(contexto);
  }, [contexto, onEstado]);
  return null;
}

describe("CartContext — visitante com duas abas não perde o carrinho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: Contexto;
  let armazem: Map<string, string>;
  let gravacoesDoCarrinho: number;

  beforeEach(() => {
    armazem = new Map<string, string>();
    gravacoesDoCarrinho = 0;
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (k === CHAVE) gravacoesDoCarrinho += 1;
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

  /** A OUTRA aba gravou o carrinho: o navegador avisa só esta aba. */
  async function outraAbaGravou(
    valor: string | null,
    chave: string | null = CHAVE,
  ) {
    if (valor === null) armazem.delete(CHAVE);
    else armazem.set(CHAVE, valor);
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: chave, newValue: valor }),
      );
    });
    await esperar();
  }

  const ids = () => atual.cart.map((i) => i.product.id);
  const guardado = () =>
    (JSON.parse(armazem.get(CHAVE) ?? "[]") as CartItem[]).map(
      (i) => i.product.id,
    );

  it("aba vazia adota o carrinho que a outra aba gravou", async () => {
    await abrirOApp();
    expect(ids()).toEqual([]);

    await outraAbaGravou(JSON.stringify([item("A")]));

    expect(ids()).toEqual(["A"]);
  });

  it("o defeito original: A veio da outra aba, B entra aqui, o guardado fica com A e B (não só B)", async () => {
    await abrirOApp();
    await outraAbaGravou(JSON.stringify([item("A")]));

    await act(async () => {
      atual.addToCart(produto("B"), 1);
    });
    await esperar();

    expect(ids().sort()).toEqual(["A", "B"]);
    expect(guardado().sort()).toEqual(["A", "B"]);
  });

  it("último a gravar vence: o que esta aba tinha dá lugar ao da outra, sem fusão", async () => {
    await abrirOApp();
    await act(async () => {
      atual.addToCart(produto("B"), 1);
    });
    await esperar();
    expect(ids()).toEqual(["B"]);

    await outraAbaGravou(JSON.stringify([item("A", 2)]));

    expect(ids()).toEqual(["A"]);
    expect(atual.cart[0].quantity).toBe(2);
    expect(guardado()).toEqual(["A"]);
  });

  it("sem laço: adotar o carrinho da outra aba grava no máximo UMA vez e não dispara evento nenhum", async () => {
    await abrirOApp();
    const eventos = vi.fn();
    window.addEventListener("storage", eventos);
    const antes = gravacoesDoCarrinho;

    await outraAbaGravou(JSON.stringify([item("A")]));
    await esperar(80);

    window.removeEventListener("storage", eventos);
    // Só o evento simulado chegou; esta aba não criou outro.
    expect(eventos).toHaveBeenCalledTimes(1);
    expect(gravacoesDoCarrinho - antes).toBeLessThanOrEqual(1);
  });

  it("o evento traz o mesmo carrinho que esta aba já tem: nada muda e nada é regravado", async () => {
    await abrirOApp();
    await act(async () => {
      atual.addToCart(produto("A"), 1);
    });
    await esperar();
    const antes = gravacoesDoCarrinho;
    const mesmo = armazem.get(CHAVE) as string;

    await outraAbaGravou(mesmo);

    expect(ids()).toEqual(["A"]);
    expect(gravacoesDoCarrinho).toBe(antes);
  });

  it("a outra aba esvaziou o carrinho (compra concluída): esta esvazia também", async () => {
    await abrirOApp();
    await outraAbaGravou(JSON.stringify([item("A")]));
    expect(ids()).toEqual(["A"]);

    await outraAbaGravou(null);

    expect(ids()).toEqual([]);
  });

  it("evento de OUTRA chave do localStorage não mexe no carrinho", async () => {
    await abrirOApp();
    await act(async () => {
      atual.addToCart(produto("B"), 1);
    });
    await esperar();

    await outraAbaGravou(JSON.stringify([item("A")]), "outra_chave");

    expect(ids()).toEqual(["B"]);
  });

  it("valor estragado/que não é lista: ignora e mantém o carrinho daqui", async () => {
    await abrirOApp();
    await act(async () => {
      atual.addToCart(produto("B"), 1);
    });
    await esperar();

    await outraAbaGravou("{isso nao e json");
    expect(ids()).toEqual(["B"]);

    await outraAbaGravou(JSON.stringify({ nao: "lista" }));
    expect(ids()).toEqual(["B"]);
  });

  it("linha sem produto válido na carga da outra aba é descartada, as boas ficam", async () => {
    await abrirOApp();

    await outraAbaGravou(
      JSON.stringify([item("A"), { product: null, quantity: 1 }]),
    );

    expect(ids()).toEqual(["A"]);
  });

  it("logado: o banco é a fonte, o evento do localStorage não troca o carrinho", async () => {
    mundo.usuario = { id: "u1" };
    await abrirOApp();
    await esperar(60);
    expect(ids()).toEqual([]);

    await outraAbaGravou(JSON.stringify([item("A")]));

    expect(ids()).toEqual([]);
  });

  it("pedido enviado sem resposta: o carrinho não muda por baixo (a chave do reenvio depende dele)", async () => {
    await abrirOApp();
    await act(async () => {
      atual.addToCart(produto("B"), 1);
    });
    await esperar();
    criarGerenciadorDeChave(localStorage).chavePara(
      impressaoDaCompra({
        items: [{ product_id: "B", variant_id: undefined, quantity: 1 }],
        totalAmount: 10,
        shippingCost: 0,
        paymentMethod: "entrega",
      }),
    );

    await outraAbaGravou(JSON.stringify([item("A")]));

    expect(ids()).toEqual(["B"]);
  });

  it("depois do desmonte o ouvinte sai: evento tardio não faz nada", async () => {
    await abrirOApp();
    const adicionados = vi.spyOn(window, "removeEventListener");
    act(() => raiz.unmount());
    expect(adicionados).toHaveBeenCalledWith("storage", expect.any(Function));
    // Remonta vazio só para o afterEach desmontar sem erro.
    raiz = createRoot(hospedeiro);
  });
});
