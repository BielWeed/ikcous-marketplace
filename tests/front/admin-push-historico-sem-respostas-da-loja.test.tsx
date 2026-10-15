// @vitest-environment jsdom
//
// O histórico do painel de avisos tem de mostrar só o que a lojista ENVIOU. As
// linhas "Sua pergunta foi respondida!" / "Sua avaliação foi respondida!" que as
// RPCs de resposta gravam em `push_notifications_log` não são campanha (0
// aparelhos, selo "Não confirmada") e, ao se acumularem, empurravam as campanhas
// reais para fora da lista de 20. Montagem: a view de verdade com o banco dublê
// (mesmo andaime de admin-push-envio-honesto.test.tsx).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { historicoDoBanco, limitesPedidos } = vi.hoisted(() => ({
  historicoDoBanco: { linhas: [] as Record<string, unknown>[] },
  limitesPedidos: [] as number[],
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
  usePushNotifications: () => ({
    isSupported: false,
    subscribe: vi.fn(),
  }),
}));

vi.mock("@/hooks/useVOR", () => ({
  useVOR: () => ({ recordAction: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

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
            order: () => ({
              limit: (n: number) => {
                limitesPedidos.push(n);
                return Promise.resolve({
                  data: historicoDoBanco.linhas.slice(0, n),
                  error: null,
                });
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
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    },
    rpc: () => Promise.resolve({ data: 0, error: null }),
    functions: { invoke: vi.fn() },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const esperar = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

let contador = 0;
function linhaDoLog(title: string, recipient_count = 0) {
  contador += 1;
  return {
    id: `log-${contador}`,
    title,
    body: `corpo de ${title}`,
    url: "/",
    // quanto menor o índice, mais nova a linha
    sent_at: new Date(
      Date.UTC(2026, 9, 14, 12, 0) - contador * 60000,
    ).toISOString(),
    status: "sent",
    recipient_count,
    created_by: "admin-1",
  };
}

describe("AdminPushView — o histórico só mostra campanhas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    contador = 0;
    limitesPedidos.length = 0;
    historicoDoBanco.linhas = [];
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
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

  async function abrirTela() {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(<AdminPushView onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await esperar(80);
    });
  }

  const texto = () => hospedeiro.textContent ?? "";

  it("as linhas das respostas da loja não aparecem, as campanhas sim", async () => {
    historicoDoBanco.linhas = [
      linhaDoLog("Sua pergunta foi respondida!"),
      linhaDoLog("Sua avaliação foi respondida!"),
      linhaDoLog("Sua avaliacao foi respondida!"),
      linhaDoLog("Frete grátis hoje", 12),
    ];
    await abrirTela();

    expect(texto()).toContain("Frete grátis hoje");
    expect(texto()).not.toContain("Sua pergunta foi respondida!");
    expect(texto()).not.toContain("Sua avaliação foi respondida!");
    expect(texto()).not.toContain("Sua avaliacao foi respondida!");
  });

  it("80 respostas recentes não empurram as campanhas para fora da lista", async () => {
    const respostas = Array.from({ length: 80 }, () =>
      linhaDoLog("Sua pergunta foi respondida!"),
    );
    const campanhas = Array.from({ length: 3 }, (_, i) =>
      linhaDoLog(`Campanha real ${i + 1}`, 5),
    );
    historicoDoBanco.linhas = [...respostas, ...campanhas];
    await abrirTela();

    for (const i of [1, 2, 3]) expect(texto()).toContain(`Campanha real ${i}`);
    expect(texto()).not.toContain("Sua pergunta foi respondida!");
    // a busca pede mais linhas do que a tela mostra (senão o filtro não teria de onde tirar)
    expect(Math.max(...limitesPedidos)).toBeGreaterThan(20);
  });

  it("sem nenhuma campanha, só com respostas da loja, a tela diz que nada foi enviado (não 'Não confirmada')", async () => {
    historicoDoBanco.linhas = [
      linhaDoLog("Sua pergunta foi respondida!"),
      linhaDoLog("Sua avaliação foi respondida!"),
    ];
    await abrirTela();

    expect(texto()).toContain("Nenhuma mensagem enviada até agora");
    expect(texto()).not.toContain("Não confirmada");
  });
});
