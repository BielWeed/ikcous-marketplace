// @vitest-environment jsdom
//
// Avisar clientes — as BORDAS do botão "Enviar agora" que o caminho feliz não
// mostra: (1) com UM aparelho inscrito a pergunta de confirmação diz "1 aparelho
// inscrito" (singular), não "1 aparelhos inscritos"; (2) com o envio em andamento
// o botão fica travado e um segundo toque não abre outra pergunta nem manda de
// novo (envio não se desfaz); (3) sem internet o botão e os campos ficam
// travados mesmo com a mensagem pronta, e nada é enviado.
//
// Mesmo andaime de admin-push-todos-os-clientes-pede-confirmacao.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  subCount: 8,
  alvos: [] as unknown[],
}));

const conexao = vi.hoisted(() => ({ semInternet: false }));

const registros = vi.hoisted(() => ({
  pushLog: [] as Record<string, unknown>[],
  notificacoes: [] as Record<string, unknown>[],
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
  useOnlineStatus: () => conexao.semInternet,
}));
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

// Consulta vazia que aceita `.order().order().range()` em qualquer ordem.
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
            registros.notificacoes.push(...(Array.isArray(l) ? l : [l]));
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

describe("AdminPushView — bordas do botão de enviar", () => {
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
    conexao.semInternet = false;
    registros.pushLog = [];
    registros.notificacoes = [];

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

  async function renderizar() {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(<AdminPushView onNavigate={vi.fn()} />);
    });
  }

  async function abrirTela() {
    await renderizar();
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

  const campoTitulo = () =>
    hospedeiro.querySelector<HTMLInputElement>("#push-title");
  const campoCorpo = () =>
    hospedeiro.querySelector<HTMLTextAreaElement>("#push-body");

  async function preencherMensagem(titulo: string, corpo: string) {
    await act(async () => {
      const t = campoTitulo();
      const c = campoCorpo();
      if (!t || !c) throw new Error("campos da mensagem não encontrados");
      digitar(t, titulo);
      digitar(c, corpo);
    });
    await act(async () => {
      await esperar(260);
    });
  }

  // Enquanto envia, o rótulo troca para "Enviando Notificação...".
  const botaoDeEnviar = () =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      /Enviar agora para|Enviando Notificação/.test(b.textContent ?? ""),
    );

  const janela = () =>
    document.querySelector<HTMLElement>('[data-testid="confirmar-acao"]');

  async function tocarNoBotao() {
    const botao = botaoDeEnviar();
    if (!botao) throw new Error("botão de enviar não encontrado");
    await act(async () => {
      botao.click();
    });
    await act(async () => {
      await esperar(80);
    });
  }

  async function confirmarNaJanela() {
    const botao = Array.from(janela()?.querySelectorAll("button") ?? []).find(
      (b) => (b.textContent ?? "").includes("Enviar agora"),
    );
    if (!botao)
      throw new Error("botão da janela de confirmação não encontrado");
    await act(async () => {
      botao.click();
    });
    await act(async () => {
      await esperar(120);
    });
  }

  it("com UM aparelho inscrito a pergunta fala no singular: '1 aparelho inscrito'", async () => {
    banco.subCount = 1;
    banco.alvos = [alvo(1)];
    await abrirTela();
    await preencherMensagem("Oferta de sábado", "Corre que acaba hoje!");

    expect(botaoDeEnviar()?.textContent).toContain(
      "Enviar agora para 1 aparelho",
    );
    expect(botaoDeEnviar()?.textContent).not.toContain("1 aparelhos");

    await tocarNoBotao();

    const texto = janela()?.textContent ?? "";
    expect(texto).toContain("Push para 1 aparelho inscrito");
    expect(texto).not.toContain("inscritos");
    expect(texto).not.toContain("1 aparelhos");
    expect(invokeSendPush).not.toHaveBeenCalled();
  });

  it("com o envio em andamento o botão fica travado e um segundo toque não abre outra pergunta nem manda de novo", async () => {
    // O envio fica pendurado até o teste soltar.
    let soltarEnvio: (valor: unknown) => void = () => {};
    invokeSendPush.mockReturnValue(
      new Promise((resolve) => {
        soltarEnvio = resolve;
      }),
    );
    await abrirTela();
    await preencherMensagem("Oferta de sábado", "Corre que acaba hoje!");

    await tocarNoBotao();
    await confirmarNaJanela();

    // Enviando: o rótulo mudou e o botão está travado.
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
    const enviando = botaoDeEnviar();
    expect(enviando?.textContent).toContain("Enviando Notificação");
    expect(enviando?.disabled).toBe(true);

    // Segundo toque: nada acontece (nem pergunta nova, nem outro envio).
    await tocarNoBotao();
    expect(janela()).toBeNull();
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
    expect(registros.pushLog).toHaveLength(1);

    // Terminou: o botão volta ao normal.
    await act(async () => {
      soltarEnvio({
        data: { enviados: 8, falharam: 0, falhas: [] },
        error: null,
      });
      await esperar(120);
    });
    expect(botaoDeEnviar()?.textContent).toContain("Enviar agora para");
    expect(botaoDeEnviar()?.disabled).toBe(false);
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
  });

  it("sem internet o botão e os campos ficam travados mesmo com a mensagem pronta, e nada é enviado", async () => {
    await abrirTela();
    await preencherMensagem("Oferta de sábado", "Corre que acaba hoje!");
    expect(botaoDeEnviar()?.disabled).toBe(false);

    conexao.semInternet = true;
    await renderizar();
    await act(async () => {
      await esperar(40);
    });

    expect(botaoDeEnviar()?.disabled).toBe(true);
    expect(campoTitulo()?.disabled).toBe(true);
    expect(campoCorpo()?.disabled).toBe(true);

    await tocarNoBotao();
    expect(janela()).toBeNull();
    expect(invokeSendPush).not.toHaveBeenCalled();
    expect(registros.pushLog).toHaveLength(0);
    expect(registros.notificacoes).toHaveLength(0);

    // Voltou a internet: o mesmo botão volta a funcionar.
    conexao.semInternet = false;
    await renderizar();
    await act(async () => {
      await esperar(40);
    });
    expect(botaoDeEnviar()?.disabled).toBe(false);
  });
});
