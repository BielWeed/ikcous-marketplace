// @vitest-environment jsdom
//
// Ficha aberta por LINK (?id=) de um pedido que não está na página carregada
// (lote r75-a). Esse pedido não aparece em `orders`, então a ficha só se
// atualizava por evento ao vivo (realtime). Se a rede cai ou o aparelho fica
// com a aba em segundo plano, o evento se perde e, ao voltar, a ficha seguia
// com o status antigo — a lojista via "Em preparo" de um pedido já enviado.
//
// Agora, ao a rede voltar (`online`) ou a aba voltar a ficar visível, a ficha
// refaz a busca EM SILÊNCIO (mesmo caminho do evento ao vivo): sem o spinner
// de tela cheia, sem desmontar a ficha (o texto digitado numa anotação
// sobrevive) e, se a busca falhar, a ficha continua na tela em vez de ser
// trocada pela tela de erro.
import type { Order } from "@/types";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
// Conta só as chamadas da busca avulsa da ficha (`.eq("id", …).single()`).
const eqDaBuscaAvulsa = vi.fn();

// `orders` do hook fica VAZIO: o pedido nunca está na página carregada.
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
    useOrders: () => {
      return {
        orders: mockOrders,
        loadOrders: vi.fn(),
        updateOrderStatus: vi.fn(),
        totalOrders: mockOrders.length,
        isLoaded: true,
        loading: false,
      };
    },
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

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? <div>{children}</div> : null),
  AlertDialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
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

const PEDIDO_ID = "pedido-deep-link-648";

/** Linha crua que `supabase.from("marketplace_orders").select(...).eq("id",
 * …).single()` devolve — mesma forma mínima de
 * painel-avancar-rele-pedido-do-deep-link.test.tsx. `notes` de propósito
 * ausente: o pedido nasce SEM anotação, para o teste digitar uma. */
function linhaCruaDoDeepLink() {
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

// A ficha renderiza `EtiquetaDoPedidoCard` (OrderDetail.tsx), que faz a SUA
// PRÓPRIA busca avulsa (`.eq("id", orderId).maybeSingle()`) na mesma tabela
// `marketplace_orders` — sem distinguir, ela contaria como uma segunda
// chamada de `fetchSingleOrder` (`eqDaBuscaAvulsa`) e quebraria as
// asserções de "busca de novo?" deste arquivo, que são sobre A VIEW, não
// sobre o card do pedido. A distinção é pela STRING de `select()`:
// `fetchSingleOrder` (AdminOrdersView.tsx) é a ÚNICA consulta que pede
// `marketplace_order_items` (join de itens); o card pede colunas soltas.
function ehSelectDaFichaAvulsa(colunas: unknown): boolean {
  return (
    typeof colunas === "string" && colunas.includes("marketplace_order_items")
  );
}

function builderPedidoUnico(linha: unknown) {
  const builder: any = {};
  let ehFichaAvulsa = false;
  builder.select = vi.fn((colunas: unknown) => {
    ehFichaAvulsa = ehSelectDaFichaAvulsa(colunas);
    return builder;
  });
  builder.eq = vi.fn((...args: unknown[]) => {
    if (ehFichaAvulsa) eqDaBuscaAvulsa(...args);
    return builder;
  });
  builder.single = vi.fn(() => Promise.resolve({ data: linha, error: null }));
  // Busca do EtiquetaDoPedidoCard — nunca é o pedido X/Y deste arquivo,
  // resolve vazio (o card mostra "Pedido não encontrado", irrelevante aqui).
  builder.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: null, error: null }),
  );
  return builder;
}

function definirVisibilidade(estado: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => estado,
  });
}

