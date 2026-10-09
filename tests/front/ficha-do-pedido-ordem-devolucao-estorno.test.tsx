// @vitest-environment jsdom
//
// Ordem dos blocos de devolução na ficha (redesenho de 08/10/2026): a
// devolução do PRODUTO vem antes da devolução do DINHEIRO (estorno), as duas
// coladas no bloco de pagamento e antes de "Entrega". Era o furo que nenhum
// teste cobria: trocar a ordem dos dois cartões em OrderDetail.tsx deixava
// toda a suíte verde. Pedido entregue + cobrado no site + pago + devolução
// aberta é o único caso em que os dois cartões existem ao mesmo tempo.
//
// Molde: ficha-do-pedido-estorno-pela-ficha.test.tsx (mocks de supabase, do
// alert-dialog e do hook de estornos; `items: []` evita o IntersectionObserver
// do LazyImage). O hook de devoluções do pedido é mockado do mesmo jeito — o
// alvo aqui é a POSIÇÃO dos cartões, não a leitura do banco.
import type { LinhaEstornoDoPedido } from "@/hooks/useEstornosDoPedido";
import type { Order } from "@/types";
import type { ResumoDevolucao } from "@/types/devolucao";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
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

const useEstornosDoPedidoMock = vi.fn();
vi.mock("@/hooks/useEstornosDoPedido", () => ({
  useEstornosDoPedido: (orderId: string) => useEstornosDoPedidoMock(orderId),
}));

const devolucoesDoPedido: { lista: ResumoDevolucao[] } = { lista: [] };
vi.mock("@/hooks/useDevolucoesAdmin", () => ({
  useDevolucoesDoPedidoAdmin: () => ({
    devolucoes: devolucoesDoPedido.lista,
    carregando: false,
    erro: false,
    recarregar: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pedidoEntreguePago: Order = {
  id: "ped-ordem-devolucoes",
  customer: {
    name: "Cliente Teste",
    whatsapp: "349998888777",
    address: "Rua das Flores",
    number: "123",
    neighborhood: "Centro",
    city: "Patos de Minas",
    state: "MG",
  },
  items: [],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  paymentStatus: "pago",
  status: "delivered",
  createdAt: "2026-09-01T14:32:00.000Z",
  updatedAt: "2026-09-01T14:32:00.000Z",
  cancelledAfterShipping: false,
};

const umaDevolucao: ResumoDevolucao = {
  id: "dev-1",
  protocolo: "DV260926-ABCDE",
  status: "solicitada",
  tipo: "arrependimento",
  resolucao_desejada: "reembolso",
  metodo_retorno: "entrega_na_loja",
  valor_itens: 50,
  created_at: "2026-09-20T12:00:00.000Z",
};

function hookDeEstornoPadrao() {
  return {
    linhas: [] as LinhaEstornoDoPedido[],
    pago: 100,
    devolvido: 0,
    emCurso: 0,
    disponivel: 100,
    carregando: false,
    pedidoCarregado: true,
    erro: false,
    recarregar: vi.fn(),
    solicitarEstorno: vi.fn().mockResolvedValue(undefined),
    enviando: false,
  };
}

describe("ficha do pedido — ordem Pagamento → Devolução do produto → Devolução de dinheiro → Entrega", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    useEstornosDoPedidoMock.mockReset();
    useEstornosDoPedidoMock.mockReturnValue(hookDeEstornoPadrao());
    devolucoesDoPedido.lista = [umaDevolucao];
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

  it("os títulos descem nesta ordem, e os dois cartões de devolução existem de verdade", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(
        <OrderDetail order={pedidoEntreguePago} onStatusChange={vi.fn()} />,
      );
    });

    const titulos = Array.from(hospedeiro.querySelectorAll("h3")).map(
      (h) => h.textContent?.trim() ?? "",
    );
    const posicoes = [
      "Pagamento",
      "Devolução do produto",
      "Devolução de dinheiro",
      "Entrega",
    ].map((titulo) => titulos.indexOf(titulo));

    // Sanidade: os quatro títulos renderizaram (indexOf -1 mentiria na
    // ordem) — inclusive os dois cartões que só existem neste cenário.
    for (const posicao of posicoes) {
      expect(posicao).toBeGreaterThan(-1);
    }
    let anterior: number | undefined;
    for (const posicao of posicoes) {
      if (anterior !== undefined) {
        expect(posicao).toBeGreaterThan(anterior);
      }
      anterior = posicao;
    }
  });
});
