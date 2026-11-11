// @vitest-environment jsdom
// Protege a guarda de dono do INSERT: pedido alheio não entra nem avisa a cliente.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rede = vi.hoisted(() => ({
  porId: new Map<string, unknown>(),
  eventos: new Map<string, (payload: unknown) => Promise<void>>(),
  consultasPorId: vi.fn(),
  user: { id: "cliente-1" },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
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
            rede.consultasPorId(idAlvo);
            return Promise.resolve({
              data: rede.porId.get(idAlvo) ?? null,
              error: null,
            }).then(resolve);
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
          filtro: { filter?: string },
          handler: (payload: unknown) => Promise<void>,
        ) => {
          rede.eventos.set(filtro.filter ?? "", handler);
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
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: rede.user, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { useOrders } from "@/hooks/useOrders";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const linha = (id: string, userId: string) => ({
  id,
  user_id: userId,
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
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
});

describe("useOrders — INSERT só mostra pedido da própria cliente", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: ReturnType<typeof useOrders>;

  function Sonda() {
    const retorno = useOrders(true, false);
    useEffect(() => {
      atual = retorno;
    });
    return null;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    rede.porId.clear();
    rede.eventos.clear();
    localStorage.clear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => raiz.render(<Sonda />));
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  async function entregar(id: string) {
    const handler = rede.eventos.get("user_id=eq.cliente-1");
    expect(handler).toBeDefined();
    await act(async () => {
      await handler!({ eventType: "INSERT", new: { id }, old: {} });
    });
    expect(rede.consultasPorId).toHaveBeenCalledWith(id);
  }

  it("descarta o pedido de outra conta sem toast; o pedido próprio entra e avisa", async () => {
    expect(atual.orders).toEqual([]);
    rede.porId.set("ped-alheio", linha("ped-alheio", "outra-cliente"));
    await entregar("ped-alheio");

    expect(atual.orders.map((pedido) => pedido.id)).not.toContain("ped-alheio");
    expect(toast.info).not.toHaveBeenCalled();

    // Controle: o mesmo caminho precisa aceitar e avisar o pedido da dona.
    rede.porId.set("ped-proprio", linha("ped-proprio", "cliente-1"));
    await entregar("ped-proprio");

    expect(atual.orders.map((pedido) => pedido.id)).toEqual(["ped-proprio"]);
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(expect.any(String), {
      id: "pedido-novo-ped-proprio",
    });
  });
});
