// @vitest-environment jsdom
//
// Rede que conecta e não responde: `crm_visao`, `get_admin_analytics_v2` e
// `get_category_analytics` esperavam sem prazo. O "carregando" não saía nunca, o
// botão Sincronizar ficava desabilitado e girando e a volta ao app não relia (a
// trava `consultasEmVooRef` ficava em 1). Agora a espera tem prazo de 20 s: estourou,
// vira erro com "Tentar de novo", o botão solta e a próxima leitura sai.
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

function voltarAoApp() {
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("CRM — consulta pendurada tem prazo", () => {
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

  it("lista de clientes pendurada sai do carregando, mostra erro e permite tentar de novo", async () => {
    h.penduradas.add("crm_clientes");
    const { useCrmClientes } = await import("@/hooks/useCrm");
    let ultimo!: ReturnType<typeof useCrmClientes>;
    function Sonda() {
      const lido = useCrmClientes({
        segmento: null,
        busca: "",
        pagina: 0,
        porPagina: 20,
        active: true,
      });
      useEffect(() => {
        ultimo = lido;
      });
      return null;
    }
    await act(async () => raiz.render(<Sonda />));
    await passar(150);
    expect(ultimo.carregando).toBe(true);
    await passar(20_000);
    expect(ultimo.carregando).toBe(false);
    expect(ultimo.erro).toContain("carregar os clientes");
    act(() => ultimo.atualizar());
    await passar(150);
    expect(quantas("crm_clientes")).toBe(2);
    expect(ultimo.carregando).toBe(true);
  });

  it("crm_visao pendurada: depois de 20 s o carregando sai, o erro aparece e a volta ao app lê de novo", async () => {
    h.penduradas.add("crm_visao");
    const { useCrmVisao } = await import("@/hooks/useCrm");
    let ultimo!: ReturnType<typeof useCrmVisao>;
    function Sonda() {
      const lido = useCrmVisao(
        { inicio: "2026-10-01", fim: "2026-10-31" },
        true,
      );
      useEffect(() => {
        ultimo = lido;
      });
      return null;
    }
    await act(async () => raiz.render(<Sonda />));

    await passar(1000); // passou a espera do período: a consulta saiu e pendurou
    expect(quantas("crm_visao")).toBe(1);
    expect(ultimo.carregando).toBe(true);
    expect(ultimo.erro).toBeNull();

    await passar(20_000); // o prazo estoura

    expect(ultimo.carregando).toBe(false);
    expect(ultimo.erro).toContain("carregar o CRM");
    expect(ultimo.visao).toBeNull();

    // A trava de "consulta em voo" foi solta: voltar ao app (30 s depois do
    // último retorno) relê. Antes, ficava em 1 para sempre e nunca relia.
    await passar(15_000);
    act(() => voltarAoApp());
    await passar(1000);
    expect(quantas("crm_visao")).toBe(2);
  });

  it("controle: crm_visao que responde dentro do prazo não vira erro", async () => {
    const { useCrmVisao } = await import("@/hooks/useCrm");
    let ultimo!: ReturnType<typeof useCrmVisao>;
    function Sonda() {
      const lido = useCrmVisao(
        { inicio: "2026-10-01", fim: "2026-10-31" },
        true,
      );
      useEffect(() => {
        ultimo = lido;
      });
      return null;
    }
    await act(async () => raiz.render(<Sonda />));
    await passar(1000);

    expect(quantas("crm_visao")).toBe(1);
    expect(ultimo.carregando).toBe(false);
    // `null` de dado é "formato inesperado" (frase própria), nunca a do prazo.
    expect(ultimo.erro).not.toContain("conexão está lenta");
  });

  it("Visão geral clássica (resumo e categorias penduradas): depois de 20 s o carregando sai, os dois erros aparecem e a volta ao app lê de novo", async () => {
    h.penduradas.add("get_admin_analytics_v2");
    h.penduradas.add("get_category_analytics");
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

    await passar(1000); // a leitura saiu (320 ms) e pendurou
    expect(quantas("get_admin_analytics_v2")).toBe(1);
    expect(quantas("get_category_analytics")).toBe(1);
    expect(ultimo.carregando).toBe(true);

    await passar(20_000); // o prazo estoura

    expect(ultimo.carregando).toBe(false);
    expect(ultimo.erro).toContain("carregar o resumo do painel");
    expect(ultimo.erroDeCategoria).toContain("carregar os dados de categorias");

    // Solta a trava `leiturasEmVooRef`: a volta ao app relê (antes, nunca).
    await passar(15_000);
    act(() => voltarAoApp());
    await passar(1000);
    expect(quantas("get_admin_analytics_v2")).toBeGreaterThan(1);
  });
});
