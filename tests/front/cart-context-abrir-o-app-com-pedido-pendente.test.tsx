// @vitest-environment jsdom
//
// Lote 249 (resíduo da caça 12-A #1): ABRIR o app de novo (fechou e reabriu, não
// só voltou do segundo plano) NÃO mexe no carrinho enquanto há um pedido sem
// resposta.
//
// DEFEITO: o lote 242 segurou o carrinho só na volta do segundo plano. Mas a
// chave do pedido sobrevive ao app fechado (localStorage, 30 min) e o carrinho
// também. Ao reabrir, a leitura de abertura (com conta: a junção com o carrinho
// do servidor; sem conta: a releitura do catálogo) via o estoque que o PRÓPRIO
// pedido consumiu e tirava a linha. A chave do reenvio nasce da impressão do
// carrinho de agora, então mudava — e o novo "Finalizar" criava um SEGUNDO
// pedido. Com a chave vigente, a abertura espera: o carrinho e a chave seguem
// os mesmos até a confirmação (ou os 30 min).
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

describe("CartContext — pedido sem resposta segura o carrinho ao ABRIR o app de novo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let relogio: number;
  let armazem: Map<string, string>;

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
    mundo.leiturasDoCatalogo = 0;
    mundo.avisos = [];
    relogio = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => relogio);
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

  async function esperar(ms = 60) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }

  /** "Abrir o app": provider NOVO, com o localStorage que o aparelho guardou. */
  async function abrirOApp() {
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda />
        </CartProvider>,
      );
    });
    await esperar();
  }

  function guardarCarrinho(salvos: CartItem[]) {
    armazem.set("marketplace_cart_v1", JSON.stringify(salvos));
  }

  function pedidoEnviadoSemResposta(dono: string | null, cart: CartItem[]) {
    const gerente = criarGerenciadorDeChave(
      localStorage,
      undefined,
      dono ? { dono } : {},
    );
    return gerente.chavePara(impressaoDoCarrinho(cart));
  }

  it("com conta: o pedido foi gravado (estoque a zero), o app reabre: a linha fica e a chave do reenvio é a MESMA", async () => {
    const carrinho = [itemSalvo(produtoSalvo(), 1)];
    guardarCarrinho(carrinho);
    const chaveDoEnvio = pedidoEnviadoSemResposta("u1", carrinho);
    mundo.catalogo = [linha({ estoque: 0 })]; // o PRÓPRIO pedido consumiu a peça

    await abrirOApp();

    expect(atual.cart).toHaveLength(1);
    expect(atual.cart[0].quantity).toBe(1);
    expect(mundo.avisos).toEqual([]);
    const gerente = criarGerenciadorDeChave(localStorage, undefined, {
      dono: "u1",
    });
    expect(gerente.chavePara(impressaoDoCarrinho(atual.cart))).toBe(
      chaveDoEnvio,
    );
  });

  it("com conta: a quantidade que o pedido enviou também não é reduzida (estoque restante menor)", async () => {
    mundo.itensNoBanco = [
      {
        product_id: "prod-1",
        variant_id: "",
        quantity: 3,
        updated_at: new Date(T).toISOString(),
      },
    ];
    const carrinho = [itemSalvo(produtoSalvo({ estoque: 5 }), 3)];
    guardarCarrinho(carrinho);
    const chaveDoEnvio = pedidoEnviadoSemResposta("u1", carrinho);
    mundo.catalogo = [linha({ estoque: 2 })]; // o pedido levou 3 de 5

    await abrirOApp();

    expect(atual.cart[0].quantity).toBe(3);
    expect(mundo.avisos).toEqual([]);
    const gerente = criarGerenciadorDeChave(localStorage, undefined, {
      dono: "u1",
    });
    expect(gerente.chavePara(impressaoDoCarrinho(atual.cart))).toBe(
      chaveDoEnvio,
    );
  });

  it("visitante: a releitura de abertura também espera a confirmação", async () => {
    mundo.usuario = null;
    mundo.itensNoBanco = [];
    const carrinho = [itemSalvo(produtoSalvo(), 1)];
    guardarCarrinho(carrinho);
    const chaveDoEnvio = pedidoEnviadoSemResposta(null, carrinho);
    mundo.catalogo = [linha({ estoque: 0 })];

    await abrirOApp();

    expect(atual.cart).toHaveLength(1);
    expect(mundo.avisos).toEqual([]);
    expect(mundo.leiturasDoCatalogo).toBe(0);
    const gerente = criarGerenciadorDeChave(localStorage);
    expect(gerente.chavePara(impressaoDoCarrinho(atual.cart))).toBe(
      chaveDoEnvio,
    );
  });

  it("controle: sem pedido pendente, abrir o app tira a linha esgotada (a releitura segue valendo)", async () => {
    guardarCarrinho([itemSalvo(produtoSalvo(), 1)]);
    mundo.catalogo = [linha({ estoque: 0 })];

    await abrirOApp();

    expect(atual.cart).toHaveLength(0);
    expect(mundo.avisos).toHaveLength(1);
  });

  it("controle (visitante): sem pedido pendente, abrir o app tira a linha esgotada", async () => {
    mundo.usuario = null;
    mundo.itensNoBanco = [];
    guardarCarrinho([itemSalvo(produtoSalvo(), 1)]);
    mundo.catalogo = [linha({ estoque: 0 })];

    await abrirOApp();

    expect(atual.cart).toHaveLength(0);
  });

  it("pedido confirmado (chave esquecida): o app abre e a releitura volta a valer", async () => {
    const carrinho = [itemSalvo(produtoSalvo(), 1)];
    guardarCarrinho(carrinho);
    criarGerenciadorDeChave(localStorage, undefined, { dono: "u1" }).chavePara(
      impressaoDoCarrinho(carrinho),
    );
    criarGerenciadorDeChave(localStorage, undefined, {
      dono: "u1",
    }).esquecer();
    mundo.catalogo = [linha({ estoque: 0 })];

    await abrirOApp();

    expect(atual.cart).toHaveLength(0);
  });

  it("chave vencida (mais de 30 min): não segura a abertura", async () => {
    const carrinho = [itemSalvo(produtoSalvo(), 1)];
    guardarCarrinho(carrinho);
    pedidoEnviadoSemResposta("u1", carrinho);
    mundo.catalogo = [linha({ estoque: 0 })];

    relogio += 31 * 60_000;
    await abrirOApp();

    expect(atual.cart).toHaveLength(0);
  });

  it("a chave pendente é de OUTRA conta: não segura o carrinho desta", async () => {
    const carrinho = [itemSalvo(produtoSalvo(), 1)];
    guardarCarrinho(carrinho);
    pedidoEnviadoSemResposta("u2", carrinho);
    mundo.catalogo = [linha({ estoque: 0 })];

    await abrirOApp();

    expect(atual.cart).toHaveLength(0);
  });

  it("a ação explícita (recusa 'atualize o carrinho') continua relendo mesmo com a chave vigente", async () => {
    const carrinho = [itemSalvo(produtoSalvo(), 1)];
    guardarCarrinho(carrinho);
    pedidoEnviadoSemResposta("u1", carrinho);
    mundo.catalogo = [linha({ estoque: 0 })];
    await abrirOApp();
    expect(atual.cart).toHaveLength(1);

    await act(async () => {
      await atual.renovar();
    });
    await esperar();

    expect(atual.cart).toHaveLength(0);
  });
});
