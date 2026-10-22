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
// "Vender" é AÇÃO com botão próprio — nenhuma das 5 abas deve acender na
// tela dele. Na casca v5, Vender ganha rótulo e a mesma seleção das abas.
//
// O CONTRATO (este arquivo):
//   1. Em admin-pdv, NENHUMA das 5 abas carrega o estado ativo
//      (`aria-current="page"`) — na sidebar desktop nem na barra do celular.
//   2. "Vender" se marca em dourado — o PDV tem dono do destaque.
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
      builder.or = vi.fn(() => builder);
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

  it("em admin-pdv, NENHUMA das 5 abas está ativa (sem aria-current)", async () => {
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
      expect(aba.getAttribute("aria-current")).toBeNull();
    }
  });

  it("em admin-pdv, só Vender carrega a seleção dourada (o destaque tem dono)", async () => {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-pdv" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });

    const vender = hospedeiro.querySelector(
      'nav[aria-label="Navegação inferior do painel"] button[aria-label="Vender"]',
    ) as HTMLButtonElement | null;
    expect(vender).toBeTruthy();
    expect(vender!.className).toContain("text-white");
    expect(vender!.className).not.toContain("bg-[#3B3016]");
    expect(vender!.querySelector(".border-admin-gold.text-admin-gold")).toBeTruthy();
    expect(vender!.getAttribute("aria-current")).toBe("page");
    expect(vender!.textContent).toBe("Vender");
  });

  it.each([
    ["admin-dashboard", "Início"],
    ["admin-orders", "Pedidos"],
    ["admin-products", "Produtos"],
    ["admin-customers", "Clientes"],
    ["admin-settings", "Ajustes"],
    ["admin-pdv", "Vender"],
  ] as const)("em %s, destaca %s sem preencher a célula nas duas barras", async (view, rotulo) => {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView={view} onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });

    for (const nav of hospedeiro.querySelectorAll("nav")) {
      const ativo = nav.querySelector('button[aria-current="page"]');
      expect(ativo?.textContent?.trim()).toBe(rotulo);
      expect(ativo?.className).not.toContain("bg-");
      expect(ativo?.className).toContain("text-white");
      const traco = ativo?.querySelector('span[aria-hidden="true"]');
      expect(traco?.className).toContain("top-0");
      expect(traco?.className).toContain("w-5");
      expect(traco?.className).toContain("h-[3px]");
      expect(traco?.className).toContain("bg-admin-gold");
      expect(ativo?.querySelector(".border-admin-gold.text-admin-gold")).toBeTruthy();
      const label = Array.from(ativo?.querySelectorAll("span") ?? []).find(
        (span) => span.textContent?.trim() === rotulo,
      );
      expect(label?.className).toContain("font-bold");
      for (const inativo of nav.querySelectorAll('button:not([aria-current="page"])')) {
        expect(inativo.querySelector(".border-admin-gold")).toBeNull();
      }
    }
  });

  it("em admin-pdv, o botão do topo diz Perfil (a venda é aba da barra, não sub-tela)", async () => {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-pdv" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });

    const textos = [...hospedeiro.querySelectorAll("header button")].map((b) =>
      b.textContent?.trim(),
    );
    expect(textos).toContain("Perfil");
    expect(textos).not.toContain("Voltar");
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
    expect(clientes?.getAttribute("aria-current")).toBe("page");
    expect(clientes?.querySelector(".border-admin-gold.text-admin-gold")).toBeTruthy();
  });
});
