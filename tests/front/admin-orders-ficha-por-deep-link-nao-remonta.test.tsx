// @vitest-environment jsdom
//
// AdminOrdersView-648 (achado do laudo de frentes/pedidos): a ficha aberta
// por DEEP LINK (pedido fora da página/filtro carregado — vem do sino, da
// ficha do cliente, ou é entregue/cancelado fora do filtro padrão "Em
// Aberto") busca o pedido avulso via `fetchSingleOrder`
// (AdminOrdersView.tsx:614), que liga `loadingDetail` e troca <OrderDetail>
// pelo spinner de tela cheia "Carregando Pedido" (:1176) enquanto busca.
//
// O efeito que decide se busca de novo (:648) tinha `orders` nas deps SEM
// nenhuma guarda: qualquer recarga silenciosa (visibilitychange/reconexão),
// realtime INSERT/UPDATE de OUTRO pedido ou `loadOrders` periódico gera uma
// nova referência de `orders` (mesmo que o pedido aberto continue de fora
// dela) — e o efeito reentrava em `fetchSingleOrder`, remontando
// <OrderDetail> do zero. Como o estado da anotação em edição
// (`isEditingNotes`/`notesValue`) e do diálogo "Recebeu?" (`pendingAdvance`)
// mora em `useState` LOCAL de OrderDetail.tsx, remontar apaga os dois sem
// aviso nenhum ao lojista.
//
// Este arquivo prova que, com o MESMO `selectedOrderId`, uma nova
// referência de `orders` (que ainda não contém o pedido) NÃO reabre o
// spinner, NÃO refaz a busca (`from` não é chamado de novo) e NÃO apaga a
// anotação que o lojista estava digitando.
import type { Order } from "@/types";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
// Conta só as chamadas de `fetchSingleOrder` (o `.eq("id", …).single()` da
// busca avulsa) — a view também dispara, à parte, um COUNT de cabeçalho
// (`select("*", { count: "exact", head: true })`, sem `.eq`) quando a
// lista filtrada vem vazia (AdminOrdersView.tsx, bloco "loja vazia"); esse
// COUNT não tem nada a ver com este achado e usaria o mesmo `from`, por
// isso a contagem certa é a de `.eq`, não a de `from`.
const eqDaBuscaAvulsa = vi.fn();

// `orders` do hook — igual ao padrão de
// painel-avancar-rele-pedido-do-deep-link.test.tsx: fica VAZIO (o pedido
// nunca está na página carregada), simulando o caminho de deep link.
let mockOrders: Order[] = [];
// Captura o `onRealtimeEvent` que a view passa ao hook, para o teste
// disparar um UPDATE do realtime sobre o pedido da ficha (revalidação
// silenciosa, ressalva da revisão de 648).
let realtimeCapturado: ((payload: unknown) => void) | null = null;

