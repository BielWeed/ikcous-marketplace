// @vitest-environment jsdom
//
// MEUS PEDIDOS NÃO SOMEM NA JANELA EM QUE O TOKEN NÃO RENOVOU (caça 28/11/2026).
//
// A cliente volta ao app depois de horas e a renovação do token falha uns
// segundos (rede voltando). O supabase-js 2.117 guarda essa falha por 60 s e,
// nessa janela, `getSession()` devolve `session: null` com um erro de rede --
// sem SIGNED_OUT: o app continua mostrando a cliente logada. As consultas saem
// com a chave ANÔNIMA e o banco (RLS) devolve a lista VAZIA. A leitura aceitava
// esse `[]` como "a conta não tem pedido": "Nenhum pedido" na tela, e a cópia
// boa do aparelho era trocada por `[]`.
//
// Regra: lista vazia só vale com a sessão do DONO confirmada. Sem ela a lista e
// a cópia ficam como estavam, a falha é exposta, e a leitura se refaz quando o
// supabase-js avisar que a sessão DESTA conta voltou (TOKEN_REFRESHED/
// SIGNED_IN). Quem saiu de verdade continua com a lista limpa, como antes.
import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Ouvinte = (evento: string, sessao: unknown) => void;

const estado = vi.hoisted(() => ({
  // O que o banco devolve (a RLS já aplicada: sem o token da dona, `[]`).
  linhas: [] as unknown[],
  leituras: 0,
  // O que o cliente Supabase diz AGORA (`getSession`).
  sessaoDe: "cliente-1" as string | null,
  erroDaSessao: null as unknown,
  ouvintes: new Set<(evento: string, sessao: unknown) => void>(),
}));
const exposto = vi.hoisted(() => ({
  fetchUserOrders: null as null | ((silent?: boolean) => Promise<unknown>),
  ordersLoadError: undefined as unknown,
  orders: [] as Array<{ id: string }>,
}));
const conta = vi.hoisted(() => ({ id: "cliente-1" as string | null }));

vi.mock("@/lib/supabase", () => {
  const builder = () => {
    const alvo: Record<string, unknown> = {
      select: () => alvo,
      eq: () => alvo,
      order: () => alvo,
      range: () => alvo,
      limit: () => alvo,
      or: () => alvo,
      in: () => alvo,
      abortSignal: () => alvo,
      single: () => alvo,
      maybeSingle: () => alvo,
    };
    // biome-ignore lint/suspicious/noThenProperty: mock de consulta precisa ser awaitable
    Object.defineProperty(alvo, "then", {
      value: (res: (v: unknown) => unknown, rej: (r: unknown) => unknown) => {
        estado.leituras += 1;
        return Promise.resolve({
          data: [...estado.linhas],
          error: null,
          count: 0,
        }).then(res, rej);
      },
    });
    return alvo;
  };
  const canal = () => {
    const alvo: Record<string, unknown> = {
      on: () => alvo,
      subscribe: () => alvo,
    };
    return alvo;
  };
  return {
    supabase: {
      from: () => builder(),
      rpc: () => builder(),
      channel: () => canal(),
      removeChannel: () => Promise.resolve(),
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
      auth: {
        getSession: async () => ({
          data: {
            session: estado.sessaoDe ? { user: { id: estado.sessaoDe } } : null,
          },
          error: estado.erroDaSessao,
        }),
        onAuthStateChange: (ouvinte: Ouvinte) => {
          estado.ouvintes.add(ouvinte);
          return {
            data: {
              subscription: {
                unsubscribe: () => {
                  estado.ouvintes.delete(ouvinte);
                },
              },
            },
          };
        },
      },
    },
  };
});

vi.mock("@/hooks/useAuth", () => {
  const usuarios = new Map<string, { id: string }>();
  return {
    useAuth: () => {
      if (!conta.id) return { user: null, isAdmin: false };
      let user = usuarios.get(conta.id);
      if (!user) {
        user = { id: conta.id };
        usuarios.set(conta.id, user);
      }
      return { user, isAdmin: false };
    },
  };
});

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { useOrders } from "@/hooks/useOrders";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const CACHE = "ikcous_orders_cache_cliente-1";

function pedido(id: string) {
  return {
    id,
    customer: { name: "Cliente Teste", whatsapp: "34900000000" },
    items: [],
    subtotal: 10,
    shipping: 0,
    discount: 0,
    total: 10,
    paymentMethod: "pix",
    status: "pending",
    createdAt: "2026-11-27T10:00:00.000Z",
    updatedAt: "2026-11-27T10:00:00.000Z",
    cancelledAfterShipping: false,
  };
}

// Linha do banco (o mapeador lê os nomes das colunas).
function linha(id: string) {
  return {
    id,
    user_id: "cliente-1",
    customer_name: "Cliente Teste",
    customer_data: { name: "Cliente Teste", whatsapp: "34900000000" },
    items: [],
    subtotal: 10,
    shipping_cost: 0,
    discount: 0,
    total: 10,
    payment_method: "pix",
    status: "pending",
    created_at: "2026-11-27T10:00:00.000Z",
    updated_at: "2026-11-27T10:00:00.000Z",
  };
}

function Alvo() {
  const hook = useOrders(true, false) as unknown as {
    fetchUserOrders: (silent?: boolean) => Promise<unknown>;
    ordersLoadError?: unknown;
    orders: Array<{ id: string }>;
  };
  useEffect(() => {
    exposto.fetchUserOrders = hook.fetchUserOrders;
    exposto.ordersLoadError = hook.ordersLoadError;
    exposto.orders = hook.orders;
  });
  return null;
}

