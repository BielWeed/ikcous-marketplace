// @vitest-environment jsdom
//
// Painel do lojista com uma BUSCA na tela: o rastreio (e o cupom) são campos
// que a busca do servidor olha e que mudam DEPOIS de o pedido existir. Sem
// reler, a lista ficava velha em dois sentidos: a busca por um rastreio que
// ainda não existia continuava vazia depois de a lojista gravá-lo em outro
// aparelho, e a busca pelo rastreio antigo continuava mostrando o pedido
// depois que o rastreio mudou.
//
// Harness no molde de pedidos-pago-em-tempo-real-aparece-com-filtro-todos.
import { useOrders } from "@/hooks/useOrders";
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
  useAuth: () => ({ user: { id: "admin-busca-rastreio" }, isAdmin: true }),
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

interface Linha {
  id: string;
  payment_status: string;
  status: string;
  customer_name: string;
  created_at: string;
  updated_at: string;
  items: never[];
  tracking_code?: string | null;
  coupon_code?: string | null;
}

function linha(id: string, extra: Partial<Linha> = {}): Linha {
  return {
    id,
    payment_status: "pago",
    status: "processing",
    customer_name: "Cliente Teste",
    created_at: "2026-10-16T10:00:00Z",
    updated_at: "2026-10-16T11:00:00Z",
    items: [],
    ...extra,
  };
}

let atuais: ReturnType<typeof useOrders>;
let linhas: Linha[];
function Sonda() {
  const retorno = useOrders(true, true);
  useEffect(() => {
    atuais = retorno;
  });
  return null;
}

// O `old` do UPDATE real chega só com a chave primária (RLS ligada).
async function emitir(nova: Linha, anterior: Partial<Linha> = { id: nova.id }) {
  expect(evento).toBeDefined();
  await act(async () => {
    await evento!({ eventType: "UPDATE", new: nova, old: anterior });
  });
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("Pedidos do painel — a busca acompanha o rastreio que muda", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    evento = undefined;
    linhas = [];
    rpc.mockReset();
    rpc.mockImplementation((nome: string) => {
      if (nome !== "get_admin_orders_paged") {
        throw new Error(`RPC inesperada: ${nome}`);
      }
      return {
        abortSignal: () =>
          Promise.resolve({
            data: { data: linhas, total_count: linhas.length },
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
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
      // Libera o canal compartilhado antes do próximo teste.
      await vi.advanceTimersByTimeAsync(4001);
    });
    host.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function carregar(busca: string, status = "all") {
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await atuais.loadOrders(0, 12, status, busca);
    });
    rpc.mockClear();
  }

  it("busca por rastreio que ainda não existia: o pedido aparece quando outro aparelho grava o código", async () => {
    await carregar("BR123");
    expect(atuais.orders).toHaveLength(0);
    expect(atuais.totalOrders).toBe(0);
    const gravado = linha("pedido-a", { tracking_code: "BR123456789" });
    linhas = [gravado];
    await emitir(gravado);
    await avancar(399);
    expect(rpc).not.toHaveBeenCalled();
    await avancar(1);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "get_admin_orders_paged",
      expect.objectContaining({ p_search: "BR123", p_status: "all" }),
    );
    expect(atuais.orders.map((pedido) => pedido.id)).toEqual(["pedido-a"]);
    expect(atuais.totalOrders).toBe(1);
    // O eco do mesmo UPDATE (outra aba, reconexão) não cria laço de leituras.
    await emitir(gravado);
    await avancar(2000);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("a busca pelo rastreio antigo larga o pedido depois que o rastreio muda", async () => {
    linhas = [linha("pedido-a", { tracking_code: "ANTIGO99" })];
    await carregar("antigo99");
    expect(atuais.orders.map((pedido) => pedido.id)).toEqual(["pedido-a"]);
    const trocado = linha("pedido-a", { tracking_code: "NOVO11" });
    linhas = [];
    await emitir(trocado);
    await avancar(400);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "get_admin_orders_paged",
      expect.objectContaining({ p_search: "antigo99" }),
    );
    expect(atuais.orders).toHaveLength(0);
    expect(atuais.totalOrders).toBe(0);
  });

  it("o cupom também é campo da busca: cupom gravado depois faz o pedido entrar", async () => {
    await carregar("VOLTA10");
    const comCupom = linha("pedido-a", { coupon_code: "volta10" });
    linhas = [comCupom];
    await emitir(comCupom);
    await avancar(400);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(atuais.orders.map((pedido) => pedido.id)).toEqual(["pedido-a"]);
  });

  it("rajada de gravações de rastreio paga uma leitura só", async () => {
    await carregar("BR1");
    const um = linha("p1", { tracking_code: "BR1AAA" });
    const dois = linha("p2", { tracking_code: "BR1BBB" });
    linhas = [um, dois];
    await emitir(um);
    await avancar(200);
    await emitir(dois);
    await avancar(399);
    expect(rpc).not.toHaveBeenCalled();
    await avancar(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(atuais.orders).toHaveLength(2);
  });

  describe("o que NÃO relê", () => {
    it("sem busca na tela, gravar rastreio não relê nada", async () => {
      await carregar("");
      await emitir(linha("p1", { tracking_code: "BR123" }));
      await avancar(2000);
      expect(rpc).not.toHaveBeenCalled();
    });

    it("rastreio que não casa com a busca e o pedido fora da lista: nada a reavaliar", async () => {
      await carregar("BR123");
      await emitir(linha("p1", { tracking_code: "XX999" }));
      await emitir(linha("p2", { tracking_code: null }));
      await avancar(2000);
      expect(rpc).not.toHaveBeenCalled();
    });

    it("pedido da lista muda de status sem mexer no rastreio: não relê", async () => {
      linhas = [linha("p1", { tracking_code: "BR123" })];
      await carregar("BR123");
      await emitir(linha("p1", { tracking_code: "BR123", status: "shipping" }));
      await avancar(2000);
      expect(rpc).not.toHaveBeenCalled();
    });

    it("busca por nome, rastreio muda sem casar com ela: não relê", async () => {
      linhas = [linha("p1", { tracking_code: "AAA1" })];
      await carregar("Cliente Teste");
      await emitir(linha("p1", { tracking_code: "BBB2" }));
      await avancar(2000);
      expect(rpc).not.toHaveBeenCalled();
    });

    it("pedido de outro status do filtro da tela não puxa leitura", async () => {
      await carregar("BR123", "cancelled");
      await emitir(
        linha("p1", { tracking_code: "BR123", status: "processing" }),
      );
      await avancar(2000);
      expect(rpc).not.toHaveBeenCalled();
    });
  });

  it("o `old` com o campo vale mais que a memória: rastreio igual antes e depois não relê", async () => {
    await carregar("BR123");
    const igual = linha("p1", { tracking_code: "BR123" });
    await emitir(igual, { id: "p1", tracking_code: "BR123" });
    await avancar(2000);
    expect(rpc).not.toHaveBeenCalled();
  });
});
