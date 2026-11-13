// @vitest-environment jsdom
//
// Painel da lojista (admin): dois defeitos do "ao vivo" ao entrar um pedido novo.
//
// (1) PEDIDO PAGO APARECIA "AGUARDANDO PAGAMENTO". `handleRealtimeInsert`
//     consulta o pedido no banco quando o INSERT chega. Se o UPDATE de
//     pagamento (`payment_status = 'pago'`) chegava ENQUANTO a consulta estava
//     em voo, o pedido ainda não estava na lista e o UPDATE era descartado; a
//     consulta (um retrato anterior ao pagamento) entrava depois com
//     "aguardando". Para a cliente já existia a proteção (`insertsEmVooRef` +
//     `mesclarAtualizacaoRealtime`), mas ela estava ligada só para `!isAdmin`.
//
// (2) O MAIS NOVO SAÍA DA PÁGINA. Dois INSERTs seguidos (A, depois B, mais
//     novo) cuja consulta responde fora de ordem davam [A, B] em vez de
//     [B, A] (`[newOrder, ...prev]` sem olhar `createdAt`), e o corte da
//     página (`slice(0, pageSize)`) podia tirar o pedido mais novo.
//
// Mesmo molde de use-orders-cancelados-insert-recarrega-com-debounce.test.tsx
// (hook real, canal capturado) e de useorders-realtime-da-cliente-conta-e-
// versao.test.tsx (consulta por id com portão).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rede = vi.hoisted(() => ({
  porId: new Map<string, unknown>(),
  portoes: new Map<string, Promise<void>>(),
  rpc: vi.fn(),
  canal: null as ((payload: unknown) => Promise<void>) | null,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    rpc: (...args: unknown[]) => rede.rpc(...args),
    from: (tabela: string) => {
      let idAlvo: string | null = null;
      const alvo: Record<string, unknown> = {
        select: () => alvo,
        eq: (coluna: string, valor: string) => {
          if (coluna === "id") idAlvo = valor;
          return alvo;
        },
        order: () => alvo,
        range: () => alvo,
        limit: () => alvo,
        or: () => alvo,
        in: () => alvo,
        abortSignal: () => alvo,
        single: () => alvo,
        maybeSingle: () => alvo,
      };
      // biome-ignore lint/suspicious/noThenProperty: dublê awaitable do Supabase.
      Object.defineProperty(alvo, "then", {
        value: (resolve: (resposta: unknown) => unknown) => {
          if (tabela === "marketplace_orders" && idAlvo) {
            const id = idAlvo;
            const espera = rede.portoes.get(id) ?? Promise.resolve();
            return espera
              .then(() => ({ data: rede.porId.get(id) ?? null, error: null }))
              .then(resolve);
          }
          return Promise.resolve({ data: [], error: null, count: 0 }).then(
            resolve,
          );
        },
      });
      return alvo;
    },
    channel: () => {
      const canal = {
        on: (
          _tipo: string,
          _filtro: unknown,
          handler: (payload: unknown) => Promise<void>,
        ) => {
          rede.canal = handler;
          return canal;
        },
        subscribe: (callback?: (status: string) => void) => {
          callback?.("SUBSCRIBED");
          return canal;
        },
      };
      return canal;
    },
    removeChannel: () => Promise.resolve(),
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-1" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const T_PEDIDO = "2026-11-12T10:00:00.000Z";
const T_PAGO = "2026-11-12T10:00:05.000Z";

const linha = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  user_id: "cliente-1",
  customer_name: "Cliente de teste",
  customer_data: {},
  items: [],
  total: 10,
  subtotal: 10,
  shipping: 0,
  discount: 0,
  payment_method: "pix",
  payment_status: "aguardando",
  status: "pending",
  created_at: T_PEDIDO,
  updated_at: T_PEDIDO,
  ...extra,
});

