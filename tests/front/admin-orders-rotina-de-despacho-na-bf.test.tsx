// @vitest-environment jsdom
//
// Rotina de despachar ~40 pedidos/dia pelo celular (28/11/2026):
// 1. O "Status atualizado com sucesso" era igual quando ninguém seria avisado
//    (pedido sem conta). Agora a confirmação diz que a cliente não recebe aviso
//    automático e oferece o WhatsApp; com conta, quando a resposta do envio
//    mostra que a cliente não ativou os avisos, a MESMA confirmação passa a
//    dizer isso.
// 2. A mensagem com a etapa nova só existia no cartão, que some da lista logo
//    depois de avançar num filtro de status. A confirmação oferece o WhatsApp
//    para qualquer pedido com telefone, com a mensagem da etapa NOVA.
// 3. Ficha aberta pelo aviso (`?id=`): o Voltar caía na página e no filtro da
//    última visita, onde o pedido podia não estar. Agora cai em Todos, página 1.
//
// Casco de mocks: admin-orders-avancar-com-resposta-atrasada-nao-volta-a-etapa
// e admin-orders-ficha-por-deep-link-nao-remonta.
import { rotuloDoStatusParaACliente } from "@/lib/mensagem-do-status-no-whatsapp";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateOrderStatus = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const invoke = vi.fn();
const abrirWhatsapp = vi.fn();

