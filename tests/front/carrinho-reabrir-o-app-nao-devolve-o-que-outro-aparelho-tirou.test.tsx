// @vitest-environment jsdom
//
// A cliente entra com a mesma conta no celular e no computador. O computador
// é FECHADO por completo; no celular ela tira um produto (ou esvazia o
// carrinho) e a gravação chega ao banco. Ao REABRIR o computador, o carrinho
// nascia da cópia guardada nele (ainda com o produto), a primeira leitura não
// sabia que aquela linha já estava confirmada no banco e a junção a mantinha --
// e a gravação seguinte devolvia o produto ao banco sem a cliente ter posto
// nada.
//
// A regra: o aparelho guarda, junto da cópia, as linhas que o banco já
// confirmou ter (linha e quantidade). Na abertura, linha confirmada que o banco
// não tem mais foi tirada em outro aparelho e não volta. Linha que o banco
// NUNCA confirmou (posta sem rede, quantidade mexida e não enviada) fica e é
// enviada: a cliente nunca perde o que acabou de pôr. Cópia antiga, sem essa
// anotação, segue como sempre: nada é apagado.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { mapProductFromDB } from "@/lib/mappers";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type LinhaGravada = { product_id: string; quantity: number };
type Gravar = (
  nome: string,
  args: { p_cart_items: LinhaGravada[] },
) => Promise<{ error: unknown }>;

