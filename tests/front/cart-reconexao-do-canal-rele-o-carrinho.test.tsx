// @vitest-environment jsdom
//
// Cliente com a conta aberta em dois aparelhos: o aviso ao vivo ("o carrinho
// mudou") chega por um canal em tempo real (websocket). Se SÓ esse canal cai e
// volta (o navegador segue online e a aba segue visível), nem o evento `online`
// nem o `visibilitychange` disparam e o aviso que o outro aparelho gerou na
// queda se perde. O carrinho daqui fica velho e a próxima edição grava o
// carrinho velho INTEIRO por cima do salvo: o item que o outro aparelho pôs some.
//
// A regra: quando o canal volta (SUBSCRIBED) depois de uma queda
// (CHANNEL_ERROR / TIMED_OUT / CLOSED), faz UMA releitura do banco, a mesma do
// aviso ao vivo (edição pendente daqui nunca é sobrescrita) e avisa as outras
// abas. A primeira assinatura não relê (o carrinho já foi lido na entrada) e
// valem as mesmas travas das outras releituras (pedido sem confirmação).
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { criarGerenciadorDeChave } from "@/lib/chave-do-pedido";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Status = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

const mundo = vi.hoisted(() => ({
  usuario: { id: "u1" } as null | { id: string },
  carregando: false,
  lider: true,
  itens: [] as Record<string, unknown>[],
  rpc: vi.fn(),
  leiturasDoCarrinho: 0,
  canaisCriados: 0,
  status: null as null | ((status: string) => void),
  mensagensDeAbas: [] as unknown[],
  abaAberta: null as null | { onmessage: ((e: unknown) => void) | null },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario, loading: mundo.carregando }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: mundo.lider }),
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
    nome: "Bone",
    preco_venda: 20,
    estoque: 20,
    ativo: true,
    imagens: [],
  },
  {
    id: "p3",
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
        eq: () => {
          if (tabela === "cart_items") mundo.leiturasDoCarrinho += 1;
          return Promise.resolve({ data: mundo.itens.slice(), error: null });
        },
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
        data: { session: mundo.usuario ? { user: mundo.usuario } : null },
      }),
    },
    rpc: mundo.rpc,
    // O mock deixa o teste capturar o aviso de estado do canal e dispará-lo.
    channel: () => ({
      on: () => ({
        subscribe: (aoMudarDeEstado?: (status: string) => void) => {
          mundo.canaisCriados += 1;
          mundo.status = aoMudarDeEstado ?? null;
          return {};
        },
      }),
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
  mundo.usuario = { id: "u1" };
  mundo.carregando = false;
  mundo.lider = true;
  mundo.itens = [];
  mundo.leiturasDoCarrinho = 0;
  mundo.canaisCriados = 0;
  mundo.status = null;
  mundo.mensagensDeAbas = [];
  mundo.abaAberta = null;
  // O banco de verdade: a gravação SUBSTITUI o carrinho salvo.
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
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      onmessage: ((e: unknown) => void) | null = null;
      constructor() {
        mundo.abaAberta = this;
      }
      postMessage(m: unknown) {
        mundo.mensagensDeAbas.push(m);
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
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
}
// Passa o tempo de espera da gravação (1 s) e deixa as promessas se resolverem.
async function sincronizar() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
}
// O canal em tempo real muda de estado (o que o supabase avisa ao app).
async function canal(...estados: Status[]) {
  for (const estado of estados) {
    await act(async () => {
      mundo.status?.(estado);
      await vi.advanceTimersByTimeAsync(50);
    });
  }
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
const idsNoBanco = () => mundo.itens.map((i) => i.product_id);

describe("canal em tempo real do carrinho cai e volta: o carrinho relê o banco", () => {
  it("(1) a primeira assinatura não relê: o carrinho já foi lido na entrada", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    await sincronizar();
    expect(mundo.canaisCriados).toBe(1);
    const leituras = mundo.leiturasDoCarrinho;

    await canal("SUBSCRIBED");

    expect(mundo.leiturasDoCarrinho).toBe(leituras);
    expect(mundo.mensagensDeAbas).toEqual([]);
  });

  it("(2) caiu e voltou: traz o item que o outro aparelho pôs, avisa as abas e a edição seguinte NÃO o apaga do banco", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    await sincronizar();
    await canal("SUBSCRIBED");
    expect(idsDoCarrinho()).toEqual(["p1", "p2"]);
    const leituras = mundo.leiturasDoCarrinho;

    // O socket cai; o outro aparelho põe a camiseta; o aviso se perde.
    await canal("CHANNEL_ERROR");
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2"), linhaDoBanco("p3")];
    await canal("SUBSCRIBED");

    expect(mundo.leiturasDoCarrinho).toBe(leituras + 1);
    expect(idsDoCarrinho()).toEqual(["p1", "p2", "p3"]);
    expect(mundo.mensagensDeAbas).toEqual([{ type: "cart_update" }]);

    // A cliente mexe em OUTRO item: a gravação leva o carrinho completo.
    await act(async () => atual.updateQuantity("p1", 3));
    await sincronizar();
    expect(idsNoBanco().sort()).toEqual(["p1", "p2", "p3"]);
  });

  it.each<Status>(["TIMED_OUT", "CLOSED"])(
    "(2b) queda por %s seguida de SUBSCRIBED também relê uma vez",
    async (queda) => {
      mundo.itens = [linhaDoBanco("p1")];
      await montar();
      await sincronizar();
      await canal("SUBSCRIBED");
      const leituras = mundo.leiturasDoCarrinho;

      await canal(queda, "SUBSCRIBED");

      expect(mundo.leiturasDoCarrinho).toBe(leituras + 1);
    },
  );

  it("(3) vários estados de erro seguidos e um só SUBSCRIBED: uma releitura só, sem rajada", async () => {
    mundo.itens = [linhaDoBanco("p1")];
    await montar();
    await sincronizar();
    await canal("SUBSCRIBED");
    const leituras = mundo.leiturasDoCarrinho;

    await canal("CHANNEL_ERROR", "TIMED_OUT", "CLOSED", "CHANNEL_ERROR");
    // Nenhum erro, sozinho, lê o banco (a rede segue fora).
    expect(mundo.leiturasDoCarrinho).toBe(leituras);

    await canal("SUBSCRIBED");
    expect(mundo.leiturasDoCarrinho).toBe(leituras + 1);

    // SUBSCRIBED repetido sem nova queda no meio: nada de novo.
    await canal("SUBSCRIBED", "SUBSCRIBED");
    expect(mundo.leiturasDoCarrinho).toBe(leituras + 1);
    expect(mundo.mensagensDeAbas).toEqual([{ type: "cart_update" }]);
  });

  it("(3b) uma SEGUNDA queda depois da volta relê de novo (uma por queda)", async () => {
    mundo.itens = [linhaDoBanco("p1")];
    await montar();
    await sincronizar();
    await canal("SUBSCRIBED");
    const leituras = mundo.leiturasDoCarrinho;

    await canal("CLOSED", "SUBSCRIBED");
    await canal("CHANNEL_ERROR", "SUBSCRIBED");

    expect(mundo.leiturasDoCarrinho).toBe(leituras + 2);
  });

  it("(4) pedido enviado e sem confirmação segura o carrinho: a volta do canal não relê", async () => {
    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
    await montar();
    await sincronizar();
    await canal("SUBSCRIBED");
    criarGerenciadorDeChave(localStorage, undefined, { dono: "u1" }).chavePara(
      "impressao-do-pedido",
    );
    const leituras = mundo.leiturasDoCarrinho;

    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2"), linhaDoBanco("p3")];
    await canal("CHANNEL_ERROR", "SUBSCRIBED");

    expect(mundo.leiturasDoCarrinho).toBe(leituras);
    expect(idsDoCarrinho()).toEqual(["p1", "p2"]);
    expect(mundo.mensagensDeAbas).toEqual([]);
  });

  it("(4b) sessão ainda carregando: a volta do canal não relê", async () => {
    mundo.carregando = true;
    mundo.itens = [linhaDoBanco("p1")];
    await montar();
    const leituras = mundo.leiturasDoCarrinho;
    expect(mundo.canaisCriados).toBe(1);

    await canal("SUBSCRIBED", "CHANNEL_ERROR", "SUBSCRIBED");

    expect(mundo.leiturasDoCarrinho).toBe(leituras);
    expect(mundo.mensagensDeAbas).toEqual([]);
  });

  it("(5) aba secundária (não líder): não assina o canal e segue escutando as outras abas", async () => {
    mundo.lider = false;
    mundo.itens = [linhaDoBanco("p1")];
    await montar();
    await sincronizar();
    expect(mundo.canaisCriados).toBe(0);
    const leituras = mundo.leiturasDoCarrinho;

    mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p3")];
    await act(async () => {
      mundo.abaAberta?.onmessage?.({ data: { type: "cart_update" } });
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(mundo.leiturasDoCarrinho).toBe(leituras + 1);
    expect(idsDoCarrinho()).toEqual(["p1", "p3"]);
  });

  it("(6) desmontar durante a queda: o SUBSCRIBED que chega depois não relê", async () => {
    mundo.itens = [linhaDoBanco("p1")];
    await montar();
    await sincronizar();
    await canal("SUBSCRIBED", "CHANNEL_ERROR");
    const leituras = mundo.leiturasDoCarrinho;

    await act(async () => raiz.unmount());
    // O afterEach desmonta de novo: devolve uma raiz viva para ele.
    raiz = createRoot(hospedeiro);
    await canal("SUBSCRIBED");

    expect(mundo.leiturasDoCarrinho).toBe(leituras);
    expect(mundo.mensagensDeAbas).toEqual([]);
  });
});
