// @vitest-environment jsdom
//
// SELO DE CONEXÃO EM PALAVRAS DE LOJISTA — painel simples, G7a. O selo do
// cabeçalho do painel (barra lateral e cabeçalho móvel) e o ponto de operação
// falavam em "Latência: 120ms", "Offline", "Lento" e, no celular, "Off/Sync/
// Slow/On" em fonte de 6,5px. Agora: "Sem internet / Lenta / Online /
// Sincronizado", o title diz "Conexão boa" ou "Conexão lenta" (sem milissegundo)
// e o texto do selo tem pelo menos 11px. A medição e o estado da conexão não
// mudam: o teste só troca o que o hook devolve.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Diagnostico = {
  isOffline: boolean;
  quality: "excellent" | "good" | "slow" | "offline";
  latency: number;
};
const diagnostico = vi.hoisted(() => ({
  atual: {
    isOffline: false,
    quality: "excellent",
    latency: 80,
  } as Diagnostico,
}));

vi.mock("@/hooks/useOnlineStatus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useOnlineStatus")>()),
  useConnectionDiagnostics: () => diagnostico.atual,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => {
      const builder: any = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.in = vi.fn(() => builder);
      builder.is = vi.fn(() => builder);
      // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
      builder.then = (resolve: any, reject?: any) =>
        Promise.resolve({ count: 0, error: null }).then(resolve, reject);
      return builder;
    }),
    rpc: vi.fn(() =>
      Promise.resolve({ data: { total_count: 0 }, error: null }),
    ),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    fetchExecutiveSummary: vi.fn(),
    fetchCategoryAnalytics: vi.fn(),
  }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ loadOrders: vi.fn() }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ loadProducts: vi.fn() }),
}));

describe("AdminLayout — selo de conexão em palavras de lojista", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    diagnostico.atual = { isOffline: false, quality: "excellent", latency: 80 };
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function montar() {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-dashboard" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });
  }

  /** O selo é a pílula `cursor-help`: uma na barra lateral, outra no celular. */
  function selos(): HTMLElement[] {
    return Array.from(hospedeiro.querySelectorAll<HTMLElement>(".cursor-help"));
  }

  it("mostra o selo na barra lateral e no cabeçalho do celular", async () => {
    await montar();
    expect(selos()).toHaveLength(2);
  });

  it("conexão boa: 'Online', title 'Conexão boa', sem milissegundo", async () => {
    await montar();
    for (const selo of selos()) {
      expect(selo.textContent?.trim()).toBe("Online");
      expect(selo.getAttribute("title")).toBe("Conexão boa");
    }
  });

  it("conexão 'good' (um pouco mais lenta que a ótima) também é 'Online'", async () => {
    diagnostico.atual = { isOffline: false, quality: "good", latency: 240 };
    await montar();
    for (const selo of selos()) {
      expect(selo.textContent?.trim()).toBe("Online");
      expect(selo.getAttribute("title")).toBe("Conexão boa");
    }
  });

  it("conexão lenta: 'Lenta' e title 'Conexão lenta'", async () => {
    diagnostico.atual = { isOffline: false, quality: "slow", latency: 1800 };
    await montar();
    for (const selo of selos()) {
      expect(selo.textContent?.trim()).toBe("Lenta");
      expect(selo.getAttribute("title")).toBe("Conexão lenta");
    }
  });

  it("sem internet: 'Sem internet' e title 'Sem conexão com o servidor'", async () => {
    diagnostico.atual = { isOffline: true, quality: "offline", latency: 0 };
    await montar();
    for (const selo of selos()) {
      expect(selo.textContent?.trim()).toBe("Sem internet");
      expect(selo.getAttribute("title")).toBe("Sem conexão com o servidor");
    }
  });

  it("nenhuma palavra do selo é jargão: latência, ms, Off, Sync, Slow, Lento", async () => {
    for (const d of [
      { isOffline: false, quality: "excellent", latency: 80 },
      { isOffline: false, quality: "slow", latency: 1800 },
      { isOffline: true, quality: "offline", latency: 0 },
    ] as Diagnostico[]) {
      diagnostico.atual = d;
      await montar();
      for (const selo of selos()) {
        const texto = `${selo.textContent} ${selo.getAttribute("title")}`;
        expect(texto).not.toMatch(
          /lat[eê]ncia|\d\s*ms\b|\bOff\b|\bSync\b|\bSlow\b|\bLento\b|\bOffline\b/i,
        );
      }
    }
  });

  it("o texto do selo tem pelo menos 11px (nada de text-[7px] / [6.5px])", async () => {
    await montar();
    for (const selo of selos()) {
      const texto = selo.querySelector(
        ":scope > span:last-child",
      ) as HTMLElement;
      // Nenhum `text-[Npx]` abaixo de 11 (a régua do painel, spec §7).
      const tamanhos = texto.className
        .split(/\s+/)
        .map((c) => /^text-\[([\d.]+)px\]$/.exec(c)?.[1])
        .filter((n): n is string => n !== undefined)
        .map(Number);
      expect(tamanhos.length).toBeGreaterThan(0);
      expect(Math.min(...tamanhos)).toBeGreaterThanOrEqual(11);
      expect(texto.className).toContain("text-[11px]");
    }
  });

  it("a barra lateral não carrega mais o rótulo 'Navegação Unificada'", async () => {
    await montar();
    expect(hospedeiro.querySelector("aside")?.textContent).not.toContain(
      "Navegação Unificada",
    );
  });
});
