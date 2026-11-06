// @vitest-environment jsdom
//
// Ficha do pedido (painel): a anotação interna ou o código de rastreio
// DIGITADOS e ainda não salvos sumiam sem aviso no Voltar — a view zerava o
// desvio do Voltar e o aparelho saía da ficha direto. Agora, enquanto houver
// rascunho de verdade, o Voltar (seta do cabeçalho OU botão do aparelho)
// pergunta "Descartar o que você digitou?": descartar sai, continuar fica com
// o texto. Sem rascunho (ou só com o campo aberto) nada muda: o Voltar sai
// direto, como sempre.
//
// O popstate aqui é o do jsdom (`history.back()`): a entrada do histórico que
// a ficha empurra para o rascunho é o que mantém a URL da ficha de pé depois
// do Voltar (sem ela o App trocaria de tela e o texto iria embora de qualquer
// jeito, com ou sem pergunta).
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
const gravarNota = vi.fn();

let mockOrders: Order[] = [];

vi.mock("@/hooks/useDevolucoesAdmin", () => ({
  useDevolucoesAbertas: () => ({ abertas: 0 }),
}));

vi.mock("@/hooks/useOrders", async () => {
  const real =
    await vi.importActual<typeof import("@/hooks/useOrders")>(
      "@/hooks/useOrders",
    );
  return {
    ErroPedidoMudou: real.ErroPedidoMudou,
    useOrders: () => ({
      orders: mockOrders,
      loadOrders: vi.fn(),
      updateOrderStatus: vi.fn(),
      totalOrders: mockOrders.length,
      isLoaded: true,
      loading: false,
    }),
  };
});

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => from(...args),
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorDeTamanho {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const PEDIDO_ID = "pedido-rascunho-na-ficha";
const URL_DA_FICHA = `/admin-orders?id=${PEDIDO_ID}`;
const PERGUNTA = "Descartar o que você digitou?";

function linhaCrua() {
  return {
    id: PEDIDO_ID,
    status: "processing",
    payment_status: "pago",
    payment_method: "pix",
    total: 120,
    subtotal: 100,
    shipping: 20,
    discount: 0,
    customer_name: "Cliente Teste",
    customer_data: { whatsapp: "34999999999" },
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    items: [],
    address: null,
  };
}

// O mesmo builder do teste de deep link, mais a gravação da anotação.
function builder() {
  const b: any = {};
  b.select = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.single = vi.fn(() => Promise.resolve({ data: linhaCrua(), error: null }));
  b.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  b.upsert = vi.fn((valores: unknown) => {
    gravarNota(valores);
    return Promise.resolve({ error: null });
  });
  return b;
}

describe("AdminOrdersView — Voltar com anotação/rastreio digitados e não salvos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let desvio: (() => void) | null = null;
  const onNavigate = vi.fn();
  // Mesma semântica do `useState` do App: uma função passada vira "atualizador"
  // (por isso as views registram `() => () => ...`).
  const onSetBackOverride = (
    valor: (() => void) | null | ((atual: (() => void) | null) => () => void),
  ) => {
    desvio =
      typeof valor === "function"
        ? (valor as (atual: (() => void) | null) => () => void)(desvio)
        : valor;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrders = [];
    desvio = null;
    from.mockReset();
    from.mockImplementation(() => builder());
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
    vi.stubGlobal("ResizeObserver", ObservadorDeTamanho);
    vi.stubGlobal("IntersectionObserver", ObservadorDeTamanho);
    // A lojista veio da lista: há uma entrada ANTERIOR para o Voltar existir.
    globalThis.history.replaceState(
      { view: "admin-orders" },
      "",
      "/admin-orders",
    );
    globalThis.history.pushState(
      { view: "admin-orders", id: PEDIDO_ID, from: "admin-orders" },
      "",
      URL_DA_FICHA,
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  const assentar = async (voltas = 6) => {
    for (let i = 0; i < voltas; i++) {
      await act(async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };

  async function abrirFicha(active = true) {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={onNavigate}
          active={active}
          selectedOrderId={PEDIDO_ID}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await assentar();
  }

  const textarea = () =>
    hospedeiro.querySelector<HTMLTextAreaElement>("#notes-textarea");
  const pergunta = () => document.querySelector('[role="alertdialog"]');
  const botao = (rotulo: string, onde: ParentNode = document.body) =>
    Array.from(onde.querySelectorAll("button")).find(
      (b) =>
        (b.textContent ?? "").trim() === rotulo ||
        b.getAttribute("aria-label") === rotulo,
    );

  async function clicar(el: Element | undefined | null) {
    if (!el) throw new Error("elemento não encontrado");
    await act(async () => {
      (el as HTMLElement).click();
    });
    await assentar();
  }

  async function abrirOEditorDaAnotacao() {
    await clicar(
      Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Adicionar anotação"),
      ),
    );
    expect(textarea()).not.toBeNull();
  }

  async function digitarAnotacao(texto: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(textarea(), texto);
      textarea()?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await assentar();
  }

  const voltarDoAparelho = async () => {
    await act(async () => {
      globalThis.history.back();
    });
    await assentar(10);
  };

  const rota = () => globalThis.location.pathname + globalThis.location.search;

  it("sem rascunho (nem com o campo aberto sem mexer): nenhum desvio, nenhuma pergunta, nenhuma entrada extra", async () => {
    await abrirFicha();
    expect(desvio).toBeNull();

    await abrirOEditorDaAnotacao();
    expect(desvio).toBeNull();
    expect(globalThis.history.state?.folhaDePolitica).toBeUndefined();

    await voltarDoAparelho();
    expect(pergunta()).toBeNull();
  });

  it("anotação digitada: a seta Voltar do cabeçalho pergunta; continuar digitando mantém o texto", async () => {
    await abrirFicha();
    await abrirOEditorDaAnotacao();
    await digitarAnotacao("cliente pediu entrega depois das 18h");

    expect(desvio).toBeTypeOf("function");

    await act(async () => {
      desvio?.();
    });
    await assentar();
    expect(pergunta()?.textContent).toContain(PERGUNTA);

    await clicar(botao("Continuar digitando"));

    expect(pergunta()).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(textarea()?.value).toBe("cliente pediu entrega depois das 18h");
    // Continua protegida: a seta seguinte pergunta de novo.
    expect(desvio).toBeTypeOf("function");
  });

  it("descartar e sair: sai da ficha para a lista de pedidos", async () => {
    await abrirFicha();
    await abrirOEditorDaAnotacao();
    await digitarAnotacao("cliente pediu entrega depois das 18h");

    await act(async () => {
      desvio?.();
    });
    await assentar();
    await clicar(botao("Descartar e sair"));

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("admin-orders");
  });

  it("Voltar do APARELHO: pergunta, fica na ficha com o texto; o segundo Voltar vale 'continuar digitando'", async () => {
    await abrirFicha();
    await abrirOEditorDaAnotacao();
    await digitarAnotacao("cliente pediu entrega depois das 18h");

    await voltarDoAparelho();

    expect(pergunta()?.textContent).toContain(PERGUNTA);
    expect(rota()).toBe(URL_DA_FICHA);
    expect(textarea()?.value).toBe("cliente pediu entrega depois das 18h");
    expect(onNavigate).not.toHaveBeenCalled();

    await voltarDoAparelho();

    expect(pergunta()).toBeNull();
    expect(rota()).toBe(URL_DA_FICHA);
    expect(textarea()?.value).toBe("cliente pediu entrega depois das 18h");
    // A ficha segue protegida: o Voltar seguinte pergunta de novo.
    await voltarDoAparelho();
    expect(pergunta()?.textContent).toContain(PERGUNTA);
  });

  it("no Voltar do aparelho o desvio também roda (o App o chama no popstate): com a entrada já consumida ele não pergunta, para não desfazer a pergunta do aparelho", async () => {
    await abrirFicha();
    await abrirOEditorDaAnotacao();
    await digitarAnotacao("cliente pediu entrega depois das 18h");
    expect(globalThis.history.state?.folhaDePolitica).toBe(true);

    // Entrada da ficha de volta ao topo, sem a marca: o estado do popstate.
    globalThis.history.replaceState(
      { view: "admin-orders", id: PEDIDO_ID },
      "",
      URL_DA_FICHA,
    );
    await act(async () => {
      desvio?.();
    });
    await assentar();

    expect(pergunta()).toBeNull();
  });

  it("trocou de aba com rascunho (a tela de Pedidos fica montada, inativa): o Voltar do aparelho NÃO é engolido e NÃO pergunta por cima da outra aba", async () => {
    await abrirFicha();
    await abrirOEditorDaAnotacao();
    await digitarAnotacao("cliente pediu entrega depois das 18h");
    expect(desvio).toBeTypeOf("function");

    await abrirFicha(false);

    expect(desvio).toBeNull();
    expect(pergunta()).toBeNull();
    await voltarDoAparelho();
    expect(pergunta()).toBeNull();
    expect(globalThis.history.state?.folhaDePolitica).toBeUndefined();

    // Voltou para a aba de Pedidos: o texto continua lá e a proteção também.
    await abrirFicha(true);
    expect(textarea()?.value).toBe("cliente pediu entrega depois das 18h");
    expect(desvio).toBeTypeOf("function");
    await voltarDoAparelho();
    expect(pergunta()?.textContent).toContain(PERGUNTA);
  });

  it("o rascunho some com a pergunta aberta e a lojista digita de novo: a pergunta NÃO reabre sozinha", async () => {
    await abrirFicha();
    await abrirOEditorDaAnotacao();
    await digitarAnotacao("cliente pediu entrega depois das 18h");
    await act(async () => {
      desvio?.();
    });
    await assentar();
    expect(pergunta()?.textContent).toContain(PERGUNTA);

    // O rascunho some por fora da pergunta (ex.: a ficha foi atualizada).
    await act(async () => {
      botao("Cancelar edição das anotações", hospedeiro)?.click();
    });
    await assentar();
    expect(pergunta()).toBeNull();
    expect(desvio).toBeNull();

    await abrirOEditorDaAnotacao();
    await digitarAnotacao("outra anotação");

    expect(desvio).toBeTypeOf("function");
    expect(pergunta()).toBeNull();
  });

  it("código de rastreio digitado e não salvo também segura o Voltar", async () => {
    await abrirFicha();
    await clicar(botao("Adicionar rastreio"));
    const campo = hospedeiro.querySelector<HTMLInputElement>("#tracking-input");
    expect(campo).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, "br999999999br");
      campo?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await assentar();

    expect(desvio).toBeTypeOf("function");
    await act(async () => {
      desvio?.();
    });
    await assentar();
    expect(pergunta()?.textContent).toContain(PERGUNTA);
  });

  it("salvar a anotação libera o Voltar: sem desvio e sem pergunta", async () => {
    await abrirFicha();
    await abrirOEditorDaAnotacao();
    await digitarAnotacao("cliente pediu entrega depois das 18h");
    expect(desvio).toBeTypeOf("function");

    await clicar(botao("Salvar", hospedeiro));

    expect(gravarNota).toHaveBeenCalledTimes(1);
    expect(desvio).toBeNull();
    await voltarDoAparelho();
    expect(pergunta()).toBeNull();
  });

  it("cancelar a edição pelo X do campo também libera o Voltar", async () => {
    await abrirFicha();
    await abrirOEditorDaAnotacao();
    await digitarAnotacao("cliente pediu entrega depois das 18h");
    expect(desvio).toBeTypeOf("function");

    await clicar(botao("Cancelar edição das anotações", hospedeiro));

    expect(desvio).toBeNull();
  });
});
