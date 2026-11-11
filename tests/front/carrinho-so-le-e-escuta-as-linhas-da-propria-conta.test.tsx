// @vitest-environment jsdom
//
// Onda 111 (achados 1 e 2 do carrinho): a policy de SELECT de `cart_items`
// deixa a lojista (admin) ler o carrinho de TODAS as clientes. Então o único
// freio do lado do app é o filtro que o CartContext manda ao banco:
//   - a leitura (`syncFromDB`) pede só `user_id = <a própria conta>`; sem isso
//     a lojista logada na vitrine mesclaria o carrinho das clientes no dela e
//     o `sync_cart_atomic` gravaria a SOMA de tudo na conta dela;
//   - o canal ao vivo assina só `user_id=eq.<a própria conta>`; sem isso cada
//     edição de carrinho de qualquer cliente dispara releitura na vitrine dela.
//
// Os testes vizinhos de carrinho usam um `eq` que ignora (coluna, valor), então
// apagar o filtro não deixava nenhum vermelho. Aqui o dublê guarda as linhas de
// DUAS contas e aplica o `eq` de verdade, e o canal guarda a config do `.on`.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { mapProductFromDB } from "@/lib/mappers";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Linha = {
  user_id: string;
  product_id: string;
  variant_id: string;
  quantity: number;
  updated_at: string;
};

const mundo = vi.hoisted(() => ({
  linhas: [] as Record<string, unknown>[],
  consultas: [] as { tabela: string; coluna: string; valor: unknown }[],
  canais: [] as { nome: string; tipo: unknown; config: any }[],
  rpc: vi.fn(),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
const usuario = { id: "lojista" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
const produtos = ["p1", "p2", "p9", "x1", "x2", "x3"].map((id) => ({
  id,
  nome: `Produto ${id}`,
  preco_venda: 10,
  estoque: 20,
  ativo: true,
  imagens: [],
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () =>
        // Sem filtro, a consulta resolve com tudo o que a policy deixa esta
        // conta ver; para a lojista (admin), as linhas de todas as contas.
        Object.assign(
          Promise.resolve({ data: mundo.linhas.slice(), error: null }),
          {
            // O `eq` de verdade: só as linhas cuja coluna casa com o valor.
            eq: async (coluna: string, valor: unknown) => {
              mundo.consultas.push({ tabela, coluna, valor });
              return {
                data: mundo.linhas.filter((linha) =>
                  Object.entries(linha).some(
                    ([chave, v]) => chave === coluna && v === valor,
                  ),
                ),
                error: null,
              };
            },
            in: async (_coluna: string, ids: string[]) =>
              tabela === "product_variants"
                ? { data: [], error: null }
                : {
                    data: produtos.filter((p) => ids.includes(p.id)),
                    error: null,
                  },
          },
        ),
    }),
    auth: {
      getSession: async () => ({ data: { session: { user: usuario } } }),
    },
    rpc: mundo.rpc,
    channel: (nome: string) => ({
      on: (tipo: unknown, config: unknown) => {
        mundo.canais.push({ nome, tipo, config });
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
function linha(user_id: string, product_id: string): Linha {
  return {
    user_id,
    product_id,
    variant_id: "",
    quantity: 1,
    updated_at: new Date(Date.now() - 1000).toISOString(),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mundo.consultas = [];
  mundo.canais = [];
  // Lojista com 2 itens; cliente-x com 3.
  mundo.linhas = [
    linha("lojista", "p1"),
    linha("cliente-x", "x1"),
    linha("lojista", "p2"),
    linha("cliente-x", "x2"),
    linha("cliente-x", "x3"),
  ];
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
const produto = (id: string) =>
  mapProductFromDB({
    ...produtos.find((p) => p.id === id),
    product_variants: [],
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

describe("carrinho: só lê e só escuta as linhas da própria conta", () => {
  it("a lojista monta o carrinho só com os 2 itens dela, e o que grava não leva produto de cliente", async () => {
    await montar();
    await sincronizar();

    // A leitura pediu exatamente as linhas desta conta.
    expect(mundo.consultas).toContainEqual({
      tabela: "cart_items",
      coluna: "user_id",
      valor: "lojista",
    });
    expect(
      mundo.consultas
        .filter((c) => c.tabela === "cart_items")
        .every((c) => c.coluna === "user_id" && c.valor === "lojista"),
    ).toBe(true);
    expect(atual.cart.map((i) => i.product.id).sort()).toEqual(["p1", "p2"]);

    // Força uma gravação (a junção do banco, sozinha, não regrava): o que vai
    // para `sync_cart_atomic` são os itens dela e nenhum da cliente-x.
    await act(async () => atual.addToCart(produto("p9"), 1));
    await sincronizar();

    const gravacoes = mundo.rpc.mock.calls.filter(
      ([nome]) => nome === "sync_cart_atomic",
    );
    expect(gravacoes.length).toBeGreaterThan(0);
    const enviados = gravacoes
      .flatMap(([, args]) => args.p_cart_items)
      .map((i: { product_id: string }) => i.product_id);
    expect(enviados.sort()).toEqual(expect.arrayContaining(["p1", "p2", "p9"]));
    expect(enviados.some((id: string) => id.startsWith("x"))).toBe(false);
  });

  it("o canal ao vivo é aberto só para as mudanças de cart_items da própria conta", async () => {
    await montar();

    expect(mundo.canais).toHaveLength(1);
    const [canal] = mundo.canais;
    expect(canal.nome).toBe("cart:lojista");
    expect(canal.tipo).toBe("postgres_changes");
    expect(canal.config.table).toBe("cart_items");
    expect(canal.config.filter).toBe("user_id=eq.lojista");
  });
});
