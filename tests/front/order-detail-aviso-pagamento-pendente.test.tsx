// @vitest-environment jsdom
//
// Defeito observado na ficha do pedido: nenhum lugar da tela dizia se o
// dinheiro tinha entrado, e o botão "Avançar" não tinha trava nenhuma ligada
// a pagamento — dava para levar um pedido não pago até "Finalizado" sem o
// painel dizer uma palavra. Este teste cobre as duas partes da correção:
//
//   1. o badge de status de pagamento aparece no cabeçalho e no bloco
//      "Consolidado Financeiro" (mesmo componente `PaymentStatusBadge` já
//      usado na lista de pedidos, para o vocabulário ficar idêntico);
//   2. clicar em "Avançar" com `paymentStatus` em 'aguardando', 'recusado'
//      ou 'estornado' abre uma confirmação antes de mudar o status;
//      `null`/'pago'/'pago_apos_expirar' avançam direto, sem aviso.
//
// `@/lib/supabase` é mocado pelo mesmo motivo dos outros testes deste
// componente: OrderDetail.tsx importa `supabase` no topo (usado no useEffect
// que busca SKU dos itens), e sem o mock a leitura de
// VITE_SUPABASE_URL/ANON_KEY em src/lib/env.ts explode por design. Como os
// pedidos de teste têm `items: []`, o efeito cai no ramo "nada para buscar"
// antes de chamar `supabase.from(...)`.
//
// `@/components/ui/alert-dialog` é mocado porque o Radix real depende de
// PointerEvent/ResizeObserver que o jsdom não implementa — mesmo padrão de
// tests/front/admin-products-view-toast-de-exclusao.test.tsx.
import type { Order, PaymentStatus } from "@/types";
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedidoFake(paymentStatus: PaymentStatus | null | undefined): Order {
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
    paymentStatus,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelledAfterShipping: false,
  };
}

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function localizarBotaoPorTexto(
  raizDom: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("OrderDetail — mostra o pagamento e avisa antes de avançar pedido não pago", () => {
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

  it("mostra 'Aguardando pagamento' no cabeçalho e no Consolidado Financeiro", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const order = pedidoFake("aguardando");

    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });

    const ocorrencias = hospedeiro.textContent?.split(
      "Aguardando pagamento",
    ).length;
    // split por N ocorrências dá N+1 pedaços: duas ocorrências (cabeçalho +
    // Consolidado Financeiro) viram 3 pedaços.
    expect(ocorrencias).toBeGreaterThanOrEqual(3);
  });

  it("paymentStatus nulo mostra 'Sem cobrança online', não texto de reserva inventado", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const order = pedidoFake(null);

    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });

    expect(hospedeiro.textContent).toContain("Sem cobrança online");
  });

  it("'aguardando': clicar em Avançar abre a confirmação e NÃO muda o status ainda", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const order = pedidoFake("aguardando");
    const onStatusChange = vi.fn();

    await act(async () => {
      raiz.render(
        <OrderDetail order={order} onStatusChange={onStatusChange} />,
      );
    });

    const botaoAvancar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.trim().startsWith("Avançar:"),
    ) as HTMLButtonElement;
    expect(botaoAvancar).toBeDefined();

    await act(async () => {
      botaoAvancar.click();
    });

    expect(hospedeiro.textContent).toContain(
      "Este pedido não está com o pagamento confirmado",
    );
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("'aguardando': confirmar no diálogo avança o status normalmente", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const order = pedidoFake("aguardando");
    const onStatusChange = vi.fn();

    await act(async () => {
      raiz.render(
        <OrderDetail order={order} onStatusChange={onStatusChange} />,
      );
    });

    const botaoAvancar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.trim().startsWith("Avançar:"),
    ) as HTMLButtonElement;

    await act(async () => {
      botaoAvancar.click();
    });

    const botaoConfirmar = localizarBotaoPorTexto(
      hospedeiro,
      "Avançar mesmo assim",
    )!;
    expect(botaoConfirmar).toBeDefined();

    await act(async () => {
      botaoConfirmar.click();
      await esperarMicrotarefas();
    });

    expect(onStatusChange).toHaveBeenCalledWith("ped-teste", "processing");
  });

  it("paymentStatus nulo: clicar em Avançar muda o status direto, sem aviso", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const order = pedidoFake(null);
    const onStatusChange = vi.fn();

    await act(async () => {
      raiz.render(
        <OrderDetail order={order} onStatusChange={onStatusChange} />,
      );
    });

    const botaoAvancar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.trim().startsWith("Avançar:"),
    ) as HTMLButtonElement;

    await act(async () => {
      botaoAvancar.click();
      await esperarMicrotarefas();
    });

    expect(hospedeiro.textContent).not.toContain(
      "Este pedido não está com o pagamento confirmado",
    );
    expect(onStatusChange).toHaveBeenCalledWith("ped-teste", "processing");
  });

  it("paymentStatus 'pago': clicar em Avançar muda o status direto, sem aviso", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const order = pedidoFake("pago");
    const onStatusChange = vi.fn();

    await act(async () => {
      raiz.render(
        <OrderDetail order={order} onStatusChange={onStatusChange} />,
      );
    });

    const botaoAvancar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.trim().startsWith("Avançar:"),
    ) as HTMLButtonElement;

    await act(async () => {
      botaoAvancar.click();
      await esperarMicrotarefas();
    });

    expect(hospedeiro.textContent).not.toContain(
      "Este pedido não está com o pagamento confirmado",
    );
    expect(onStatusChange).toHaveBeenCalledWith("ped-teste", "processing");
  });

  it("'recusado': clicar em Avançar abre a confirmação e NÃO muda o status ainda", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const order = pedidoFake("recusado");
    const onStatusChange = vi.fn();

    await act(async () => {
      raiz.render(
        <OrderDetail order={order} onStatusChange={onStatusChange} />,
      );
    });

    const botaoAvancar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.trim().startsWith("Avançar:"),
    ) as HTMLButtonElement;
    expect(botaoAvancar).toBeDefined();

    await act(async () => {
      botaoAvancar.click();
    });

    expect(hospedeiro.textContent).toContain(
      "Este pedido não está com o pagamento confirmado",
    );
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("'estornado': clicar em Avançar abre a confirmação e NÃO muda o status ainda", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const order = pedidoFake("estornado");
    const onStatusChange = vi.fn();

    await act(async () => {
      raiz.render(
        <OrderDetail order={order} onStatusChange={onStatusChange} />,
      );
    });

    const botaoAvancar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.trim().startsWith("Avançar:"),
    ) as HTMLButtonElement;
    expect(botaoAvancar).toBeDefined();

    await act(async () => {
      botaoAvancar.click();
    });

    expect(hospedeiro.textContent).toContain(
      "Este pedido não está com o pagamento confirmado",
    );
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("botão 'Abortar Operação' cancela direto, sem passar pelo diálogo de pagamento pendente", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    // paymentStatus 'aguardando' é justamente o caso que dispara o aviso
    // para o botão "Avançar" — o teste prova que o botão de abortar é uma
    // porta estrutural separada, não uma comparação de valor que só por
    // coincidência hoje exclui "cancelled".
    const order = pedidoFake("aguardando");
    const onStatusChange = vi.fn();

    await act(async () => {
      raiz.render(
        <OrderDetail order={order} onStatusChange={onStatusChange} />,
      );
    });

    const botaoAbortar = hospedeiro.querySelector(
      'button[title="Abortar Operação"]',
    ) as HTMLButtonElement;
    expect(botaoAbortar).toBeDefined();

    await act(async () => {
      botaoAbortar.click();
      await esperarMicrotarefas();
    });

    expect(hospedeiro.textContent).not.toContain(
      "Este pedido não está com o pagamento confirmado",
    );
    expect(onStatusChange).toHaveBeenCalledWith("ped-teste", "cancelled");
  });
});