describe("useOrders (painel) — pedido novo que chega pelo ao vivo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: ReturnType<typeof useOrders>;

  let useOrders: typeof import("@/hooks/useOrders").useOrders;

  function Sonda() {
    const retorno = useOrders(true, true);
    useEffect(() => {
      atual = retorno;
    });
    return null;
  }

  const ids = () => atual.orders.map((pedido) => pedido.id);

  /** Fecha o portão da consulta de um pedido; devolve a chave que o abre. */
  function fecharPortao(id: string) {
    let abrir: () => void = () => {};
    rede.portoes.set(
      id,
      new Promise<void>((resolve) => {
        abrir = resolve;
      }),
    );
    return abrir;
  }

  function inserirSemEsperar(id: string) {
    return rede.canal?.({ eventType: "INSERT", new: { id }, old: {} }) as
      | Promise<void>
      | undefined;
  }

  async function carregarPagina(pageSize: number, linhas: unknown[]) {
    rede.rpc.mockImplementation(() => ({
      abortSignal: () =>
        Promise.resolve({
          data: { data: linhas, total_count: linhas.length },
          error: null,
        }),
    }));
    await act(async () => {
      await atual.loadOrders(0, pageSize, "all");
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    // O canal do admin é UM só (`admin_order_updates`), global ao módulo e com
    // contagem de telas: módulo novo por teste, para cada um registrar o seu.
    vi.resetModules();
    ({ useOrders } = await import("@/hooks/useOrders"));
    rede.porId.clear();
    rede.portoes.clear();
    rede.canal = null;
    localStorage.clear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => raiz.render(<Sonda />));
    expect(rede.canal).toBeTruthy();
  });

  afterEach(() => {
    try {
      act(() => raiz.unmount());
    } catch {
      // já desmontado
    }
    hospedeiro.remove();
    localStorage.clear();
  });

  describe("(1) o pagamento que chega no meio da consulta", () => {
    it("CONTROLE: sem UPDATE no meio, o pedido entra como veio da consulta (aguardando)", async () => {
      await carregarPagina(12, []);
      rede.porId.set("ped-1", linha("ped-1"));
      const abrir = fecharPortao("ped-1");
      const voo = inserirSemEsperar("ped-1");
      await act(async () => {
        abrir();
        await voo;
      });
      expect(ids()).toEqual(["ped-1"]);
      expect(atual.orders[0].paymentStatus).toBe("aguardando");
    });

    it("UPDATE de pagamento durante a consulta: o pedido entra PAGO, não aguardando", async () => {
      await carregarPagina(12, []);
      // A consulta devolve o retrato ANTERIOR ao pagamento.
      rede.porId.set("ped-1", linha("ped-1"));
      const abrir = fecharPortao("ped-1");
      const voo = inserirSemEsperar("ped-1");

      // O pagamento confirma enquanto a consulta ainda está em voo.
      await act(async () => {
        await rede.canal?.({
          eventType: "UPDATE",
          new: linha("ped-1", {
            payment_status: "pago",
            status: "processing",
            updated_at: T_PAGO,
          }),
          old: { id: "ped-1" },
        });
      });
      expect(ids()).toEqual([]); // ainda não entrou

      await act(async () => {
        abrir();
        await voo;
      });

      expect(ids()).toEqual(["ped-1"]);
      expect(atual.orders[0].paymentStatus).toBe("pago");
      expect(atual.orders[0].status).toBe("processing");
    });

    it("UPDATE MAIS VELHO que a consulta, no meio do voo, não desfaz o que a consulta já sabe", async () => {
      await carregarPagina(12, []);
      rede.porId.set(
        "ped-1",
        linha("ped-1", { payment_status: "pago", updated_at: T_PAGO }),
      );
      const abrir = fecharPortao("ped-1");
      const voo = inserirSemEsperar("ped-1");
      await act(async () => {
        await rede.canal?.({
          eventType: "UPDATE",
          new: linha("ped-1", { payment_status: "aguardando" }), // T_PEDIDO
          old: { id: "ped-1" },
        });
      });
      await act(async () => {
        abrir();
        await voo;
      });
      expect(atual.orders[0].paymentStatus).toBe("pago");
    });

    it("BORDA: o UPDATE do meio do voo muda o status para fora do filtro — o pedido NÃO entra na lista filtrada", async () => {
      // Filtro "Em Aberto": a consulta (retrato antigo) diz pending e entraria;
      // o UPDATE guardado diz cancelled — a decisão olha o pedido já mesclado.
      rede.rpc.mockImplementation(() => ({
        abortSignal: () =>
          Promise.resolve({ data: { data: [], total_count: 0 }, error: null }),
      }));
      await act(async () => {
        await atual.loadOrders(0, 12, "open");
      });
      rede.porId.set("ped-1", linha("ped-1"));
      const abrir = fecharPortao("ped-1");
      const voo = inserirSemEsperar("ped-1");
      await act(async () => {
        await rede.canal?.({
          eventType: "UPDATE",
          new: linha("ped-1", { status: "cancelled", updated_at: T_PAGO }),
          old: { id: "ped-1" },
        });
      });
      await act(async () => {
        abrir();
        await voo;
      });
      expect(ids()).toEqual([]);
    });

    it("BORDA: UPDATE de pedido que NÃO está em voo e fora da lista continua ignorado (nada é guardado)", async () => {
      await carregarPagina(12, []);
      await act(async () => {
        await rede.canal?.({
          eventType: "UPDATE",
          new: linha("ped-estranho", { payment_status: "pago" }),
          old: { id: "ped-estranho" },
        });
      });
      expect(ids()).toEqual([]);
      // Depois, um INSERT do mesmo id traz só o que a consulta disse: nada de
      // UPDATE "fantasma" guardado de antes do voo.
      rede.porId.set("ped-estranho", linha("ped-estranho"));
      await act(async () => {
        await inserirSemEsperar("ped-estranho");
      });
      expect(atual.orders[0].paymentStatus).toBe("aguardando");
    });
  });

  describe("(2) dois pedidos cuja consulta responde fora de ordem", () => {
    const T_X = "2026-11-12T09:00:00.000Z";
    const T_A = "2026-11-12T09:30:00.000Z";
    const T_B = "2026-11-12T09:45:00.000Z";

    it("A (mais velho) e B (mais novo): a lista fica [B, A] mesmo se a consulta de B responde primeiro", async () => {
      await carregarPagina(12, []);
      rede.porId.set("ped-a", linha("ped-a", { created_at: T_A }));
      rede.porId.set("ped-b", linha("ped-b", { created_at: T_B }));
      const abrirA = fecharPortao("ped-a"); // A chegou primeiro mas demora
      const vooA = inserirSemEsperar("ped-a");
      const vooB = inserirSemEsperar("ped-b"); // B responde na hora
      await act(async () => {
        await vooB;
      });
      expect(ids()).toEqual(["ped-b"]);
      await act(async () => {
        abrirA();
        await vooA;
      });
      expect(ids()).toEqual(["ped-b", "ped-a"]);
    });

    it("página cheia: o corte tira o MAIS VELHO, nunca o mais novo", async () => {
      // Página de 2 já com [B, X]. A (entre B e X, em tempo) chega por último:
      // fica [B, A] e X sai — com `[novo, ...prev]` sairia o B (mais novo).
      await carregarPagina(2, [
        linha("ped-b", { created_at: T_B }),
        linha("ped-x", { created_at: T_X }),
      ]);
      expect(ids()).toEqual(["ped-b", "ped-x"]);
      rede.porId.set("ped-a", linha("ped-a", { created_at: T_A }));
      await act(async () => {
        await inserirSemEsperar("ped-a");
      });
      expect(ids()).toEqual(["ped-b", "ped-a"]);
    });

    it("BORDA: pedido mais velho que a página inteira cheia nem aparece (vai para a página 2)", async () => {
      await carregarPagina(2, [
        linha("ped-b", { created_at: T_B }),
        linha("ped-a", { created_at: T_A }),
      ]);
      rede.porId.set("ped-x", linha("ped-x", { created_at: T_X }));
      await act(async () => {
        await inserirSemEsperar("ped-x");
      });
      expect(ids()).toEqual(["ped-b", "ped-a"]);
    });

    it("EMPATE de data: o que chegou por último fica no topo, como sempre foi", async () => {
      await carregarPagina(12, [linha("ped-1", { created_at: T_A })]);
      rede.porId.set("ped-2", linha("ped-2", { created_at: T_A }));
      await act(async () => {
        await inserirSemEsperar("ped-2");
      });
      expect(ids()).toEqual(["ped-2", "ped-1"]);
    });

    it("pedido mais novo que todos continua indo para o topo (caminho comum)", async () => {
      await carregarPagina(12, [linha("ped-x", { created_at: T_X })]);
      rede.porId.set("ped-b", linha("ped-b", { created_at: T_B }));
      await act(async () => {
        await inserirSemEsperar("ped-b");
      });
      expect(ids()).toEqual(["ped-b", "ped-x"]);
    });
  });
});
