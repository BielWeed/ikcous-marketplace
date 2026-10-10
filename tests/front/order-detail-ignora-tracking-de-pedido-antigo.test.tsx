// @vitest-environment jsdom
//
// 2ª rodada da revisão Opus sobre o commit aadbf4c: com `key={order.id}` em
// `EtiquetaDoPedidoCard` (dentro de OrderDetail.tsx), trocar de pedido
// DESMONTA a instância do card antigo — uma resposta atrasada ainda pode
// chamar `onTrackingAtualizado` (o `fetch`/`invoke` em voo sobrevive na
// closure mesmo sem o componente estar mais na árvore). A guarda interna do
// card sozinha não é suficiente: quem CONSOME o callback (este componente,
// que NÃO desmonta ao trocar de pedido) precisa validar, por conta própria,
// que o `orderId` recebido ainda é o pedido que está mostrando — é essa
// validação que este arquivo prova, isolando `EtiquetaDoPedidoCard` real
// (que já tem sua própria suíte de corrida em
// tests/front/etiqueta-do-pedido-card.test.tsx) por um stub que expõe
// diretamente o `onTrackingAtualizado` recebido, sem precisar refazer todo o
// fluxo de fetch/CPF/confirmação do card real.
import type { Order } from "@/types";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
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

// Stub do card: expõe diretamente o `onTrackingAtualizado` que OrderDetail
// passou, com dois botões de teste — um simula uma resposta de OUTRO pedido
// (o caso que a guarda do OrderDetail tem que descartar) e outro simula a
// resposta do pedido ATUAL (o caso que tem que passar). Não refaz nada do
// fetch/CPF/confirmação do card real — isso já está coberto em
// tests/front/etiqueta-do-pedido-card.test.tsx.
vi.mock("@/components/admin/orders/EtiquetaDoPedidoCard", () => ({
  EtiquetaDoPedidoCard: ({
    orderId,
    onTrackingAtualizado,
  }: {
    orderId: string;
    onTrackingAtualizado?: (orderId: string, codigo: string) => void;
  }) => (
    <div data-testid="stub-etiqueta-card">
      <button
        type="button"
        onClick={() =>
          onTrackingAtualizado?.("id-de-outro-pedido-qualquer", "CODIGO-ERRADO")
        }
      >
        simular resposta de outro pedido
      </button>
      <button
        type="button"
        onClick={() => onTrackingAtualizado?.(orderId, "CODIGO-CORRETO")}
      >
        simular resposta do pedido atual
      </button>
    </div>
  ),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedidoFake(): Order {
  return {
    id: "ped-teste",
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
    paymentMethod: "pix",
    paymentStatus: "pago",
    status: "processing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelledAfterShipping: false,
  };
}

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("OrderDetail — ignora onTrackingAtualizado de um pedido que não é mais o atual", () => {
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
    vi.restoreAllMocks();
  });

  const botao = (texto: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    ) as HTMLButtonElement | undefined;

  it("onTrackingAtualizado com orderId de OUTRO pedido é descartado: não aparece na tela", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const order = pedidoFake();

    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
      await esperarMicrotarefas();
    });

    await act(async () => {
      botao("simular resposta de outro pedido")?.click();
      await esperarMicrotarefas();
    });

    expect(hospedeiro.textContent).not.toContain("CODIGO-ERRADO");
  });

  it("onTrackingAtualizado com o orderId do pedido ATUAL aplica: mostra o código na tela", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const order = pedidoFake();

    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
      await esperarMicrotarefas();
    });

    await act(async () => {
      botao("simular resposta do pedido atual")?.click();
      await esperarMicrotarefas();
    });

    expect(hospedeiro.textContent).toContain("CODIGO-CORRETO");
  });
});
