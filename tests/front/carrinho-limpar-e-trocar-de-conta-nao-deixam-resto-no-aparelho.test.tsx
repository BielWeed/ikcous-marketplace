// @vitest-environment jsdom
//
// Caça de provas fracas (carrinho, 24/11/2026): três limpezas do carrinho que
// podiam ser apagadas do código sem nenhum teste cair.
//   1. Esvaziar o carrinho (compra concluída) grava a lápide de cada linha: uma
//      leitura do banco que chega logo depois, ainda com as linhas velhas
//      (a gravação do carrinho vazio sai 1 s depois), não as devolve ao
//      carrinho que acabou de ser esvaziado.
//   2. Esvaziar o carrinho apaga também a cópia guardada no aparelho, mesmo
//      com a leitura da conta ainda em andamento (a gravação normal do
//      carrinho está travada até a leitura voltar): senão, fechando o app
//      nesse intervalo, o carrinho da compra já concluída reaparece ao abrir.
//   3. Trocar de conta apaga a cópia guardada da conta anterior: até a leitura
//      da conta nova voltar nada a sobrescreve, e uma cópia da conta A no
//      aparelho seria lida como carrinho da conta B ao reabrir o app.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { mapProductFromDB } from "@/lib/mappers";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comPaginacao } from "./duble-consulta-paginada";

const mundo = vi.hoisted(() => ({
  usuario: { id: "uA" } as { id: string },
  itens: [] as Record<string, unknown>[],
  rpc: vi.fn(),
  evento: (_payload: unknown) => {},
  // Quando preenchida, a PRÓXIMA leitura do carrinho no banco fica em voo até
  // `liberar()`.
  segurar: false,
  liberar: (() => {}) as () => void,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
const produtos = [
  { id: "p1", nome: "Camiseta", preco_venda: 10, estoque: 20 },
  { id: "p2", nome: "Bermuda", preco_venda: 30, estoque: 20 },
].map((p) => ({ ...p, ativo: true, imagens: [] }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => {
          const dados = { data: mundo.itens.slice(), error: null };
          if (!mundo.segurar) return Promise.resolve(dados);
          mundo.segurar = false;
          return new Promise((resolve) => {
            mundo.liberar = () => resolve(dados);
          });
        },
        in: comPaginacao(async (_coluna: string, ids: string[]) =>
          tabela === "product_variants"
            ? { data: [], error: null }
            : {
                data: produtos.filter((p) => ids.includes(p.id)),
                error: null,
              },
        ),
      }),
    }),
    auth: {
      getSession: async () => ({ data: { session: { user: mundo.usuario } } }),
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

const CHAVE_DO_CARRINHO = "marketplace_cart_v1";

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
  mundo.usuario = { id: "uA" };
  mundo.itens = [];
  mundo.segurar = false;
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
const arvore = () => (
  <CartProvider>
    <Sonda />
  </CartProvider>
);
async function montar() {
  await act(async () => raiz.render(arvore()));
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
const produto = (id: string) =>
  mapProductFromDB({
    ...produtos.find((p) => p.id === id),
    product_variants: [],
  });
const idsDoCarrinho = () => atual.cart.map((i) => i.product.id);

describe("carrinho: limpar e trocar de conta não deixam resto no aparelho", () => {
  it("esvaziado o carrinho, uma leitura do banco ainda com as linhas velhas não as devolve", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    await sincronizar();
    expect(idsDoCarrinho()).toEqual(["p1", "p2"]);

    await act(async () => atual.clearCart({ silencioso: true }));
    expect(idsDoCarrinho()).toEqual([]);
    // Antes de a gravação do carrinho vazio sair, chega o aviso ao vivo e a
    // leitura ainda traz as linhas velhas.
    await act(async () => {
      mundo.evento({ eventType: "UPDATE" });
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(idsDoCarrinho()).toEqual([]);
  });

  it("esvaziar com a leitura da conta em andamento apaga a cópia guardada no aparelho", async () => {
    localStorage.setItem(
      CHAVE_DO_CARRINHO,
      JSON.stringify([
        { product: produto("p1"), quantity: 1, lastModifiedAt: 1 },
      ]),
    );
    mundo.segurar = true;
    await montar();
    expect(idsDoCarrinho()).toEqual(["p1"]);

    await act(async () => atual.clearCart({ silencioso: true }));

    expect(localStorage.getItem(CHAVE_DO_CARRINHO)).toBeNull();
    // Termina a leitura pendente para o teste não deixar nada no ar.
    await act(async () => {
      mundo.liberar();
      await vi.advanceTimersByTimeAsync(50);
    });
  });

  it("trocar de conta apaga a cópia guardada da conta anterior enquanto a nova ainda é lida", async () => {
    mundo.itens = [linhaDoBanco("p1")];
    await montar();
    await sincronizar();
    // Com a conta A lida, o carrinho dela está guardado no aparelho.
    expect(
      JSON.parse(localStorage.getItem(CHAVE_DO_CARRINHO) ?? "[]"),
    ).toHaveLength(1);

    // Entra a conta B, cuja leitura demora.
    mundo.usuario = { id: "uB" };
    mundo.itens = [];
    mundo.segurar = true;
    await act(async () => raiz.render(arvore()));

    expect(idsDoCarrinho()).toEqual([]);
    expect(localStorage.getItem(CHAVE_DO_CARRINHO)).toBeNull();
    await act(async () => {
      mundo.liberar();
      await vi.advanceTimersByTimeAsync(50);
    });
  });
});
