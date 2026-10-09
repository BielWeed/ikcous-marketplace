// @vitest-environment jsdom
//
// ALVOS DE TOQUE DO CABEÇALHO MÓVEL — painel simples, tarefa A3. O Voltar e
// o sino eram desenhados com `h-7`/`size-7` (28px) e o próprio botão era o
// alvo de toque: bem abaixo dos 44px que o dono fixou (spec §7). Agora o
// elemento clicável tem `min-h-11 min-w-11` e o desenho visual (a pílula e o
// círculo de 28px) mora num elemento interno, igual ao que era.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AdminLayout — Voltar e sino do cabeçalho móvel têm alvo de 44px", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  async function montarCabecalho() {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      // admin-coupon-form é sub-view (filho de Produtos): o botão diz "Voltar".
      raiz.render(
        <AdminLayout currentView="admin-coupon-form" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });
    const cabecalho = hospedeiro.querySelector("header") as HTMLElement | null;
    expect(cabecalho).toBeTruthy();
    return cabecalho!;
  }

  it("o botão Voltar tem min-h-11 e min-w-11", async () => {
    const cabecalho = await montarCabecalho();
    const voltar = Array.from(cabecalho.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Voltar"),
    );
    expect(voltar).toBeTruthy();
    const classes = voltar!.className.split(/\s+/);
    expect(classes).toContain("min-h-11");
    expect(classes).toContain("min-w-11");
  });

  it("o sino (Notificações) tem min-h-11 e min-w-11", async () => {
    const cabecalho = await montarCabecalho();
    const sino = cabecalho.querySelector(
      'button[aria-label="Notificações"]',
    ) as HTMLButtonElement | null;
    expect(sino).toBeTruthy();
    const classes = sino!.className.split(/\s+/);
    expect(classes).toContain("min-h-11");
    expect(classes).toContain("min-w-11");
  });
});
