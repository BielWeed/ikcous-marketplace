// @vitest-environment jsdom
//
// Caça por mutação em `src/contexts/CartContext.tsx` (24/11/2026): para saber se
// há edição daqui que o banco ainda não viu, o carrinho compara "cada linha e a
// sua quantidade" com o último que o banco confirmou. Essa conta NÃO depende da
// ORDEM das linhas: o banco devolve as linhas numa ordem e o aparelho guarda
// noutra. Se a ordem contasse, o aparelho nunca se daria por "alinhado" com o
// banco e a linha que outro aparelho tirou voltava a aparecer aqui.
//
// Cena: o aparelho já tinha a bermuda guardada; o banco tem a camiseta e a
// bermuda (nessa ordem). Depois de juntar, o carrinho daqui fica bermuda +
// camiseta. Outro aparelho tira a bermuda do banco; ao voltar do segundo plano,
// o carrinho daqui acompanha o banco (só a camiseta).
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { mapProductFromDB } from "@/lib/mappers";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comPaginacao } from "./duble-consulta-paginada";

const mundo = vi.hoisted(() => ({
  itens: [] as Record<string, unknown>[],
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
  {
    id: "p1",
    nome: "Bermuda",
    preco_venda: 30,
    estoque: 20,
    ativo: true,
    imagens: [],
  },
  {
    id: "p2",
    nome: "Camiseta",
    preco_venda: 10,
    estoque: 20,
    ativo: true,
    imagens: [],
  },
];
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => Promise.resolve({ data: mundo.itens.slice(), error: null }),
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
    // A gravação daqui falha (sem rede): quem alinha o aparelho com o banco é
    // a LEITURA, não o envio.
    rpc: async () => ({ error: { message: "sem rede" } }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
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
  return null;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
let visibilidade: "visible" | "hidden";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  visibilidade = "visible";
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibilidade,
  });
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
  vi.restoreAllMocks();
  // biome-ignore lint/performance/noDelete: volta ao getter nativo do jsdom
  delete (document as unknown as Record<string, unknown>).visibilityState;
});

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
const ids = () => atual.cart.map((i) => i.product.id);

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("carrinho com conta: a ordem das linhas não conta como edição pendente", () => {
  it("o banco tem camiseta + bermuda, o aparelho guardava a bermuda: depois de juntar, o que outro aparelho tira do banco também sai daqui", async () => {
    localStorage.setItem(
      "marketplace_cart_v1",
      JSON.stringify([
        {
          product: produto("p1"),
          quantity: 1,
          lastModifiedAt: Date.now() - 60_000,
        },
      ]),
    );
    mundo.itens = [linhaDoBanco("p2"), linhaDoBanco("p1")];

    await act(async () =>
      raiz.render(
        <CartProvider>
          <Sonda />
        </CartProvider>,
      ),
    );
    await passar(1_100);
    expect(ids().sort()).toEqual(["p1", "p2"]);

    // Outro aparelho tirou a bermuda; este volta do segundo plano.
    mundo.itens = [linhaDoBanco("p2")];
    visibilidade = "hidden";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await passar(100);
    visibilidade = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await passar(50);

    expect(ids()).toEqual(["p2"]);
  });
});
