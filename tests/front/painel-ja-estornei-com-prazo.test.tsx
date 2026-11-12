// @vitest-environment jsdom
//
// Achado 13 — "Já estornei no Mercado Pago" (`registrar_estorno_manual`) com
// rede "pendurada": a conexão abre e não responde. Sem prazo o botão ficava
// ocupado para sempre e a lojista não sabia se o estorno tinha sido registrado.
//
// O prazo só encerra a ESPERA DA TELA: o servidor pode ter registrado. Por
// isso a frase NÃO diz que falhou ("Sem resposta da rede. Confira o pedido
// antes de tentar de novo."), o botão solta, a lista de cancelados é relida e
// a resposta tardia não vira aviso. Repetir o toque é seguro: a RPC é
// idempotente (pedido já estornado devolve ok sem gravar nada de novo).
//
// Mesmos mocks de painel-devolver-agora-pedido-que-nao-e-online.test.tsx, com
// relógio falso para dirigir o prazo.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  desligarDialogoDeConfirmacao,
  ligarDialogoDeConfirmacao,
} from "./duble-dialogo-de-confirmacao";

const rpcMock = vi.fn();
const fetchCancelados = vi.fn();

function criarBuilderOrderRefunds() {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase.
  builder.then = (resolve: unknown, reject?: unknown) =>
    Promise.resolve({ data: [], error: null }).then(
      resolve as never,
      reject as never,
    );
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: vi.fn((tabela: string) => {
      if (tabela === "order_refunds") return criarBuilderOrderRefunds();
      throw new Error(`tabela inesperada neste teste: ${tabela}`);
    }),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    promise: vi.fn(),
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

let mockPedidosCancelados: Order[] = [];

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [],
    loadOrders: vi.fn(),
    updateOrderStatus: vi.fn(),
    confirmarRetornoDoProduto: vi.fn(),
    totalOrders: 0,
    isLoaded: true,
    loading: false,
    pedidosCancelados: mockPedidosCancelados,
    carregandoPedidosCancelados: false,
    fetchPedidosCancelados: (...args: unknown[]) => fetchCancelados(...args),
    pedidosCanceladosIncompleto: false,
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: null,
    fetchExecutiveSummary: vi.fn(),
  }),
}));

import {
  MENSAGEM_ACAO_DO_PEDIDO_SEM_RESPOSTA,
  PRAZO_DAS_ACOES_DO_PEDIDO_MS,
} from "@/lib/prazo-da-requisicao";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FRASE = "Sem resposta da rede. Confira o pedido antes de tentar de novo.";

function pedidoCancelado(id: string): Order {
  return {
    id,
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "online",
    status: "cancelled",
    paymentStatus: "pago",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: false,
    returnedToSellerAt: null,
  } as Order;
}

/** Avança o relógio falso em passos curtos até a condição valer. */
async function avancarAte(condicao: () => boolean, limiteMs = 2000) {
  await act(async () => {
    let gasto = 0;
    while (!condicao()) {
      if (gasto > limiteMs) {
        throw new Error(`avancarAte: condição não valeu em ${limiteMs}ms`);
      }
      await vi.advanceTimersByTimeAsync(10);
      gasto += 10;
    }
  });
}

const chamadasDoEstorno = () =>
  rpcMock.mock.calls.filter(([nome]) => nome === "registrar_estorno_manual");

