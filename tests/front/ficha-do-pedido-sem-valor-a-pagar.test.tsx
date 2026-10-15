// @vitest-environment jsdom
//
// Pedido de R$ 0,00 na FICHA da lojista (cupom de 100% que zera a compra).
// Decisão do dono, 15/10/2026 — só telas e textos; o servidor segue gravando
// o pedido como "pagar na entrega" e nada novo é gravado:
//   1) a ficha diz "Sem valor a pagar", nunca "Dinheiro"/"Falta receber na
//      entrega";
//   2) ao marcar como entregue NÃO pergunta "Recebeu R$ 0,00?" — registra
//      sozinha o "Recebi" (MESMA chamada do botão "Recebi":
//      `onRegistrarPagamento(id, true)`), dinheiro primeiro, status depois;
//   3) CONTROLE: o mesmo pedido com total > 0 continua perguntando e
//      mostrando o rótulo de antes.
//
// Molde de montagem: ficha-do-pedido-pergunta-se-recebeu-ao-entregar.test.tsx.
import type { Order, OrderStatus, PaymentMethod } from "@/types";
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedidoFake(overrides: {
  id: string;
  total: number;
  status?: OrderStatus;
  paymentMethod?: PaymentMethod;
  pagamentoRecebidoEm?: string | null;
}): Order {
  return {
    id: overrides.id,
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [],
    subtotal: overrides.total === 0 ? 100 : overrides.total,
    shipping: 0,
    discount: overrides.total === 0 ? 100 : 0,
    total: overrides.total,
    paymentMethod: overrides.paymentMethod ?? "cash",
    status: overrides.status ?? "shipping",
    paymentStatus: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: false,
    returnedToSellerAt: null,
    pagamentoRecebidoEm: overrides.pagamentoRecebidoEm ?? null,
    pagamentoRecebidoPor: null,
  };
}

function botaoComTexto(hospedeiro: HTMLElement, textoParcial: string) {
  return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(textoParcial),
  );
}

describe("ficha do pedido — pedido de R$ 0,00 (sem valor a pagar)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let ordem: string[];
  let onStatusChangeMock: ReturnType<
    typeof vi.fn<(orderId: string, status: OrderStatus) => Promise<void>>
  >;
  let onRegistrarPagamentoMock: ReturnType<
    typeof vi.fn<(orderId: string, recebido: boolean) => Promise<unknown>>
  >;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    ordem = [];
    onStatusChangeMock = vi.fn(async (_id: string, status: OrderStatus) => {
      ordem.push(`status:${status}`);
    });
    onRegistrarPagamentoMock = vi.fn(async (_id: string, recebido: boolean) => {
      ordem.push(`recebido:${recebido}`);
      return { payment_status: "recebido_na_entrega" };
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function renderizar(order: Order) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(
        <OrderDetail
          order={order}
          onStatusChange={onStatusChangeMock}
          onRegistrarPagamento={onRegistrarPagamentoMock}
        />,
      );
    });
  }

  function blocoDoDinheiro(): string {
    return (
      hospedeiro.querySelector('[data-testid="bloco-dinheiro"]')?.textContent ??
      ""
    );
  }

  async function clicarAvancar() {
    const botao = botaoComTexto(hospedeiro, "Avançar");
    expect(botao).toBeTruthy();
    await act(async () => {
      botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("mostra 'Sem valor a pagar' no lugar de 'Dinheiro' e de 'Falta receber na entrega'", async () => {
    await renderizar(pedidoFake({ id: "ped-zero", total: 0 }));

    const bloco = blocoDoDinheiro();
    expect(bloco).toContain("Sem valor a pagar");
    expect(bloco).not.toContain("Dinheiro");
    expect(bloco).not.toContain("Falta receber");
  });

  it("CONTROLE: com total 100 a ficha continua com 'Dinheiro' e 'Falta receber na entrega'", async () => {
    await renderizar(pedidoFake({ id: "ped-cem", total: 100 }));

    const bloco = blocoDoDinheiro();
    expect(bloco).toContain("Dinheiro");
    expect(bloco).toContain("Falta receber na entrega");
    expect(bloco).not.toContain("Sem valor a pagar");
  });

  it("entregar um pedido de R$ 0: não pergunta 'Recebeu', registra o 'Recebi' sozinha e DEPOIS avança", async () => {
    await renderizar(
      pedidoFake({ id: "ped-zero", total: 0, status: "shipping" }),
    );

    await clicarAvancar();

    expect(hospedeiro.textContent).not.toMatch(/Recebeu/i);
    expect(botaoComTexto(hospedeiro, "Recebi")).toBeUndefined();
    expect(onRegistrarPagamentoMock).toHaveBeenCalledTimes(1);
    expect(onRegistrarPagamentoMock).toHaveBeenCalledWith("ped-zero", true);
    expect(onStatusChangeMock).toHaveBeenCalledTimes(1);
    expect(onStatusChangeMock).toHaveBeenCalledWith("ped-zero", "delivered");
    // Dinheiro primeiro, status depois — a mesma ordem do botão "Recebi".
    expect(ordem).toEqual(["recebido:true", "status:delivered"]);
  });

  it("se o registro do 'Recebi' falhar, o pedido NÃO é marcado como entregue", async () => {
    onRegistrarPagamentoMock.mockRejectedValueOnce(new Error("rede"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderizar(
      pedidoFake({ id: "ped-zero", total: 0, status: "shipping" }),
    );

    await clicarAvancar();

    expect(onRegistrarPagamentoMock).toHaveBeenCalledTimes(1);
    expect(onStatusChangeMock).not.toHaveBeenCalled();
  });

  it("pedido de R$ 0 que JÁ tem recebimento registrado: só avança, sem registrar de novo", async () => {
    await renderizar(
      pedidoFake({
        id: "ped-zero",
        total: 0,
        status: "shipping",
        pagamentoRecebidoEm: "2026-10-15T12:00:00Z",
      }),
    );

    await clicarAvancar();

    expect(onRegistrarPagamentoMock).not.toHaveBeenCalled();
    expect(onStatusChangeMock).toHaveBeenCalledWith("ped-zero", "delivered");
  });

  it("CONTROLE: entregar um pedido de total 100 continua abrindo a pergunta 'Recebeu os R$ 100,00'", async () => {
    await renderizar(
      pedidoFake({ id: "ped-cem", total: 100, status: "shipping" }),
    );

    await clicarAvancar();

    expect(hospedeiro.textContent).toMatch(/Recebeu os R\$\s*100,00/);
    expect(botaoComTexto(hospedeiro, "Recebi")).toBeTruthy();
    expect(onRegistrarPagamentoMock).not.toHaveBeenCalled();
    expect(onStatusChangeMock).not.toHaveBeenCalled();
  });
});