const mundo = vi.hoisted(() => ({
  itens: [] as Record<string, unknown>[],
  rpc: vi.fn<Gravar>(),
  sessaoAtiva: true,
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
  toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
const produtos = ["p1", "p2", "p3"].map((id) => ({
  id,
  nome: id,
  preco_venda: 10,
  estoque: 20,
  ativo: true,
  imagens: [],
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: async () => ({ data: mundo.itens.slice(), error: null }),
        in: async (_coluna: string, ids: string[]) =>
          tabela === "product_variants"
            ? { data: [], error: null }
            : {
                data: produtos.filter((p) => ids.includes(p.id)),
                error: null,
              },
      }),
    }),
    auth: {
      getSession: async () => ({
        data: { session: mundo.sessaoAtiva ? { user: usuario } : null },
      }),
    },
    rpc: mundo.rpc,
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
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
  mundo.sessaoAtiva = true;
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
// Fechar o app por completo e abrir de novo: o que fica é só o localStorage.
async function fecharEReabrir() {
  act(() => raiz.unmount());
  raiz = createRoot(hospedeiro);
  await montar();
}
async function sincronizar() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
}
function linhaDoBanco(productId: string, quantity = 1) {
  return {
    product_id: productId,
    variant_id: "",
    quantity,
    updated_at: new Date(Date.now() - 1000).toISOString(),
  };
}
const idsDoCarrinho = () => atual.cart.map((i) => i.product.id);
const produto = (id: string) =>
  mapProductFromDB({
    ...produtos.find((p) => p.id === id),
    product_variants: [],
  });
// O que as gravações no banco levaram, produto por produto.
const idsGravados = () =>
  (
    mundo.rpc.mock.calls as [string, { p_cart_items: LinhaGravada[] }][]
  ).flatMap(([, args]) => args.p_cart_items.map((i) => i.product_id));
// Cópia guardada no aparelho, sem a anotação nova (versão antiga do app).
function guardarCopiaAntiga(ids: string[]) {
  localStorage.setItem(
    "marketplace_cart_v1",
    JSON.stringify(
      ids.map((id) => ({
        product: produto(id),
        quantity: 1,
        lastModifiedAt: Date.now() - 5000,
      })),
    ),
  );
}

describe("carrinho: reabrir o app não devolve o que outro aparelho tirou", () => {
  it("o produto tirado no celular não volta ao reabrir o computador, nem é regravado", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    await sincronizar();
    expect(idsDoCarrinho()).toEqual(["p1", "p2"]);

    // O computador fecha; o celular tira o p2 e o banco passa a ter só o p1.
    mundo.itens = [linhaDoBanco("p1")];
    mundo.rpc.mockClear();
    await fecharEReabrir();
    await sincronizar();

    expect(idsDoCarrinho()).toEqual(["p1"]);
    expect(idsGravados()).not.toContain("p2");
    expect(mundo.rpc).not.toHaveBeenCalled();
  });

  it("carrinho esvaziado no celular abre vazio no computador e nada é regravado", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    await sincronizar();

    mundo.itens = [];
    mundo.rpc.mockClear();
    await fecharEReabrir();
    await sincronizar();

    expect(atual.cart).toEqual([]);
    expect(mundo.rpc).not.toHaveBeenCalled();
  });

  it("o que o celular pôs enquanto o computador estava fechado entra, e o que tirou sai", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    await sincronizar();

    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p3")];
    mundo.rpc.mockClear();
    await fecharEReabrir();
    await sincronizar();

    expect(idsDoCarrinho().sort()).toEqual(["p1", "p3"]);
    expect(mundo.rpc).not.toHaveBeenCalled();
  });

  it("o que a cliente pôs SEM REDE e fechou o app continua e é enviado; o que o celular tirou sai", async () => {
    mundo.itens = [linhaDoBanco("p1")];
    await montar();
    await sincronizar();

    mundo.rpc.mockResolvedValue({ error: { message: "sem rede" } });
    await act(async () => atual.addToCart(produto("p2"), 1));
    await sincronizar(); // a gravação falha; o banco segue sem o p2

    // O celular tirou o p1 (o banco ficou vazio) com o computador fechado.
    mundo.itens = [];
    mundo.rpc.mockReset();
    mundo.rpc.mockResolvedValue({ error: null });
    await fecharEReabrir();
    await sincronizar();

    expect(idsDoCarrinho()).toEqual(["p2"]);
    expect(idsGravados()).toEqual(["p2"]);
  });

  it("quantidade mexida e não enviada antes de fechar não é confundida com linha confirmada", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    await sincronizar();

    mundo.rpc.mockResolvedValue({ error: { message: "sem rede" } });
    await act(async () => atual.updateQuantity("p2", 3));
    await sincronizar();

    mundo.itens = [linhaDoBanco("p1")]; // o celular tirou o p2
    mundo.rpc.mockReset();
    mundo.rpc.mockResolvedValue({ error: null });
    await fecharEReabrir();
    await sincronizar();

    expect(atual.cart.map((i) => [i.product.id, i.quantity])).toEqual([
      ["p1", 1],
      ["p2", 3],
    ]);
  });

  it("linha guardada com quantidade DIFERENTE da confirmada não é apagada (mesmo com anotação velha)", async () => {
    localStorage.setItem(
      "marketplace_cart_v1",
      JSON.stringify(
        [
          ["p1", 1],
          ["p2", 3],
        ].map(([id, quantity]) => ({
          product: produto(String(id)),
          quantity,
          lastModifiedAt: Date.now() - 5000,
        })),
      ),
    );
    localStorage.setItem(
      "marketplace_cart_confirmado_v1",
      JSON.stringify({ uid: "u1", entradas: ["p1-=1", "p2-=1"] }),
    );
    mundo.itens = [linhaDoBanco("p1")]; // o celular tirou o p2
    await montar();
    await sincronizar();

    expect(atual.cart.map((i) => [i.product.id, i.quantity])).toEqual([
      ["p1", 1],
      ["p2", 3],
    ]);
    expect(idsGravados()).toContain("p2");
  });

  it("tirou e pôs o mesmo produto de novo sem rede: o que pôs de novo não é apagado ao reabrir", async () => {
    mundo.itens = [linhaDoBanco("p1")];
    await montar();
    await sincronizar();

    mundo.rpc.mockResolvedValue({ error: { message: "sem rede" } });
    await act(async () => atual.removeFromCart("p1"));
    await act(async () => atual.addToCart(produto("p1"), 1));
    await sincronizar();

    mundo.itens = []; // o celular também tirou o p1
    mundo.rpc.mockReset();
    mundo.rpc.mockResolvedValue({ error: null });
    await fecharEReabrir();
    await sincronizar();

    expect(idsDoCarrinho()).toEqual(["p1"]);
  });

  it("cópia antiga, sem a anotação: segue como sempre e nada é apagado", async () => {
    guardarCopiaAntiga(["p1", "p2"]);
    mundo.itens = [linhaDoBanco("p1")];
    await montar();
    await sincronizar();

    expect(idsDoCarrinho()).toEqual(["p1", "p2"]);
    expect(idsGravados()).toContain("p2");
  });

  it("anotação de OUTRA conta não vale: nada é apagado", async () => {
    guardarCopiaAntiga(["p1", "p2"]);
    localStorage.setItem(
      "marketplace_cart_confirmado_v1",
      JSON.stringify({ uid: "outra", entradas: ["p1-=1", "p2-=1"] }),
    );
    mundo.itens = [linhaDoBanco("p1")];
    await montar();
    await sincronizar();

    expect(idsDoCarrinho()).toEqual(["p1", "p2"]);
  });

  it("sem sessão válida a leitura vazia não é confiável: o carrinho guardado fica", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    await sincronizar();

    mundo.sessaoAtiva = false;
    mundo.itens = []; // o que o banco devolve a quem não está autenticado
    mundo.rpc.mockClear();
    await fecharEReabrir();
    await sincronizar();

    expect(idsDoCarrinho()).toEqual(["p1", "p2"]);
  });
});
