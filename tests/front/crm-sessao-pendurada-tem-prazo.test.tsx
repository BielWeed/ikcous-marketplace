// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  chamadas: [] as string[],
  // Nomes das RPCs que ficam penduradas (nunca respondem).
  penduradas: new Set<string>(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn((nome: string) => {
      h.chamadas.push(nome);
      if (h.penduradas.has(nome)) return new Promise(() => undefined);
      return Promise.resolve({ data: null, error: null });
    }),
    channel: vi.fn(() => {
      const canal: Record<string, unknown> = {
        on: () => canal,
        subscribe: () => canal,
      };
      return canal;
    }),
    removeChannel: vi.fn(),
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { access_token: "t" } } }),
      refreshSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "adm-1" } }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getById: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const quantas = (nome: string) => h.chamadas.filter((n) => n === nome).length;

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("CRM — sessão pendurada tem prazo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-10-15T15:00:00Z"));
    h.chamadas = [];
    h.penduradas = new Set();
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage: ((event: MessageEvent) => void) | null = null;
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("as duas verificações de sessão têm prazo e liberam nova leitura", async () => {
    const { supabase } = await import("@/lib/supabase");
    vi.mocked(supabase.auth.getSession)
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockImplementationOnce(() => new Promise(() => undefined));
    const { clearAnalyticsCache } = await import("@/hooks/useAnalytics");
    clearAnalyticsCache();
    const { useDashboardClassico } = await import("@/hooks/useCrm");
    let ultimo!: ReturnType<typeof useDashboardClassico>;
    function Sonda() {
      const lido = useDashboardClassico(true);
      useEffect(() => {
        ultimo = lido;
      });
      return null;
    }
    await act(async () => raiz.render(<Sonda />));

    await passar(1000);
    expect(quantas("get_admin_analytics_v2")).toBe(0);
    expect(quantas("get_category_analytics")).toBe(0);
    expect(ultimo.carregando).toBe(true);

    await passar(20_000); // o prazo estoura

    expect(ultimo.carregando).toBe(false);
    expect(ultimo.erro).toContain("carregar o resumo do painel");
    expect(ultimo.erroDeCategoria).toContain("carregar os dados de categorias");

    await passar(15_000);
    await act(async () => ultimo.carregar(true));
    await passar(1000);
    expect(quantas("get_admin_analytics_v2")).toBeGreaterThan(0);
  });
});