describe("AdminOrdersView — ficha por link revalida ao voltar a rede ou a aba (r75-a)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrders = [];
    from.mockReset();
    eqDaBuscaAvulsa.mockReset();
    from.mockImplementation(() => builderPedidoUnico(linhaCruaDoDeepLink()));
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
    definirVisibilidade("visible");
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    // Volta ao `visibilityState` nativo do jsdom.
    Reflect.deleteProperty(document, "visibilityState");
    vi.unstubAllGlobals();
  });

  async function renderizar() {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={vi.fn()}
          active={true}
          selectedOrderId={PEDIDO_ID}
        />,
      );
    });
    await assentar();
  }

  async function assentar() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function spinnerDeCarregamento() {
    return hospedeiro.textContent?.includes("Carregando Pedido");
  }

  // O botão de avançar diz o PRÓXIMO status: é como a ficha mostra em que
  // passo o pedido está (processing -> "Em Trânsito"; shipping -> "Finalizado").
  function botaoDeAvancar() {
    return Array.from(hospedeiro.querySelectorAll("button"))
      .map((b) => b.textContent ?? "")
      .find((t) => t.includes("Avançar"));
  }

  function telaDeErro() {
    return hospedeiro.textContent?.includes("Não foi possível carregar");
  }

  function textareaDeNotas() {
    return hospedeiro.querySelector(
      "#notes-textarea",
    ) as HTMLTextAreaElement | null;
  }

  async function digitarUmaAnotacao(texto: string) {
    const adicionar = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Adicionar anotação"),
    );
    await act(async () => {
      adicionar?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(textareaDeNotas(), texto);
      textareaDeNotas()?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(textareaDeNotas()?.value).toBe(texto);
  }

  it("a rede volta (`online`): a ficha busca o pedido de novo, em silêncio, sem perder o texto digitado", async () => {
    await renderizar();
    expect(eqDaBuscaAvulsa).toHaveBeenCalledTimes(1);
    await digitarUmaAnotacao("combinado: entregar depois das 18h");

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await assentar();

    expect(eqDaBuscaAvulsa).toHaveBeenCalledTimes(2);
    expect(spinnerDeCarregamento()).toBeFalsy();
    expect(textareaDeNotas()?.value).toBe("combinado: entregar depois das 18h");
  });

  it("a aba volta a ficar visível: a ficha busca o pedido de novo, em silêncio", async () => {
    await renderizar();
    expect(eqDaBuscaAvulsa).toHaveBeenCalledTimes(1);

    definirVisibilidade("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await assentar();

    expect(eqDaBuscaAvulsa).toHaveBeenCalledTimes(2);
    expect(spinnerDeCarregamento()).toBeFalsy();
  });

  it("a aba ir para o segundo plano não busca nada", async () => {
    await renderizar();

    definirVisibilidade("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await assentar();

    expect(eqDaBuscaAvulsa).toHaveBeenCalledTimes(1);
  });

  it("a busca silenciosa falha (a rede acabou de voltar): a ficha continua na tela, sem tela de erro", async () => {
    await renderizar();
    expect(hospedeiro.textContent).toContain("Cliente Teste");
    vi.spyOn(console, "error").mockImplementation(() => {});
    from.mockImplementation(() => {
      const builder = builderPedidoUnico(null);
      builder.single = vi.fn(() =>
        Promise.resolve({ data: null, error: { message: "sem rede" } }),
      );
      return builder;
    });

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await assentar();

    expect(eqDaBuscaAvulsa).toHaveBeenCalledTimes(2);
    expect(telaDeErro()).toBeFalsy();
    expect(spinnerDeCarregamento()).toBeFalsy();
    expect(hospedeiro.textContent).toContain("Cliente Teste");
  });

  it("a rede volta e a ficha passa a mostrar o status novo (era o que ficava congelado)", async () => {
    await renderizar();
    expect(botaoDeAvancar()).toContain("Em Trânsito");
    from.mockImplementation(() =>
      builderPedidoUnico({ ...linhaCruaDoDeepLink(), status: "shipping" }),
    );

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await assentar();

    expect(botaoDeAvancar()).toContain("Finalizado");
  });

  it("a lista recarrega junto com a rede (`orders` ganha nova referência) com a busca da ficha no ar: a resposta não é jogada fora", async () => {
    await renderizar();
    let responder!: (linha: unknown) => void;
    from.mockImplementation(() => {
      const builder = builderPedidoUnico(null);
      builder.single = vi.fn(
        () =>
          new Promise((resolve) => {
            responder = (linha) => resolve({ data: linha, error: null });
          }),
      );
      return builder;
    });
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    // O hook de pedidos recarrega a lista na reconexão: referência nova.
    mockOrders = [];
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={vi.fn()}
          active={true}
          selectedOrderId={PEDIDO_ID}
        />,
      );
    });
    await act(async () => {
      responder({ ...linhaCruaDoDeepLink(), status: "shipping" });
    });
    await assentar();

    expect(botaoDeAvancar()).toContain("Finalizado");
    expect(spinnerDeCarregamento()).toBeFalsy();
  });
});
