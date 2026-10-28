// @vitest-environment jsdom
//
// Lote 249 (ressalva da revisão): a releitura automática do catálogo (ao abrir o
// app sem conta, ou ao voltar do segundo plano) conferia a chave do pedido só
// ANTES das esperas de rede. Se a cliente tocava em "Finalizar" com a leitura em
// voo, a chave nascia e o pedido era gravado (a última peça vai a zero); a
// leitura voltava DEPOIS, via o estoque que o próprio pedido consumiu e tirava a
// linha — e o novo "Finalizar" criava um SEGUNDO pedido. Agora a leitura
// automática confere a chave DE NOVO logo antes de aplicar o resultado. A ação
// explícita "Atualize o carrinho" (recusa do pedido) continua relendo sempre.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import {
  criarGerenciadorDeChave,
  impressaoDaCompra,
} from "@/lib/chave-do-pedido";
import { mapProductFromDB } from "@/lib/mappers";
import type { CartItem, Product } from "@/types";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Linha = Record<string, unknown>;

const T = 1_760_000_000_000;

const mundo = vi.hoisted(() => ({
  usuario: null as null | { id: string },
  itensNoBanco: [] as Array<Record<string, unknown>>,
  catalogo: [] as Array<Record<string, unknown>>,
  leiturasDoCatalogo: 0,
  avisos: [] as string[],
  portao: null as null | Promise<void>,
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
        eq: () =>
          Promise.resolve({
            data: tabela === "cart_items" ? mundo.itensNoBanco : [],
            error: null,
          }),
        in: async (_coluna: string, ids: unknown) => {
          if (tabela === "vw_produtos_public") {
            // Consulta em voo: o teste a segura, e o estoque é lido DEPOIS
            // (como no servidor, que responde com o que há quando a consulta
            // chega).
            if (mundo.portao) await mundo.portao;
            mundo.leiturasDoCatalogo += 1;
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

function linha(extra: Linha = {}): Linha {
  return {
    id: "prod-1",
    nome: "Blusa A",
    preco_venda: 59.9,
    estoque: 1,
    ativo: true,
    imagens: [],
    categoria: "geral",
    ...extra,
  };
}

function produtoSalvo(extra: Linha = {}): Product {
  return mapProductFromDB({
    ...linha(),
    ...extra,
    product_variants: [],
  });
}

function itemSalvo(produto: Product, quantity: number): CartItem {
  return { product: produto, quantity, lastModifiedAt: T };
}

type Mundo = { cart: CartItem[]; renovar: () => Promise<void> };
let atual: Mundo;

function Sonda() {
  const { cart, renovarCarrinhoPeloCatalogo } = useCartContext();
  useEffect(() => {
    atual = { cart, renovar: renovarCarrinhoPeloCatalogo };
  }, [cart, renovarCarrinhoPeloCatalogo]);
  return null;
}

/** A impressão que o checkout calcula do carrinho de agora (mesmos campos). */
function impressaoDoCarrinho(cart: CartItem[]) {
  return impressaoDaCompra({
    items: cart.map((i) => ({
      product_id: i.product.id,
      variant_id: undefined,
      quantity: i.quantity,
    })),
    totalAmount: 59.9,
    shippingCost: 0,
    paymentMethod: "entrega",
  });
}

describe("CartContext — a chave que nasce com a releitura em voo segura o carrinho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let relogio: number;
  let armazem: Map<string, string>;
  let soltarPortao: () => void;

  beforeEach(() => {
    armazem = new Map<string, string>();
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
    mundo.itensNoBanco = [
      {
        product_id: "prod-1",
        variant_id: "",
        quantity: 1,
        updated_at: new Date(T).toISOString(),
      },
    ];
    mundo.catalogo = [linha()];
    mundo.avisos = [];
    mundo.portao = null;
    relogio = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => relogio);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // biome-ignore lint/performance/noDelete: volta ao getter nativo do jsdom
    delete (document as unknown as Record<string, unknown>).visibilityState;
  });

  async function esperar(ms = 60) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }

  async function montar(salvos: CartItem[]) {
    armazem.set("marketplace_cart_v1", JSON.stringify(salvos));
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda />
        </CartProvider>,
      );
    });
    await esperar();
  }

  /** Volta do segundo plano: a releitura começa e fica em voo. */
  async function voltarComALeituraSegura() {
    mundo.portao = new Promise<void>((resolver) => {
      soltarPortao = resolver;
    });
    relogio += 60_000;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await esperar(20);
  }

  async function soltarALeitura() {
    await act(async () => {
      soltarPortao();
    });
    await esperar();
  }

  /** O checkout grava o registro da chave ao tocar em Finalizar. */
  function tocarEmFinalizar(dono: string | null, cart: CartItem[]) {
    return criarGerenciadorDeChave(
      localStorage,
      undefined,
      dono ? { dono } : {},
    ).chavePara(impressaoDoCarrinho(cart));
  }

  for (const [nome, dono] of [
    ["com conta", "u1"],
    ["visitante", null],
  ] as const) {
    it(`${nome}: a chave nasce no meio da releitura e o estoque vai a zero: a linha fica e a chave é a mesma`, async () => {
      if (!dono) {
        mundo.usuario = null;
        mundo.itensNoBanco = [];
      }
      await montar([itemSalvo(produtoSalvo(), 1)]);
      await voltarComALeituraSegura();

      const chaveDoEnvio = tocarEmFinalizar(dono, atual.cart); // pedido gravado
      mundo.catalogo = [linha({ estoque: 0 })]; // o PRÓPRIO pedido consumiu a peça
      await soltarALeitura();

      expect(atual.cart).toHaveLength(1);
      expect(mundo.avisos).toEqual([]);
      const gerente = criarGerenciadorDeChave(
        localStorage,
        undefined,
        dono ? { dono } : {},
      );
      expect(gerente.chavePara(impressaoDoCarrinho(atual.cart))).toBe(
        chaveDoEnvio,
      );
    });

    it(`controle (${nome}): sem chave nascida no caminho, a releitura aplica normalmente`, async () => {
      if (!dono) {
        mundo.usuario = null;
        mundo.itensNoBanco = [];
      }
      await montar([itemSalvo(produtoSalvo(), 1)]);
      await voltarComALeituraSegura();

      mundo.catalogo = [linha({ estoque: 0 })];
      await soltarALeitura();

      expect(atual.cart).toHaveLength(0);
      expect(mundo.avisos).toHaveLength(1);
    });
  }

  it("a ação explícita (Atualize o carrinho) aplica mesmo com a chave nascida no meio da leitura", async () => {
    await montar([itemSalvo(produtoSalvo(), 1)]);
    mundo.portao = new Promise<void>((resolver) => {
      soltarPortao = resolver;
    });
    let leitura!: Promise<void>;
    await act(async () => {
      leitura = atual.renovar();
    });
    await esperar(20);
    tocarEmFinalizar("u1", atual.cart);
    mundo.catalogo = [linha({ estoque: 0 })];
    await act(async () => {
      soltarPortao();
      await leitura;
    });
    await esperar();

    expect(atual.cart).toHaveLength(0);
  });
});
