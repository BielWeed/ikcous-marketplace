// @vitest-environment jsdom
//
// Rotina de despachar pelo celular (28/11/2026): na ficha, a etiqueta é o
// último bloco, atrás do "Devolução de dinheiro" que, em pedido pago ainda não
// cancelado, só diz "Cancele o pedido antes de devolver o dinheiro". Sem
// reordenar a ficha:
// - pedido de envio ainda sem etiqueta ganha o atalho "Etiqueta" no topo, que
//   rola até o bloco de envio e põe o foco nele;
// - a devolução de dinheiro de pedido em andamento fica recolhida numa linha
//   (abre ao tocar). Cancelado, abre como sempre.
//
// Molde: ficha-do-pedido-ordem-devolucao-estorno.test.tsx.
import type { LinhaEstornoDoPedido } from "@/hooks/useEstornosDoPedido";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
    })),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

const useEstornosDoPedidoMock = vi.fn();
vi.mock("@/hooks/useEstornosDoPedido", () => ({
  useEstornosDoPedido: (orderId: string) => useEstornosDoPedidoMock(orderId),
}));
vi.mock("@/hooks/useDevolucoesDoPedidoAdmin", () => ({
  useDevolucoesDoPedidoAdmin: () => ({
    devolucoes: [],
    carregando: false,
    erro: false,
    recarregar: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pedidoPagoEmSeparacao: Order = {
  id: "ped-fic-etiqueta",
  customer: {
    name: "Cliente Fictícia",
    whatsapp: "11988887777",
    address: "Rua Inventada",
    number: "10",
    neighborhood: "Centro",
    city: "Cidade Teste",
    state: "SP",
  },
  items: [],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  paymentStatus: "pago",
  status: "processing",
  createdAt: "2026-11-27T14:32:00.000Z",
  updatedAt: "2026-11-27T14:32:00.000Z",
  cancelledAfterShipping: false,
};

function hookDeEstornoPadrao() {
  return {
    linhas: [] as LinhaEstornoDoPedido[],
    pago: 100,
    devolvido: 0,
    emCurso: 0,
    disponivel: 100,
    reservadoPorFora: 0,
    carregando: false,
    pedidoCarregado: true,
    erro: false,
    recarregar: vi.fn(),
    solicitarEstorno: vi.fn().mockResolvedValue(undefined),
    enviando: false,
  };
}

describe("ficha do pedido — atalho da etiqueta e devolução de dinheiro recolhida", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const rolar = vi.fn();

  beforeEach(() => {
    useEstornosDoPedidoMock.mockReset();
    useEstornosDoPedidoMock.mockReturnValue(hookDeEstornoPadrao());
    rolar.mockReset();
    Element.prototype.scrollIntoView = rolar;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    // biome-ignore lint/performance/noDelete: o jsdom não tem o método; o teste o pôs.
    delete (Element.prototype as Partial<Element>).scrollIntoView;
    vi.restoreAllMocks();
  });

  async function montar(order: Order) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });
  }
  const atalho = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Ir para a etiqueta de envio"]',
    );
  const linhaDaDevolucao = () =>
    Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) =>
        b.getAttribute("aria-expanded") !== null &&
        b.textContent?.includes("Devolução de dinheiro"),
    );

  it("pedido de envio sem etiqueta: o atalho rola até o envio e põe o foco nele", async () => {
    await montar(pedidoPagoEmSeparacao);
    const botao = atalho();
    expect(botao?.textContent).toContain("Etiqueta");

    await act(async () => botao!.click());

    const envio = hospedeiro.querySelector('[data-testid="envio-lista"]');
    expect(rolar).toHaveBeenCalledTimes(1);
    expect(rolar.mock.contexts[0]).toBe(envio);
    expect(document.activeElement).toBe(envio);
  });

  it.each([
    ["já tem rastreio", { trackingCode: "AA123456789BR" }],
    ["já tem etiqueta", { shippingLabelId: "etq-fic-1" }],
    ["é retirada na loja", { retiradaNaLoja: true }],
    ["está cancelado", { status: "cancelled" as const }],
    ["já foi entregue", { status: "delivered" as const }],
  ])("sem atalho quando o pedido %s", async (_, sobre) => {
    await montar({ ...pedidoPagoEmSeparacao, ...sobre });
    expect(atalho()).toBeNull();
  });

  it("pedido pago em andamento: a devolução de dinheiro fica numa linha e abre ao tocar", async () => {
    await montar(pedidoPagoEmSeparacao);
    const linha = linhaDaDevolucao();
    expect(linha?.getAttribute("aria-expanded")).toBe("false");
    expect(hospedeiro.textContent).not.toContain(
      "Cancele o pedido antes de devolver o dinheiro.",
    );

    await act(async () => linha!.click());

    expect(linhaDaDevolucao()?.getAttribute("aria-expanded")).toBe("true");
    expect(hospedeiro.textContent).toContain(
      "Cancele o pedido antes de devolver o dinheiro.",
    );
  });

  it("pedido em andamento com devolução no ar: o cartão fica aberto (há o que ler)", async () => {
    useEstornosDoPedidoMock.mockReturnValue({
      ...hookDeEstornoPadrao(),
      reservadoPorFora: 30,
    });
    await montar(pedidoPagoEmSeparacao);
    expect(linhaDaDevolucao()).toBeUndefined();
    expect(hospedeiro.textContent).toContain(
      "Cancele o pedido antes de devolver o dinheiro.",
    );
  });

  it("pedido cancelado: a devolução de dinheiro abre como sempre", async () => {
    await montar({ ...pedidoPagoEmSeparacao, status: "cancelled" });
    expect(linhaDaDevolucao()).toBeUndefined();
    // O valor vem com espaço inseparável depois do "R$".
    expect(hospedeiro.textContent).toMatch(/Devolver R\$\s100,00/);
  });
});
