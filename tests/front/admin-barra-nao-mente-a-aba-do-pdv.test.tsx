// @vitest-environment jsdom
//
// A BARRA NÃO MENTE DE ONDE VOCÊ ESTÁ — relato do dono em teste real no
// celular (19/09, com print): clicar no botão VENDER abria o PDV e a barra
// de navegação continuava marcando GERAL como aba ativa, como se o lojista
// estivesse no dashboard.
//
// A CAUSA: `isActive` das abas usa `parentView === item.view`, e o pai do
// admin-pdv é admin-dashboard — pai esse que existe para o botão VOLTAR
// (plano §5.3: "sub-view do painel principal"), não para herdar o destaque.
// "Vender" é AÇÃO com botão próprio (o redondo, que já se marca com anel
// quando o PDV está aberto) — nenhuma das 5 abas deve acender na tela dele.
//
// O CONTRATO (este arquivo):
//   1. Em admin-pdv, NENHUMA das 5 abas carrega o estado ativo
//      (`text-admin-gold`) — na sidebar desktop nem na barra do celular.
//   2. O botão redondo "Vender" se marca (anel) — o PDV tem dono do destaque.
//   3. Controle: sub-view DE VERDADE (admin-coupon-form, filho de Produtos)
//      continua acendendo a aba pai — a correção não pode cegar a barra toda.
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

const ABAS = ["Início", "Pedidos", "Produtos", "Clientes", "Ajustes"] as const;

function botoesDasAbas(hospedeiro: HTMLDivElement): HTMLButtonElement[] {
  return Array.from(hospedeiro.querySelectorAll("button")).filter((b) =>
    ABAS.includes(b.textContent?.trim() as (typeof ABAS)[number]),
  );
}

describe("AdminLayout — na tela de venda, a barra marca o Vender e não a aba Início", () => {
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

  it("em admin-pdv, NENHUMA das 5 abas está ativa (sem text-admin-gold)", async () => {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-pdv" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });

    const abas = botoesDasAbas(hospedeiro);
    expect(abas.length).toBeGreaterThanOrEqual(5);
    for (const aba of abas) {
      expect(aba.className).not.toContain("text-admin-gold");
    }
  });

  it("em admin-pdv, o botão redondo Vender carrega a marca do anel (o destaque tem dono)", async () => {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-pdv" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });

    const vender = hospedeiro.querySelector(
      'button[aria-label="Vender"]',
    ) as HTMLButtonElement | null;
    expect(vender).toBeTruthy();
    expect(vender!.className).toContain("ring-2");
  });

  it("controle: sub-view de verdade (admin-user-detail) continua acendendo a aba pai Clientes", async () => {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-user-detail" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });

    const clientes = botoesDasAbas(hospedeiro).find(
      (b) => b.textContent?.trim() === "Clientes",
    );
    expect(clientes?.className).toContain("text-admin-gold");
  });
});
