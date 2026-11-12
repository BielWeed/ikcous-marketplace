import { PRAZO_DA_CONSULTA_DO_PAINEL_MS } from "@/lib/prazo-da-requisicao";
// @vitest-environment jsdom
//
// Avisar clientes: a leitura dos aparelhos (antes de enviar) nao pode prender o
// botao. Rede que conecta e nao responde deixava o "Enviar agora" em "Enviando
// Notificacao..." para sempre, sem erro e sem tentar de novo, embora nenhum
// envio tivesse comecado. Agora a leitura tem prazo: estourou, o botao volta, a
// tela diz que nada foi enviado e o lojista pode tocar de novo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmarEnvioSePerguntar } from "./confirma-envio-para-todos";

const { estado, invokeSendPush, toastError, toastSuccess } = vi.hoisted(() => ({
  estado: {
    leitura: "normal" as "normal" | "pendurada" | "erro",
    chamadasDaLeitura: 0,
    aparelhos: [] as Record<string, unknown>[],
  },
  invokeSendPush: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
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
  toast: { success: toastSuccess, error: toastError, warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return {
          select: () =>
            Promise.resolve({ count: estado.aparelhos.length, error: null }),
        };
      }
      if (tabela === "push_notifications_log") {
        return {
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: "log-1" }, error: null }),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (tabela === "notificacoes") {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              range: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      };
    },
    rpc: (nome: string) => {
      if (nome === "get_segmented_push_count") {
        return Promise.resolve({ data: estado.aparelhos.length, error: null });
      }
      const consulta = {
        order: () => consulta,
        range: (de: number, ate: number) => {
          estado.chamadasDaLeitura += 1;
          if (estado.leitura === "pendurada") {
            // Rede pendurada: conecta e nunca responde.
            return new Promise(() => {});
          }
          if (estado.leitura === "erro") {
            return Promise.resolve({
              data: null,
              error: { message: "falha da leitura" },
            });
          }
          return Promise.resolve({
            data: estado.aparelhos.slice(de, Math.min(ate, de + 999) + 1),
            error: null,
          });
        },
      };
      return consulta;
    },
    functions: { invoke: invokeSendPush },
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

describe("Avisar clientes: leitura dos aparelhos sem resposta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estado.leitura = "normal";
    estado.chamadasDaLeitura = 0;
    estado.aparelhos = Array.from({ length: 3 }, (_, i) => ({
      user_id: `u${i}`,
      endpoint: `e${i}`,
      p256dh: "p",
      auth: "a",
    }));
    invokeSendPush.mockResolvedValue({
      data: { enviados: 3, falharam: 0, falhas: [] },
      error: null,
    });
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
    vi.useRealTimers();
    act(() => raiz.unmount());
    hospedeiro.remove();
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

  function digitar(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function escrever(titulo: string, corpo: string) {
    await act(async () => {
      digitar(
        hospedeiro.querySelector<HTMLInputElement>("#push-title")!,
        titulo,
      );
      digitar(
        hospedeiro.querySelector<HTMLTextAreaElement>("#push-body")!,
        corpo,
      );
    });
    await act(async () => {
      await esperar(260);
    });
  }

  const botao = (trecho: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(trecho),
    ) as HTMLButtonElement | undefined;

  // Relogio falso SO depois de a tela estar pronta (ela usa timers reais para
  // se montar): o prazo da leitura nasce dentro do clique, ja sob o relogio.
  function relogioFalso() {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
  }

  async function tocarEmEnviar() {
    await act(async () => {
      botao("Enviar agora para")!.click();
    });
    await confirmarEnvioSePerguntar();
  }

  async function passarOPrazo() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_DA_CONSULTA_DO_PAINEL_MS + 1);
    });
  }

  it("leitura que nunca responde: passado o prazo o botao volta, aparece o erro e nada foi enviado", async () => {
    await abrirTela();
    await escrever("Novidade", "Chegou colecao nova");
    estado.leitura = "pendurada";
    relogioFalso();

    await tocarEmEnviar();
    expect(botao("Enviando Notificação")).toBeDefined();
    expect(estado.chamadasDaLeitura).toBe(1);

    await passarOPrazo();

    expect(botao("Enviando Notificação")).toBeUndefined();
    const voltou = botao("Enviar agora para");
    expect(voltou).toBeDefined();
    expect(voltou!.disabled).toBe(false);
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("Demorou demais"),
    );
    expect(invokeSendPush).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("leitura normal: envia como sempre, sem erro", async () => {
    await abrirTela();
    await escrever("Novidade", "Chegou colecao nova");

    await tocarEmEnviar();
    await act(async () => {
      await esperar(80);
    });

    expect(invokeSendPush).toHaveBeenCalledTimes(1);
    expect(invokeSendPush.mock.calls[0][1].body.tokens).toHaveLength(3);
    expect(toastError).not.toHaveBeenCalled();
    expect(botao("Enviando Notificação")).toBeUndefined();
  });

  it("leitura com erro imediato: mesma falha de sempre, sem enviar e sem prazo pendente", async () => {
    await abrirTela();
    await escrever("Novidade", "Chegou colecao nova");
    estado.leitura = "erro";

    await tocarEmEnviar();
    await act(async () => {
      await esperar(80);
    });

    expect(toastError).toHaveBeenCalledWith(
      "Falha ao registrar notificação no banco",
    );
    expect(invokeSendPush).not.toHaveBeenCalled();
    expect(botao("Enviar agora para")!.disabled).toBe(false);
  });

  it("depois do prazo da para tocar de novo e, se a leitura responder, o aviso sai", async () => {
    await abrirTela();
    await escrever("Novidade", "Chegou colecao nova");
    estado.leitura = "pendurada";
    relogioFalso();

    await tocarEmEnviar();
    await passarOPrazo();
    expect(invokeSendPush).not.toHaveBeenCalled();

    estado.leitura = "normal";
    await tocarEmEnviar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(estado.chamadasDaLeitura).toBe(2);
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
    expect(invokeSendPush.mock.calls[0][1].body.tokens).toHaveLength(3);
  });
});
