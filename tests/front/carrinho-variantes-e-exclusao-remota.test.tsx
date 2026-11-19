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
import { comPaginacao } from "./duble-consulta-paginada";

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
let sessao: typeof usuario | null;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: sessao, loading: false }),
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
  {
    id: "v3",
    product_id: "p1",
    name: "Tamanho",
    value: "M",
    stock_increment: 10,
    active: true,
  },
];
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: async () => ({ data: mundo.itens, error: null }),
        in: comPaginacao(async () =>
          tabela === "product_variants"
            ? {
                data: mundo.falhaVariantes ? null : variantes,
                error: mundo.falhaVariantes ? { message: "rede caiu" } : null,
              }
            : { data: [linha], error: null },
        ),
      }),
    }),
    auth: {
      getSession: async () => ({
        data: { session: sessao ? { user: sessao } : null },
      }),
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
function guardarEstado(contexto: ReturnType<typeof useCartContext>) {
  atual = contexto;
}
function Sonda({
  onEstado = guardarEstado,
}: Readonly<{ onEstado?: typeof guardarEstado }>) {
  const contexto = useCartContext();
  useEffect(() => {
    onEstado(contexto);
  }, [contexto, onEstado]);
  return <output>{contexto.cartTotal}</output>;
}
let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  sessao = usuario;
  mundo.itens = [];
  mundo.falhaVariantes = false;
  mundo.rpc.mockImplementation(
    async (
      _nome: string,
      args: { p_cart_items: ReturnType<typeof itemRemoto>[] },
    ) => {
      mundo.itens = args.p_cart_items;
      return { error: null };
    },
  );
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
  localStorage.clear();
  sessionStorage.clear();
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
it("tirar a camiseta M como visitante não apaga a linha que já está na conta", async () => {
  sessao = null;
  mundo.itens = [itemRemoto("v3")];
  const produto = mapProductFromDB({ ...linha, product_variants: variantes });
  await montar();

  await act(async () => {
    atual.addToCart(produto, 1, "v3", "M");
  });
  expect(atual.cart.map((item) => item.variantId)).toEqual(["v3"]);
  await act(async () => {
    atual.removeFromCart("p1", "v3");
  });
  expect(atual.cart).toEqual([]);
  expect(mundo.rpc).not.toHaveBeenCalled();

  sessao = usuario;
  await montar();
  await sincronizar();

  expect(mundo.rpc).toHaveBeenCalledExactlyOnceWith("sync_cart_atomic", {
    p_cart_items: [
      expect.objectContaining({
        product_id: "p1",
        variant_id: "v3",
        quantity: 1,
      }),
    ],
  });
  expect(atual.cart.map((item) => item.variantId)).toEqual(["v3"]);
  expect(mundo.itens.map((item) => item.variant_id)).toEqual(["v3"]);
});
it("leva o que sobrou no carrinho visitante junto com o que já estava na conta", async () => {
  sessao = null;
  mundo.itens = [itemRemoto("v3")];
  const produto = mapProductFromDB({ ...linha, product_variants: variantes });
  await montar();
  await act(async () => {
    atual.addToCart(produto, 1, "v3", "M");
    atual.addToCart(produto, 2, "v1", "P");
  });
  await act(async () => atual.removeFromCart("p1", "v3"));

  sessao = usuario;
  await montar();
  await sincronizar();

  expect(mundo.itens).toMatchObject([
    { product_id: "p1", variant_id: "v1", quantity: 2 },
    { product_id: "p1", variant_id: "v3", quantity: 1 },
  ]);
});
it("não atribui à conta uma marca antiga sem origem", async () => {
  mundo.itens = [itemRemoto("v3")];
  localStorage.setItem(
    "marketplace_cart_tombstones_v1",
    JSON.stringify([{ key: "p1-v3", deletedAt: Date.now() }]),
  );
  await montar();
  await sincronizar();

  expect(mundo.rpc).toHaveBeenCalledExactlyOnceWith("sync_cart_atomic", {
    p_cart_items: [
      expect.objectContaining({
        product_id: "p1",
        variant_id: "v3",
        quantity: 1,
      }),
    ],
  });
  expect(atual.cart.map((item) => item.variantId)).toEqual(["v3"]);
});
it("a remoção da conta A não apaga a camiseta da conta B após uma troca por uma aba antiga", async () => {
  const chave = "marketplace_cart_account_tombstones_v1";
  mundo.itens = [itemRemoto("v3")];
  await montar();
  await sincronizar();
  mundo.rpc.mockClear();

  await act(async () => atual.removeFromCart("p1", "v3"));
  expect(atual.cart).toEqual([]);
  expect(localStorage.getItem(chave)).not.toBeNull();
  expect(mundo.rpc).not.toHaveBeenCalled();
  act(() => raiz.unmount());

  // A aba antiga trocou a sessão sem conhecer nem limpar a chave nova.
  sessao = { id: "u2" };
  mundo.itens = [itemRemoto("v3")];
  raiz = createRoot(hospedeiro);
  await montar();
  await sincronizar();

  expect(mundo.rpc).toHaveBeenCalledExactlyOnceWith("sync_cart_atomic", {
    p_cart_items: [
      expect.objectContaining({
        product_id: "p1",
        variant_id: "v3",
        quantity: 1,
      }),
    ],
  });
  expect(atual.cart.map((item) => item.variantId)).toEqual(["v3"]);
  expect(mundo.itens.map((item) => item.variant_id)).toEqual(["v3"]);
  expect(localStorage.getItem(chave)).toBeNull();
});
it("descarta marcas da chave da conta que não têm dono", async () => {
  const chave = "marketplace_cart_account_tombstones_v1";
  localStorage.setItem(
    chave,
    JSON.stringify([{ key: "p1-v3", deletedAt: Date.now() }]),
  );
  mundo.itens = [itemRemoto("v3")];

  await montar();
  await sincronizar();

  expect(mundo.itens.map((item) => item.variant_id)).toEqual(["v3"]);
  expect(localStorage.getItem(chave)).toBeNull();
});
it("tirar a camiseta M da conta apaga a linha e a segunda aba não a devolve", async () => {
  mundo.itens = [itemRemoto("v3")];
  await montar();
  await sincronizar();
  mundo.rpc.mockClear();
  const hospedeiroDaOutraAba = document.createElement("div");
  document.body.appendChild(hospedeiroDaOutraAba);
  const outraRaiz = createRoot(hospedeiroDaOutraAba);
  let outraAba: ReturnType<typeof useCartContext> | undefined;

  try {
    await act(async () =>
      outraRaiz.render(
        <CartProvider>
          <Sonda onEstado={(contexto) => (outraAba = contexto)} />
        </CartProvider>,
      ),
    );
    expect(atual.cart.map((item) => item.variantId)).toEqual(["v3"]);
    expect(outraAba?.cart.map((item) => item.variantId)).toEqual(["v3"]);

    await act(async () => atual.removeFromCart("p1", "v3"));

    // A outra aba relê antes do envio: o servidor ainda traz a linha velha.
    expect(mundo.rpc).not.toHaveBeenCalled();
    await act(async () => mundo.evento({ eventType: "UPDATE" }));
    expect(outraAba?.cart).toEqual([]);

    await sincronizar();
    expect(mundo.rpc).toHaveBeenLastCalledWith("sync_cart_atomic", {
      p_cart_items: [],
    });
    expect(mundo.itens).toEqual([]);
  } finally {
    act(() => outraRaiz.unmount());
    hospedeiroDaOutraAba.remove();
  }
});
it("4: limpar carrinho elimina o cupom do rascunho sem apagar os demais campos", async () => {
  await montar();
  await act(async () => atual.addToCart(mapProductFromDB(linha)));
  salvarRascunhoDoCheckout(sessionStorage, {
    ...rascunhoVazio(),
    cupom: "TESTE10",
    contaDoCupom: usuario.id,
    contaDosDados: usuario.id,
    notas: "Nota fictícia",
  });
  await act(async () => atual.clearCart());
  expect(atual.cart).toEqual([]);
  expect(lerRascunhoDoCheckout(sessionStorage)?.cupom).toBeNull();
  expect(lerRascunhoDoCheckout(sessionStorage)?.contaDoCupom).toBeNull();
  expect(lerRascunhoDoCheckout(sessionStorage)?.notas).toBe("Nota fictícia");
});
