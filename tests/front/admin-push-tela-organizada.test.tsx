// @vitest-environment jsdom
//
// Avisar clientes: MESMA tela de antes, mais compacta (22/10/2026). Previa ao
// vivo intacta; "Quem recebe" vira carrossel; destino, historico e ajustes
// recolhidos; saem so os blocos repetidos. Logica de envio presa nos irmaos.
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
    // true: o bloco "Ajustes" só existe quando o botão de teste aparece (a
    // chave de avisos de compras está escondida).
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
      // vw_produtos_public, public_profiles: sem linha — não é o que este
      // arquivo mede.
      if (tabela === "vw_produtos_public") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                range: () =>
                  Promise.resolve({
                    data: [{ id: "p1", nome: "Tênis Veloz" }],
                    error: null,
                  }),
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
    rpc: (nome: string, args: { p_segment: string }) => {
      // Mesma fronteira do irmão: medição pela count, envio pela targets —
      // este arquivo não envia, então a targets só precisa existir.
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

describe("AdminPushView — tela organizada e compacta", () => {
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
  const botaoCom = (parte: string) =>
    Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => (b.textContent ?? "").includes(parte),
    );
  // true se `a` aparece ANTES de `b` na página.
  const antes = (
    a: Element | null | undefined,
    b: Element | null | undefined,
  ) =>
    Boolean(
      a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
    );

  it("o cabeçalho é enxuto: título, selo verde 'No ar' e ajuda — sem subtítulo nem contador repetido", async () => {
    await abrirTela();

    expect(hospedeiro.querySelector("h1")?.textContent).toContain(
      "Avisar clientes",
    );
    expect(
      hospedeiro.querySelector('[data-testid="selo-no-ar"]')?.textContent,
    ).toBe("No ar");
    expect(
      hospedeiro.querySelector('button[title="Ajuda e explicação desta tela"]'),
    ).not.toBeNull();
    expect(texto()).not.toContain("Envie mensagens e avisos");
    expect(texto()).not.toContain("Celulares Cadastrados");
    expect(texto()).not.toContain("Receberão:");
  });

  it("saem o cartão 'Clientes prontos para receber' e a 'Dica de Vendas'", async () => {
    await abrirTela();
    expect(texto()).not.toContain("Clientes Prontos");
    expect(texto()).not.toContain("Celulares e Computadores Cadastrados");
    expect(texto()).not.toContain("Dica de Vendas");
  });

  it("a PRÉVIA AO VIVO continua inteira: selo, data, relógio grande e o cartão da notificação", async () => {
    await abrirTela();

    const previa = hospedeiro.querySelector('[data-testid="previa-celular"]');
    expect(previa).not.toBeNull();
    expect(previa!.textContent).toContain("Prévia ao vivo");
    expect(previa!.textContent).toMatch(/\d{2}:\d{2}/);
    expect(previa!.textContent).toContain("Título da notificação aqui");
    expect(previa!.textContent).toContain("agora");
    expect(previa!.textContent).toContain("É assim que chega no celular");
  });

  it("a ordem é: modelos, campos, prévia, quem recebe, destino, enviar, histórico, ajustes", async () => {
    await abrirTela();

    const modelo = botaoCom("Oferta com cupom");
    const titulo = hospedeiro.querySelector("#push-title");
    const previa = hospedeiro.querySelector('[data-testid="previa-celular"]');
    const quem = hospedeiro.querySelector('section[aria-label="Quem recebe"]');
    const destino = botaoCom("Ao tocar na mensagem");
    const enviar = botaoCom("Enviar agora para");
    const historico = botaoCom("O que já foi ao ar");
    const ajustes = botaoCom("Ajustes");

    for (const [nome, el] of Object.entries({
      modelo,
      titulo,
      previa,
      quem,
      destino,
      enviar,
      historico,
      ajustes,
    })) {
      expect(el, nome).toBeTruthy();
    }
    expect(antes(modelo, titulo)).toBe(true);
    expect(antes(titulo, previa)).toBe(true);
    expect(antes(previa, quem)).toBe(true);
    expect(antes(quem, destino)).toBe(true);
    expect(antes(destino, enviar)).toBe(true);
    expect(antes(enviar, historico)).toBe(true);
    expect(antes(historico, ajustes)).toBe(true);
  });

  it("'Quem recebe' é um carrossel horizontal, com a contagem em cada chip; zero fica desativado com o motivo", async () => {
    await abrirTela();

    const quem = hospedeiro.querySelector('section[aria-label="Quem recebe"]')!;
    const faixa = quem.querySelector('[data-testid="carrossel-publico"]');
    expect(faixa).not.toBeNull();
    expect(faixa!.className).toContain("overflow-x-auto");
    expect(faixa!.className).not.toContain("grid");
    const chips = Array.from(faixa!.querySelectorAll("button"));
    expect(chips).toHaveLength(4);
    expect(
      chips.map((c) => c.querySelector("span.font-mono")?.textContent),
    ).toEqual(["8", "0", "2", "0"]);

    const inativos = chips[1];
    expect(inativos.disabled).toBe(true);
    expect(inativos.textContent).toContain(
      "ninguém passou de 30 dias sem pedir",
    );
    // O reset global do projeto tira o estilo de borda de todo <button>:
    // sem `border-solid` o contorno do chip não aparece (medido no navegador).
    for (const c of chips) expect(c.className).toContain("border-solid");
    expect(chips[0].getAttribute("aria-pressed")).toBe("true");
    expect(chips[0].querySelector("svg")).not.toBeNull();
  });

  it("destino, histórico e ajustes nascem recolhidos e abrem ao toque, com o conteúdo de antes", async () => {
    await abrirTela();

    const destino = botaoCom("Ao tocar na mensagem")!;
    const historico = botaoCom("O que já foi ao ar")!;
    const ajustes = botaoCom("Ajustes")!;
    for (const b of [destino, historico, ajustes]) {
      expect(b.getAttribute("aria-expanded")).toBe("false");
    }
    expect(hospedeiro.querySelector("#push-destination")).toBeNull();
    expect(texto()).not.toContain("Nenhuma mensagem enviada até agora");
    expect(texto()).not.toContain("Ligar avisos neste aparelho");

    await act(async () => {
      destino.click();
    });
    expect(destino.getAttribute("aria-expanded")).toBe("true");
    const gatilho = hospedeiro.querySelector("#push-destination");
    expect(gatilho?.textContent).toContain("Página Inicial da Loja");
    expect(gatilho?.textContent).toContain("Mudar");
    expect(texto()).toContain("Avançado: abrir outra página");

    await act(async () => {
      historico.click();
    });
    expect(texto()).toContain("Nenhuma mensagem enviada até agora");

    await act(async () => {
      ajustes.click();
    });
    expect(texto()).toContain("Ligar avisos neste aparelho");
  });

  it("o botão diz 'Enviar agora para N aparelhos' (N do público escolhido) e avisa que não dá para desfazer", async () => {
    await abrirTela();
    expect(botaoCom("Enviar agora para")!.textContent).toContain(
      "Enviar agora para 8 aparelhos",
    );
    expect(texto()).toContain("Depois de enviar, não dá para desfazer.");

    await act(async () => {
      botaoCom("Gastaram R$ 150+")!.click();
    });
    await act(async () => {
      await esperar(50);
    });
    expect(botaoCom("Enviar agora para")!.textContent).toContain(
      "Enviar agora para 2 aparelhos",
    );
  });

  it("o destino recolhido mostra, no cabeçalho, para onde o aviso vai", async () => {
    await abrirTela();
    expect(botaoCom("Ao tocar na mensagem")!.textContent).toContain(
      "Página inicial",
    );
  });

  it("o destino recolhido mostra o NOME do produto escolhido, e não só 'Um produto'", async () => {
    await abrirTela();
    await act(async () => {
      botaoCom("Ao tocar na mensagem")!.click();
    });
    await act(async () => {
      botaoCom("Avançado: abrir outra página")!.click();
    });
    const campo =
      hospedeiro.querySelector<HTMLInputElement>("#push-custom-path")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, "/product-detail?id=p1");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await esperar(400);
    });
    expect(botaoCom("Ao tocar na mensagem")!.textContent).toContain(
      "Tênis Veloz",
    );
  });

  it("o carrossel tem nome próprio para leitor de tela e respiro para o anel de foco", async () => {
    await abrirTela();
    const faixa = hospedeiro.querySelector(
      '[data-testid="carrossel-publico"]',
    )!;
    expect(faixa.getAttribute("role")).toBe("group");
    expect(faixa.getAttribute("aria-label")).toBeTruthy();
    expect(faixa.className).toMatch(/(?:^|\s)p-1(?:\s|$)/);
    expect(faixa.className).toContain("-m-1");
  });

  it("o modelo escolhido ganha o check (além da borda forte) e perde ao trocar de modelo", async () => {
    await abrirTela();
    const grupo = (nome: string) =>
      Array.from(hospedeiro.querySelectorAll("button")).find(
        (b) => b.textContent === nome,
      )!;
    const oferta = grupo("Oferta com cupom");
    const carrinho = grupo("Lembrete de Carrinho");
    const temCheck = (b: HTMLElement) =>
      b.querySelector("svg.lucide-check") !== null;
    expect(temCheck(oferta)).toBe(false);
    await act(async () => {
      oferta.click();
    });
    expect(temCheck(oferta)).toBe(true);
    await act(async () => {
      carrinho.click();
    });
    expect(temCheck(oferta)).toBe(false);
    expect(temCheck(carrinho)).toBe(true);
  });
});
