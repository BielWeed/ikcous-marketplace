// @vitest-environment jsdom
//
// Painel simples (C9): cada função tem UMA porta. "Avisar clientes" mora em
// Clientes (AtalhosDaAba); a barra lateral do computador não tem mais um
// segundo botão para a mesma tela. Os subcabeçalhos de Banners e Vitrines
// dizem o nome único da tela (`NOMES_DO_PAINEL`), não "Gerenciador de
// Banners" / "Vitrines & Carrosséis". "Notificações" continua: é o sino, que
// é outra função (receber, não enviar).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Duble do query builder de contagem do Supabase (`head: true`). */
function criarContagemBuilder() {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.or = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase — mesmo padrão de sino-do-painel-leva-as-notificacoes.
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve({ count: 0, error: null }).then(resolve, reject);
  return builder;
}

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => criarContagemBuilder()),
    rpc: vi.fn(() =>
      Promise.resolve({
        data: { total_count: 0, total: 0, itens: [], contagem: {} },
        error: null,
      }),
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

describe("AdminLayout — uma porta por função", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
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

  async function montar(currentView: string) {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView={currentView as never} onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });
  }

  /** Subcabeçalho acoplado ao cabeçalho (Banners / Vitrines). */
  function subcabecalho(): string | null {
    return hospedeiro.querySelector("header h1.truncate")?.textContent ?? null;
  }

  it("a barra lateral não tem botão 'Avisar clientes'", async () => {
    await montar("admin-dashboard");

    const botoes = Array.from(hospedeiro.querySelectorAll("button"));
    const avisar = botoes.filter(
      (b) =>
        b.getAttribute("aria-label") === "Avisar clientes" ||
        b.textContent?.trim() === "Avisar clientes",
    );
    expect(avisar).toHaveLength(0);
    expect(hospedeiro.querySelector("aside")).toBeTruthy();
    expect(hospedeiro.querySelector("aside")?.textContent).not.toContain(
      "Avisar clientes",
    );
  });

  it("'Notificações' continua na barra lateral e no sino do cabeçalho", async () => {
    await montar("admin-dashboard");

    expect(
      hospedeiro.querySelector('aside button[aria-label="Notificações"]'),
    ).toBeTruthy();
    expect(
      hospedeiro.querySelector('header button[aria-label="Notificações"]'),
    ).toBeTruthy();
  });

  it("o subcabeçalho de banners diz 'Banners'", async () => {
    await montar("admin-banners");

    expect(subcabecalho()).toBe("Banners");
    expect(hospedeiro.textContent).not.toContain("Gerenciador de Banners");
  });

  it("o subcabeçalho de vitrines diz 'Vitrines'", async () => {
    await montar("admin-carousels");

    expect(subcabecalho()).toBe("Vitrines");
    expect(hospedeiro.textContent).not.toContain("Carrosséis");
  });
});
