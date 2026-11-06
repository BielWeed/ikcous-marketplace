// @vitest-environment jsdom
//
// ACHADO (06/11/2026): produto pausado ou excluído SUMIA do carrinho guardado
// na conta sem nenhum aviso. A cliente deixa a peça no carrinho, entra de novo
// (ou abre em outro aparelho) e a peça simplesmente não está lá. O aviso
// "não está mais à venda e saiu do seu carrinho" só olhava o carrinho DESTE
// aparelho e os itens do banco que ainda tinham produto na vitrine — o item do
// banco sem produto era descartado antes de chegar ao aviso.
//
// O item do banco sem produto não tem nome (a tabela guarda só o id do produto,
// a variação e a quantidade): a frase é genérica, no singular ou no plural.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Linha = Record<string, unknown>;

const T = 1_760_000_000_000;

const mundo = vi.hoisted(() => ({
  usuario: null as null | { id: string },
  itensNoBanco: [] as Array<Record<string, unknown>>,
  catalogo: [] as Array<Record<string, unknown>>,
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
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: async () => ({ data: mundo.itensNoBanco, error: null }),
        in: async () =>
          tabela === "vw_produtos_public"
            ? { data: mundo.catalogo, error: null }
            : { data: [], error: null },
      }),
    }),
    auth: {
      getSession: async () => ({
        data: { session: mundo.usuario ? { user: mundo.usuario } : null },
      }),
    },
    rpc: mundo.rpc,
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: async () => {},
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const A_VENDA = "prod-a-venda";
const PAUSADO = "prod-pausado";
const EXCLUIDO = "prod-excluido";

function produto(id: string): Product {
  return {
    id,
    name: `Camiseta ${id}`,
    price: 10,
    images: [],
    stock: 10,
  } as unknown as Product;
}
function linhaDoCatalogo(id: string): Linha {
  return {
    id,
    nome: `Camiseta ${id}`,
    preco_venda: 10,
    estoque: 10,
    ativo: true,
    imagens: [],
    categoria: "geral",
  };
}
function linhaDoBanco(productId: string, quantity: number): Linha {
  return {
    product_id: productId,
    variant_id: "",
    quantity,
    updated_at: new Date(T).toISOString(),
  };
}

const observar = vi.fn();
function Sonda() {
  observar(useCartContext());
  return null;
}
const atual = () =>
  observar.mock.calls.at(-1)![0] as ReturnType<typeof useCartContext>;
const idsNoCarrinho = () => atual().cart.map((i) => i.product.id);
const frasesDeAviso = () =>
  vi.mocked(toast.warning).mock.calls.map((chamada) => chamada[0] as string);

describe("CartContext — carrinho guardado com produto pausado ou excluído", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let valores: Map<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mundo.usuario = { id: "A" };
    mundo.itensNoBanco = [];
    mundo.catalogo = [];
    mundo.rpc.mockResolvedValue({ error: null });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    valores = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => valores.get(k) ?? null,
      setItem: (k: string, v: string) => void valores.set(k, v),
      removeItem: (k: string) => void valores.delete(k),
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function abrirOApp() {
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda />
        </CartProvider>,
      );
    });
    for (let t = 0; t < 1500; t += 500) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
    }
  }

  it("carrinho da conta com produto pausado e carrinho local vazio: a cliente é avisada", async () => {
    mundo.itensNoBanco = [linhaDoBanco(A_VENDA, 2), linhaDoBanco(PAUSADO, 1)];
    mundo.catalogo = [linhaDoCatalogo(A_VENDA)];

    await abrirOApp();

    // A regra de quais itens entram não mudou: só o que está à venda.
    expect(idsNoCarrinho()).toEqual([A_VENDA]);
    expect(frasesDeAviso()).toEqual([
      "Um item do seu carrinho guardado não está mais à venda e saiu dele.",
    ]);
  });

  it("dois itens fora da vitrine: UMA frase no plural, com a conta certa", async () => {
    mundo.itensNoBanco = [
      linhaDoBanco(PAUSADO, 1),
      linhaDoBanco(EXCLUIDO, 3),
      linhaDoBanco(A_VENDA, 1),
    ];
    mundo.catalogo = [linhaDoCatalogo(A_VENDA)];

    await abrirOApp();

    expect(idsNoCarrinho()).toEqual([A_VENDA]);
    expect(frasesDeAviso()).toEqual([
      "2 itens do seu carrinho guardado não estão mais à venda e saíram dele.",
    ]);
  });

  it("tudo à venda: nenhum aviso (o caminho feliz não muda)", async () => {
    mundo.itensNoBanco = [linhaDoBanco(A_VENDA, 2)];
    mundo.catalogo = [linhaDoCatalogo(A_VENDA)];

    await abrirOApp();

    expect(idsNoCarrinho()).toEqual([A_VENDA]);
    expect(frasesDeAviso()).toEqual([]);
  });

  it("o mesmo produto pausado também está no carrinho DESTE aparelho: um aviso só, o com nome", async () => {
    valores.set(
      "marketplace_cart_v1",
      JSON.stringify([
        {
          product: produto(PAUSADO),
          quantity: 1,
          lastModifiedAt: T,
        },
      ]),
    );
    mundo.itensNoBanco = [linhaDoBanco(PAUSADO, 1)];
    mundo.catalogo = [];

    await abrirOApp();

    expect(idsNoCarrinho()).toEqual([]);
    expect(frasesDeAviso()).toEqual([
      `"Camiseta ${PAUSADO}" não está mais à venda e saiu do seu carrinho.`,
    ]);
  });

  it("mesmo produto pausado, mas OUTRA variação aqui: a linha do banco é outra e também é avisada", async () => {
    valores.set(
      "marketplace_cart_v1",
      JSON.stringify([
        {
          product: produto(PAUSADO),
          quantity: 1,
          variantId: "v-b",
          lastModifiedAt: T,
        },
      ]),
    );
    mundo.itensNoBanco = [{ ...linhaDoBanco(PAUSADO, 1), variant_id: "v-a" }];
    mundo.catalogo = [];

    await abrirOApp();

    expect(idsNoCarrinho()).toEqual([]);
    expect(frasesDeAviso()).toHaveLength(2);
    expect(frasesDeAviso()).toContain(
      "Um item do seu carrinho guardado não está mais à venda e saiu dele.",
    );
  });
});
