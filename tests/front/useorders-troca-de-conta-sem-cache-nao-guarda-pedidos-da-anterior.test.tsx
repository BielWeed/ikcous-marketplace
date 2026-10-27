// @vitest-environment jsdom
//
// Dado de cliente: trocar de conta SEM "Sair" no meio (a sessão da A venceu e a
// B entrou no mesmo aparelho) deixava a lista de pedidos da A na memória da
// tela quando a B não tinha cache próprio: o efeito que troca a lista só
// escrevia quando a conta nova TINHA cache. Agora a lista da conta anterior
// sai, e a da B (se houver cache) entra. A MESMA conta reemitindo evento não
// zera nada.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Pendente = {
  resolve: (corpo: unknown) => void;
  reject: (erro: unknown) => void;
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
        new Promise((resolve, reject) => {
          pendentes.fila.push({ resolve, reject });
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

const linhaDeB = { ...linhaDeA, id: "ped-de-B", user_id: "cliente-B" };

describe("useOrders — troca de conta sem Sair não guarda os pedidos da anterior", () => {
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

  async function irPara(id: string) {
    conta.id = id;
    await act(async () => {
      raiz.render(<Alvo />);
    });
  }

  beforeEach(() => {
    pendentes.fila.length = 0;
    pendentes.sinais.length = 0;
    conta.id = "cliente-A";
    conta.usuarios.clear();
    toasts.erro.mockClear();
    toasts.info.mockClear();
    exposto.fetchUserOrders = null;
    exposto.ordersLoadError = undefined;
    exposto.orders = [];
    localStorage.clear();
    // A tem pedidos guardados no aparelho: a tela de A nasce com eles.
    localStorage.setItem(
      "ikcous_orders_cache_cliente-A",
      JSON.stringify([linhaDeA]),
    );
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

  it("controle: a tela de A nasce com os pedidos guardados de A", async () => {
    await montarComoA();
    expect(exposto.orders.map((o) => o.id)).toEqual(["ped-de-A"]);
  });

  it("A -> B, B sem cache: a lista de A SAI da memória (não aparece para B)", async () => {
    await montarComoA();
    expect(exposto.orders.map((o) => o.id)).toEqual(["ped-de-A"]);

    await irPara("cliente-B");

    expect(exposto.orders).toEqual([]);
  });

  it("A -> B, B COM cache: entra a lista de B (e nada de A)", async () => {
    localStorage.setItem(
      "ikcous_orders_cache_cliente-B",
      JSON.stringify([linhaDeB]),
    );
    await montarComoA();

    await irPara("cliente-B");

    expect(exposto.orders.map((o) => o.id)).toEqual(["ped-de-B"]);
  });

  it("A -> B -> A: a lista de B não fica para A (B sem cache zera; A volta ao próprio cache)", async () => {
    await montarComoA();
    await irPara("cliente-B");
    expect(exposto.orders).toEqual([]);

    await irPara("cliente-A");

    expect(exposto.orders.map((o) => o.id)).toEqual(["ped-de-A"]);
  });

  it("limite: a MESMA conta re-renderizando (token renovado) não zera a lista", async () => {
    await montarComoA();
    expect(exposto.orders.map((o) => o.id)).toEqual(["ped-de-A"]);

    await irPara("cliente-A");
    await irPara("cliente-A");

    expect(exposto.orders.map((o) => o.id)).toEqual(["ped-de-A"]);
  });
});
