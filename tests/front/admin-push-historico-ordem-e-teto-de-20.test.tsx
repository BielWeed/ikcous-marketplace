// @vitest-environment jsdom
//
// "O que já foi ao ar" (histórico de campanhas do painel de avisos): a busca
// pede ao banco as campanhas da MAIS NOVA para a mais antiga, e a tela mostra
// exatamente 20, na ordem em que o banco devolveu — sem reordenar. Se a busca
// virasse "da mais antiga para a mais nova", a lojista veria as 20 campanhas
// mais velhas no lugar das últimas que enviou.
//
// Montagem: a view de verdade com o banco dublê (mesmo andaime de
// admin-push-historico-tem-tres-estados.test.tsx).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consulta = vi.hoisted(() => ({
  ordenacoes: [] as Array<{ coluna: string; opcoes: unknown }>,
  limites: [] as number[],
  linhas: [] as Record<string, unknown>[],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-1" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { realTimeSalesAlerts: false },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({ isSupported: false, subscribe: vi.fn() }),
}));
vi.mock("@/hooks/useVOR", () => ({
  useVOR: () => ({ recordAction: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// Consulta vazia que aceita `.order().order().range()` em qualquer ordem.
function encadeavelVazio(): Promise<{ data: never[]; error: null }> {
  const p = Promise.resolve({ data: [] as never[], error: null });
  return Object.assign(p, {
    order: () => encadeavelVazio(),
    range: () => encadeavelVazio(),
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return {
          select: () => Promise.resolve({ count: 8, error: null }),
        };
      }
      if (tabela === "push_notifications_log") {
        return {
          select: () => ({
            not: () => ({
              order: (coluna: string, opcoes: unknown) => {
                consulta.ordenacoes.push({ coluna, opcoes });
                return {
                  limit: (n: number) => {
                    consulta.limites.push(n);
                    return Promise.resolve({
                      data: consulta.linhas,
                      error: null,
                    });
                  },
                };
              },
            }),
          }),
        };
      }
      return {
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
          eq: () => ({ order: () => encadeavelVazio() }),
        }),
      };
    },
    rpc: () => Promise.resolve({ data: 0, error: null }),
    functions: { invoke: vi.fn() },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const esperar = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

// Da mais nova (índice 0) para a mais antiga, como o banco devolve.
const campanhasDoBanco = (quantas: number) =>
  Array.from({ length: quantas }, (_, i) => ({
    id: `log-${i}`,
    title: `Campanha ${String(i).padStart(2, "0")}`,
    body: `corpo ${i}`,
    url: "/",
    sent_at: new Date(
      Date.UTC(2026, 10, 24, 12, 0, 0) - i * 3_600_000,
    ).toISOString(),
    status: "sent",
    recipient_count: 3,
    created_by: "admin-1",
  }));

describe("AdminPushView — histórico de campanhas: ordem e teto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    consulta.ordenacoes = [];
    consulta.limites = [];
    consulta.linhas = [];
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
      },
    });
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
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
    vi.restoreAllMocks();
  });

  async function abrirHistorico() {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(<AdminPushView onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await esperar(80);
    });
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("O que já foi ao ar"),
    );
    await act(async () => {
      botao?.click();
    });
    await act(async () => {
      await esperar(40);
    });
  }

  const titulosNaTela = () =>
    Array.from(hospedeiro.querySelectorAll("h4")).map(
      (h) => h.textContent ?? "",
    );

  it("pede ao banco as campanhas da mais nova para a mais antiga, por data de envio, até 100 linhas", async () => {
    consulta.linhas = campanhasDoBanco(3);
    await abrirHistorico();

    expect(consulta.ordenacoes[0]).toEqual({
      coluna: "sent_at",
      opcoes: { ascending: false },
    });
    expect(consulta.limites[0]).toBe(100);
  });

  it("com 25 campanhas no banco, a tela mostra as 20 mais novas, na ordem que o banco devolveu", async () => {
    consulta.linhas = campanhasDoBanco(25);
    await abrirHistorico();

    const titulos = titulosNaTela();
    expect(titulos).toHaveLength(20);
    expect(titulos[0]).toBe("Campanha 00");
    expect(titulos[19]).toBe("Campanha 19");
    expect(titulos).not.toContain("Campanha 20");
    expect(titulos).not.toContain("Campanha 24");
  });

  it("com exatamente 20 campanhas no banco aparecem as 20, nenhuma some", async () => {
    consulta.linhas = campanhasDoBanco(20);
    await abrirHistorico();
    expect(titulosNaTela()).toHaveLength(20);
  });

  it("uma campanha entregue a um único aparelho diz '1 aparelho' no histórico", async () => {
    consulta.linhas = [{ ...campanhasDoBanco(1)[0], recipient_count: 1 }];
    await abrirHistorico();

    const texto = hospedeiro.textContent ?? "";
    expect(titulosNaTela()).toEqual(["Campanha 00"]);
    expect(texto).toContain("1 aparelho");
    expect(texto).not.toContain("1 aparelhos");
    expect(texto).toContain("Aceitos para envio");
  });
});
