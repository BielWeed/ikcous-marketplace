// @vitest-environment jsdom
//
// Achado 1 da revisão do commit ec4cbdd: `useOrders.updateOrderStatus`
// (linha ~1115 de src/hooks/useOrders.ts) já foi consertado e mostra o
// PRÓPRIO toast traduzido via `mensagemAmigavelErroAtualizacaoStatus` quando
// `!silent` — mas o CHAMADOR (AdminOrdersView.tsx, handleStatusChange,
// ramo catch) ainda lia `err?.message` cru direto do Postgres/RPC e
// disparava um SEGUNDO toast por cima, empilhado. Cenário medido: a lojista
// clica "Avançar" (Processando → Em Trânsito), a RPC
// `update_order_status_atomic` recusa com `23505 / duplicate key value
// violates unique constraint "marketplace_order_history_pkey"`, e ela via
// DOIS avisos — um traduzido (o conserto) e um cru por cima (o defeito).
//
// Este teste NÃO moca `@/hooks/useOrders` inteiro (como os outros testes de
// AdminOrdersView fazem) porque o que está sob prova é justamente a
// INTERAÇÃO entre o toast que o hook já dispara e o toast que a VIEW
// dispara — mocar o módulo inteiro esconderia essa interação. Em vez disso,
// a fábrica do mock encaminha `mensagemAmigavelErroAtualizacaoStatus` (a
// função de tradução REAL, via `vi.importActual`) e troca só
// `updateOrderStatus` por um dublê que reproduz — linha a linha — o que o
// hook de verdade faz (ver useOrders.ts:1104-1117): computa a mensagem
// amigável, dispara UM toast com ela quando `!silent`, e relança o erro
// intacto. Assim o teste prova a integração real sem precisar da máquina
// inteira do hook (cache, RPC, realtime).
//
// `sonner` é mocado como espião (`vi.fn()`) porque toast não renderiza no
// DOM neste projeto de teste — a prova é sobre os ARGUMENTOS da chamada,
// não sobre `hospedeiro.textContent` (mesma razão pela qual
// admin-shipping-erro-teste-credenciais-traduzido.test.tsx só consegue
// olhar o DOM: lá o banner é estado do PRÓPRIO componente, não um toast).
import { mensagemAmigavelErroAtualizacaoStatus } from "@/hooks/useOrders";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ERRO_CRU_POSTGRES =
  'duplicate key value violates unique constraint "marketplace_order_history_pkey"';

const updateOrderStatus = vi.fn();

vi.mock("@/hooks/useOrders", async () => {
  const real =
    await vi.importActual<typeof import("@/hooks/useOrders")>(
      "@/hooks/useOrders",
    );
  return {
    // Encaminha a função de tradução REAL — não uma cópia — para que o
    // teste prove o comportamento de produção, não uma reimplementação
    // paralela que poderia divergir em silêncio.
    mensagemAmigavelErroAtualizacaoStatus:
      real.mensagemAmigavelErroAtualizacaoStatus,
    useOrders: () => ({
      orders: mockOrders,
      loadOrders: vi.fn(),
      updateOrderStatus,
      totalOrders: mockOrders.length,
      isLoaded: true,
      loading: false,
    }),
  };
});

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const pedidoBase: Order = {
  id: "pedido-em-processamento",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "prod-1",
      name: "Blusa Teste",
      price: 100,
      quantity: 1,
      image: "",
    },
  ],
  subtotal: 100,
  shipping: 20,
  discount: 0,
  total: 120,
  paymentMethod: "pix",
  paymentStatus: "pago",
  status: "processing",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

let mockOrders: Order[] = [pedidoBase];

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// OrderItemsCard (dentro de OrderDetail) usa LazyImage, que depende de
// IntersectionObserver — ausente no jsdom deste projeto. Mesmo padrão de
// status-desconhecido-nao-quebra-a-tela.test.tsx.
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

/** Todo texto que passou por algum `toast.error(...)` disparado no teste —
 * título e descrição, achatados numa lista só, para procurar o texto cru em
 * qualquer um dos dois lugares onde ele poderia vazar. */
function textosDosToastsDeErro(): string[] {
  const chamadas = (toast.error as unknown as { mock: { calls: unknown[][] } })
    .mock.calls;
  return chamadas.flatMap((args) => {
    const [titulo, opcoes] = args as [unknown, { description?: unknown }?];
    const textos: string[] = [];
    if (typeof titulo === "string") textos.push(titulo);
    if (typeof opcoes?.description === "string")
      textos.push(opcoes.description);
    return textos;
  });
}

describe("AdminOrdersView — erro cru do Postgres ao atualizar status não vaza, e não duplica o toast", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    updateOrderStatus.mockReset();
    mockOrders = [pedidoBase];
    // jsdom deste projeto não traz localStorage utilizável — mesmo dublê em
    // Map usado em admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx
    // (useLocalStorage, usado pela tela para busca/filtro/paginação, quebra
    // sem isto).
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

  async function renderizarComPedidoSelecionado() {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={vi.fn()}
          active={true}
          selectedOrderId={pedidoBase.id}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function botaoAvancar() {
    return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Avançar"),
    );
  }

  it("RPC recusa com erro cru (23505, duplicate key): nenhum toast.error leva o texto do Postgres, e o clique gera só UM aviso", async () => {
    // Dublê do que useOrders.ts:1104-1117 faz de verdade: computa a mensagem
    // amigável, dispara o SEU PRÓPRIO toast quando `!silent`, e relança o
    // erro intacto — exatamente o comportamento que o commit ec4cbdd deixou
    // no hook (fora do escopo desta tarefa, só reproduzido aqui).
    updateOrderStatus.mockImplementation(
      async (
        _orderId: string,
        _status: string,
        _notes: unknown,
        silent = false,
      ) => {
        const err: any = new Error(ERRO_CRU_POSTGRES);
        err.code = "23505";
        if (!silent) {
          toast.error(mensagemAmigavelErroAtualizacaoStatus(err));
        }
        throw err;
      },
    );

    await renderizarComPedidoSelecionado();

    const botao = botaoAvancar();
    expect(botao).toBeTruthy();

    await act(async () => {
      botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const textos = textosDosToastsDeErro();

    // A âncora real do defeito: o texto cru do Postgres não pode aparecer em
    // NENHUM toast.error, nem como título nem como descrição.
    for (const texto of textos) {
      expect(texto).not.toContain(ERRO_CRU_POSTGRES);
      expect(texto).not.toContain("duplicate key value");
    }

    // A duplicata: o mesmo clique não pode acender dois avisos para o
    // mesmo erro — só o do hook (que já é o traduzido).
    expect((toast.error as any).mock.calls.length).toBe(1);
    expect(textos).toContain(
      "Não foi possível atualizar o status do pedido agora. Tente novamente em instantes.",
    );
  });

  it("controle: RPC aceita normalmente — nenhum toast.error dispara", async () => {
    updateOrderStatus.mockResolvedValue(undefined);

    await renderizarComPedidoSelecionado();

    const botao = botaoAvancar();
    expect(botao).toBeTruthy();

    await act(async () => {
      botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect((toast.error as any).mock.calls.length).toBe(0);
  });
});
