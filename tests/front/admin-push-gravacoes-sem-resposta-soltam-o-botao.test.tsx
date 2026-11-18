// @vitest-environment jsdom
//
// Avisar clientes: as GRAVACOES do envio (registro no historico, avisos dentro
// do app, a chamada da send-push e o ajuste final do historico) nao podem
// prender o botao. Rede que conecta e nao responde deixava "Enviando
// Notificacao..." para sempre; recarregar e reenviar podia duplicar avisos.
// Cada etapa tem prazo, e a frase de cada uma diz so o que se sabe dela.
import {
  PRAZO_DA_EDGE_DE_ENVIO_DE_PUSH_MS,
  PRAZO_DA_GRAVACAO_DO_ENVIO_DE_PUSH_MS,
} from "@/lib/prazo-da-requisicao";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmarEnvioSePerguntar } from "./confirma-envio-para-todos";

type Etapa = "registro" | "aviso" | "envio" | "ajuste" | null;

const { estado, invokeSendPush, toastError, toastSuccess, toastWarning } =
  vi.hoisted(() => ({
    estado: {
      pendurar: null as Etapa,
      chamadasDoAviso: 0,
      chamadasDoAjuste: 0,
      aparelhosDoCliente: [] as Record<string, unknown>[],
    },
    invokeSendPush: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    toastWarning: vi.fn(),
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
  toast: { success: toastSuccess, error: toastError, warning: toastWarning },
}));

