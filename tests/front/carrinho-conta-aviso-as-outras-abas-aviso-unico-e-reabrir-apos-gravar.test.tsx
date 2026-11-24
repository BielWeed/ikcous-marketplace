// @vitest-environment jsdom
//
// Caça de provas fracas (carrinho, 24/11/2026): três comportamentos da conta
// que podiam sumir sem nenhum teste cair.
//   1. A aba LÍDER é a única que escuta o canal ao vivo do banco; quando o
//      aviso chega ela relê E AVISA as outras abas da mesma conta (pelo canal
//      entre abas), senão as abas secundárias ficam com o carrinho velho e a
//      próxima edição nelas grava o carrinho velho inteiro por cima do salvo.
//   2. O aviso "o preço mudou" sai com a própria frase como identificador: duas
//      leituras ao mesmo tempo contam a mesma mudança e a cliente vê UM aviso
//      (o aviso de mesmo id se funde, não se empilha).
//   3. O que este aparelho GRAVOU com sucesso conta como "o banco já tem": se o
//      app é fechado e outro aparelho tira essa linha, ao reabrir ela sai daqui
//      em vez de voltar ao carrinho e ao banco (a anotação do que o banco
//      confirmou também é atualizada pela gravação, não só pela leitura).
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { mapProductFromDB } from "@/lib/mappers";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comPaginacao } from "./duble-consulta-paginada";

const mundo = vi.hoisted(() => ({
  itens: [] as Record<string, unknown>[],
  rpc: vi.fn(),
  evento: (_payload: unknown) => {},
  mensagensDeAbas: [] as unknown[],
  precoDoCatalogo: 10,
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
const catalogo = () =>
  [
    { id: "p1", nome: "Camiseta", preco_venda: mundo.precoDoCatalogo },
    { id: "p2", nome: "Bermuda", preco_venda: 30 },
  ].map((p) => ({ ...p, estoque: 20, ativo: true, imagens: [] }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: async () => ({ data: mundo.itens.slice(), error: null }),
        in: comPaginacao(async (_coluna: string, ids: string[]) =>
          tabela === "product_variants"
            ? { data: [], error: null }
            : {
                data: catalogo().filter((p) => ids.includes(p.id)),
                error: null,
              },
        ),
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
  return <output>{contexto.cartCount}</output>;
}
let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mundo.itens = [];
  mundo.mensagensDeAbas = [];
  mundo.precoDoCatalogo = 10;
  mundo.rpc.mockResolvedValue({ error: null });
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage(mensagem: unknown) {
        mundo.mensagensDeAbas.push(mensagem);
      }
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
function linhaDoBanco(productId: string, quantity = 1) {
  return {
    product_id: productId,
    variant_id: "",
    quantity,
    updated_at: new Date(Date.now() - 1000).toISOString(),
  };
}
const produto = (id: string, preco?: number) =>
  mapProductFromDB({
    ...catalogo().find((p) => p.id === id),
    ...(preco === undefined ? {} : { preco_venda: preco }),
    product_variants: [],
  });
const idsDoCarrinho = () => atual.cart.map((i) => i.product.id);

describe("carrinho da conta: avisos entre abas, aviso único e o que o banco confirmou", () => {
  it("a aba líder que recebe o aviso ao vivo do banco avisa as outras abas", async () => {
    mundo.itens = [linhaDoBanco("p1")];
    await montar();
    await sincronizar();
    expect(mundo.mensagensDeAbas).toEqual([]);

    await act(async () => {
      mundo.evento({ eventType: "UPDATE" });
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(mundo.mensagensDeAbas).toEqual([{ type: "cart_update" }]);
  });

  it("o aviso de preço mudado sai com a própria frase como identificador (duas leituras, um aviso)", async () => {
    // A cliente guardou a camiseta a R$ 10; a loja agora vende a R$ 12.
    mundo.precoDoCatalogo = 12;
    localStorage.setItem(
      "marketplace_cart_v1",
      JSON.stringify([
        { product: produto("p1", 10), quantity: 1, lastModifiedAt: 1 },
      ]),
    );
    mundo.itens = [linhaDoBanco("p1")];
    await montar();
    await sincronizar();

    const avisos = vi.mocked(toast.warning).mock.calls;
    expect(avisos.length).toBeGreaterThan(0);
    for (const [frase, opcoes] of avisos) {
      expect(opcoes).toMatchObject({ id: frase });
    }
    expect(String(avisos[0]?.[0])).toContain('O preço de "Camiseta" mudou');
  });

  it("o que este aparelho gravou com sucesso vale como confirmado: ao reabrir, o que outro aparelho tirou sai", async () => {
    // O banco de verdade: a gravação daqui SUBSTITUI o carrinho salvo.
    mundo.rpc.mockImplementation(
      async (
        _nome: string,
        args: { p_cart_items: { product_id: string; quantity: number }[] },
      ) => {
        mundo.itens = args.p_cart_items.map((i) =>
          linhaDoBanco(i.product_id, i.quantity),
        );
        return { error: null };
      },
    );
    mundo.itens = [linhaDoBanco("p1")];
    await montar();
    await sincronizar();
    // A cliente põe o p2; a gravação dele termina com sucesso.
    await act(async () => atual.addToCart(produto("p2"), 1));
    await sincronizar();
    expect(mundo.itens.map((i) => i.product_id)).toEqual(["p1", "p2"]);

    // Fecha o app. Enquanto isso o outro aparelho tira o p2 do carrinho.
    act(() => raiz.unmount());
    mundo.itens = [linhaDoBanco("p1")];
    mundo.rpc.mockClear();

    raiz = createRoot(hospedeiro);
    await montar();
    await sincronizar();

    expect(idsDoCarrinho()).toEqual(["p1"]);
    // E o p2 não volta ao banco por regravação.
    expect(mundo.itens.map((i) => i.product_id)).toEqual(["p1"]);
  });
});
