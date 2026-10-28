// @vitest-environment jsdom
//
// Lote 242 (caça 12-A #1): voltar ao app NÃO mexe no carrinho enquanto há um
// pedido sem resposta.
//
// DEFEITO MEDIDO: a cliente com conta toca em "Finalizar", o pedido É gravado
// (o estoque da última peça vai a zero), mas a resposta se perde. Ela sai do app
// para ligar a internet e volta. A releitura do catálogo ao voltar (lote 238)
// via o estoque que o PRÓPRIO pedido consumiu e tirava a linha do carrinho; a
// chave anti-duplicação do pedido nasce da impressão do carrinho de AGORA, então
// mudava — e o novo "Finalizar" criava um SEGUNDO pedido. Com a chave pendente
// (registro da compra em curso, que nasce antes do envio e só some na
// confirmação), a releitura espera: o carrinho e a chave seguem os mesmos.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import {
  criarGerenciadorDeChave,
  haChaveDoPedidoVigente,
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

type Mundo = { cart: CartItem[] };
let atual: Mundo;

function Sonda() {
  const { cart } = useCartContext();
  useEffect(() => {
    atual = { cart };
  }, [cart]);
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

describe("CartContext — pedido sem resposta segura o carrinho ao voltar do segundo plano", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let relogio: number;

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
    localStorage.setItem("marketplace_cart_v1", JSON.stringify(salvos));
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda />
        </CartProvider>,
      );
    });
    await esperar();
  }

  async function voltarDoSegundoPlano() {
    relogio += 60_000;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await esperar();
  }

  it("a resposta se perdeu e o estoque foi a zero: ao voltar, a linha fica e a chave do reenvio é a MESMA", async () => {
    await montar([itemSalvo(produtoSalvo(), 1)]);
    const gerente = criarGerenciadorDeChave(localStorage, undefined, {
      dono: "u1",
    });
    const chaveDoEnvio = gerente.chavePara(impressaoDoCarrinho(atual.cart));
    mundo.catalogo = [linha({ estoque: 0 })]; // o PRÓPRIO pedido consumiu a peça
    const leituras = mundo.leiturasDoCatalogo;

    await voltarDoSegundoPlano();

    expect(atual.cart).toHaveLength(1);
    expect(atual.cart[0].quantity).toBe(1);
    expect(mundo.avisos).toEqual([]);
    expect(mundo.leiturasDoCatalogo).toBe(leituras);
    expect(gerente.chavePara(impressaoDoCarrinho(atual.cart))).toBe(
      chaveDoEnvio,
    );
  });

  it("controle: sem pedido pendente, a mesma volta tira a linha esgotada (a releitura do lote 238 segue valendo)", async () => {
    await montar([itemSalvo(produtoSalvo(), 1)]);
    mundo.catalogo = [linha({ estoque: 0 })];

    await voltarDoSegundoPlano();

    expect(atual.cart).toHaveLength(0);
    expect(mundo.avisos).toHaveLength(1);
  });

  it("o pedido foi confirmado (a chave é esquecida): a releitura volta a valer", async () => {
    await montar([itemSalvo(produtoSalvo(), 1)]);
    const gerente = criarGerenciadorDeChave(localStorage, undefined, {
      dono: "u1",
    });
    gerente.chavePara(impressaoDoCarrinho(atual.cart));
    mundo.catalogo = [linha({ estoque: 0 })];
    await voltarDoSegundoPlano();
    expect(atual.cart).toHaveLength(1);

    gerente.esquecer();
    await voltarDoSegundoPlano();

    expect(atual.cart).toHaveLength(0);
  });

  it("chave vencida (mais de 30 min): não segura a releitura", async () => {
    await montar([itemSalvo(produtoSalvo(), 1)]);
    criarGerenciadorDeChave(localStorage, undefined, { dono: "u1" }).chavePara(
      impressaoDoCarrinho(atual.cart),
    );
    mundo.catalogo = [linha({ estoque: 0 })];

    relogio += 31 * 60_000;
    await voltarDoSegundoPlano();

    expect(atual.cart).toHaveLength(0);
  });

  it("a chave pendente é de OUTRA conta: não segura o carrinho desta", async () => {
    await montar([itemSalvo(produtoSalvo(), 1)]);
    criarGerenciadorDeChave(localStorage, undefined, { dono: "u2" }).chavePara(
      "qualquer",
    );
    mundo.catalogo = [linha({ estoque: 0 })];

    await voltarDoSegundoPlano();

    expect(atual.cart).toHaveLength(0);
  });

  it("visitante com pedido sem resposta: a linha também fica até a confirmação", async () => {
    mundo.usuario = null;
    mundo.itensNoBanco = [];
    await montar([itemSalvo(produtoSalvo(), 1)]);
    criarGerenciadorDeChave(localStorage).chavePara(
      impressaoDoCarrinho(atual.cart),
    );
    mundo.catalogo = [linha({ estoque: 0 })];

    await voltarDoSegundoPlano();

    expect(atual.cart).toHaveLength(1);
    expect(mundo.avisos).toEqual([]);
  });

  it("registro ilegível ou sem validade não segura nada (e não quebra)", () => {
    const armazem = new Map<string, string>([
      ["ikcous-chave-do-pedido:u1", "{não é json"],
      ["ikcous-chave-do-pedido:u2", JSON.stringify({ chave: "x" })],
    ]);
    const lugar = {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: () => {},
      removeItem: () => {},
    };
    expect(haChaveDoPedidoVigente("u1", lugar)).toBe(false);
    expect(haChaveDoPedidoVigente("u2", lugar)).toBe(false);
    expect(haChaveDoPedidoVigente("u3", lugar)).toBe(false);
  });
});
