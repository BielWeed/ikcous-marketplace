// @vitest-environment jsdom
//
// Avisar clientes, "Mensagem para Cliente Específico" sem celular inscrito: a
// tela grava um aviso no sino dela (`notificacoes`). Se a conexão cai DEPOIS
// de o banco gravar, o supabase-js devolve `{ message: "TypeError: Failed to
// fetch", code: "" }`. A tela dizia "Não foi possível registrar o aviso", não
// limpava o formulário, e o segundo envio gravava o MESMO aviso de novo: a
// cliente via dois. Agora o id do aviso nasce no aparelho e é o mesmo em toda
// nova tentativa do mesmo texto para a mesma cliente; a repetição bate na
// chave primária (23505 `notificacoes_pkey`) e isso quer dizer "já gravado".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmarEnvioSePerguntar } from "./confirma-envio-para-todos";

const { estado, invokeSendPush, toastError, toastSuccess, toastWarning } =
  vi.hoisted(() => ({
    estado: {
      // O "banco" da tabela de avisos: guarda a linha antes de responder.
      avisos: [] as Array<Record<string, unknown>>,
      respostaDoAviso: "normal" as "normal" | "queda" | "recusa",
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

const lerHistorico = vi.hoisted(() =>
  vi.fn(async () => ({ data: [], error: null })),
);

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return {
          select: () => Promise.resolve({ count: 0, error: null }),
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
            not: () => ({ order: () => ({ limit: lerHistorico }) }),
          }),
        };
      }
      if (tabela === "notificacoes") {
        return {
          insert: (linha: Record<string, unknown>) => {
            if (estado.respostaDoAviso === "recusa") {
              return Promise.resolve({
                error: {
                  code: "42501",
                  message:
                    'new row violates row-level security policy for table "notificacoes"',
                },
              });
            }
            if (
              linha.id !== undefined &&
              estado.avisos.some((a) => a.id === linha.id)
            ) {
              return Promise.resolve({
                error: {
                  code: "23505",
                  message:
                    'duplicate key value violates unique constraint "notificacoes_pkey"',
                },
              });
            }
            estado.avisos.push(linha);
            return Promise.resolve({
              error:
                estado.respostaDoAviso === "queda"
                  ? { message: "TypeError: Failed to fetch", code: "" }
                  : null,
            });
          },
        };
      }
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
    },
    rpc: (nome: string, args?: { p_segment?: string }) => {
      const lista =
        args?.p_segment && args.p_segment !== "all"
          ? estado.aparelhosDoCliente
          : [];
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

describe("Avisar clientes: aviso avulso no sino com a conexão caindo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estado.avisos = [];
    estado.respostaDoAviso = "normal";
    estado.aparelhosDoCliente = [];
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
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function digitar(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const botao = (trecho: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(trecho),
    ) as HTMLButtonElement | undefined;

  const titulo = () =>
    hospedeiro.querySelector<HTMLInputElement>("#push-title")?.value;

  // O botão só habilita com alcance medido > 0: a cliente tem aparelho na
  // medição e o perde antes do toque (a mesma corrida dos testes irmãos),
  // e o envio cai no caminho do aviso só dentro do app.
  async function abrirEscrever(texto: string, corpo: string) {
    estado.aparelhosDoCliente = [
      { user_id: "cliente-1", endpoint: "e1", p256dh: "p", auth: "a" },
    ];
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(
        <AdminPushView onNavigate={vi.fn()} targetUserId="cliente-1" />,
      );
    });
    await act(async () => {
      await esperar(80);
    });
    await escrever(texto, corpo);
    estado.aparelhosDoCliente = [];
  }

  async function escrever(texto: string, corpo: string) {
    await act(async () => {
      digitar(
        hospedeiro.querySelector<HTMLInputElement>("#push-title")!,
        texto,
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

  async function tocarEmEnviar() {
    const enviar = botao("Enviar agora para");
    expect(enviar).toBeDefined();
    expect(enviar!.disabled).toBe(false);
    await act(async () => {
      enviar!.click();
    });
    await confirmarEnvioSePerguntar();
    await act(async () => {
      await esperar(20);
    });
  }

  it("gravou, caiu, envia de novo: a cliente fica com UM aviso e o formulário limpa", async () => {
    await abrirEscrever("Oferta", "Corre que acaba hoje");

    estado.respostaDoAviso = "queda";
    await tocarEmEnviar();
    expect(estado.avisos).toHaveLength(1);
    // Queda não é recusa: não afirma que não registrou...
    expect(toastError).not.toHaveBeenCalledWith(
      "Não foi possível registrar o aviso para este cliente",
    );
    // ...e o texto continua na tela para a nova tentativa.
    expect(titulo()).toBe("Oferta");

    estado.respostaDoAviso = "normal";
    await tocarEmEnviar();

    expect(estado.avisos).toHaveLength(1);
    expect(toastError).toHaveBeenCalledWith(
      "Este cliente não tem aparelho inscrito para push",
      expect.anything(),
    );
    expect(titulo()).toBe("");
    expect(invokeSendPush).not.toHaveBeenCalled();
  });

  it("depois de um aviso registrado, o mesmo texto enviado de novo é um aviso NOVO", async () => {
    await abrirEscrever("Oferta", "Corre que acaba hoje");
    await tocarEmEnviar();
    expect(titulo()).toBe("");

    estado.aparelhosDoCliente = [
      { user_id: "cliente-1", endpoint: "e1", p256dh: "p", auth: "a" },
    ];
    await escrever("Oferta", "Corre que acaba hoje");
    estado.aparelhosDoCliente = [];
    await tocarEmEnviar();

    expect(estado.avisos).toHaveLength(2);
    expect(estado.avisos[0].id).not.toBe(estado.avisos[1].id);
  });

  it("controle: recusa real do banco (42501) continua dizendo que não registrou", async () => {
    await abrirEscrever("Oferta", "Corre que acaba hoje");
    estado.respostaDoAviso = "recusa";
    await tocarEmEnviar();

    expect(estado.avisos).toHaveLength(0);
    expect(toastError).toHaveBeenCalledWith(
      "Não foi possível registrar o aviso para este cliente",
    );
    expect(titulo()).toBe("Oferta");
  });
});
