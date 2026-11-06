// @vitest-environment jsdom
//
// Avisar clientes: o envio para TODOS os clientes saía com dois toques (o
// público "Todos" já vem marcado, e "Enviar agora" mandava na hora) e sem
// pergunta nenhuma — e depois de enviar não dá para desfazer. Agora o
// "Enviar agora" do público "Todos" abre a janela do app (a mesma dos fluxos de
// dinheiro do painel) dizendo para quantos aparelhos vai e que não dá para
// desfazer. Só o botão da janela envia; voltar, Esc e a tela que some não
// enviam nada. Segmento específico e cliente específico seguem sem a pergunta
// extra (o alcance deles é pequeno e escolhido de propósito).
//
// Mesmo andaime de admin-push-envio-honesto.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estadoDoBanco } = vi.hoisted(() => ({
  estadoDoBanco: {
    subCount: 8,
    porSegmento: { vip: [], inactive: [], new: [] } as Record<
      string,
      unknown[]
    >,
    alvosDoClienteEspecifico: [] as unknown[],
    alvosDoSegmentoTodos: [] as unknown[],
  },
}));

const inserts = vi.hoisted(() => ({
  notificacoes: [] as Record<string, unknown>[],
  pushLog: [] as Record<string, unknown>[],
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

const invokeSendPush = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return {
          select: () =>
            Promise.resolve({ count: estadoDoBanco.subCount, error: null }),
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
          insert: (linha: Record<string, unknown>) => {
            const registrado = {
              id: `log-${inserts.pushLog.length + 1}`,
              ...linha,
            };
            inserts.pushLog.push(registrado);
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
            inserts.notificacoes.push(...(Array.isArray(l) ? l : [l]));
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
    rpc: (...a: any[]) => {
      const r = Reflect.apply(
        (nome: string, args: { p_segment: string }) => {
          const seg = args.p_segment;
          const lista = () => {
            if (seg === "vip" || seg === "inactive" || seg === "new") {
              return estadoDoBanco.porSegmento[args.p_segment] ?? [];
            }
            if (seg === "all") return estadoDoBanco.alvosDoSegmentoTodos;
            return estadoDoBanco.alvosDoClienteEspecifico;
          };
          if (nome === "get_segmented_push_count") {
            return Promise.resolve({ data: lista().length, error: null });
          }
          return Promise.resolve({ data: lista(), error: null });
        },
        null,
        a,
      );
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

// Consulta vazia que aceita `.order().order().range()` em qualquer ordem.
function encadeavelVazio(): Promise<{ data: never[]; error: null }> {
  const p = Promise.resolve({ data: [] as never[], error: null });
  return Object.assign(p, {
    order: () => encadeavelVazio(),
    range: () => encadeavelVazio(),
  });
}

const esperar = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

const alvo = (n: number) => ({
  user_id: `u${n}`,
  endpoint: `https://push.example/${n}`,
  p256dh: `p${n}`,
  auth: `a${n}`,
});

describe("AdminPushView — enviar para TODOS os clientes pede confirmação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    invokeSendPush.mockResolvedValue({
      data: { enviados: 8, falharam: 0, falhas: [] },
      error: null,
    });
    estadoDoBanco.subCount = 8;
    estadoDoBanco.porSegmento = { vip: [], inactive: [], new: [] };
    estadoDoBanco.alvosDoClienteEspecifico = [];
    estadoDoBanco.alvosDoSegmentoTodos = Array.from({ length: 8 }, (_, i) =>
      alvo(i + 1),
    );
    inserts.notificacoes = [];
    inserts.pushLog = [];

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
    const campoTitulo =
      hospedeiro.querySelector<HTMLInputElement>("#push-title");
    const campoCorpo =
      hospedeiro.querySelector<HTMLTextAreaElement>("#push-body");
    await act(async () => {
      digitar(campoTitulo!, titulo);
      digitar(campoCorpo!, corpo);
    });
    await act(async () => {
      await esperar(260);
    });
  }

  const botaoEnviar = () =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Enviar agora para"),
    ) as HTMLButtonElement;

  const janela = () =>
    document.querySelector<HTMLElement>('[data-testid="confirmar-acao"]');

  const botaoDaJanela = (rotulo: string) =>
    Array.from(janela()?.querySelectorAll("button") ?? []).find((b) =>
      (b.textContent ?? "").includes(rotulo),
    ) as HTMLButtonElement | undefined;

  async function tocarEnviar() {
    expect(botaoEnviar().disabled).toBe(false);
    await act(async () => {
      botaoEnviar().click();
    });
    await act(async () => {
      await esperar(80);
    });
  }

  async function tocarNaJanela(rotulo: string) {
    const botao = botaoDaJanela(rotulo);
    expect(botao).toBeTruthy();
    await act(async () => {
      botao!.click();
    });
    await act(async () => {
      await esperar(120);
    });
  }

  it("Todos: 'Enviar agora' abre a pergunta com o número de aparelhos e o aviso de que não desfaz, e NADA é enviado ainda", async () => {
    await abrirTela();
    await preencherMensagem("Oferta de sábado", "Corre que acaba hoje!");

    await tocarEnviar();

    expect(janela()).not.toBeNull();
    const texto = janela()?.textContent ?? "";
    expect(texto).toContain("todos os clientes");
    expect(texto).toContain("8 aparelhos");
    expect(texto).toMatch(/não dá para desfazer/i);
    expect(invokeSendPush).not.toHaveBeenCalled();
    expect(inserts.pushLog).toHaveLength(0);
    expect(inserts.notificacoes).toHaveLength(0);
  });

  it("Voltar na pergunta não envia nada e a mensagem digitada continua na tela", async () => {
    await abrirTela();
    await preencherMensagem("Oferta de sábado", "Corre que acaba hoje!");

    await tocarEnviar();
    await tocarNaJanela("Voltar");

    expect(invokeSendPush).not.toHaveBeenCalled();
    expect(inserts.pushLog).toHaveLength(0);
    expect(janela()).toBeNull();
    expect(
      hospedeiro.querySelector<HTMLInputElement>("#push-title")?.value,
    ).toBe("Oferta de sábado");
    // e dá para tentar de novo: a pergunta reabre
    await tocarEnviar();
    expect(janela()).not.toBeNull();
  });

  it("confirmar na pergunta envia UMA vez, com o texto e o público certos", async () => {
    await abrirTela();
    await preencherMensagem("Oferta de sábado", "Corre que acaba hoje!");

    await tocarEnviar();
    await tocarNaJanela("Enviar agora");

    expect(invokeSendPush).toHaveBeenCalledTimes(1);
    expect(inserts.pushLog).toHaveLength(1);
    expect(inserts.pushLog[0]).toMatchObject({ title: "Oferta de sábado" });
  });

  it("toque repetido em 'Enviar agora' com a pergunta aberta não abre duas e não envia em dobro", async () => {
    await abrirTela();
    await preencherMensagem("Oferta de sábado", "Corre que acaba hoje!");

    await tocarEnviar();
    await act(async () => {
      botaoEnviar().click();
    });
    await act(async () => {
      await esperar(40);
    });
    expect(
      document.querySelectorAll('[data-testid="confirmar-acao"]'),
    ).toHaveLength(1);

    await tocarNaJanela("Enviar agora");

    expect(invokeSendPush).toHaveBeenCalledTimes(1);
  });

  it("mensagem incompleta: avisa do que falta ANTES, sem abrir a pergunta", async () => {
    await abrirTela();

    await tocarEnviar();

    expect(janela()).toBeNull();
    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalledWith("Preencha título e mensagem");
    expect(invokeSendPush).not.toHaveBeenCalled();
  });

  it("segmento específico (Inativos): envia direto, sem a pergunta extra", async () => {
    estadoDoBanco.porSegmento.inactive = [alvo(1), alvo(2)];
    await abrirTela();
    await preencherMensagem("Sentimos sua falta", "Volte a nos visitar!");
    const chip = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Inativos há 30 dias"),
    );
    await act(async () => {
      chip!.click();
    });
    await act(async () => {
      await esperar(80);
    });

    await tocarEnviar();

    expect(janela()).toBeNull();
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
  });

  it("cliente específico (vindo da ficha): envia direto, sem a pergunta extra", async () => {
    estadoDoBanco.alvosDoClienteEspecifico = [alvo(9)];
    await abrirTela("cliente-9");
    await preencherMensagem("Chegou novidade", "Confere lá na loja!");

    await tocarEnviar();

    expect(janela()).toBeNull();
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
  });
});