vi.mock("@/hooks/useOrders", async () => {
  const real =
    await vi.importActual<typeof import("@/hooks/useOrders")>(
      "@/hooks/useOrders",
    );
  return {
    ErroPedidoMudou: real.ErroPedidoMudou,
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
vi.mock("@/hooks/useDevolucoesAdmin", () => ({
  useDevolucoesAbertas: () => ({ abertas: 0 }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));
vi.mock("@/lib/abrir-whatsapp", () => ({
  abrirWhatsapp: (url: string) => abrirWhatsapp(url),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => buscaAvulsa()),
    rpc: vi.fn(),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
    },
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true, updateConfig: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const pedidoBase: Order = {
  id: "pedido-fic-despacho",
  customer: { name: "Cliente Fictícia", whatsapp: "11988887777" },
  items: [],
  subtotal: 100,
  shipping: 20,
  discount: 0,
  total: 120,
  paymentMethod: "pix",
  paymentStatus: "pago",
  status: "pending",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};
let mockOrders: Order[] = [pedidoBase];

/** Linha crua da busca avulsa da ficha aberta por link (pedido fora da lista). */
function buscaAvulsa() {
  const linha = {
    id: pedidoBase.id,
    status: "processing",
    payment_status: "pago",
    payment_method: "pix",
    total: 120,
    subtotal: 100,
    shipping: 20,
    discount: 0,
    customer_name: "Cliente Fictícia",
    customer_data: { whatsapp: "11988887777" },
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    items: [],
    address: null,
  };
  const builder = {
    abortSignal: () => builder,
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    single: () => Promise.resolve({ data: linha, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  return builder;
}

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

describe("AdminOrdersView — confirmação do avanço e volta da ficha aberta pelo aviso", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    updateOrderStatus.mockReset();
    updateOrderStatus.mockResolvedValue({ gravadoNoBancoEm: null });
    invoke.mockReset();
    invoke.mockResolvedValue({ data: { enviados: 1, total: 1 }, error: null });
    mockOrders = [pedidoBase];
    armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal("ResizeObserver", ObservadorStub);
    vi.stubGlobal("IntersectionObserver", ObservadorStub);
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

  async function renderizar(selectedOrderId?: string, onNavigate = vi.fn()) {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={onNavigate}
          active={true}
          selectedOrderId={selectedOrderId}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }
  async function avancarNaFicha(pedido: Order) {
    mockOrders = [pedido];
    await renderizar(pedido.id);
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Avançar"),
    );
    await act(async () => {
      botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    // O aviso à cliente roda sem a ficha esperar: deixa a resposta chegar.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(updateOrderStatus).toHaveBeenCalledTimes(1);
  }

  it("a ficha pede ao hook para não confirmar o avanço: a confirmação é dela", async () => {
    await avancarNaFicha({ ...pedidoBase, userId: "cliente-fic-1" });
    expect(updateOrderStatus.mock.calls[0]?.[5]).toEqual({
      avancoConfirmadoPorQuemChamou: true,
    });
  });

  it("pedido sem conta: a confirmação diz que não há aviso automático e oferece o WhatsApp com a etapa nova", async () => {
    await avancarNaFicha({ ...pedidoBase, userId: undefined });

    expect(sucessos()).toHaveLength(1);
    const [titulo, opcoes] = sucessos()[0]!;
    expect(titulo).toBe("Status atualizado.");
    expect(opcoes?.description).toBe(
      "A cliente não recebe aviso automático: mande pelo WhatsApp.",
    );
    expect(opcoes?.action?.label).toBe("WhatsApp");
    // Sem conta não há para quem mandar o aviso do aplicativo.
    expect(invoke).not.toHaveBeenCalled();

    opcoes!.action!.onClick();
    expect(abrirWhatsapp).toHaveBeenCalledTimes(1);
    const texto = decodeURIComponent(
      new URL(abrirWhatsapp.mock.calls[0]![0] as string).searchParams.get(
        "text",
      ) ?? "",
    );
    expect(texto).toContain(rotuloDoStatusParaACliente("processing"));
  });

  it("pedido sem conta e sem telefone: diz só que não há aviso automático, sem ação", async () => {
    await avancarNaFicha({
      ...pedidoBase,
      userId: undefined,
      customer: { name: "Cliente Fictícia", whatsapp: "" },
    });
    const [titulo, opcoes] = sucessos()[0]!;
    expect(titulo).toBe("Status atualizado.");
    expect(opcoes?.description).toBe(
      "A cliente não recebe aviso automático deste pedido.",
    );
    expect(opcoes?.action).toBeUndefined();
  });

  it("pedido com conta e telefone: confirma e oferece avisar pelo WhatsApp com a etapa nova", async () => {
    await avancarNaFicha({ ...pedidoBase, userId: "cliente-fic-1" });

    expect(invoke).toHaveBeenCalledTimes(1);
    const [titulo, opcoes] = sucessos()[0]!;
    expect(titulo).toBe("Status atualizado com sucesso");
    expect(opcoes?.description).toBeUndefined();
    expect(opcoes?.action?.label).toBe("Avisar pelo WhatsApp");
    // O aviso do aplicativo chegou: nada mais a dizer.
    expect(sucessos()).toHaveLength(1);

    opcoes!.action!.onClick();
    const texto = decodeURIComponent(
      new URL(abrirWhatsapp.mock.calls[0]![0] as string).searchParams.get(
        "text",
      ) ?? "",
    );
    expect(texto).toContain(rotuloDoStatusParaACliente("processing"));
  });

  it("pedido com conta cuja cliente não ativou os avisos: a MESMA confirmação passa a dizer isso", async () => {
    invoke.mockResolvedValue({ data: { enviados: 0, total: 0 }, error: null });
    await avancarNaFicha({ ...pedidoBase, userId: "cliente-fic-1" });

    expect(sucessos()).toHaveLength(2);
    const [, primeira] = sucessos()[0]!;
    const [titulo, segunda] = sucessos()[1]!;
    expect(segunda?.id).toBeDefined();
    expect(segunda?.id).toBe(primeira?.id);
    expect(titulo).toBe("Status atualizado.");
    expect(segunda?.description).toBe(
      "A cliente não ativou os avisos no celular: mande pelo WhatsApp.",
    );
    expect(segunda?.action?.label).toBe("WhatsApp");
  });

  it("pedido com conta sem telefone: confirma sem ação", async () => {
    await avancarNaFicha({
      ...pedidoBase,
      userId: "cliente-fic-1",
      customer: { name: "Cliente Fictícia", whatsapp: "" },
    });
    const [titulo, opcoes] = sucessos()[0]!;
    expect(titulo).toBe("Status atualizado com sucesso");
    expect(opcoes?.action).toBeUndefined();
  });

  describe("volta da ficha aberta pelo aviso", () => {
    const salvarUltimaVisita = () => {
      armazem.set("admin_orders_filter_v2", JSON.stringify("shipping"));
      armazem.set("admin_orders_current_page", JSON.stringify(3));
      armazem.set("admin_orders_search_query", JSON.stringify("fulana"));
    };
    const filtroSalvo = () => armazem.get("admin_orders_filter_v2");
    const paginaSalva = () => armazem.get("admin_orders_current_page");
    const buscaSalva = () => armazem.get("admin_orders_search_query");

    it("o pedido não está na lista da última visita: o Voltar cai em Todos, página 1, sem busca", async () => {
      salvarUltimaVisita();
      mockOrders = [];
      await renderizar(pedidoBase.id);
      await renderizar(undefined);

      expect(filtroSalvo()).toBe(JSON.stringify("all"));
      expect(paginaSalva()).toBe(JSON.stringify(0));
      expect(buscaSalva()).toBe(JSON.stringify(""));
    });

    it("controle: o pedido está na lista da última visita, ela fica como estava", async () => {
      salvarUltimaVisita();
      mockOrders = [{ ...pedidoBase, status: "shipping" }];
      await renderizar(pedidoBase.id);
      await renderizar(undefined);

      // A página não serve de prova aqui: a lista falsa tem um pedido só, e a
      // tela corrige sozinha uma página além do fim.
      expect(filtroSalvo()).toBe(JSON.stringify("shipping"));
      expect(buscaSalva()).toBe(JSON.stringify("fulana"));
    });

    it("controle: ficha aberta pela LISTA não mexe nos filtros, mesmo que o pedido tenha saído dela", async () => {
      salvarUltimaVisita();
      mockOrders = [{ ...pedidoBase, status: "shipping" }];
      const navegar = vi.fn();
      await renderizar(undefined, navegar);
      const cartao = hospedeiro.querySelector<HTMLButtonElement>(
        `[data-abrir-pedido="${pedidoBase.id}"]`,
      );
      await act(async () => cartao!.click());
      expect(navegar).toHaveBeenCalledWith("admin-orders", pedidoBase.id);
      await renderizar(pedidoBase.id, navegar);
      // Avançou e saiu do filtro "Em Trânsito".
      mockOrders = [];
      await renderizar(undefined, navegar);

      // A página não serve de prova aqui: a lista falsa tem um pedido só, e a
      // tela corrige sozinha uma página além do fim.
      expect(filtroSalvo()).toBe(JSON.stringify("shipping"));
      expect(buscaSalva()).toBe(JSON.stringify("fulana"));
    });
  });
});
