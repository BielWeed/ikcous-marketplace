// @vitest-environment jsdom
//
// O modelo pronto "Cupom de R$20" preenchia "Use o cupom BEMVINDO" e o
// "Desconto Relâmpago" prometia "10% OFF ativo por 1 hora" — sem que a loja
// tivesse criado cupom nenhum. A lojista clicava no modelo, enviava na
// primeira campanha, e a cliente digitava BEMVINDO e lia "O cupom BEMVINDO
// não existe". Aqui se prende, na tela de verdade:
//   1. o modelo NÃO traz código fixo nem desconto inventado: traz o marcador;
//   2. o envio fica travado, com o motivo na cara, enquanto o marcador
//      estiver no texto;
//   3. citar um código que a loja não tem (ou que está desligado) avisa
//      antes de sair — e o segundo toque, de quem sabe o que faz, envia.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estado } = vi.hoisted(() => ({
  estado: {
    cupons: [] as Record<string, unknown>[],
    erroDosCupons: null as null | { message: string },
    consultasDeCupom: [] as unknown[],
  },
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
          select: () => Promise.resolve({ count: 3, error: null }),
        };
      }
      if (tabela === "coupons") {
        return {
          select: () => ({
            in: (_coluna: string, codigos: string[]) => {
              estado.consultasDeCupom.push(codigos);
              if (estado.erroDosCupons) {
                return Promise.resolve({
                  data: null,
                  error: estado.erroDosCupons,
                });
              }
              return Promise.resolve({
                data: estado.cupons.filter((c) =>
                  codigos.includes(String(c.code)),
                ),
                error: null,
              });
            },
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
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    },
    rpc: (nome: string) => {
      const alvos = [
        { user_id: "u1", endpoint: "e1", p256dh: "p1", auth: "a1" },
        { user_id: "u2", endpoint: "e2", p256dh: "p2", auth: "a2" },
        { user_id: "u3", endpoint: "e3", p256dh: "p3", auth: "a3" },
      ];
      if (nome === "get_segmented_push_count") {
        return Promise.resolve({ data: alvos.length, error: null });
      }
      if (nome === "get_segmented_push_targets") {
        return Promise.resolve({ data: alvos, error: null });
      }
      return Promise.resolve({ data: null, error: new Error("rpc?") });
    },
    functions: { invoke: invokeSendPush },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AdminPushView — modelo pronto não promete cupom que a loja não criou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    invokeSendPush.mockResolvedValue({
      data: { enviados: 3, falharam: 0, falhas: [] },
      error: null,
    });
    estado.cupons = [];
    estado.erroDosCupons = null;
    estado.consultasDeCupom = [];

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
    hospedeiro.querySelector<HTMLInputElement>("#push-title")!;
  const campoCorpo = () =>
    hospedeiro.querySelector<HTMLTextAreaElement>("#push-body")!;

  async function escrever(titulo: string, corpo: string) {
    await act(async () => {
      digitar(campoTitulo(), titulo);
      digitar(campoCorpo(), corpo);
    });
    await act(async () => {
      await esperar(260);
    });
  }

  async function clicarModelo(trecho: string) {
    const pilula = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(trecho),
    );
    expect(pilula).toBeTruthy();
    await act(async () => {
      pilula!.click();
    });
    await act(async () => {
      await esperar(40);
    });
  }

  const botaoEnviar = () =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Enviar agora para"),
    ) as HTMLButtonElement;

  async function enviar() {
    await act(async () => {
      botaoEnviar().click();
    });
    await act(async () => {
      await esperar(80);
    });
  }

  it("o modelo de cupom de boas-vindas traz o marcador, nunca BEMVINDO nem R$20", async () => {
    await abrirTela();
    await clicarModelo("Cupom de boas-vindas");

    const tudo = `${campoTitulo().value} ${campoCorpo().value}`;
    expect(tudo).toContain("[CÓDIGO DO SEU CUPOM]");
    expect(tudo).not.toMatch(/BEMVINDO/i);
    expect(tudo).not.toMatch(/R\$\s*\d/);
  });

  it("o modelo de oferta não promete 10% OFF nem relógio", async () => {
    await abrirTela();
    await clicarModelo("Oferta com cupom");

    const tudo = `${campoTitulo().value} ${campoCorpo().value}`;
    expect(tudo).toContain("[CÓDIGO DO SEU CUPOM]");
    expect(tudo).not.toMatch(/10\s*%/);
    expect(tudo).not.toMatch(/1 hora/i);
  });

  it("com o marcador no texto o envio fica travado, com o motivo na tela", async () => {
    await abrirTela();
    await clicarModelo("Cupom de boas-vindas");

    expect(botaoEnviar().disabled).toBe(true);
    const aviso = hospedeiro.querySelector(
      '[data-testid="aviso-codigo-pendente"]',
    );
    expect(aviso).toBeTruthy();
    expect(aviso?.textContent).toMatch(/Cupons/);
    expect(aviso?.textContent).toContain("[CÓDIGO DO SEU CUPOM]");

    // mesmo forçando o clique, nada sai
    await enviar();
    expect(invokeSendPush).not.toHaveBeenCalled();
  });

  it("o modelo do carrinho (sem cupom) não trava nada", async () => {
    await abrirTela();
    await clicarModelo("Lembrete de Carrinho");

    expect(
      hospedeiro.querySelector('[data-testid="aviso-codigo-pendente"]'),
    ).toBeNull();
    expect(botaoEnviar().disabled).toBe(false);
  });

  it("trocar o marcador por um cupom que existe libera e envia", async () => {
    estado.cupons = [
      {
        code: "VERAO10",
        active: true,
        valid_until: null,
        usage_limit: null,
        usage_count: 0,
      },
    ];
    await abrirTela();
    await clicarModelo("Cupom de boas-vindas");
    await escrever("Oferta na loja", "Use o cupom VERAO10 na sua compra.");

    expect(botaoEnviar().disabled).toBe(false);
    expect(
      hospedeiro.querySelector('[data-testid="aviso-codigo-pendente"]'),
    ).toBeNull();

    await enviar();
    expect(estado.consultasDeCupom).toEqual([["VERAO10"]]);
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
  });

  it("citar um código que a loja não criou avisa antes de enviar", async () => {
    estado.cupons = [];
    await abrirTela();
    await escrever("Presente para você", "Use o cupom BEMVINDO e economize.");

    await enviar();

    expect(invokeSendPush).not.toHaveBeenCalled();
    const { toast } = await import("sonner");
    const chamada = (toast.error as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) =>
        /BEMVINDO/.test(String(c[0]) + String(JSON.stringify(c[1]))),
    );
    expect(chamada).toBeTruthy();
  });

  it("cupom desligado também avisa; o segundo toque, de quem sabe o que faz, envia", async () => {
    estado.cupons = [
      {
        code: "VERAO10",
        active: false,
        valid_until: null,
        usage_limit: null,
        usage_count: 0,
      },
    ];
    await abrirTela();
    await escrever("Oferta", "Use o cupom VERAO10 hoje.");

    await enviar();
    expect(invokeSendPush).not.toHaveBeenCalled();

    await enviar();
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
  });

  it("se não deu para conferir o cupom, não envia calado: avisa", async () => {
    estado.erroDosCupons = { message: "rede caiu" };
    await abrirTela();
    await escrever("Oferta", "Use o cupom VERAO10 hoje.");

    await enviar();
    expect(invokeSendPush).not.toHaveBeenCalled();
    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalled();
  });

  it("texto sem cupom citado nem consulta a tabela de cupons", async () => {
    await abrirTela();
    await escrever("Novidades", "Chegaram produtos novos na loja.");

    await enviar();
    expect(estado.consultasDeCupom).toEqual([]);
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
  });
});
