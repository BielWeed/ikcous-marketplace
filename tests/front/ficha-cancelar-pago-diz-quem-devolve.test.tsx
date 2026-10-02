// @vitest-environment jsdom
//
// L3e (lacunas de pagamento, 02/10/2026) — a PONTA do fio: a ficha do pedido
// é o único chamador de `textoCancelamentoDoPainel`, e a frase certa depende
// de um campo que a ficha precisa repassar (`cancelledAfterShipping`). Sem
// ele, um pedido enviado, cancelado e REATIVADO para "processing" (a peça
// está com o cliente; o servidor NÃO grava a linha automática) leria "o app
// devolve sozinho" — e o lojista não devolveria nada a quem pagou.
//
// Mocks copiados de order-detail-aviso-pagamento-pendente.test.tsx (mesmo
// componente, mesmos motivos: `supabase` importado no topo e o Radix do
// alert-dialog sem PointerEvent no jsdom).
import type { Order } from "@/types";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    // `from` cobre também a busca PRÓPRIA do card de etiqueta
    // (EtiquetaDoPedidoCard, dentro de OrderDetail) — `.select().eq("id",
    // ...).maybeSingle()` sem esse builder cairia em "Cannot read properties
    // of undefined" e o card só logaria a exceção (achado da revisão Opus:
    // ruído silencioso nestes testes, sem mudar nenhuma asserção deles).
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            Promise.resolve({ data: null, error: null }),
          ),
        })),
      })),
    })),
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedidoPago(overrides: Partial<Order>): Order {
  return {
    id: "ped-ficha",
    customer: {
      name: "Cliente Teste",
      whatsapp: "34999999999",
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
    status: "processing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelledAfterShipping: false,
    ...overrides,
  };
}

describe("Ficha do pedido — o confirm de cancelar diz quem devolve o dinheiro (L3e)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let confirmSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    // Recusa o confirm: o teste só lê o TEXTO da pergunta; nenhum
    // cancelamento chega a acontecer.
    confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function textoDoConfirmAoCancelar(order: Order): Promise<string> {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const onStatusChange = vi.fn();
    await act(async () => {
      raiz.render(
        <OrderDetail order={order} onStatusChange={onStatusChange} />,
      );
    });
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Cancelar pedido"),
    ) as HTMLButtonElement | undefined;
    expect(botao).toBeDefined();
    await act(async () => {
      botao!.click();
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // Recusou: nada foi cancelado.
    expect(onStatusChange).not.toHaveBeenCalled();
    return String(confirmSpy.mock.calls[0]?.[0] ?? "");
  }

  it("pago e ainda não saiu: o confirm diz que o app devolve sozinho e proíbe devolver por fora", async () => {
    const texto = await textoDoConfirmAoCancelar(pedidoPago({}));
    expect(texto).toContain("sozinho");
    expect(texto).toContain("NÃO devolva");
    expect(texto).not.toContain("não devolve o dinheiro automaticamente");
  });

  it("pago, enviado, cancelado e REATIVADO para processing: o confirm NÃO promete devolução automática", async () => {
    const texto = await textoDoConfirmAoCancelar(
      pedidoPago({ status: "processing", cancelledAfterShipping: true }),
    );
    expect(texto).toContain("não devolve o dinheiro automaticamente");
    expect(texto).not.toContain("sozinho");
  });

  it("G4: pago e não enviado, mas com devolução anterior concluída (valorEstornado): o confirm NÃO promete devolução automática", async () => {
    const texto = await textoDoConfirmAoCancelar(
      pedidoPago({ status: "processing", valorEstornado: 10 }),
    );
    expect(texto).toContain("não devolve o dinheiro automaticamente");
    expect(texto).not.toContain("sozinho");
  });

  it("pago e em rota (shipping): o confirm NÃO promete devolução automática", async () => {
    const texto = await textoDoConfirmAoCancelar(
      pedidoPago({ status: "shipping" }),
    );
    expect(texto).toContain("não devolve o dinheiro automaticamente");
    expect(texto).not.toContain("sozinho");
  });
});