vi.mock("@/hooks/useOrders", async () => {
  const real =
    await vi.importActual<typeof import("@/hooks/useOrders")>(
      "@/hooks/useOrders",
    );
  return {
    ErroPedidoMudou: real.ErroPedidoMudou,
    useOrders: (
      _enabled?: boolean,
      _isAdmin?: boolean,
      options?: { onRealtimeEvent?: (payload: unknown) => void },
    ) => {
      realtimeCapturado = options?.onRealtimeEvent ?? realtimeCapturado;
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

function builderPedidoUnico(linha: unknown) {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn((...args: unknown[]) => {
    eqDaBuscaAvulsa(...args);
    return builder;
  });
  builder.single = vi.fn(() => Promise.resolve({ data: linha, error: null }));
  return builder;
}

describe("AdminOrdersView — ficha aberta por deep link não remonta quando `orders` ganha nova referência (AdminOrdersView-648)", () => {
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
    // fetchSingleOrder é assíncrono — mesmo número de awaits do teste irmão
    // (painel-avancar-rele-pedido-do-deep-link.test.tsx) para o `await` da
    // query e o `setState` seguinte assentarem.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  /** Re-renderiza com o MESMO `selectedOrderId`, mas troca a referência de
   * `mockOrders` antes — simula a recarga silenciosa/realtime/reconexão que
   * gera um `orders` novo sem o pedido aberto entrar nele. Passa um
   * `onNavigate` novo a cada chamada para furar o `memo()` de
   * `AdminOrdersView` (o mesmo truque do teste irmão, mutação i) — sem
   * isso, props idênticas fariam o React nem invocar o corpo do componente
   * de novo, e o hook mockado nunca leria o novo `mockOrders`. */
  async function reRenderizarComNovaReferenciaDeOrders(orders: Order[]) {
    mockOrders = orders;
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={vi.fn()}
          active={true}
          selectedOrderId={PEDIDO_ID}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function spinnerDeCarregamento() {
    return hospedeiro.textContent?.includes("Carregando Pedido");
  }

  function botaoAdicionarAnotacao() {
    return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Adicionar anotação"),
    );
  }

  function textareaDeNotas() {
    return hospedeiro.querySelector(
      "#notes-textarea",
    ) as HTMLTextAreaElement | null;
  }

  function telaDeErro() {
    return hospedeiro.textContent?.includes("Não foi possível carregar");
  }

  it("pedido X falha ao buscar / lojista volta para o pedido Y já resolvido — nem spinner nem tela de erro presos (rodada de correção)", async () => {
    const ID_Y = PEDIDO_ID;
    const ID_X = "pedido-x-falho-648";

    // Builder cujo resultado depende do id passado a `.eq("id", …)`: Y
    // sempre resolve, X sempre falha — simula o blip de rede/sessão
    // expirada só na busca de X.
    from.mockImplementation(() => {
      const builder: any = {};
      let idConsultado: string | undefined;
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn((...args: unknown[]) => {
        eqDaBuscaAvulsa(...args);
        idConsultado = args[1] as string;
        return builder;
      });
      builder.single = vi.fn(() => {
        if (idConsultado === ID_X) {
          return Promise.resolve({
            data: null,
            error: { message: "falha de rede" },
          });
        }
        return Promise.resolve({
          data: linhaCruaDoDeepLink(),
          error: null,
        });
      });
      return builder;
    });

    // 1) Lojista abre Y por deep link (ficha do cliente/sino) — resolve OK.
    await renderizar();
    expect(spinnerDeCarregamento()).toBeFalsy();
    expect(telaDeErro()).toBeFalsy();

    // 2) Sai e abre X (também fora da página carregada) — a busca falha.
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={vi.fn()}
          active={true}
          selectedOrderId={ID_X}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(telaDeErro()).toBeTruthy();

    // 3) Lojista abre Y de novo: `orders` continua sem Y (fora do filtro),
    // `resolvedOrderIdRef` já guarda Y de (1) → retorno antecipado.
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={vi.fn()}
          active={true}
          selectedOrderId={ID_Y}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Sem a correção: `detailError=true` setado na busca de X nunca é
    // limpo pelo retorno antecipado (linha 634) — a ficha de Y, que já
    // tinha carregado com sucesso, fica substituída para sempre pela tela
    // vermelha "Não foi possível carregar" em vez de <OrderDetail>.
    expect(telaDeErro()).toBeFalsy();
    expect(spinnerDeCarregamento()).toBeFalsy();
    expect(hospedeiro.textContent).toContain("Cliente Teste");
  });

  it("UPDATE do realtime sobre o PRÓPRIO pedido da ficha: revalida em silêncio — nova busca, sem spinner de tela cheia", async () => {
    await renderizar();
    expect(eqDaBuscaAvulsa).toHaveBeenCalledTimes(1);
    expect(realtimeCapturado).toBeTypeOf("function");

    // A linha nova vem com outro status: é o que a lojista precisa ver sem
    // sair da ficha.
    from.mockImplementation(() =>
      builderPedidoUnico({ ...linhaCruaDoDeepLink(), status: "shipped" }),
    );
    await act(async () => {
      realtimeCapturado?.({
        eventType: "UPDATE",
        new: { id: PEDIDO_ID, status: "shipped" },
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Sem a revalidação, o retorno antecipado do id já resolvido deixava a
    // ficha congelada no retrato da primeira busca (uma chamada só).
    expect(eqDaBuscaAvulsa).toHaveBeenCalledTimes(2);
    expect(spinnerDeCarregamento()).toBeFalsy();
  });

  it("digita uma anotação, `orders` ganha nova referência (ainda sem o pedido) — o rascunho sobrevive, sem spinner e sem nova busca", async () => {
    await renderizar();

    expect(eqDaBuscaAvulsa).toHaveBeenCalledTimes(1);
    expect(spinnerDeCarregamento()).toBeFalsy();

    const botaoAdicionar = botaoAdicionarAnotacao();
    expect(botaoAdicionar).toBeTruthy();

    await act(async () => {
      botaoAdicionar!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const textarea = textareaDeNotas();
    expect(textarea).toBeTruthy();

    const TEXTO_EM_EDICAO = "cliente pediu entrega só depois das 18h";
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(textarea, TEXTO_EM_EDICAO);
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(textareaDeNotas()?.value).toBe(TEXTO_EM_EDICAO);

    // Recarga silenciosa/realtime de OUTRO pedido: `orders` troca de
    // referência (array novo, mesmo vazio) mas `selectedOrderId` NÃO muda.
    await reRenderizarComNovaReferenciaDeOrders([]);

    // Sem a correção, isto reentra em `fetchSingleOrder`: o spinner
    // "Carregando Pedido" volta, <OrderDetail> desmonta e a segunda busca
    // acontece (`eqDaBuscaAvulsa` chamado de novo) — e o `textarea` com o
    // rascunho some (isEditingNotes volta a `false`, useState reinicia).
    expect(eqDaBuscaAvulsa).toHaveBeenCalledTimes(1);
    expect(spinnerDeCarregamento()).toBeFalsy();
    expect(textareaDeNotas()?.value).toBe(TEXTO_EM_EDICAO);
  });
});
