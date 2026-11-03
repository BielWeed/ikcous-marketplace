// @vitest-environment jsdom
//
// Avisar clientes, bloco "Ajustes": o botão "Ligar avisos neste aparelho"
// decidia se aparecia por um estado LOCAL (`isTestSubscribed`, nascia `false`),
// sem olhar a inscrição real do aparelho que o hook já conhece:
//   1. aparelho JÁ inscrito mostrava "Ligar" mesmo assim (botão sem o que fazer);
//   2. `subscribe()` devolve `undefined` sem lançar quando a conta muda no meio
//      do toque, e a tela dava o aparelho como ligado e escondia o botão sem
//      inscrição nenhuma.
// Agora o botão acompanha `subscription` do hook: some quando há inscrição de
// verdade, e fica quando não ficou nada inscrito.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { hook, selectDeInscritos } = vi.hoisted(() => ({
  hook: {
    subscription: null as unknown,
    subscribe: undefined as unknown as ReturnType<typeof vi.fn>,
  },
  selectDeInscritos: { vezes: 0 },
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
    isSupported: true,
    subscription: hook.subscription,
    subscribe: hook.subscribe,
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
          select: () => {
            selectDeInscritos.vezes += 1;
            return Promise.resolve({ count: 3, error: null });
          },
        };
      }
      if (tabela === "push_notifications_log") {
        return {
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      }
      if (tabela === "vw_produtos_public") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                order: () => ({
                  range: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
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
            order: () =>
              Object.assign(Promise.resolve({ data: [], error: null }), {
                range: () => Promise.resolve({ data: [], error: null }),
              }),
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

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AdminPushView — 'Ligar avisos neste aparelho' segue a inscrição real", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    hook.subscription = null;
    hook.subscribe = vi.fn();
    selectDeInscritos.vezes = 0;
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
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
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
    vi.restoreAllMocks();
  });

  async function abrirTela() {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(<AdminPushView onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await esperar(50);
    });
  }

  const texto = () => hospedeiro.textContent ?? "";
  const botaoCom = (parte: string) =>
    Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => (b.textContent ?? "").includes(parte),
    );

  it("aparelho JÁ inscrito: o botão 'Ligar avisos neste aparelho' não aparece", async () => {
    hook.subscription = { endpoint: "https://push.example/ja-inscrito" };
    await abrirTela();

    // O bloco "Ajustes" pode nem existir (só o botão de ligar o sustenta);
    // se existir, abre para provar que o botão não está lá dentro.
    const ajustes = botaoCom("Ajustes");
    if (ajustes) {
      await act(async () => {
        ajustes.click();
      });
    }
    expect(texto()).not.toContain("Ligar avisos neste aparelho");
  });

  it("aparelho sem inscrição: o botão aparece dentro de Ajustes", async () => {
    await abrirTela();
    await act(async () => {
      botaoCom("Ajustes")!.click();
    });
    expect(texto()).toContain("Ligar avisos neste aparelho");
  });

  it("subscribe() devolve undefined sem lançar (conta mudou no toque): o botão FICA, nada foi inscrito", async () => {
    hook.subscribe = vi.fn().mockResolvedValue(undefined);
    await abrirTela();
    await act(async () => {
      botaoCom("Ajustes")!.click();
    });
    const antesDoToque = selectDeInscritos.vezes;

    await act(async () => {
      botaoCom("Ligar avisos neste aparelho")!.click();
    });
    await act(async () => {
      await esperar(50);
    });

    expect(hook.subscribe).toHaveBeenCalledTimes(1);
    expect(texto()).toContain("Ligar avisos neste aparelho");
    // Nada foi inscrito: não há contagem nova a buscar.
    expect(selectDeInscritos.vezes).toBe(antesDoToque);
  });

  it("subscribe() inscreve de verdade: a contagem de aparelhos é relida", async () => {
    hook.subscribe = vi
      .fn()
      .mockResolvedValue({ endpoint: "https://push.example/nova" });
    await abrirTela();
    await act(async () => {
      botaoCom("Ajustes")!.click();
    });
    const antesDoToque = selectDeInscritos.vezes;

    await act(async () => {
      botaoCom("Ligar avisos neste aparelho")!.click();
    });
    await act(async () => {
      await esperar(50);
    });

    expect(selectDeInscritos.vezes).toBeGreaterThan(antesDoToque);
  });
});
