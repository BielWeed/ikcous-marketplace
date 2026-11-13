// @vitest-environment jsdom
//
// Defeito: "Novos em 7 dias" e "Inativos há 30 dias" (as contagens dos grupos
// de público em Avisar clientes) são medidas pelo servidor com o dia de HOJE
// dele, e a tela só as media na abertura e na volta do foco. Com o painel
// aberto de 23h59 a 00h01 (São Paulo), os grupos seguiam com a janela de
// ontem. Agora a virada do dia mede de novo (os grupos, o total de aparelhos
// e o alcance), sem laço novo: só na virada.
// Relógio falso cruzando a meia-noite de São Paulo (UTC−3: 03:00Z).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, lerAparelhos } = vi.hoisted(() => ({
  rpc: vi.fn<(nome: string, args?: unknown) => Promise<unknown>>(),
  lerAparelhos: vi.fn<() => void>(),
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
  toast: {
    success: vi.fn<() => void>(),
    error: vi.fn<() => void>(),
    warning: vi.fn<() => void>(),
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return {
          select: () => {
            lerAparelhos();
            return Promise.resolve({ count: 5, error: null });
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
      const consulta: Record<string, unknown> = {};
      consulta.eq = () => consulta;
      consulta.order = () => consulta;
      consulta.range = () => Promise.resolve({ data: [], error: null });
      return { select: () => consulta };
    },
    rpc: (nome: string, args?: unknown) => rpc(nome, args),
    functions: { invoke: vi.fn() },
  },
}));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const ANTES_DA_MEIA_NOITE = "2026-11-13T02:59:50Z"; // 12/11, 23:59:50 em SP
const DEPOIS_DA_MEIA_NOITE = "2026-11-13T03:00:10Z"; // 13/11, 00:00:10 em SP

const medidasDeGrupo = () =>
  rpc.mock.calls.filter(([nome]) => nome === "get_segmented_push_count");

describe("Avisar clientes — acompanha a virada do dia", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: 2, error: null });
    lerAparelhos.mockReset();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date(ANTES_DA_MEIA_NOITE));
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => void armazem.set(c, v),
      removeItem: (c: string) => void armazem.delete(c),
    });
    vi.stubGlobal("ResizeObserver", ObservadorMudo);
    vi.stubGlobal("IntersectionObserver", ObservadorMudo);
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
    act(() => raiz.unmount());
    hospedeiro.remove();
    Reflect.deleteProperty(document, "visibilityState");
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function abrirTela() {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(<AdminPushView onNavigate={vi.fn()} />);
    });
    await avancar(100);
  }

  it("com a tela aberta na virada do dia, os grupos e o total de aparelhos são medidos de novo", async () => {
    await abrirTela();
    // Abertura: os três grupos (VIP, inativos, novos) e o total de aparelhos.
    expect(medidasDeGrupo()).toHaveLength(3);
    expect(lerAparelhos).toHaveBeenCalledTimes(1);

    await avancar(12_000); // o temporizador da meia-noite dispara aos ~11 s

    expect(medidasDeGrupo()).toHaveLength(6);
    expect(lerAparelhos).toHaveBeenCalledTimes(2);
  });

  it("controle: sem virada de dia, passar o tempo não mede de novo", async () => {
    await abrirTela();
    await avancar(5_000);
    expect(medidasDeGrupo()).toHaveLength(3);
    expect(lerAparelhos).toHaveBeenCalledTimes(1);
  });

  it("aba escondida na virada não bate na rede (a volta ao foco mede)", async () => {
    await abrirTela();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    await avancar(12_000);
    expect(medidasDeGrupo()).toHaveLength(3);
    expect(lerAparelhos).toHaveBeenCalledTimes(1);
    // Volta ao foco já no dia seguinte: o ouvinte de sempre mede uma vez.
    await act(async () => {
      vi.setSystemTime(new Date(DEPOIS_DA_MEIA_NOITE));
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      window.dispatchEvent(new Event("focus"));
    });
    await avancar(100);
    expect(medidasDeGrupo()).toHaveLength(6);
  });
});