const aparelhos = Array.from({ length: 3 }, (_, i) => ({
  user_id: `u${i}`,
  endpoint: `e${i}`,
  p256dh: "p",
  auth: "a",
}));
const pendurada = () => new Promise<never>(() => {});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return {
          select: () =>
            Promise.resolve({ count: aparelhos.length, error: null }),
        };
      }
      if (tabela === "public_profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: { full_name: "Cliente de Teste" },
                  error: null,
                }),
            }),
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
          insert: () => ({
            select: () => ({
              single: () =>
                estado.pendurar === "registro"
                  ? pendurada()
                  : Promise.resolve({ data: { id: "log-1" }, error: null }),
            }),
          }),
          update: () => ({
            eq: () => {
              estado.chamadasDoAjuste += 1;
              return estado.pendurar === "ajuste"
                ? pendurada()
                : Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (tabela === "notificacoes") {
        return {
          insert: () => {
            estado.chamadasDoAviso += 1;
            return estado.pendurar === "aviso"
              ? pendurada()
              : Promise.resolve({ error: null });
          },
        };
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
    rpc: (nome: string, args?: { p_segment?: string }) => {
      // Segmento que nao e "all" = cliente especifico (como no banco real).
      const lista =
        args?.p_segment && args.p_segment !== "all"
          ? estado.aparelhosDoCliente
          : aparelhos;
      if (nome === "get_segmented_push_count") {
        return Promise.resolve({ data: lista.length, error: null });
      }
      const consulta = {
        order: () => consulta,
        range: (de: number, ate: number) =>
          Promise.resolve({
            data: lista.slice(de, Math.min(ate, de + 999) + 1),
            error: null,
          }),
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

describe("Avisar clientes: gravacoes do envio sem resposta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estado.pendurar = null;
    estado.chamadasDoAviso = 0;
    estado.chamadasDoAjuste = 0;
    estado.aparelhosDoCliente = [];
    invokeSendPush.mockImplementation(() =>
      estado.pendurar === "envio"
        ? pendurada()
        : Promise.resolve({
            data: { enviados: 3, falharam: 0, falhas: [] },
            error: null,
          }),
    );
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

  async function abrirTela(targetUserId?: string) {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(
        <AdminPushView onNavigate={vi.fn()} targetUserId={targetUserId} />,
      );
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
  // se montar): os prazos nascem dentro do clique, ja sob o relogio.
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

  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms + 1);
    });
  }

  async function prepararEEnviar(etapa: Etapa) {
    await abrirTela();
    await escrever("Novidade", "Chegou colecao nova");
    estado.pendurar = etapa;
    relogioFalso();
    await tocarEmEnviar();
  }

  function botaoVoltou() {
    expect(botao("Enviando Notificação")).toBeUndefined();
    const voltou = botao("Enviar agora para");
    expect(voltou).toBeDefined();
    expect(voltou!.disabled).toBe(false);
  }

  it("registro no historico sem resposta: o botao volta, nada foi enviado e a frase fala do registro", async () => {
    await prepararEEnviar("registro");
    expect(botao("Enviando Notificação")).toBeDefined();

    await passar(PRAZO_DA_GRAVACAO_DO_ENVIO_DE_PUSH_MS);

    botaoVoltou();
    expect(toastError).toHaveBeenCalledWith(
      expect.stringMatching(/Nada foi enviado.*Histórico/),
    );
    expect(invokeSendPush).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("aviso dentro do app sem resposta: o envio segue e o aviso e sinalizado sem dizer que o banco recusou", async () => {
    await prepararEEnviar("aviso");
    expect(botao("Enviando Notificação")).toBeDefined();

    await passar(PRAZO_DA_GRAVACAO_DO_ENVIO_DE_PUSH_MS);

    botaoVoltou();
    expect(estado.chamadasDoAviso).toBe(1);
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
    expect(toastWarning).toHaveBeenCalledWith(
      "O aviso dentro do app não foi registrado",
      expect.objectContaining({
        description: expect.not.stringContaining("recusou"),
      }),
    );
    expect(toastError).not.toHaveBeenCalledWith(
      "Falha ao registrar notificação no banco",
    );
  });

  it("send-push sem resposta: o botao volta e a tela diz que alguns clientes podem ter recebido", async () => {
    await prepararEEnviar("envio");
    expect(botao("Enviando Notificação")).toBeDefined();
    expect(invokeSendPush).toHaveBeenCalledTimes(1);

    // Dentro do orcamento de 50 s da edge ainda se espera a resposta.
    await passar(PRAZO_DA_GRAVACAO_DO_ENVIO_DE_PUSH_MS);
    expect(botao("Enviando Notificação")).toBeDefined();

    await passar(PRAZO_DA_EDGE_DE_ENVIO_DE_PUSH_MS);

    botaoVoltou();
    expect(toastError).toHaveBeenCalledWith(
      "Não foi possível confirmar o envio",
      expect.objectContaining({
        description: expect.stringContaining("podem ter recebido"),
      }),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("ajuste final do historico sem resposta: o envio ja confirmado nao vira falha e o botao volta", async () => {
    await prepararEEnviar("ajuste");
    expect(botao("Enviando Notificação")).toBeDefined();
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
    expect(estado.chamadasDoAjuste).toBe(1);

    await passar(PRAZO_DA_GRAVACAO_DO_ENVIO_DE_PUSH_MS);

    botaoVoltou();
    expect(toastSuccess).toHaveBeenCalledWith(
      "Notificação entregue em 3 dispositivos",
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it("cliente especifico sem aparelho, aviso sem resposta: a frase diz que pode ter sido registrado e o texto fica na tela", async () => {
    estado.aparelhosDoCliente = [
      { user_id: "cliente-1", endpoint: "e1", p256dh: "p", auth: "a" },
    ];
    await abrirTela("cliente-1");
    await escrever("Oferta", "Corre que acaba hoje");
    // O aparelho some entre a medicao e o clique: cai no caminho do aviso so
    // dentro do app, cujo INSERT nunca responde.
    estado.aparelhosDoCliente = [];
    estado.pendurar = "aviso";
    relogioFalso();
    await tocarEmEnviar();
    expect(botao("Enviando Notificação")).toBeDefined();

    await passar(PRAZO_DA_GRAVACAO_DO_ENVIO_DE_PUSH_MS);

    botaoVoltou();
    expect(estado.chamadasDoAviso).toBe(1);
    expect(toastError).toHaveBeenCalledWith(
      "Sem resposta da rede. O aviso pode ter sido registrado: confira o histórico antes de repetir.",
    );
    expect(toastError).not.toHaveBeenCalledWith(
      "Não foi possível registrar o aviso para este cliente",
    );
    expect(invokeSendPush).not.toHaveBeenCalled();
    // Nao limpa: a lojista ainda ve o texto que escreveu.
    expect(
      hospedeiro.querySelector<HTMLInputElement>("#push-title")?.value,
    ).toBe("Oferta");
  });

  it("tudo respondendo: envia como sempre, sem erro", async () => {
    await prepararEEnviar(null);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    botaoVoltou();
    expect(toastSuccess).toHaveBeenCalledWith(
      "Notificação entregue em 3 dispositivos",
    );
    expect(toastError).not.toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
  });
});
