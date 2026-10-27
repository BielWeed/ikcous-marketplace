// @vitest-environment jsdom
//
// Caça 9, item 5 (correção da revisão): com RLS ligada o `old` do UPDATE do
// Supabase Realtime traz só a chave primária. O `useOrders` completa o "antes"
// (status e pagamento) com o pedido que a tela já tinha, ANTES de mesclar o
// evento, e só então entrega ao painel. Aqui o evento tem o formato REAL
// (`old = { id }`) e o hook é o de verdade.
import { useOrders } from "@/hooks/useOrders";
import { esquecerAcaoPropriaDoPedido } from "@/lib/acao-propria-do-painel";
import { tipoDoAvisoDoPedido } from "@/lib/aviso-de-pedido-atualizado";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
let evento: ((payload: unknown) => Promise<void>) | undefined;
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    channel: () => {
      const canal = {
        on: (_tipo: string, _filtro: unknown, handler: typeof evento) => {
          evento = handler;
          return canal;
        },
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: () => Promise.resolve(),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-aviso-old" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function linha(id: string, payment_status: string, status: string) {
  return {
    id,
    payment_status,
    status,
    customer_name: "Cliente Teste",
    created_at: "2026-10-16T10:00:00Z",
    updated_at: "2026-10-16T11:00:00Z",
    items: [],
  };
}

let recebidos: Array<Record<string, any>>;
let atuais: ReturnType<typeof useOrders>;
function Sonda() {
  const retorno = useOrders(true, true, {
    onRealtimeEvent: (payload) => recebidos.push(payload),
  });
  useEffect(() => {
    atuais = retorno;
  });
  return null;
}

async function emitirComOldSoComId(novo: Record<string, unknown>) {
  expect(evento).toBeDefined();
  await act(async () => {
    await evento!({
      eventType: "UPDATE",
      old: { id: novo.id },
      new: novo,
    });
  });
  return recebidos[recebidos.length - 1];
}

describe("useOrders — completa o 'antes' do UPDATE do realtime (old só com a chave primária)", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(async () => {
    vi.useFakeTimers();
    evento = undefined;
    recebidos = [];
    esquecerAcaoPropriaDoPedido("p1");
    rpc.mockReset();
    rpc.mockImplementation((nome: string) => {
      if (nome !== "get_admin_orders_paged") {
        throw new Error(`RPC inesperada: ${nome}`);
      }
      return {
        abortSignal: () =>
          Promise.resolve({
            data: {
              data: [linha("p1", "aguardando", "pending")],
              total_count: 1,
            },
            error: null,
          }),
      };
    });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => armazem.set(chave, valor),
      removeItem: (chave: string) => armazem.delete(chave),
    });
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await atuais.loadOrders(0, 12, "all", "", undefined, undefined, false);
    });
    expect(atuais.orders.map((p) => p.id)).toEqual(["p1"]);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
      await vi.advanceTimersByTimeAsync(4001);
    });
    host.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("PIX confirmado (aguardando -> pago, mesmo status): o painel recebe o 'antes' e avisa o pagamento", async () => {
    const chegou = await emitirComOldSoComId(linha("p1", "pago", "pending"));
    expect(chegou.old).toMatchObject({
      id: "p1",
      status: "pending",
      payment_status: "aguardando",
    });
    expect(tipoDoAvisoDoPedido(chegou)).toBe("pagamento");
  });

  it("status mudou (pending -> processing): avisa o status", async () => {
    const chegou = await emitirComOldSoComId(
      linha("p1", "aguardando", "processing"),
    );
    expect(tipoDoAvisoDoPedido(chegou)).toBe("status");
  });

  it("segundo evento com o MESMO status (salvou rastreio): não avisa", async () => {
    const primeiro = await emitirComOldSoComId(
      linha("p1", "aguardando", "processing"),
    );
    expect(tipoDoAvisoDoPedido(primeiro)).toBe("status");
    const segundo = await emitirComOldSoComId({
      ...linha("p1", "aguardando", "processing"),
      tracking_code: "BR123",
    });
    expect(segundo.old).toMatchObject({ status: "processing" });
    expect(tipoDoAvisoDoPedido(segundo)).toBeNull();
  });

  it("pedido que a tela não tem (fora da página): chega como veio e o aviso sai como antes", async () => {
    const chegou = await emitirComOldSoComId(
      linha("desconhecido", "pago", "shipping"),
    );
    expect(chegou.old).toEqual({ id: "desconhecido" });
    expect(tipoDoAvisoDoPedido(chegou)).toBe("status");
  });
});
