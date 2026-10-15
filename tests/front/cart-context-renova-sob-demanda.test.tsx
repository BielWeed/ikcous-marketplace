// @vitest-environment jsdom
//
// O carrinho relê o catálogo QUANDO A CLIENTE PEDE (14/10/2026).
//
// DEFEITO MEDIDO: a cliente toca em Finalizar com o app aberto; a lojista
// mudou o preço (ou o estoque caiu) depois que ela montou o carrinho; o
// servidor recusa com "Os valores do pedido mudaram. Atualize o carrinho". O
// carrinho só relia o catálogo ao ABRIR o app ou por aviso em tempo real de
// `cart_items` — então "Atualizar o carrinho" levava ao carrinho com os MESMOS
// preços, e a cliente tomava a mesma recusa. Esta ação (`renovarCarrinhoPelo
// Catalogo`) é a releitura sob demanda que a recusa dispara.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { mapProductFromDB } from "@/lib/mappers";
import { formatCurrency } from "@/lib/utils";
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

describe("CartContext — releitura do catálogo sob demanda", () => {
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
    mundo.usuario = null;
    mundo.itensNoBanco = [];
    mundo.catalogo = [linha()];
    mundo.falhaNoCatalogo = false;
    mundo.leiturasDoCatalogo = 0;
    mundo.avisos = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function esperar(ms = 60) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }

  /** Abre o app com o carrinho já IGUAL ao catálogo (nada a corrigir na abertura). */
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

  async function pedirARenovacao() {
    await act(async () => {
      await atual.renovar();
    });
  }

  const de = (centavos: number) => formatCurrency(centavos / 100);

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

      it("a lojista MUDOU O PREÇO com o app aberto: a releitura traz o preço novo ao carrinho e avisa", async () => {
        await montar([itemSalvo(produtoSalvo(), 2)]);
        expect(atual.cartTotal).toBeCloseTo(119.8, 2);
        expect(mundo.avisos).toEqual([]);
        const leiturasNaAbertura = mundo.leiturasDoCatalogo;

        // A lojista reajusta DEPOIS que o carrinho foi aberto.
        mundo.catalogo = [linha({ preco_venda: 69.9 })];
        await pedirARenovacao();

        expect(mundo.leiturasDoCatalogo).toBeGreaterThan(leiturasNaAbertura);
        expect(atual.cart[0].product.price).toBe(69.9);
        expect(atual.cart[0].quantity).toBe(2);
        expect(atual.cartTotal).toBeCloseTo(139.8, 2);
        // O que o servidor conferiria: o total da tela bate com 2 x 69,90.
        expect(Math.abs(2 * 69.9 - atual.cartTotal)).toBeLessThanOrEqual(0.05);
        // O carrinho já comunica a mudança pelo aviso que ele tem.
        expect(mundo.avisos).toHaveLength(1);
        expect(mundo.avisos[0]).toContain("Camiseta");
        expect(mundo.avisos[0]).toContain(de(5990));
        expect(mundo.avisos[0]).toContain(de(6990));
      });

      it("o ESTOQUE caiu com o app aberto: a quantidade desce ao que há e avisa", async () => {
        await montar([itemSalvo(produtoSalvo(), 2)]);
        mundo.catalogo = [linha({ estoque: 1 })];

        await pedirARenovacao();

        expect(atual.cart).toHaveLength(1);
        expect(atual.cart[0].quantity).toBe(1);
        expect(mundo.avisos).toHaveLength(1);
        expect(mundo.avisos[0]).toContain("Só restam 1 unidade");
      });

      it("o produto ESGOTOU ou foi pausado: a linha sai do carrinho, com aviso", async () => {
        await montar([itemSalvo(produtoSalvo(), 2)]);
        mundo.catalogo = [linha({ estoque: 0 })];

        await pedirARenovacao();

        expect(atual.cart).toHaveLength(0);
        expect(mundo.avisos).toHaveLength(1);
        expect(mundo.avisos[0]).toContain("esgotou");
      });

      it("nada mudou: relê, mas o carrinho e os avisos ficam como estavam", async () => {
        await montar([itemSalvo(produtoSalvo(), 2)]);
        const carrinhoAntes = atual.cart;
        const leiturasNaAbertura = mundo.leiturasDoCatalogo;

        await pedirARenovacao();

        expect(mundo.leiturasDoCatalogo).toBeGreaterThan(leiturasNaAbertura);
        expect(atual.cart).toBe(carrinhoAntes);
        expect(mundo.avisos).toEqual([]);
      });

      it("a releitura FALHA: a promessa termina sem erro e o carrinho fica como estava", async () => {
        await montar([itemSalvo(produtoSalvo(), 2)]);
        mundo.catalogo = [linha({ preco_venda: 69.9 })];
        mundo.falhaNoCatalogo = true;
        const erro = vi.spyOn(console, "error").mockImplementation(() => {});

        await pedirARenovacao();

        expect(atual.cart[0].product.price).toBe(59.9);
        expect(atual.cartTotal).toBeCloseTo(119.8, 2);
        expect(mundo.avisos).toEqual([]);
        erro.mockRestore();
      });
    });
  }

  it("carrinho vazio: não lê nada", async () => {
    await montar([]);
    const leituras = mundo.leiturasDoCatalogo;

    await pedirARenovacao();

    expect(mundo.leiturasDoCatalogo).toBe(leituras);
  });
});
