// @vitest-environment jsdom
//
// Avisar clientes: quatro defeitos de honestidade da tela.
//   B2. titulo/mensagem so com espacos passavam e saia aviso em branco;
//   B3. o envio lia os aparelhos numa chamada so: a RPC devolve no maximo
//       1.000 linhas, entao quem passava disso era cortado em silencio;
//   B4. o historico mostrava a rota crua ("/search") e o publico "Todos"
//       dizia "Toda a base da loja" quando so alcanca quem aceitou avisos.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estado, invokeSendPush, chamadasDeRange, toastError } = vi.hoisted(
  () => ({
    estado: {
      aparelhos: [] as Record<string, unknown>[],
      historico: [] as Record<string, unknown>[],
    },
    invokeSendPush: vi.fn(),
    chamadasDeRange: [] as [number, number][],
    toastError: vi.fn(),
  }),
);

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
  toast: { success: vi.fn(), error: toastError, warning: vi.fn() },
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
              limit: () =>
                Promise.resolve({ data: estado.historico, error: null }),
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
      // Como o PostgREST: no maximo o pedaco pedido por `.range()`.
      const consulta = {
        order: () => consulta,
        range: (de: number, ate: number) => {
          chamadasDeRange.push([de, ate]);
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

describe("Avisar clientes: envio paginado, texto em branco e historico amigavel", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    chamadasDeRange.length = 0;
    estado.historico = [];
    estado.aparelhos = Array.from({ length: 1500 }, (_, i) => ({
      user_id: `u${i}`,
      endpoint: `e${i}`,
      p256dh: "p",
      auth: "a",
    }));
    invokeSendPush.mockResolvedValue({
      data: { enviados: 1500, falharam: 0, falhas: [] },
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

  async function enviar() {
    await act(async () => {
      botao("Enviar agora para")!.click();
    });
    await act(async () => {
      await esperar(80);
    });
  }

  it("B2: titulo e mensagem so com espacos nao saem", async () => {
    await abrirTela();
    await escrever("   ", "   ");
    await enviar();

    expect(toastError).toHaveBeenCalledWith("Preencha título e mensagem");
    expect(invokeSendPush).not.toHaveBeenCalled();
  });

  it("B3: o envio para Todos pega os 1.500 aparelhos, nao so os primeiros 1.000", async () => {
    await abrirTela();
    await escrever("Novidade", "Chegou colecao nova");
    await enviar();

    expect(invokeSendPush).toHaveBeenCalledTimes(1);
    const { tokens } = invokeSendPush.mock.calls[0][1].body;
    expect(tokens).toHaveLength(1500);
    expect(
      new Set(tokens.map((t: { endpoint: string }) => t.endpoint)).size,
    ).toBe(1500);
    expect(chamadasDeRange).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("B3b: a lista vai para a send-push com os servicos intercalados (o teto de tempo nao corta sempre iPhone/Windows) e sem perder ninguem", async () => {
    const servicos = [
      "https://fcm.googleapis.com/fcm/send/",
      "https://web.push.apple.com/",
      "https://wns2-par02p.notify.windows.com/w/?token=",
    ];
    // Como o banco entrega: ordenada por endereco, agrupada por empresa.
    estado.aparelhos = servicos.flatMap((base, s) =>
      Array.from({ length: 30 }, (_, i) => ({
        user_id: `u${s}-${i}`,
        endpoint: `${base}${i}`,
        p256dh: "p",
        auth: "a",
      })),
    );
    await abrirTela();
    await escrever("Novidade", "Chegou colecao nova");
    await enviar();

    const { tokens } = invokeSendPush.mock.calls[0][1].body;
    const hosts = tokens.map(
      (t: { endpoint: string }) => new URL(t.endpoint).hostname,
    );
    expect(new Set(hosts.slice(0, 3)).size).toBe(3);
    expect(new Set(hosts.slice(0, 30)).size).toBe(3);
    expect(tokens).toHaveLength(90);
    expect(
      new Set(tokens.map((t: { endpoint: string }) => t.endpoint)),
    ).toEqual(new Set(estado.aparelhos.map((t) => t.endpoint)));
  });

  it("B4: o historico mostra o nome da tela, nao a rota crua, e 'Todos' nao promete a base inteira", async () => {
    estado.historico = [
      {
        id: "h1",
        title: "Oferta",
        body: "Corre",
        url: "/search",
        recipient_count: 3,
        created_at: new Date().toISOString(),
      },
    ];
    await abrirTela();
    await act(async () => {
      botao("O que já foi ao ar")!.click();
    });

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Ao clicar: Busca de produtos");
    expect(texto).not.toContain("/search");
    expect(texto).toContain("Quem aceitou receber avisos");
    expect(texto).not.toContain("Toda a base da loja");
  });
});