describe("'Já estornei': a espera da tela tem prazo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let gravacao: () => Promise<{ data: unknown; error: unknown }>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
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
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    gravacao = async () => ({ data: { ok: true }, error: null });
    rpcMock.mockReset();
    rpcMock.mockImplementation((nome: string) =>
      nome === "registrar_estorno_manual"
        ? gravacao()
        : Promise.resolve({ data: null, error: null }),
    );
    fetchCancelados.mockReset();
    fetchCancelados.mockResolvedValue([]);
    // "Sim" para a pergunta de confirmação.
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    ligarDialogoDeConfirmacao();
  });

  afterEach(() => {
    desligarDialogoDeConfirmacao();
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    mockPedidosCancelados = [];
  });

  async function tocarJaEstornei(id: string) {
    mockPedidosCancelados = [pedidoCancelado(id)];
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });
    const alavanca = hospedeiro.querySelector<HTMLButtonElement>(
      'button[data-testid="alertas-cancelados-alavanca"]',
    );
    expect(alavanca).toBeTruthy();
    await act(async () => {
      alavanca!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await tocarBotao(id);
  }

  const seletorDoBotao = (id: string) =>
    `[data-testid="devolver-agora-item-${id}"] button`;

  async function tocarBotao(id: string) {
    await avancarAte(
      () => hospedeiro.querySelector(seletorDoBotao(id)) !== null,
    );
    const botao = hospedeiro.querySelector<HTMLButtonElement>(
      seletorDoBotao(id),
    );
    await act(async () => {
      botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("a RPC nunca responde: depois do prazo o botão solta, com a frase honesta, a lista é relida e nada é reenviado sozinho", async () => {
    gravacao = () => new Promise(() => {}); // pendurada para sempre
    await tocarJaEstornei("ped-1");
    await avancarAte(() => chamadasDoEstorno().length === 1);
    expect(toast.error).not.toHaveBeenCalled();
    fetchCancelados.mockClear();

    // um instante antes do prazo: nenhum aviso ainda
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_DAS_ACOES_DO_PEDIDO_MS - 1);
    });
    expect(toast.error).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(MENSAGEM_ACAO_DO_PEDIDO_SEM_RESPOSTA).toBe(FRASE);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(FRASE);
    expect(toast.success).not.toHaveBeenCalled();
    // relê a lista de cancelados, porque o estorno pode ter sido registrado
    expect(fetchCancelados).toHaveBeenCalled();
    // uma única gravação, nenhum reenvio automático
    expect(chamadasDoEstorno()).toHaveLength(1);
    // o botão voltou: dá para tocar de novo
    const botao = hospedeiro.querySelector<HTMLButtonElement>(
      seletorDoBotao("ped-1"),
    );
    expect(botao?.disabled).toBe(false);
  });

  it("borda: a resposta que chega DEPOIS do prazo não vira aviso, e tocar de novo manda uma gravação nova que o banco aceita como já feita", async () => {
    let responder!: (r: { data: unknown; error: unknown }) => void;
    gravacao = () =>
      new Promise((resolve) => {
        responder = resolve;
      });
    await tocarJaEstornei("ped-2");
    await avancarAte(() => chamadasDoEstorno().length === 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_DAS_ACOES_DO_PEDIDO_MS);
    });
    expect(toast.error).toHaveBeenCalledWith(FRASE);
    vi.mocked(toast.error).mockClear();

    await act(async () => {
      responder({
        data: { ok: true, payment_status: "estornado" },
        error: null,
      });
      await vi.advanceTimersByTimeAsync(10);
    });
    // resposta tardia: nenhum aviso novo, nem de sucesso nem de erro
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();

    // segundo toque: mesma RPC, mesmos argumentos (a RPC é idempotente)
    gravacao = async () => ({
      data: { ok: true, payment_status: "estornado" },
      error: null,
    });
    await tocarBotao("ped-2");
    await avancarAte(() => chamadasDoEstorno().length === 2);
    await avancarAte(() => vi.mocked(toast.success).mock.calls.length > 0);
    expect(chamadasDoEstorno()[1]).toEqual(chamadasDoEstorno()[0]);
    expect(chamadasDoEstorno()[0]).toEqual([
      "registrar_estorno_manual",
      { p_order_id: "ped-2" },
    ]);
    expect(toast.success).toHaveBeenCalledWith(
      "Estorno registrado — o pedido saiu da lista.",
    );
  });

  it("borda: o servidor responde com erro de verdade (antes do prazo): segue a frase de sempre, não a de 'sem resposta'", async () => {
    gravacao = async () => ({
      data: null,
      error: { code: "XX000", message: "falha qualquer" },
    });
    await tocarJaEstornei("ped-3");
    await avancarAte(() => vi.mocked(toast.error).mock.calls.length > 0);
    expect(toast.error).toHaveBeenCalledWith(
      "Não consegui registrar o estorno. Tente de novo.",
    );
    expect(toast.error).not.toHaveBeenCalledWith(FRASE);
  });
});
