// @vitest-environment jsdom
//
// Cancelar pelo painel pede "tem certeza?" com um texto que depende do estado
// do pedido (pago? em rota? etiqueta paga? já houve devolução?). Se o pedido
// muda enquanto a janela está aberta (o cliente cancela, o Mercado Pago
// confirma o pagamento, outra aba da loja avança o pedido), o "sim" confirma
// um texto que já não é verdade -- por exemplo "o app devolve o dinheiro
// sozinho" num pedido que acabou de sair para entrega. A ficha tira uma foto
// dos campos que alimentam o texto ao abrir a janela e, se algum mudar, fecha a
// janela, avisa e NÃO cancela. Mesmos mocks de
// ficha-cancelar-pago-diz-quem-devolve.test.tsx (mesmo componente).
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

// O botão de desistir do Radix real chama `onOpenChange(false)`: o dublê repassa.
let fecharDaJanela: (() => void) | null = null;

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange?: (aberta: boolean) => void;
    children: ReactNode;
  }) => {
    fecharDaJanela = () => onOpenChange?.(false);
    return open ? <div>{children}</div> : null;
  },
  AlertDialogContent: ({
    children,
    "data-testid": idDeTeste,
  }: {
    children: ReactNode;
    "data-testid"?: string;
  }) => <div data-testid={idDeTeste}>{children}</div>,
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
    <div data-slot="alert-dialog-description">{children}</div>
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
  AlertDialogCancel: ({ children }: { children: ReactNode }) => (
    <button type="button" onClick={() => fecharDaJanela?.()}>
      {children}
    </button>
  ),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedidoPago(overrides: Partial<Order> = {}): Order {
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
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    cancelledAfterShipping: false,
    ...overrides,
  };
}

const AVISO = "O pedido mudou de situação. Confira antes de cancelar.";

describe("Ficha do pedido — cancelar confere se o pedido mudou desde que a janela abriu", () => {
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

  const janela = () =>
    hospedeiro.querySelector<HTMLElement>('[data-testid="confirmar-acao"]');

  // O botão "Cancelar pedido" existe duas vezes quando a janela está aberta
  // (a barra de ação e o verbo da janela): o da JANELA é o que confirma.
  const botaoDaJanela = () =>
    [...(janela()?.querySelectorAll("button") ?? [])].find((b) =>
      b.textContent?.includes("Cancelar pedido"),
    ) as HTMLButtonElement | undefined;

  async function montarEAbrirJanela(order: Order) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const { toast } = await import("sonner");
    const aviso = vi.spyOn(toast, "warning");
    const onStatusChange = vi.fn();
    const desenhar = (o: Order) => (
      <OrderDetail order={o} onStatusChange={onStatusChange} />
    );
    await act(async () => {
      raiz.render(desenhar(order));
    });
    const abrir = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Cancelar pedido"),
    ) as HTMLButtonElement | undefined;
    expect(abrir).toBeDefined();
    await act(async () => {
      abrir!.click();
    });
    expect(janela()).not.toBeNull();
    return { desenhar, aviso, onStatusChange };
  }

  it("caminho feliz: nada mudou, o 'sim' cancela com a situação que o lojista viu", async () => {
    const { aviso, onStatusChange } = await montarEAbrirJanela(pedidoPago());
    await act(async () => {
      botaoDaJanela()!.click();
    });
    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith(
      "ped-ficha",
      "cancelled",
      "processing",
    );
    expect(aviso).not.toHaveBeenCalled();
  });

  it("o pedido sai para entrega com a janela aberta: a janela fecha, avisa e NÃO cancela", async () => {
    const { desenhar, aviso, onStatusChange } = await montarEAbrirJanela(
      pedidoPago(),
    );
    await act(async () => {
      raiz.render(desenhar(pedidoPago({ status: "shipping" })));
    });
    expect(janela()).toBeNull();
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(aviso).toHaveBeenCalledWith(AVISO);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("o pagamento muda com a janela aberta (pago -> estornado): fecha e avisa, sem cancelar", async () => {
    const { desenhar, aviso, onStatusChange } = await montarEAbrirJanela(
      pedidoPago(),
    );
    await act(async () => {
      raiz.render(desenhar(pedidoPago({ paymentStatus: "estornado" })));
    });
    expect(janela()).toBeNull();
    expect(aviso).toHaveBeenCalledWith(AVISO);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("uma etiqueta paga aparece com a janela aberta: o texto não avisava dela, então fecha e avisa", async () => {
    const { desenhar, aviso, onStatusChange } = await montarEAbrirJanela(
      pedidoPago(),
    );
    await act(async () => {
      raiz.render(desenhar(pedidoPago({ shippingLabelId: "lbl-9" })));
    });
    expect(janela()).toBeNull();
    expect(aviso).toHaveBeenCalledWith(AVISO);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("o pedido vira o de outro cliente (troca de ficha) com a janela aberta: fecha e não cancela nenhum dos dois", async () => {
    const { desenhar, onStatusChange } = await montarEAbrirJanela(pedidoPago());
    await act(async () => {
      raiz.render(desenhar(pedidoPago({ id: "ped-outro" })));
    });
    expect(janela()).toBeNull();
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("mudança que não alimenta o texto (data de atualização) NÃO fecha a janela, e o 'sim' ainda cancela", async () => {
    const { desenhar, aviso, onStatusChange } = await montarEAbrirJanela(
      pedidoPago(),
    );
    await act(async () => {
      raiz.render(
        desenhar(pedidoPago({ updatedAt: "2026-11-01T10:05:00.000Z" })),
      );
    });
    expect(janela()).not.toBeNull();
    expect(aviso).not.toHaveBeenCalled();
    await act(async () => {
      botaoDaJanela()!.click();
    });
    expect(onStatusChange).toHaveBeenCalledWith(
      "ped-ficha",
      "cancelled",
      "processing",
    );
  });

  it("o pedido muda NO MESMO INSTANTE do 'sim' (antes do efeito da janela rodar): não cancela e avisa UMA vez", async () => {
    const { flushSync } = await import("react-dom");
    const { desenhar, aviso, onStatusChange } = await montarEAbrirJanela(
      pedidoPago(),
    );
    await act(async () => {
      // O clique resolve o "sim" (a continuação roda em microtarefa) e, no mesmo
      // tique, a ficha recebe o pedido já em rota.
      botaoDaJanela()!.click();
      flushSync(() => {
        raiz.render(desenhar(pedidoPago({ status: "shipping" })));
      });
    });
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(aviso).toHaveBeenCalledWith(AVISO);
  });

  it("depois de desistir, a janela pode abrir de novo e cancelar normalmente", async () => {
    const { desenhar, aviso, onStatusChange } = await montarEAbrirJanela(
      pedidoPago(),
    );
    const voltar = [...(janela()?.querySelectorAll("button") ?? [])].find((b) =>
      b.textContent?.includes("Voltar"),
    ) as HTMLButtonElement;
    await act(async () => {
      voltar.click();
    });
    expect(janela()).toBeNull();
    // O pedido muda DEPOIS de a janela fechar: não há nada a conferir.
    await act(async () => {
      raiz.render(desenhar(pedidoPago({ status: "shipping" })));
    });
    expect(aviso).not.toHaveBeenCalled();
    const abrir = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Cancelar pedido"),
    ) as HTMLButtonElement;
    await act(async () => {
      abrir.click();
    });
    await act(async () => {
      botaoDaJanela()!.click();
    });
    expect(onStatusChange).toHaveBeenCalledWith(
      "ped-ficha",
      "cancelled",
      "shipping",
    );
  });
});
