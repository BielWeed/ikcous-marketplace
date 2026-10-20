// @vitest-environment jsdom
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { mapProductFromDB } from "@/lib/mappers";
import {
  lerRascunhoDoCheckout,
  rascunhoVazio,
  salvarRascunhoDoCheckout,
} from "@/lib/rascunho-do-checkout";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mundo = vi.hoisted(() => ({
  itens: [] as Record<string, unknown>[],
  falhaVariantes: false,
  rpc: vi.fn(),
  evento: (_payload: unknown) => {},
  erro: vi.fn(),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
const usuario = { id: "u1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("sonner", () => ({
  toast: { error: mundo.erro, info: vi.fn(), warning: vi.fn() },
}));
const linha = {
  id: "p1",
  nome: "Camiseta",
  preco_venda: 10,
  estoque: 20,
  ativo: true,
  imagens: [],
};
const variantes = [
  {
    id: "v1",
    product_id: "p1",
    name: "Tamanho",
    value: "P",
    stock_increment: 10,
    price_override: 20,
    active: true,
  },
  {
    id: "v2",
    product_id: "p1",
    name: "Tamanho",
    value: "G",
    stock_increment: 10,
    price_override: 30,
    active: true,
  },
];
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: async () => ({ data: mundo.itens, error: null }),
        in: async () =>
          tabela === "product_variants"
            ? {
                data: mundo.falhaVariantes ? null : variantes,
                error: mundo.falhaVariantes ? { message: "rede caiu" } : null,
              }
            : { data: [linha], error: null },
      }),
    }),
    auth: {
      getSession: async () => ({ data: { session: { user: usuario } } }),
    },
    rpc: mundo.rpc,
    channel: () => ({
      on: (_tipo: unknown, _filtro: unknown, evento: typeof mundo.evento) => {
        mundo.evento = evento;
        return { subscribe: () => ({}) };
      },
    }),
    removeChannel: async () => {},
  },
}));
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let atual: ReturnType<typeof useCartContext>;
function Sonda() {
  const contexto = useCartContext();
  useEffect(() => {
    atual = contexto;
  }, [contexto]);
  return <output>{contexto.cartTotal}</output>;
}
let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mundo.itens = [];
  mundo.falhaVariantes = false;
  mundo.rpc.mockResolvedValue({ error: null });
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal(
    "BroadcastChannel",
    class {
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
});
async function montar() {
  await act(async () =>
    raiz.render(
      <CartProvider>
        <Sonda />
      </CartProvider>,
    ),
  );
}
async function sincronizar() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
}
function itemRemoto(variantId = "v1") {
  return {
    product_id: "p1",
    variant_id: variantId,
    quantity: 1,
    updated_at: new Date(Date.now() - 1000).toISOString(),
  };
}
it("1: mantém duas variantes separadas, com seus preços e quantidades no envio", async () => {
  await montar();
  const produto = mapProductFromDB({ ...linha, product_variants: variantes });
  await act(async () => {
    atual.addToCart(produto, 2, "v1", "P");
    atual.addToCart(produto, 3, "v2", "G");
  });
  expect(atual.cart.map((i) => [i.variantId, i.quantity])).toEqual([
    ["v1", 2],
    ["v2", 3],
  ]);
  expect(atual.cartTotal).toBe(130);
  await sincronizar();
  expect(mundo.rpc.mock.calls.at(-1)?.[1].p_cart_items).toEqual([
    expect.objectContaining({ variant_id: "v1", quantity: 2 }),
    expect.objectContaining({ variant_id: "v2", quantity: 3 }),
  ]);
});
it("2: falha das variantes não publica preço base nem sincroniza catálogo incompleto", async () => {
  mundo.itens = [itemRemoto()];
  mundo.falhaVariantes = true;
  await montar();
  expect(atual.cart).toEqual([]);
  expect(mundo.erro).toHaveBeenCalledWith(
    expect.stringMatching(/varia|preço/i),
    { id: "carrinho-variantes-indisponiveis" },
  );
  await sincronizar();
  expect(mundo.rpc).not.toHaveBeenCalled();
});
it("2: conserva o preço conhecido e recupera as variantes na releitura", async () => {
  const remoto = itemRemoto();
  mundo.itens = [remoto];
  const produto = mapProductFromDB({ ...linha, product_variants: variantes });
  localStorage.setItem(
    "marketplace_cart_v1",
    JSON.stringify([
      {
        product: produto,
        variantId: "v1",
        quantity: 1,
        lastModifiedAt: Date.parse(String(remoto.updated_at)),
      },
    ]),
  );
  mundo.falhaVariantes = true;
  await montar();
  expect(atual.cartTotal).toBe(20);
  await sincronizar();
  expect(mundo.rpc).not.toHaveBeenCalled();
  mundo.falhaVariantes = false;
  await act(async () => window.dispatchEvent(new Event("online")));
  expect(atual.cartTotal).toBe(20);
  await sincronizar();
  expect(mundo.rpc).toHaveBeenCalled();
});
it("4: limpar carrinho elimina o cupom do rascunho sem apagar os demais campos", async () => {
  await montar();
  await act(async () => atual.addToCart(mapProductFromDB(linha)));
  salvarRascunhoDoCheckout(sessionStorage, {
    ...rascunhoVazio(),
    cupom: "TESTE10",
    contaDoCupom: usuario.id,
    notas: "Nota fictícia",
  });
  await act(async () => atual.clearCart());
  expect(atual.cart).toEqual([]);
  expect(lerRascunhoDoCheckout(sessionStorage)?.cupom).toBeNull();
  expect(lerRascunhoDoCheckout(sessionStorage)?.contaDoCupom).toBeNull();
  expect(lerRascunhoDoCheckout(sessionStorage)?.notas).toBe("Nota fictícia");
});
