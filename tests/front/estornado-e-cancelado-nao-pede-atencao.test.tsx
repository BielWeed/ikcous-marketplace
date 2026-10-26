// @vitest-environment jsdom
//
// Pedido CANCELADO e já devolvido por inteiro ficava marcado para sempre como
// "Estornado — precisa de atenção", piscando, enquanto o cartão logo abaixo
// dizia "Todo o valor pago já foi devolvido". É o caso RESOLVIDO: o dinheiro
// voltou, nada a fazer. Só o pedido ATIVO com "estornado" é anomalia
// (devolução em pedido que segue de pé) e continua pedindo atenção.
import type { Order } from "@/types";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PaymentStatusBadge,
  rotuloDoPagamento,
} from "@/components/admin/orders/OrderStatusBadge";
import { pedidosParaCsv } from "@/lib/pedidos-csv";

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
  AlertDialogAction: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogCancel: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

// O cartão de devolução tem teste próprio; aqui só o selo e a frase importam.
vi.mock("@/hooks/useEstornosDoPedido", () => ({
  useEstornosDoPedido: () => ({
    linhas: [],
    pago: 100,
    devolvido: 100,
    emCurso: 0,
    emDuvida: 0,
    disponivel: 0,
    reservadoPorFora: 0,
    carregando: false,
    pedidoCarregado: true,
    erro: false,
    recarregar: vi.fn(),
    solicitarEstorno: vi.fn(),
    registrarPorForaAposEspera: vi.fn(),
    enviando: false,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const base: Order = {
  id: "ped-estornado-1",
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
  paymentStatus: "estornado",
  status: "cancelled",
  createdAt: "2026-09-01T14:32:00.000Z",
  updatedAt: "2026-09-01T14:32:00.000Z",
  cancelledAfterShipping: false,
};

describe("selo do pagamento — cancelado + estornado é caso resolvido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("o rótulo do pedido cancelado e estornado é neutro: 'Estornado'", () => {
    expect(rotuloDoPagamento("estornado", "cancelled")).toBe("Estornado");
  });

  it("o selo do cancelado e estornado não pisca nem pede atenção", async () => {
    await act(async () => {
      raiz.render(
        <PaymentStatusBadge
          paymentStatus="estornado"
          orderStatus="cancelled"
        />,
      );
    });
    expect(hospedeiro.textContent).toContain("Estornado");
    expect(hospedeiro.textContent).not.toContain("precisa de atenção");
    expect(hospedeiro.innerHTML).not.toContain("animate-pulse");
  });

  it("pedido ATIVO com 'estornado' continua pedindo atenção", async () => {
    expect(rotuloDoPagamento("estornado", "processing")).toBe(
      "Estornado — precisa de atenção",
    );
    expect(rotuloDoPagamento("estornado")).toBe(
      "Estornado — precisa de atenção",
    );
    await act(async () => {
      raiz.render(
        <PaymentStatusBadge
          paymentStatus="estornado"
          orderStatus="processing"
        />,
      );
    });
    expect(hospedeiro.textContent).toContain("precisa de atenção");
    expect(hospedeiro.innerHTML).toContain("animate-pulse");
  });

  it("pago e cancelado (dinheiro preso) segue pedindo atenção", () => {
    expect(rotuloDoPagamento("pago", "cancelled")).toBe(
      "Pago e cancelado — precisa de atenção",
    );
  });

  it("a ficha do pedido cancelado e estornado não tem 'precisa de atenção' e diz que foi devolvido", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={base} onStatusChange={vi.fn()} />);
    });
    expect(hospedeiro.textContent).not.toContain("precisa de atenção");
    expect(hospedeiro.textContent).toContain("Estornado");
    // A frase do dinheiro é neutra: nada pendente, então nem âmbar nem verde.
    const frase = Array.from(hospedeiro.querySelectorAll("p")).find((p) =>
      p.textContent?.startsWith("Estornado ·"),
    );
    expect(frase).toBeTruthy();
    expect(frase?.className).not.toContain("text-amber-400");
  });

  it("a ficha do pedido ATIVO com 'estornado' continua com 'precisa de atenção'", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(
        <OrderDetail
          order={{ ...base, status: "processing" }}
          onStatusChange={vi.fn()}
        />,
      );
    });
    expect(hospedeiro.textContent).toContain("precisa de atenção");
  });

  it("a planilha: cancelado + estornado sem atenção; ativo + estornado com atenção", () => {
    const csv = pedidosParaCsv([
      base,
      { ...base, id: "ped-estornado-2", status: "processing" },
    ]);
    const [, resolvido, ativo] = csv.split(/\r?\n/);
    expect(resolvido).not.toContain("precisa de atenção");
    expect(resolvido).toContain(";Estornado;");
    expect(ativo).toContain("Estornado — precisa de atenção");
  });
});
