// @vitest-environment jsdom
//
// Varredura de bugs (12/10/2026) — achado R1 do revisor de risco: a ficha do
// pedido (`OrderDetail`) não tem `key` por pedido, então ao trocar de pedido
// SEM desmontar a ficha (link direto, voltar/avançar do navegador) o
// `EstornoCard` do pedido B nascia com o estado do A: o saldo "Disponível" do
// pedido anterior ficava na tela, com o botão de devolver habilitado, até a
// leitura do B voltar. Dinheiro: o cartão tem de ser REMONTADO por pedido
// (`key={order.id}`), para nunca mostrar o saldo de outro pedido.
import type { LinhaEstornoDoPedido } from "@/hooks/useEstornosDoPedido";
import type { Order } from "@/types";
import { act, useEffect, useRef } from "react";
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

const montagens: string[] = [];
const useEstornosDoPedidoMock = vi.fn();
vi.mock("@/hooks/useEstornosDoPedido", () => ({
  useEstornosDoPedido: (orderId: string) => {
    // Registra uma montagem do cartão a cada vez que ele nasce (efeito sem
    // dependências de pedido: roda só ao montar).
    const idNoNascimento = useRef(orderId);
    useEffect(() => {
      montagens.push(idNoNascimento.current);
    }, []);
    return useEstornosDoPedidoMock(orderId);
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const base: Order = {
  id: "ped-A",
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
  status: "cancelled",
  createdAt: "2026-09-01T14:32:00.000Z",
  updatedAt: "2026-09-01T14:32:00.000Z",
  cancelledAfterShipping: false,
};

function hookPadrao() {
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

describe("OrderDetail — o EstornoCard é remontado a cada pedido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    montagens.length = 0;
    useEstornosDoPedidoMock.mockReset();
    useEstornosDoPedidoMock.mockReturnValue(hookPadrao());
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

  it("trocar de pedido com a ficha montada nasce um EstornoCard novo (nunca herda o saldo do anterior)", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={base} onStatusChange={vi.fn()} />);
    });
    expect(montagens).toEqual(["ped-A"]);

    await act(async () => {
      raiz.render(
        <OrderDetail
          order={{ ...base, id: "ped-B" }}
          onStatusChange={vi.fn()}
        />,
      );
    });
    expect(montagens).toEqual(["ped-A", "ped-B"]);
  });

  it("revalidar o MESMO pedido não remonta o cartão", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={base} onStatusChange={vi.fn()} />);
    });
    await act(async () => {
      raiz.render(
        <OrderDetail
          order={{ ...base, updatedAt: "2026-09-02T10:00:00.000Z" }}
          onStatusChange={vi.fn()}
        />,
      );
    });
    expect(montagens).toEqual(["ped-A"]);
  });
});
