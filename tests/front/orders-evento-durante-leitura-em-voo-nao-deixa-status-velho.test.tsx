// @vitest-environment jsdom
// Página 2 em voo: o cancelamento de um pedido que não estava na página 1
// precisa invalidar o retrato antigo, mesmo sem encontrar o pedido na memória.
import type { useOrders } from "@/hooks/useOrders";
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
  useAuth: () => ({ user: { id: "admin-leitura-em-voo" }, isAdmin: true }),
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

function linha(
  id: string,
  status = "pending",
  updated_at = "2026-11-10T10:00:00Z",
) {
  return {
    id,
    status,
    updated_at,
    customer_name: "Cliente Teste",
    created_at: "2026-11-10T09:00:00Z",
    payment_status: "aguardando",
    items: [],
  };
}

type Linha = ReturnType<typeof linha>;
type Resposta = {
  data: { data: Linha[]; total_count: number };
  error: null;
};
let atuais: ReturnType<typeof useOrders>;
let linhas: Linha[];
let total: number;
let proximaLeitura: Promise<Resposta> | null;

function consultasDaLista() {
  return rpc.mock.calls.filter(([nome]) => nome === "get_admin_orders_paged");
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function atualizar(id: string, status = "cancelled") {
  expect(evento).toBeDefined();
  await act(async () => {
    await evento!({
      eventType: "UPDATE",
      new: linha(id, status, "2026-11-10T10:01:00Z"),
      // No realtime com RLS, a imagem anterior pode conter só a chave.
      old: { id },
    });
  });
}

async function iniciarSegundaPagina() {
  let entregar!: (resposta: Resposta) => void;
  proximaLeitura = new Promise<Resposta>((resolve) => {
    entregar = resolve;
  });
  // O retrato é capturado ANTES do evento; só a entrega fica atrasada.
  const retrato = { data: { data: linhas, total_count: total }, error: null };
  let leitura!: Promise<unknown>;
  await act(async () => {
    leitura = atuais.loadOrders(1, 12, "pending");
  });
  expect(consultasDaLista()).toHaveLength(1);
  expect(consultasDaLista()[0]?.[1]).toMatchObject({
    p_page: 1,
    p_status: "pending",
  });
  expect(atuais.loading).toBe(true);
  expect(atuais.orders.some((pedido) => pedido.id === "x")).toBe(false);
  return async () => {
    await act(async () => {
      entregar(retrato);
      await leitura;
    });
  };
}

describe("Pedidos — UPDATE durante a leitura de outra página", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    evento = undefined;
    proximaLeitura = null;
    linhas = Array.from({ length: 12 }, (_, i) => linha(`pagina-1-${i}`));
    total = 14;
    rpc.mockReset();
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_admin_orders_cancelados_recentes") {
        return {
          abortSignal: () =>
            Promise.resolve({
              data: { data: [], total_count: 0, fora_da_janela: 0 },
              error: null,
            }),
        };
      }
      if (nome !== "get_admin_orders_paged") {
        throw new Error(`RPC inesperada: ${nome}`);
      }
      const resposta =
        proximaLeitura ??
        Promise.resolve({
          data: { data: linhas, total_count: total },
          error: null,
        });
      proximaLeitura = null;
      return { abortSignal: () => resposta };
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
    const { useOrders: usarPedidos } = await import("@/hooks/useOrders");
    function Sonda() {
      const retorno = usarPedidos(true, true);
      useEffect(() => {
        atuais = retorno;
      });
      return null;
    }
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await atuais.loadOrders(0, 12, "pending");
    });
    expect(atuais.orders).toHaveLength(12);
    linhas = [linha("x"), linha("fica")];
    rpc.mockClear();
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

  it.each([0, 800])(
    "não deixa X pendente após cancelamento no voo (resposta demora mais %i ms)",
    async (atraso) => {
      const entregar = await iniciarSegundaPagina();
      await atualizar("x");
      linhas = [linha("fica")];
      total = 13;
      // Mesmo se a resposta demorar mais que o debounce, a correção não
      // pode ser sobrescrita depois pelo retrato que ainda está em voo.
      await avancar(atraso);
      await entregar();
      await avancar(400);
      expect(atuais.orders.map((pedido) => pedido.id)).toEqual(["fica"]);
      expect(atuais.totalOrders).toBe(13);
      expect(consultasDaLista()).toHaveLength(2);
      expect(consultasDaLista()[1]?.[1]).toMatchObject({
        p_page: 1,
        p_page_size: 12,
        p_status: "pending",
      });
      await avancar(2000);
      expect(consultasDaLista()).toHaveLength(2);
    },
  );

  it("sem evento, aplica a resposta da página 2 sem recarga extra", async () => {
    const entregar = await iniciarSegundaPagina();
    await entregar();
    await avancar(2000);
    expect(atuais.orders.map((pedido) => pedido.id)).toEqual(["x", "fica"]);
    expect(atuais.totalOrders).toBe(14);
    expect(consultasDaLista()).toHaveLength(1);
  });

  it("UPDATE de quem está na memória e continua pendente não provoca recarga extra", async () => {
    const entregar = await iniciarSegundaPagina();
    await atualizar("pagina-1-0", "pending");
    await entregar();
    await avancar(2000);
    expect(atuais.orders.map((pedido) => pedido.id)).toEqual(["x", "fica"]);
    expect(consultasDaLista()).toHaveLength(1);
  });

  it("uma rajada de cancelamentos durante o voo paga uma única recarga silenciosa", async () => {
    linhas = [linha("x"), linha("z"), linha("fica")];
    total = 15;
    const entregar = await iniciarSegundaPagina();
    await atualizar("x");
    await avancar(100);
    await atualizar("z");
    await atualizar("x");
    linhas = [linha("fica")];
    total = 13;
    await entregar();
    await avancar(399);
    expect(consultasDaLista()).toHaveLength(1);
    // A recarga é silenciosa, não apaga a lista ligando loading de novo.
    expect(atuais.loading).toBe(false);
    await avancar(1);
    expect(atuais.orders.map((pedido) => pedido.id)).toEqual(["fica"]);
    expect(atuais.loading).toBe(false);
    expect(consultasDaLista()).toHaveLength(2);
    await avancar(2000);
    expect(consultasDaLista()).toHaveLength(2);
  });

  it("sem leitura em voo, cancelamento de pedido ausente da página agenda UMA recarga e a lista visível não muda", async () => {
    // Ele estava em outra página do filtro "pending": ao sair, o total
    // anunciado (14) fica 1 acima até a recarga.
    total = 13;
    linhas = Array.from({ length: 12 }, (_, i) => linha(`pagina-1-${i}`));
    await atualizar("x");
    expect(atuais.orders.map((pedido) => pedido.id)).toEqual(
      Array.from({ length: 12 }, (_, i) => `pagina-1-${i}`),
    );
    await avancar(399);
    expect(consultasDaLista()).toHaveLength(0);
    await avancar(1);
    expect(consultasDaLista()).toHaveLength(1);
    expect(consultasDaLista()[0]?.[1]).toMatchObject({
      p_page: 0,
      p_page_size: 12,
      p_status: "pending",
    });
    expect(atuais.totalOrders).toBe(13);
    await avancar(2000);
    expect(consultasDaLista()).toHaveLength(1);
  });
});
