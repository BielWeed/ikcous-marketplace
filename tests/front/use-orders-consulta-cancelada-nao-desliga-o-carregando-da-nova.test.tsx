// @vitest-environment jsdom
//
// Painel do lojista, busca digitada duas vezes seguidas com rede lenta: a 2ª
// chamada de `loadOrders` cancela a 1ª e liga o "carregando". A 1ª termina
// DEPOIS (AbortError) e o `finally` dela desligava o carregando que a 2ª
// acabou de ligar -> a barra "Sincronizando" sumia e a lista do filtro antigo
// aparecia como se fosse o resultado novo. Só a consulta mais nova pode
// desligar o carregando.
//
// Harness no molde de use-orders-total-do-painel-conta-o-insert-que-chegou-no-voo.test.tsx.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    rpc,
    from: () => ({}),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
      subscribe: () => ({}),
      unsubscribe: () => {},
    }),
    removeChannel: () => {},
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Visto {
  loading: boolean;
  carregar: (
    page?: number,
    pageSize?: number,
    status?: string,
    busca?: string,
    inicio?: string,
    fim?: string,
    silenciosa?: boolean,
  ) => Promise<{ orders: { id: string }[]; total: number }>;
}
let visto: Visto;
let host: HTMLDivElement;
let raiz: Root;

async function montar() {
  const { useOrders } = await import("@/hooks/useOrders");
  function Sonda() {
    const { loadOrders, loading } = useOrders(true, true);
    useEffect(() => {
      visto = { loading, carregar: loadOrders as Visto["carregar"] };
    });
    return null;
  }
  await act(async () => {
    raiz.render(<Sonda />);
  });
}

/** Consulta que só termina quando o teste mandar (ok ou cancelada). */
function consultaEmVoo() {
  let entregar!: (ids: string[], total: number) => void;
  let cancelar!: () => void;
  const promessa = new Promise((resolve, reject) => {
    entregar = (ids, total) =>
      resolve({
        data: {
          data: ids.map((id) => ({
            id,
            status: "pending",
            customer_name: "Cliente Teste",
            created_at: new Date(0).toISOString(),
            updated_at: new Date(0).toISOString(),
          })),
          total_count: total,
        },
        error: null,
      });
    cancelar = () =>
      reject(
        Object.assign(new Error("Fetch is aborted"), { name: "AbortError" }),
      );
  });
  rpc.mockImplementationOnce(() => ({ abortSignal: () => promessa }));
  return { entregar, cancelar };
}

beforeEach(() => {
  vi.resetModules();
  const armazem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => armazem.get(k) ?? null,
    setItem: (k: string, v: string) => void armazem.set(k, v),
    removeItem: (k: string) => void armazem.delete(k),
  });
  rpc.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(async () => {
  await act(async () => {
    raiz.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
});

describe("loadOrders do painel — consulta cancelada não desliga o carregando da nova", () => {
  it("a 1ª termina cancelada depois da 2ª ligar o carregando: continua carregando até a 2ª terminar", async () => {
    await montar();
    const primeira = consultaEmVoo();
    const segunda = consultaEmVoo();

    let promessa1!: Promise<unknown>;
    let promessa2!: Promise<unknown>;
    await act(async () => {
      promessa1 = visto.carregar(0, 12, "all", "mar");
    });
    expect(visto.loading).toBe(true);
    await act(async () => {
      promessa2 = visto.carregar(0, 12, "all", "maria");
    });

    // A 1ª foi cancelada pela 2ª e só agora termina.
    await act(async () => {
      primeira.cancelar();
      await promessa1;
    });
    expect(visto.loading).toBe(true);

    await act(async () => {
      segunda.entregar(["a"], 1);
      await promessa2;
    });
    expect(visto.loading).toBe(false);
  });

  it("consulta silenciosa que cancela uma comum assume o fim do carregando (não fica preso em true)", async () => {
    await montar();
    const primeira = consultaEmVoo();
    const segunda = consultaEmVoo();

    let promessa1!: Promise<unknown>;
    let promessa2!: Promise<unknown>;
    await act(async () => {
      promessa1 = visto.carregar(0, 12, "all", "mar");
    });
    expect(visto.loading).toBe(true);
    await act(async () => {
      promessa2 = visto.carregar(0, 12, "all", "mar", "", "", true);
    });
    await act(async () => {
      primeira.cancelar();
      await promessa1;
    });
    await act(async () => {
      segunda.entregar(["a"], 1);
      await promessa2;
    });
    expect(visto.loading).toBe(false);
  });

  it("controle: consulta única que termina desliga o carregando", async () => {
    await montar();
    const unica = consultaEmVoo();
    let promessa!: Promise<unknown>;
    await act(async () => {
      promessa = visto.carregar(0, 12, "all");
    });
    expect(visto.loading).toBe(true);
    await act(async () => {
      unica.entregar(["a"], 1);
      await promessa;
    });
    expect(visto.loading).toBe(false);
  });
});
