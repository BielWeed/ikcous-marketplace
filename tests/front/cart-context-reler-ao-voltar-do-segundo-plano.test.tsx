// @vitest-environment jsdom
//
// O carrinho relê o catálogo ao VOLTAR do segundo plano (lote 238, 27/10/2026).
//
// DEFEITO MEDIDO (caça 11-D #2): a cliente deixa o app instalado em segundo
// plano; a lojista acaba a promoção (ou pausa o produto); a cliente volta, vê o
// preço novo na vitrine e o carrinho segue com o preço velho até o servidor
// recusar o pedido. O carrinho só relia o catálogo ao abrir o app (visitante)
// ou depois da recusa. Agora também lê quando o app volta a ficar visível, no
// máximo uma vez a cada poucos segundos.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
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
  falhaNoCatalogo: false,
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

function linha(extra: Linha = {}): Linha {
  return {
    id: "prod-1",
    nome: "Camiseta",
    preco_venda: 59.9,
    estoque: 10,
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

type Mundo = {
  cart: CartItem[];
  cartTotal: number;
  renovar: ReturnType<typeof useCartContext>["renovarCarrinhoPeloCatalogo"];
};
let atual: Mundo;

function Sonda() {
  const { cart, cartTotal, renovarCarrinhoPeloCatalogo } = useCartContext();
  useEffect(() => {
    atual = { cart, cartTotal, renovar: renovarCarrinhoPeloCatalogo };
  }, [cart, cartTotal, renovarCarrinhoPeloCatalogo]);
  return null;
}

describe("CartContext — releitura do catálogo ao voltar do segundo plano", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let relogio: number;
  let visibilidade: "visible" | "hidden";

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
    mundo.usuario = null;
    mundo.itensNoBanco = [];
    mundo.catalogo = [linha()];
    mundo.falhaNoCatalogo = false;
    mundo.leiturasDoCatalogo = 0;
    mundo.avisos = [];
    relogio = Date.now();
    visibilidade = "visible";
    vi.spyOn(Date, "now").mockImplementation(() => relogio);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilidade,
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
    visibilidade = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await esperar();
  }

  for (const comConta of [false, true]) {
    describe(comConta ? "com conta" : "sem conta", () => {
      beforeEach(() => {
        mundo.usuario = comConta ? { id: "u1" } : null;
        if (comConta) {
          mundo.itensNoBanco = [
            {
              product_id: "prod-1",
              variant_id: "",
              quantity: 2,
              updated_at: new Date(T).toISOString(),
            },
          ];
        }
      });

      it("a promoção acabou com o app em segundo plano: ao voltar, o carrinho mostra o preço novo, com a mesma quantidade", async () => {
        await montar([itemSalvo(produtoSalvo(), 2)]);
        expect(atual.cart[0].product.price).toBe(59.9);
        expect(mundo.avisos).toEqual([]);

        mundo.catalogo = [linha({ preco_venda: 69.9 })];
        await voltarDoSegundoPlano();

        expect(atual.cart[0].product.price).toBe(69.9);
        expect(atual.cart[0].quantity).toBe(2);
        expect(atual.cartTotal).toBeCloseTo(139.8, 2);
        expect(mundo.avisos).toHaveLength(1);
        expect(mundo.avisos[0]).toContain("Camiseta");
      });

      it("o produto foi pausado: ao voltar, a linha sai do carrinho, com aviso", async () => {
        await montar([itemSalvo(produtoSalvo(), 2)]);
        mundo.catalogo = []; // pausado: a vitrine pública não devolve mais a linha

        await voltarDoSegundoPlano();

        expect(atual.cart).toHaveLength(0);
        expect(mundo.avisos).toHaveLength(1);
      });

      it("o app só foi para o segundo plano (ficou escondido): nada é relido", async () => {
        await montar([itemSalvo(produtoSalvo(), 2)]);
        const leituras = mundo.leiturasDoCatalogo;
        mundo.catalogo = [linha({ preco_venda: 69.9 })];

        visibilidade = "hidden";
        await act(async () => {
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await esperar();

        expect(mundo.leiturasDoCatalogo).toBe(leituras);
        expect(atual.cart[0].product.price).toBe(59.9);
      });

      it("vai e volta várias vezes em poucos segundos: lê uma vez só; passado o intervalo, lê de novo", async () => {
        await montar([itemSalvo(produtoSalvo(), 2)]);
        const leiturasNaAbertura = mundo.leiturasDoCatalogo;

        relogio += 60_000;
        await voltarDoSegundoPlano();
        const aposAPrimeira = mundo.leiturasDoCatalogo;
        expect(aposAPrimeira).toBeGreaterThan(leiturasNaAbertura);

        relogio += 1_000;
        await voltarDoSegundoPlano();
        await voltarDoSegundoPlano();
        expect(mundo.leiturasDoCatalogo).toBe(aposAPrimeira);

        relogio += 60_000;
        mundo.catalogo = [linha({ preco_venda: 69.9 })];
        await voltarDoSegundoPlano();
        expect(mundo.leiturasDoCatalogo).toBeGreaterThan(aposAPrimeira);
        expect(atual.cart[0].product.price).toBe(69.9);
      });

      it("a releitura FALHA ao voltar: o carrinho fica como estava, sem erro para a cliente", async () => {
        await montar([itemSalvo(produtoSalvo(), 2)]);
        mundo.catalogo = [linha({ preco_venda: 69.9 })];
        mundo.falhaNoCatalogo = true;
        const erro = vi.spyOn(console, "error").mockImplementation(() => {});

        relogio += 60_000;
        await voltarDoSegundoPlano();

        expect(atual.cart[0].product.price).toBe(59.9);
        expect(mundo.avisos).toEqual([]);
        erro.mockRestore();
      });
    });
  }

  it("carrinho vazio: voltar do segundo plano não lê nada", async () => {
    await montar([]);
    const leituras = mundo.leiturasDoCatalogo;

    relogio += 60_000;
    await voltarDoSegundoPlano();

    expect(mundo.leiturasDoCatalogo).toBe(leituras);
  });
});
