// @vitest-environment jsdom
//
// Dado de cliente: a resposta atrasada da conta A não pode pousar na conta B.
//
// `fetchUserOrders` só era cancelada quando entrava uma leitura nova ou o
// componente saía da tela — NÃO quando a conta mudava. Com a leitura da conta
// A ainda no ar, o logout + login de B (mesmo aparelho, mesma instância do
// hook) deixava a resposta tardia de A gravar a LISTA de pedidos de A na tela
// de B (o cache é por id, mas a tela é o que vaza) e, agora, também o ERRO
// de A.
//
// A correção tem duas camadas, e este arquivo prende as duas pelo resultado:
//   - o hook cancela a leitura em andamento quando o id do usuário muda;
//   - e, como cancelar é pedido ao transporte (não garantia), a resposta
//     cujo usuário capturado ao iniciar ≠ usuário atual é DESCARTADA. O
//     dublê abaixo ignora o `abortSignal` de propósito: é ele que prova a
//     segunda camada.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Pendente = {
  resolve: (corpo: unknown) => void;
};

const pendentes = vi.hoisted(() => ({
  fila: [] as Array<Pendente>,
  sinais: [] as Array<AbortSignal>,
}));
const conta = vi.hoisted(() => ({
  id: "cliente-A",
  usuarios: new Map<string, { id: string }>(),
}));
const toasts = vi.hoisted(() => ({ erro: vi.fn(), info: vi.fn() }));
const exposto = vi.hoisted(() => ({
  fetchUserOrders: null as null | ((silent?: boolean) => Promise<unknown>),
  ordersLoadError: undefined as unknown,
  orders: [] as Array<{ id: string }>,
}));

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
      // Só REGISTRA o sinal, não o obedece: cancelar é PEDIDO ao transporte, e
      // a guarda de usuário não pode depender de ele ser atendido.
      abortSignal: (sinal: AbortSignal) => {
        pendentes.sinais.push(sinal);
        return alvo;
      },
      single: () => alvo,
      maybeSingle: () => alvo,
    };
    // biome-ignore lint/suspicious/noThenProperty: mock de consulta precisa ser awaitable
    Object.defineProperty(alvo, "then", {
      value: (res: (v: unknown) => unknown, rej: (r: unknown) => unknown) =>
        new Promise((resolve) => {
          pendentes.fila.push({ resolve });
        }).then(res, rej),
    });
    return alvo;
  };
  const canal = () => {
    const alvo: Record<string, unknown> = {
      on: () => alvo,
      subscribe: (cb?: (status: string) => void) => {
        cb?.("SUBSCRIBED");
        return alvo;
      },
    };
    return alvo;
  };
  return {
    supabase: {
      from: () => builder(),
      rpc: () => builder(),
      channel: () => canal(),
      removeChannel: () => {},
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => {
    let user = conta.usuarios.get(conta.id);
    if (!user) {
      user = { id: conta.id };
      conta.usuarios.set(conta.id, user);
    }
    return { user, isAdmin: false };
  },
}));

vi.mock("sonner", () => ({
  toast: { error: toasts.erro, info: toasts.info, success: vi.fn() },
}));

import { useOrders } from "@/hooks/useOrders";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const linhaDeA = {
  id: "ped-de-A",
  user_id: "cliente-A",
  customer_name: "Cliente A",
  customer_data: {},
  items: [],
  total: 10,
  subtotal: 10,
  shipping: 0,
  discount: 0,
  payment_method: "pix",
  payment_status: "aguardando",
  status: "pending",
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

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

describe("useOrders — leitura da conta A em voo não pousa na conta B", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function montarComoA() {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Alvo />);
    });
  }

  async function trocarParaB() {
    conta.id = "cliente-B";
    await act(async () => {
      raiz.render(<Alvo />);
    });
  }

  beforeEach(() => {
    pendentes.fila.length = 0;
    pendentes.sinais.length = 0;
    conta.id = "cliente-A";
    toasts.erro.mockClear();
    toasts.info.mockClear();
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

  it("controle: sem troca de conta, a resposta de A entra na lista de A", async () => {
    await montarComoA();

    let leitura!: Promise<unknown>;
    await act(async () => {
      leitura = exposto.fetchUserOrders!();
    });
    expect(pendentes.fila).toHaveLength(1);
    await act(async () => {
      pendentes.fila[0].resolve({ data: [linhaDeA], error: null });
      await leitura;
    });

    expect(exposto.orders.map((o) => o.id)).toEqual(["ped-de-A"]);
  });

  it("a troca de conta CANCELA a leitura em andamento (primeira camada)", async () => {
    await montarComoA();
    await act(async () => {
      void exposto.fetchUserOrders!();
    });
    expect(pendentes.sinais).toHaveLength(1);
    expect(pendentes.sinais[0].aborted).toBe(false);

    await trocarParaB();

    expect(pendentes.sinais[0].aborted).toBe(true);
  });

  it("A em voo, troca para B, A responde com pedidos: a lista de B NÃO tem pedido de A", async () => {
    await montarComoA();

    let leitura!: Promise<unknown>;
    await act(async () => {
      leitura = exposto.fetchUserOrders!();
    });
    await trocarParaB();

    await act(async () => {
      pendentes.fila[0].resolve({ data: [linhaDeA], error: null });
      await leitura;
    });

    expect(exposto.orders.map((o) => o.id)).not.toContain("ped-de-A");
    expect(exposto.orders).toEqual([]);
    // Nem o cache de B nem o de A foram tocados pela resposta tardia.
    expect(localStorage.getItem("ikcous_orders_cache_cliente-B")).toBeNull();
    expect(localStorage.getItem("ikcous_orders_cache_cliente-A")).toBeNull();
  });

  it("A em voo, troca para B, A FALHA: o erro (e o toast) de A não aparecem para B", async () => {
    await montarComoA();

    let leitura!: Promise<unknown>;
    await act(async () => {
      leitura = exposto.fetchUserOrders!();
    });
    await trocarParaB();

    await act(async () => {
      pendentes.fila[0].resolve({
        data: null,
        error: { message: "Failed to fetch" },
      });
      await leitura;
    });

    expect(exposto.ordersLoadError).toBeNull();
    expect(toasts.erro).not.toHaveBeenCalled();
  });
});
