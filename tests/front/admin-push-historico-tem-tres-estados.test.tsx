// @vitest-environment jsdom
//
// "O que já foi ao ar" tem TRÊS estados: carregando, falhou e vazio. Antes, o
// histórico nascia `null` — o mesmo valor da consulta que falha —, então ao
// abrir a seção a tela já dizia "Não foi possível carregar o histórico" ANTES
// de a resposta chegar, e sem botão para tentar de novo. Montagem: a view de
// verdade com o banco dublê (mesmo andaime de
// admin-push-historico-sem-respostas-da-loja.test.tsx).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RespostaDoLog = {
  data: Record<string, unknown>[] | null;
  error: unknown;
};

const controle = vi.hoisted(() => ({
  // Cada chamada ao log de envios devolve a próxima resposta pendurada aqui.
  consultas: [] as Array<(r: RespostaDoLog) => void>,
  chamadas: 0,
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
            not: () => ({
              order: () => ({
                limit: () => {
                  controle.chamadas += 1;
                  return new Promise<RespostaDoLog>((resolve) => {
                    controle.consultas.push(resolve);
                  });
                },
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

const MENSAGEM_DE_FALHA = "Não foi possível carregar o histórico";

const campanha = {
  id: "log-1",
  title: "Frete grátis hoje",
  body: "corpo",
  url: "/",
  sent_at: "2026-10-14T12:00:00Z",
  status: "sent",
  recipient_count: 12,
  created_by: "admin-1",
};

describe("AdminPushView — histórico: carregando, falhou, vazio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    controle.consultas = [];
    controle.chamadas = 0;
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

  async function abrirHistorico() {
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("O que já foi ao ar"),
    );
    await act(async () => {
      botao?.click();
    });
  }

  async function responder(indice: number, resposta: RespostaDoLog) {
    await act(async () => {
      controle.consultas.at(indice)?.(resposta);
      await esperar(20);
    });
  }

  const texto = () => hospedeiro.textContent ?? "";
  // O "Tentar de novo" do histórico mora junto da mensagem de falha dele.
  const botaoTentarDoHistorico = () =>
    Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) =>
        /tentar de novo/i.test(b.textContent ?? "") &&
        (b.closest('[role="alert"]')?.textContent ?? "").includes(
          MENSAGEM_DE_FALHA,
        ),
    );

  it("enquanto a resposta não chega: 'Carregando…' e NADA de falha", async () => {
    await abrirTela();
    await abrirHistorico();

    expect(controle.chamadas).toBeGreaterThan(0);
    expect(texto()).toContain("Carregando o histórico");
    expect(texto()).not.toContain(MENSAGEM_DE_FALHA);
    expect(texto()).not.toContain("Nenhuma mensagem enviada até agora");
  });

  it("consulta falhou: mensagem de falha e botão 'Tentar de novo'", async () => {
    await abrirTela();
    await abrirHistorico();
    await responder(0, { data: null, error: { message: "rede caiu" } });

    expect(texto()).toContain(MENSAGEM_DE_FALHA);
    expect(texto()).not.toContain("Carregando o histórico");
    expect(botaoTentarDoHistorico()).toBeTruthy();
  });

  it("'Tentar de novo' refaz a consulta e, quando responde, mostra a lista", async () => {
    await abrirTela();
    await abrirHistorico();
    await responder(0, { data: null, error: { message: "rede caiu" } });
    const antes = controle.chamadas;

    await act(async () => {
      botaoTentarDoHistorico()?.click();
      await esperar(20);
    });
    expect(controle.chamadas).toBe(antes + 1);
    // Refazendo: volta a "Carregando…", sem a falha antiga na tela.
    expect(texto()).toContain("Carregando o histórico");
    expect(texto()).not.toContain(MENSAGEM_DE_FALHA);

    await responder(-1, { data: [campanha], error: null });
    expect(texto()).toContain("Frete grátis hoje");
    expect(texto()).not.toContain(MENSAGEM_DE_FALHA);
    expect(botaoTentarDoHistorico()).toBeUndefined();
  });

  it("consulta que funcionou e veio vazia: texto de lista vazia, sem falha", async () => {
    await abrirTela();
    await abrirHistorico();
    await responder(0, { data: [], error: null });

    expect(texto()).toContain("Nenhuma mensagem enviada até agora");
    expect(texto()).not.toContain(MENSAGEM_DE_FALHA);
    expect(texto()).not.toContain("Carregando o histórico");
  });
});
