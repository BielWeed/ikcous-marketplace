// @vitest-environment jsdom
//
// O LAÇO DO VOLTAR (achado do dono no celular, 22/10/2026): em "Avisar
// clientes" ele tocava no sino, caía em Notificações, tocava em "Voltar" e
// voltava a "Avisar clientes"; tocava em "Voltar" de novo e ia para
// Notificações — para sempre, sem nunca sair do par.
//
// Causa: o `AdminLayout` gravava como "origem" a tela anterior a CADA troca de
// tela, inclusive a troca feita pelo próprio botão Voltar. Assim, ao voltar de
// Notificações para "Avisar clientes", a origem de "Avisar clientes" virava
// Notificações — e o Voltar dela levava de volta a Notificações.
//
// Este teste monta o AdminLayout de verdade (com a regra real de
// `paiDaTelaDoAdmin`) dentro de um hospedeiro que troca de tela como o App
// faz, e toca nos botões como a pessoa toca.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { View } from "@/types";

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
      builder.gte = vi.fn(() => builder);
      builder.maybeSingle = vi.fn(() =>
        Promise.resolve({ data: null, error: null }),
      );
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

describe("AdminLayout — o Voltar nunca prende a pessoa num par de telas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let irPara: (view: View) => void;

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

  /** Monta o painel na tela `inicial`; `onNavigate` troca de tela como o App. */
  async function montar(inicial: View) {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    const React = await import("react");
    function Hospedeiro() {
      const [view, setView] = React.useState<View>(inicial);
      React.useEffect(() => {
        irPara = setView;
      }, []);
      return (
        <AdminLayout currentView={view} onNavigate={setView}>
          <div data-testid="tela" data-view={view} />
        </AdminLayout>
      );
    }
    await act(async () => {
      raiz.render(<Hospedeiro />);
    });
  }

  const telaAtual = () =>
    hospedeiro.querySelector('[data-testid="tela"]')?.getAttribute("data-view");

  /** Troca de tela "por dentro" (cartão, atalho): avanço de verdade. */
  async function navegarPara(view: View) {
    await act(async () => {
      irPara(view);
    });
  }

  async function tocar(botao: Element | null | undefined) {
    expect(botao).toBeTruthy();
    await act(async () => {
      botao?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
  }

  const sino = () =>
    hospedeiro.querySelector('header button[aria-label="Notificações"]');
  const voltar = () =>
    Array.from(hospedeiro.querySelectorAll("header button")).find((b) =>
      b.textContent?.includes("Voltar"),
    );

  it("Clientes > Avisar clientes > sino > Voltar > Voltar: sai para Clientes, sem laço", async () => {
    await montar("admin-customers");
    await navegarPara("admin-push");

    await tocar(sino());
    expect(telaAtual()).toBe("admin-notifications");

    // Voltar de Notificações: para onde a pessoa estava (Avisar clientes).
    await tocar(voltar());
    expect(telaAtual()).toBe("admin-push");

    // Voltar de Avisar clientes: a aba da porta (Clientes) — NÃO Notificações.
    await tocar(voltar());
    expect(telaAtual()).toBe("admin-customers");
  });

  it("a pessoa insiste no Voltar: em poucos toques termina fora do par e nunca volta a ele", async () => {
    await montar("admin-customers");
    await navegarPara("admin-push");
    await tocar(sino());

    const visitadas: Array<string | null | undefined> = [];
    for (let i = 0; i < 6; i++) {
      const botao = voltar();
      if (!botao) break;
      await tocar(botao);
      visitadas.push(telaAtual());
    }
    expect(visitadas.slice(0, 2)).toEqual(["admin-push", "admin-customers"]);
    // Depois de Clientes (raiz de aba) não há mais "Voltar": o botão vira "Perfil".
    expect(telaAtual()).toBe("admin-customers");
    expect(visitadas).not.toContain("admin-notifications");
    expect(visitadas.filter((v) => v === "admin-push")).toHaveLength(1);
  });

  it("Voltar físico (troca de tela sem tocar no botão) e o botão do topo se comportam igual", async () => {
    await montar("admin-customers");
    await navegarPara("admin-push");
    await tocar(sino());
    expect(telaAtual()).toBe("admin-notifications");

    // O Voltar do celular devolve a tela anterior sem passar pelo botão.
    await navegarPara("admin-push");
    // A partir daqui o botão do topo tem de sair para Clientes, como depois
    // de ter voltado pelo botão.
    await tocar(voltar());
    expect(telaAtual()).toBe("admin-customers");
  });

  it("Notificações sem origem útil (primeira tela do painel) volta para o painel principal", async () => {
    await montar("admin-notifications");
    await tocar(voltar());
    expect(telaAtual()).toBe("admin-dashboard");
  });

  it("Avisar clientes sem origem útil volta para a aba Clientes", async () => {
    await montar("admin-push");
    await tocar(voltar());
    expect(telaAtual()).toBe("admin-customers");
  });

  it("o mesmo defeito latente em outra tela: Atendimento > sino > Voltar > Voltar não gira", async () => {
    await montar("admin-dashboard");
    await navegarPara("admin-whatsapp-config");
    await tocar(sino());
    expect(telaAtual()).toBe("admin-notifications");

    await tocar(voltar());
    expect(telaAtual()).toBe("admin-whatsapp-config");

    // Antes: voltava a Notificações. Agora: à porta de onde veio (painel principal).
    await tocar(voltar());
    expect(telaAtual()).toBe("admin-dashboard");
  });

  it("entrar de novo no par depois de sair dele funciona: a origem é a de AGORA", async () => {
    await montar("admin-customers");
    await navegarPara("admin-push");
    await tocar(voltar());
    expect(telaAtual()).toBe("admin-customers");

    // Segunda visita, agora partindo de Pedidos.
    await navegarPara("admin-orders");
    await navegarPara("admin-push");
    await tocar(voltar());
    expect(telaAtual()).toBe("admin-orders");
  });
});