const deixarAndar = () => new Promise((r) => setTimeout(r, 0));

function avisar(evento: string, userId: string | null) {
  for (const ouvinte of [...estado.ouvintes]) {
    ouvinte(evento, userId ? { user: { id: userId } } : null);
  }
}

function renovacaoFalhando() {
  estado.sessaoDe = null;
  estado.erroDaSessao = new AuthRetryableFetchError("Failed to fetch", 0);
}

function renovacaoVoltou() {
  estado.sessaoDe = "cliente-1";
  estado.erroDaSessao = null;
}

describe("useOrders — lista vazia sem a sessão da dona não apaga os pedidos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function montar() {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Alvo />);
    });
  }

  beforeEach(() => {
    estado.linhas = [];
    estado.leituras = 0;
    estado.ouvintes.clear();
    renovacaoVoltou();
    conta.id = "cliente-1";
    exposto.fetchUserOrders = null;
    exposto.ordersLoadError = undefined;
    exposto.orders = [];
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("renovação falhou: o [] do banco não troca a lista nem a cópia do aparelho", async () => {
    localStorage.setItem(CACHE, JSON.stringify([pedido("ped-1")]));
    await montar();
    expect(exposto.orders.map((p) => p.id)).toEqual(["ped-1"]);

    renovacaoFalhando();
    let retorno: unknown;
    await act(async () => {
      retorno = await exposto.fetchUserOrders!(true);
    });

    expect(exposto.orders.map((p) => p.id)).toEqual(["ped-1"]);
    expect(JSON.parse(localStorage.getItem(CACHE)!)).toHaveLength(1);
    // Não é "a conta não tem pedido": a tela recebe a falha (e não o vazio).
    expect(exposto.ordersLoadError).not.toBeNull();
    expect(retorno).toEqual([]);
  });

  it("renovação voltou (TOKEN_REFRESHED da mesma conta): relê e traz os pedidos", async () => {
    await montar();
    renovacaoFalhando();
    await act(async () => {
      await exposto.fetchUserOrders!(true);
    });
    expect(exposto.orders).toEqual([]);
    expect(exposto.ordersLoadError).not.toBeNull();
    const leiturasAntes = estado.leituras;

    renovacaoVoltou();
    estado.linhas = [linha("ped-1"), linha("ped-2")];
    await act(async () => {
      avisar("TOKEN_REFRESHED", "cliente-1");
      await deixarAndar();
      await deixarAndar();
    });

    expect(estado.leituras).toBe(leiturasAntes + 1);
    expect(exposto.orders.map((p) => p.id)).toEqual(["ped-1", "ped-2"]);
    expect(exposto.ordersLoadError).toBeNull();
    expect(JSON.parse(localStorage.getItem(CACHE)!)).toHaveLength(2);

    // Uma releitura só: o aviso seguinte não relê de novo (sem laço).
    await act(async () => {
      avisar("TOKEN_REFRESHED", "cliente-1");
      await deixarAndar();
      await deixarAndar();
    });
    expect(estado.leituras).toBe(leiturasAntes + 1);
  });

  it("SIGNED_IN da mesma conta também relê; aviso de OUTRA conta não relê", async () => {
    await montar();
    renovacaoFalhando();
    await act(async () => {
      await exposto.fetchUserOrders!(true);
    });
    const leiturasAntes = estado.leituras;

    await act(async () => {
      avisar("TOKEN_REFRESHED", "outra-conta");
      avisar("SIGNED_IN", "outra-conta");
      await deixarAndar();
    });
    expect(estado.leituras).toBe(leiturasAntes);

    renovacaoVoltou();
    estado.linhas = [linha("ped-1")];
    await act(async () => {
      avisar("SIGNED_IN", "cliente-1");
      await deixarAndar();
      await deixarAndar();
    });
    expect(exposto.orders.map((p) => p.id)).toEqual(["ped-1"]);
  });

  it("leitura que deu certo não fica ouvindo a sessão (nada de releitura extra)", async () => {
    estado.linhas = [linha("ped-1")];
    await montar();
    await act(async () => {
      await exposto.fetchUserOrders!(true);
    });
    const leiturasAntes = estado.leituras;
    await act(async () => {
      avisar("TOKEN_REFRESHED", "cliente-1");
      avisar("SIGNED_IN", "cliente-1");
      await deixarAndar();
    });
    expect(estado.leituras).toBe(leiturasAntes);
  });

  it("lista vazia COM a sessão da dona é a verdade: a conta não tem pedido", async () => {
    await montar();
    await act(async () => {
      await exposto.fetchUserOrders!(true);
    });
    expect(exposto.orders).toEqual([]);
    expect(exposto.ordersLoadError).toBeNull();
    expect(localStorage.getItem(CACHE)).toBe("[]");
  });

  it("SIGNED_OUT de verdade (a conta sai do contexto): a lista é limpa como antes", async () => {
    localStorage.setItem(CACHE, JSON.stringify([pedido("ped-1")]));
    await montar();
    expect(exposto.orders).toHaveLength(1);

    estado.sessaoDe = null;
    estado.erroDaSessao = null;
    conta.id = null;
    await act(async () => {
      avisar("SIGNED_OUT", null);
      raiz.render(<Alvo />);
      await deixarAndar();
    });

    expect(exposto.orders).toEqual([]);
  });
});
