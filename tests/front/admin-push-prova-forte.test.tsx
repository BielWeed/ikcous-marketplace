// @vitest-environment jsdom
//
// Prova forte da tela Avisar clientes (25/11/2026, caça por mutação). Dois
// defeitos de uma linha passavam em todos os testes vizinhos:
//   - o aviso DENTRO do app para um grupo de clientes é gravado em lotes de 100
//     contas (o banco recusa lote grande demais); com 250 contas são três
//     gravações de 100, 100 e 50, uma linha por conta, sem repetir ninguém;
//   - quando NENHUM aparelho recebeu E o envio estourou o tempo, o aviso diz
//     quantos dispositivos nem chegaram a ser tentados (singular e plural).
// Mesmo andaime de admin-push-campanha-borda-do-envio. Só fixtures inventadas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { AdminPushView as TipoTela } from "@/views/admin/AdminPushView";

const banco = vi.hoisted(() => ({
  subCount: 8,
  alvos: [] as unknown[],
}));

const registros = vi.hoisted(() => ({
  pushLog: [] as Record<string, unknown>[],
  // Uma entrada por GRAVAÇÃO no banco (cada uma com as suas linhas).
  gravacoesDeNotificacao: [] as Record<string, unknown>[][],
}));

const toasts = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
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
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({ isSupported: false, subscribe: vi.fn() }),
}));
vi.mock("@/hooks/useVOR", () => ({
  useVOR: () => ({ recordAction: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: toasts }));

const invokeSendPush = vi.hoisted(() => vi.fn());

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
          select: () => Promise.resolve({ count: banco.subCount, error: null }),
        };
      }
      if (tabela === "push_notifications_log") {
        return {
          select: () => ({
            not: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
          insert: (linha: Record<string, unknown>) => {
            const registrado = {
              id: `log-${registros.pushLog.length + 1}`,
              ...linha,
            };
            registros.pushLog.push(registrado);
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({ data: { id: registrado.id }, error: null }),
              }),
            };
          },
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (tabela === "notificacoes") {
        return {
          insert: (l: Record<string, unknown> | Record<string, unknown>[]) => {
            registros.gravacoesDeNotificacao.push(Array.isArray(l) ? l : [l]);
            return Promise.resolve({ error: null });
          },
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
    rpc: (nome: string) => {
      const r =
        nome === "get_segmented_push_count"
          ? Promise.resolve({ data: banco.alvos.length, error: null })
          : Promise.resolve({ data: banco.alvos, error: null });
      return Object.assign(r, { order: () => r, range: () => r });
    },
    functions: { invoke: invokeSendPush },
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

const alvo = (n: number) => ({
  user_id: `u${n}`,
  endpoint: `https://push.example/${n}`,
  p256dh: `p${n}`,
  auth: `a${n}`,
});

// O import da tela é caro: mora na preparação, não dentro do teste.
let AdminPushView: typeof TipoTela;

beforeAll(async () => {
  ({ AdminPushView } = await import("@/views/admin/AdminPushView"));
}, 60_000);

describe("AdminPushView — prova forte do envio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    invokeSendPush.mockResolvedValue({
      data: { enviados: 1, falharam: 0, falhas: [] },
      error: null,
    });
    banco.subCount = 8;
    banco.alvos = Array.from({ length: 8 }, (_, i) => alvo(i + 1));
    registros.pushLog = [];
    registros.gravacoesDeNotificacao = [];

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

  async function abrirTela() {
    await act(async () => {
      raiz.render(<AdminPushView onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await esperar(80);
    });
  }

  function digitar(
    elemento: HTMLInputElement | HTMLTextAreaElement,
    valor: string,
  ) {
    const prototipo =
      elemento instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototipo, "value")?.set?.call(
      elemento,
      valor,
    );
    elemento.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function preencherMensagem(titulo: string, corpo: string) {
    await act(async () => {
      const t = hospedeiro.querySelector<HTMLInputElement>("#push-title");
      const c = hospedeiro.querySelector<HTMLTextAreaElement>("#push-body");
      if (!t || !c) throw new Error("campos da mensagem não encontrados");
      digitar(t, titulo);
      digitar(c, corpo);
    });
    await act(async () => {
      await esperar(260);
    });
  }

  async function escolherGrupo(rotulo: string) {
    const chip = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(rotulo),
    );
    if (!chip) throw new Error(`grupo "${rotulo}" não está na tela`);
    await act(async () => {
      chip.click();
    });
    await act(async () => {
      await esperar(80);
    });
  }

  const botaoDeEnviar = () =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      /Enviar agora para|Enviando Notificação/.test(b.textContent ?? ""),
    );
  const janela = () =>
    document.querySelector<HTMLElement>('[data-testid="confirmar-acao"]');

  async function enviarEConfirmar() {
    const botao = botaoDeEnviar();
    if (!botao) throw new Error("botão de enviar não encontrado");
    await act(async () => {
      botao.click();
    });
    await act(async () => {
      await esperar(80);
    });
    const confirmar = Array.from(
      janela()?.querySelectorAll("button") ?? [],
    ).find((b) => (b.textContent ?? "").includes("Enviar agora"));
    if (!confirmar) throw new Error("janela de confirmação não abriu");
    await act(async () => {
      confirmar.click();
    });
    await act(async () => {
      await esperar(200);
    });
  }

  it("grupo com 250 contas: o aviso dentro do app é gravado em lotes de 100, 100 e 50, uma linha por conta", async () => {
    banco.subCount = 250;
    banco.alvos = Array.from({ length: 250 }, (_, i) => alvo(i + 1));
    await abrirTela();
    await preencherMensagem("Sentimos sua falta", "Volte a nos visitar!");
    await escolherGrupo("Inativos há 30 dias");
    await enviarEConfirmar();

    expect(registros.gravacoesDeNotificacao.map((l) => l.length)).toEqual([
      100, 100, 50,
    ]);
    const linhas = registros.gravacoesDeNotificacao.flat();
    expect(new Set(linhas.map((l) => l.usuario_id)).size).toBe(250);
    expect(linhas[0]).toMatchObject({
      titulo: "Sentimos sua falta",
      mensagem: "Volte a nos visitar!",
      tipo: "aviso",
      usuario_id: "u1",
      dados: { segment: "inactive" },
    });
    expect(linhas.at(-1)).toMatchObject({ usuario_id: "u250" });
  });

  it.each([
    {
      naoTentados: 1,
      frase:
        "1 dispositivo nem chegou a ser tentado porque o envio demorou demais.",
    },
    {
      naoTentados: 2,
      frase:
        "2 dispositivos nem chegaram a ser tentados porque o envio demorou demais.",
    },
  ])(
    "ninguém recebeu e $naoTentados nem foi tentado: o aviso diz quantos ficaram de fora",
    async ({ naoTentados, frase }) => {
      invokeSendPush.mockResolvedValue({
        data: {
          enviados: 0,
          falharam: 8 - naoTentados,
          naoTentados,
          falhas: [
            {
              status: 410,
              motivo: "push service respondeu 410 Gone",
              quantidade: 8 - naoTentados,
            },
          ],
        },
        error: null,
      });
      await abrirTela();
      await preencherMensagem("Oferta de sábado", "Corre que acaba hoje!");
      await enviarEConfirmar();

      expect(toasts.error).toHaveBeenCalledWith(
        "Nenhum dos 8 dispositivos recebeu",
        { description: expect.stringContaining(frase) },
      );
      expect(toasts.success).not.toHaveBeenCalled();
    },
  );
});
