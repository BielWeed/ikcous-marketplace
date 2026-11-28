// @vitest-environment jsdom
//
// Lote 596 (28/11/2026): cancelar pela ficha do painel um pedido de pagar na
// entrega (dinheiro, PIX/cartão na entrega) vai pela RPC do painel, não pela
// edge do pagamento online. A ficha pede ao hook para não confirmar o AVANÇO
// (`avancoConfirmadoPorQuemChamou`), porque a confirmação do avanço é dela;
// o cancelamento continua confirmado pelo hook. A lojista vê exatamente UM
// "Pedido cancelado." — nunca nenhum (o hook calado também no cancelamento)
// nem o "Status atualizado" de um avanço com "Avisar pelo WhatsApp" da etapa
// "cancelado" (a ficha tratando o cancelamento como avanço).
//
// Hook e tela de verdade: só o banco, a sessão e os vizinhos que não vêm ao
// caso são falsos (casco de pedidos-falha-de-leitura-nao-vira-lista-vazia).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  desligarDialogoDeConfirmacao,
  ligarDialogoDeConfirmacao,
} from "./duble-dialogo-de-confirmacao";

const banco = vi.hoisted(() => ({
  status: "pending",
  rpcs: [] as string[],
  invoke: vi.fn(),
}));

const PEDIDO = "pedido-fic-na-entrega";

function linhaDoPedido() {
  return {
    id: PEDIDO,
    user_id: "cliente-fic-1",
    status: banco.status,
    payment_status: null,
    payment_method: "cash",
    total: 120,
    subtotal: 100,
    shipping: 20,
    discount: 0,
    customer_name: "Cliente Fictícia",
    customer_data: { whatsapp: "11988887777" },
    created_at: "2026-11-28T10:00:00.000Z",
    updated_at: "2026-11-28T10:00:00.000Z",
    items: [],
    address: null,
    cancelled_after_shipping: false,
  };
}

vi.mock("@/lib/supabase", () => {
  const consulta = () => {
    const builder = {
      abortSignal: () => builder,
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      range: () => builder,
      single: () => Promise.resolve({ data: linhaDoPedido(), error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    };
    return builder;
  };
  return {
    supabase: {
      rpc: (nome: string) => {
        banco.rpcs.push(nome);
        let resposta: unknown = { data: null, error: null };
        if (nome === "get_admin_orders_paged") {
          resposta = {
            data: { data: [linhaDoPedido()], total_count: 1 },
            error: null,
          };
        } else if (nome === "get_admin_orders_cancelados_recentes") {
          resposta = { data: { data: [], total_count: 0 }, error: null };
        } else if (nome === "cancelar_pedido_do_painel") {
          banco.status = "cancelled";
          resposta = {
            data: { id: PEDIDO, updated_at: "2026-11-28T10:05:00.000Z" },
            error: null,
          };
        }
        const promessa = Promise.resolve(resposta);
        return Object.assign(promessa, { abortSignal: () => promessa });
      },
      from: () => consulta(),
      auth: {
        getSession: () =>
          Promise.resolve({
            data: {
              session: { user: { id: "lojista-fic" }, access_token: "tk" },
            },
          }),
      },
      functions: { invoke: banco.invoke },
      channel: () => {
        const canal: Record<string, unknown> = {};
        canal.on = () => canal;
        canal.subscribe = () => canal;
        canal.unsubscribe = () => {};
        return canal;
      },
      removeChannel: () => Promise.resolve(),
    },
  };
});
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-fic" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  clearAnalyticsCache: vi.fn(),
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));
vi.mock("@/hooks/useNumerosDosPedidos", () => ({
  useNumerosDosPedidos: () => ({
    paraPreparar: null,
    aguardandoPagamento: null,
    aCaminho: null,
    abertosComPagamentoAConferir: null,
    pedirRecarga: vi.fn(),
  }),
}));
vi.mock("@/hooks/useDevolucoesAdmin", () => ({
  useDevolucoesAbertas: () => ({ abertas: 0 }),
}));
vi.mock("@/hooks/useEstornosEmCursoDosPedidos", () => ({
  useEstornosEmCursoDosPedidos: () => ({ porPedido: new Map() }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true, updateConfig: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

type Acao = { label: string; onClick: () => void };
type OpcoesDoAviso = { id?: string; description?: string; action?: Acao };
const sucessos = () =>
  vi.mocked(toast.success).mock.calls as unknown as [string, OpcoesDoAviso?][];
const avisos = () =>
  vi.mocked(toast.warning).mock.calls as unknown as [string, OpcoesDoAviso?][];

describe("AdminOrdersView + useOrders — cancelar pedido de pagar na entrega pela ficha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    banco.status = "pending";
    banco.rpcs = [];
    banco.invoke.mockReset();
    banco.invoke.mockResolvedValue({
      data: { enviados: 1, total: 1 },
      error: null,
    });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
      clear: () => armazem.clear(),
    });
    vi.stubGlobal("ResizeObserver", ObservadorStub);
    vi.stubGlobal("IntersectionObserver", ObservadorStub);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    ligarDialogoDeConfirmacao();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    desligarDialogoDeConfirmacao();
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const botaoDeCancelar = () =>
    Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.getAttribute("title") === "Cancelar pedido",
    );

  // Abre pela LISTA, como a lojista: o pedido fica na memória do hook, e é
  // isso que manda o cancelamento pela RPC do painel (pedido desconhecido iria
  // pela edge, ver `cancelamentoVaiPelaEdge`).
  async function abrirAFicha() {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    const desenhar = (selectedOrderId?: string) =>
      act(async () => {
        raiz.render(
          <AdminOrdersView
            onNavigate={vi.fn()}
            active={true}
            selectedOrderId={selectedOrderId}
          />,
        );
      });
    await desenhar();
    await vi.waitFor(() =>
      expect(
        hospedeiro.querySelector(`[data-abrir-pedido="${PEDIDO}"]`),
      ).toBeTruthy(),
    );
    await desenhar(PEDIDO);
    await vi.waitFor(() => expect(botaoDeCancelar()).toBeTruthy());
  }

  it("exatamente UM 'Pedido cancelado.', sem confirmação de avanço nem WhatsApp da etapa 'cancelado'", async () => {
    await abrirAFicha();
    vi.mocked(toast.success).mockClear();

    await act(async () => {
      botaoDeCancelar()!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await new Promise((r) => setTimeout(r, 0));
    });
    // Deixa o aviso à cliente (que a ficha não espera) responder.
    await vi.waitFor(() => expect(banco.invoke).toHaveBeenCalled());
    await act(async () => {
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    });

    // Foi pela RPC do painel, não pela edge do pagamento online.
    expect(banco.rpcs).toContain("cancelar_pedido_do_painel");
    expect(banco.invoke.mock.calls.map(([nome]) => nome)).not.toContain(
      "criar-pagamento",
    );

    const titulos = sucessos().map(([titulo]) => titulo);
    expect(titulos).toEqual(["Pedido cancelado."]);
    const comWhatsapp = [...sucessos(), ...avisos()].filter(
      ([, opcoes]) => opcoes?.action !== undefined,
    );
    expect(comWhatsapp).toHaveLength(0);
  });
});
