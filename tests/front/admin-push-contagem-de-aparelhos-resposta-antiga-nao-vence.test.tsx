// @vitest-environment jsdom
//
// Avisar clientes: duas leituras da contagem total de aparelhos no ar ao mesmo
// tempo, a mais ANTIGA respondendo por ultimo. Cenario medido: a tela abre, a
// primeira leitura acha 0 aparelhos mas a resposta demora; um aparelho liga os
// avisos; ao voltar a janela a segunda leitura responde rapido com 1; a
// resposta antiga chega depois e repunha 0 — o "Enviar agora" ficava
// desabilitado para todos os clientes, com o banco dizendo 1.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Resposta = { count: number | null; error: Error | null };

const { leituras } = vi.hoisted(() => ({
  leituras: [] as Array<(resposta: Resposta) => void>,
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

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        // Cada leitura da contagem fica pendurada ate o teste responder.
        return {
          select: () =>
            new Promise<Resposta>((resolve) => {
              leituras.push(resolve);
            }),
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
      // Lista de produtos: encadeia `order` quantas vezes a tela pedir.
      const consulta: Record<string, unknown> = {};
      consulta.eq = () => consulta;
      consulta.order = () => consulta;
      consulta.range = () => Promise.resolve({ data: [], error: null });
      return { select: () => consulta };
    },
    rpc: () => Promise.resolve({ data: 0, error: null }),
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

const esperar = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

describe("Avisar clientes: resposta antiga da contagem de aparelhos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    leituras.length = 0;
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
    vi.unstubAllGlobals();
  });

  const botaoDeEnviar = () =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Enviar agora para"),
    ) as HTMLButtonElement | undefined;

  async function abrirTela() {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(<AdminPushView onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await esperar(40);
    });
  }

  async function responder(indice: number, count: number) {
    await act(async () => {
      leituras.at(indice)?.({ count, error: null });
      await esperar(20);
    });
  }

  it("a resposta atrasada da primeira leitura (0) nao apaga a da segunda (1)", async () => {
    await abrirTela();
    // Leitura 0: aberta ao montar, ainda sem resposta.
    expect(leituras).toHaveLength(1);

    // A janela volta ao foco: a segunda leitura sai e responde logo.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await esperar(20);
    });
    expect(leituras).toHaveLength(2);
    await responder(1, 1);
    expect(botaoDeEnviar()?.textContent).toContain("1 aparelho");

    // So agora a resposta ANTIGA chega, com o 0 de antes do aparelho ligar.
    await responder(0, 0);

    expect(botaoDeEnviar()?.textContent).toContain("1 aparelho");
  });

  it("controle: na ordem normal (antiga primeiro, nova depois) vale a nova", async () => {
    await abrirTela();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await esperar(20);
    });

    await responder(0, 0);
    await responder(1, 1);

    expect(botaoDeEnviar()?.textContent).toContain("1 aparelho");
  });
});
