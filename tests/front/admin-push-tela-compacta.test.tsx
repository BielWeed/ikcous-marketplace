// @vitest-environment jsdom
//
// Tela "Avisar clientes" compacta (redesenho aprovado pelo dono em
// 22/10/2026): menos blocos, nenhuma informação repetida. Este arquivo prende
// a ESTRUTURA nova — o que aparece, o que sumiu por ser repetido e o que ficou
// atrás de um toque. A lógica de envio e de contagem continua presa nos
// arquivos irmãos (admin-push-envio-honesto, admin-push-view-contadores, ...).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estadoDoBanco } = vi.hoisted(() => ({
  estadoDoBanco: {
    subCount: 8,
    porSegmento: {
      vip: [{ id: "1" }, { id: "2" }] as unknown[],
      inactive: [] as unknown[],
      new: [] as unknown[],
    } as Record<string, unknown[] | null>,
    historico: [] as Record<string, unknown>[],
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
  usePushNotifications: () => ({
    isSupported: true,
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
          select: () =>
            Promise.resolve({ count: estadoDoBanco.subCount, error: null }),
        };
      }
      if (tabela === "push_notifications_log") {
        return {
          select: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({ data: estadoDoBanco.historico, error: null }),
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
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    },
    rpc: (nome: string, args: { p_segment: string }) => {
      if (
        nome !== "get_segmented_push_targets" &&
        nome !== "get_segmented_push_count"
      ) {
        return Promise.resolve({
          data: null,
          error: new Error("rpc desconhecida"),
        });
      }
      const linhas = estadoDoBanco.porSegmento[args.p_segment] ?? null;
      if (linhas === null) {
        return Promise.resolve({
          data: null,
          error: new Error("sem segmento"),
        });
      }
      if (nome === "get_segmented_push_count") {
        return Promise.resolve({ data: linhas.length, error: null });
      }
      return Promise.resolve({ data: linhas, error: null });
    },
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

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AdminPushView — tela compacta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estadoDoBanco.subCount = 8;
    estadoDoBanco.porSegmento = {
      vip: [{ id: "1" }, { id: "2" }],
      inactive: [],
      new: [],
    };
    estadoDoBanco.historico = [];
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
    vi.restoreAllMocks();
  });

  async function abrirTela() {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(<AdminPushView onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await esperar(50);
    });
  }

  const texto = () => hospedeiro.textContent ?? "";
  const botoes = () =>
    Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button"));
  const botaoCom = (parte: string) =>
    botoes().find((b) => (b.textContent ?? "").includes(parte));

  it("o topo tem só o título, a ajuda e UM selo de estado — sem subtítulo nem contador repetido", async () => {
    await abrirTela();

    expect(hospedeiro.querySelector("h1")?.textContent).toContain(
      "Avisar clientes",
    );
    const selo = hospedeiro.querySelector('[data-testid="selo-no-ar"]');
    expect(selo?.textContent).toBe("No ar · 8 aparelhos");

    expect(texto()).not.toContain("Envie mensagens e avisos");
    expect(texto()).not.toContain("Celulares Cadastrados");
    expect(texto()).not.toContain("Clientes Prontos");
    expect(texto()).not.toContain("Receberão:");
    expect(texto()).not.toContain("Dica de Vendas");
  });

  it("modelos prontos vêm sob um rótulo, juntos num só cartão, e continuam preenchendo a mensagem", async () => {
    await abrirTela();

    expect(texto()).toContain("Começar de um modelo pronto");
    const grupo = hospedeiro.querySelector('[data-testid="modelos-prontos"]');
    expect(grupo).not.toBeNull();
    const modelos = Array.from(grupo!.querySelectorAll("button"));
    expect(modelos.map((m) => m.textContent)).toEqual([
      "Oferta com cupom",
      "Lembrete de Carrinho",
      "Cupom de boas-vindas",
    ]);
    for (const m of modelos) {
      expect(m.getAttribute("aria-pressed")).toBe("false");
    }

    await act(async () => {
      modelos[1].click();
    });
    expect(modelos[1].getAttribute("aria-pressed")).toBe("true");
    expect(
      hospedeiro.querySelector<HTMLInputElement>("#push-title")?.value,
    ).not.toBe("");
  });

  it("título e mensagem moram no MESMO cartão, com as mesmas etiquetas e contadores", async () => {
    await abrirTela();

    const cartao = hospedeiro.querySelector(
      '[data-testid="cartao-de-escrita"]',
    );
    expect(cartao).not.toBeNull();
    expect(cartao!.querySelector("#push-title")).not.toBeNull();
    expect(cartao!.querySelector("#push-body")).not.toBeNull();
    expect(cartao!.textContent).toContain("0/60");
    expect(cartao!.textContent).toContain("0/140");
  });

  it("'Quem recebe' mostra chips enxutos: nome e número, sem o texto de apoio que repetia o nome", async () => {
    await abrirTela();

    expect(texto()).toContain("Quem recebe");
    expect(texto()).not.toContain("contado agora");
    expect(texto()).not.toContain("Toda a base da loja");
    expect(texto()).not.toContain("Só compras pagas");
    expect(texto()).not.toContain("Cadastros dos últimos 7 dias");

    const todos = botaoCom("Todos os clientes")!;
    expect(todos.getAttribute("aria-pressed")).toBe("true");
    expect(todos.querySelector("span.font-mono")?.textContent).toBe("8");
    // Alvo de toque confortável.
    expect(todos.className).toContain("min-h-11");

    // Zero continua desativado, e o motivo continua disponível para leitor de
    // tela, sem ocupar espaço na tela.
    const inativos = botaoCom("Inativos há 30 dias")!;
    expect(inativos.disabled).toBe(true);
    expect(inativos.querySelector(".sr-only")?.textContent).toContain(
      "ninguém passou de 30 dias sem pedir",
    );
  });

  it("o destino vira UMA linha 'Ao tocar, abre ... Mudar', ligada ao mesmo seletor de antes", async () => {
    await abrirTela();

    const gatilho = hospedeiro.querySelector("#push-destination");
    expect(gatilho).not.toBeNull();
    expect(gatilho!.getAttribute("aria-label")).toBe(
      "Para onde o cliente vai ao clicar",
    );
    expect(gatilho!.textContent).toContain("Ao tocar, abre");
    expect(gatilho!.textContent).toContain("Mudar");
    expect(texto()).not.toContain("Ao tocar na mensagem");
  });

  it("a prévia é só o cartão da notificação, sob um rótulo — sem relógio nem selo 'ao vivo'", async () => {
    await abrirTela();

    expect(texto()).toContain("Prévia · como chega no celular do cliente");
    const previa = hospedeiro.querySelector('[data-testid="previa-celular"]');
    expect(previa).not.toBeNull();
    expect(previa!.textContent).toContain("agora");
    expect(previa!.textContent).toContain("Título da notificação aqui");
    expect(texto()).not.toContain("Prévia ao vivo");
    expect(texto()).not.toContain("É assim que chega no celular do cliente");
    expect(previa!.textContent).not.toMatch(/\d{2}:\d{2}/);
  });

  it("'Envios anteriores' e 'Teste e ajustes' ficam fechados atrás de um toque e abrem o conteúdo de antes", async () => {
    await abrirTela();

    const envios = botaoCom("Envios anteriores")!;
    const ajustes = botaoCom("Teste e ajustes")!;
    expect(envios.getAttribute("aria-expanded")).toBe("false");
    expect(ajustes.getAttribute("aria-expanded")).toBe("false");
    expect(texto()).not.toContain("Nenhuma mensagem enviada até agora");
    expect(texto()).not.toContain("Testar Recebimento Neste Aparelho");

    await act(async () => {
      envios.click();
    });
    expect(envios.getAttribute("aria-expanded")).toBe("true");
    expect(texto()).toContain("Nenhuma mensagem enviada até agora");

    await act(async () => {
      ajustes.click();
    });
    expect(ajustes.getAttribute("aria-expanded")).toBe("true");
    expect(texto()).toContain("Testar Recebimento Neste Aparelho");

    await act(async () => {
      envios.click();
    });
    await act(async () => {
      await esperar(350);
    });
    expect(envios.getAttribute("aria-expanded")).toBe("false");
    expect(texto()).not.toContain("Nenhuma mensagem enviada até agora");
  });

  it("o botão de enviar diz 'Enviar para N aparelhos' e traz o aviso de que não dá para desfazer", async () => {
    await abrirTela();

    const enviar = botaoCom("Enviar para")!;
    expect(enviar.textContent).toContain("Enviar para 8 aparelhos");
    expect(enviar.textContent).toContain(
      "Depois de enviar, não dá para desfazer",
    );
    expect(texto()).not.toContain("Enviar agora para");
  });

  it("as seções antigas empilhadas saíram (histórico aberto por padrão, cartão de métrica)", async () => {
    await abrirTela();
    expect(texto()).not.toContain("O que já foi ao ar");
    expect(texto()).not.toContain("Últimas 20 mensagens");
  });
});
