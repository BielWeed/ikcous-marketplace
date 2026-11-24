// @vitest-environment jsdom
//
// Caça de provas fracas (carrinho, 24/11/2026): a LÁPIDE ("esta linha foi
// tirada às T") guardada no aparelho tem validade de 7 dias. Nenhum teste
// olhava essa validade: trocar o cálculo por "nunca expira" passava a suíte
// inteira. O que isto protege, na conta salva:
//   - lápide de 6 dias ainda esconde a linha velha que o banco devolve (a
//     cliente tirou o produto e não quer vê-lo voltar);
//   - lápide de 8 dias JÁ EXPIROU: não esconde mais nada. Sem a validade, uma
//     lápide esquecida no aparelho apagava para sempre a mesma linha que a
//     cliente (ou outro aparelho dela) pôs no carrinho meses depois.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comPaginacao } from "./duble-consulta-paginada";

const mundo = vi.hoisted(() => ({
  itens: [] as Record<string, unknown>[],
  rpc: vi.fn(),
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
const produtos = [
  { id: "p1", nome: "Camiseta", preco_venda: 10, estoque: 20 },
].map((p) => ({ ...p, ativo: true, imagens: [] }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: async () => ({ data: mundo.itens.slice(), error: null }),
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
      getSession: async () => ({ data: { session: { user: usuario } } }),
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

const DIA = 24 * 60 * 60 * 1000;
const CHAVE_DAS_LAPIDES = "marketplace_cart_account_tombstones_v1";

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

/** O carrinho salvo na conta tem p1 mexido há 10 dias; o aparelho guarda uma
 *  lápide de p1 tirada há `diasDaLapide` dias (depois do carimbo do banco). */
async function abrirComLapideDeHaDias(diasDaLapide: number) {
  mundo.itens = [
    {
      product_id: "p1",
      variant_id: "",
      quantity: 2,
      updated_at: new Date(Date.now() - 10 * DIA).toISOString(),
    },
  ];
  localStorage.setItem(
    CHAVE_DAS_LAPIDES,
    JSON.stringify({
      uid: "u1",
      marcas: [{ key: "p1-", deletedAt: Date.now() - diasDaLapide * DIA }],
    }),
  );
  await act(async () =>
    raiz.render(
      <CartProvider>
        <Sonda />
      </CartProvider>,
    ),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
}

describe("carrinho: a lápide guardada no aparelho vale 7 dias", () => {
  it("lápide de 6 dias (dentro da validade) segue escondendo a linha velha do banco", async () => {
    await abrirComLapideDeHaDias(6);

    expect(atual.cart).toEqual([]);
  });

  it("lápide de 8 dias (vencida) não esconde mais nada: a linha do banco entra", async () => {
    await abrirComLapideDeHaDias(8);

    expect(atual.cart.map((i) => [i.product.id, i.quantity])).toEqual([
      ["p1", 2],
    ]);
  });
});
