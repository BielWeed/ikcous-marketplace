// @vitest-environment jsdom
//
// Achados 4 (parte da ficha), 7 e 8 da caçada de 26/10/2026 (painel de envio):
//  7. Na janela "Este pedido não está com o pagamento confirmado" o botão que
//     só FECHA a janela se chamava "Cancelar" — e o texto manda usar o botão
//     "Cancelar pedido" para cancelar de verdade. Dois "cancelar" com efeitos
//     opostos: o que só fecha agora é "Voltar" (ficha e cartão da lista).
//  8. O link de rastreio serve a todas as transportadoras, mas a ficha falava
//     só dos Correios ("cole o código dos Correios", "Rastrear nos Correios").
//  4. Os botões das duas janelas da ficha ("Ainda não", "Recebi", "Voltar",
//     "Avançar mesmo assim") tinham altura de 36px: abaixo do alvo de toque de
//     44px (min-h-11).
//
// O alert-dialog é substituído por um dublê que PASSA o className adiante
// (os outros testes da ficha o jogam fora), porque o item 4 é sobre classe.
import { AdminOrderCard } from "@/components/admin/orders/AdminOrderCard";
import type { Order, OrderStatus, PaymentStatus } from "@/types";
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

vi.mock("@/components/ui/alert-dialog", () => {
  type Filhos = { children?: ReactNode; className?: string };
  type Botao = Filhos & { onClick?: () => void };
  return {
    AlertDialog: ({
      open,
      children,
    }: { open: boolean; children: ReactNode }) =>
      open ? <div>{children}</div> : null,
    AlertDialogContent: ({ children }: Filhos) => <div>{children}</div>,
    AlertDialogHeader: ({ children }: Filhos) => <div>{children}</div>,
    AlertDialogFooter: ({ children }: Filhos) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: Filhos) => <div>{children}</div>,
    AlertDialogDescription: ({ children }: Filhos) => <div>{children}</div>,
    AlertDialogAction: ({ children, onClick, className }: Botao) => (
      <button type="button" onClick={onClick} className={className}>
        {children}
      </button>
    ),
    AlertDialogCancel: ({ children, onClick, className }: Botao) => (
      <button type="button" onClick={onClick} className={className}>
        {children}
      </button>
    ),
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedidoFake(sobre: Partial<Order> = {}): Order {
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
    shipping: 20,
    discount: 0,
    total: 120,
    paymentMethod: "pix",
    paymentStatus: "aguardando" as PaymentStatus,
    status: "pending" as OrderStatus,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelledAfterShipping: false,
    ...sobre,
  };
}

function esperar(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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
  document.body.innerHTML = "";
});

const botaoComTexto = (texto: string, dentro: ParentNode = document.body) =>
  [...dentro.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;

async function montarFicha(order: Order, onStatusChange = vi.fn()) {
  const { OrderDetail } = await import("@/components/admin/orders/OrderDetail");
  await act(async () => {
    raiz.render(
      <OrderDetail
        order={order}
        onStatusChange={onStatusChange}
        onRegistrarPagamento={vi.fn()}
      />,
    );
    await esperar();
  });
  return onStatusChange;
}

async function clicarAvancar() {
  const avancar = [...hospedeiro.querySelectorAll("button")].find((b) =>
    b.textContent?.trim().startsWith("Avançar →"),
  );
  expect(avancar).toBeTruthy();
  await act(async () => {
    avancar?.click();
    await esperar();
  });
}

describe("ficha — janela de pagamento não confirmado: o botão que só fecha é 'Voltar'", () => {
  it("não há botão 'Cancelar' na janela; 'Voltar' não avança o pedido", async () => {
    const onStatusChange = await montarFicha(pedidoFake());
    await clicarAvancar();

    expect(hospedeiro.textContent).toContain(
      "Este pedido não está com o pagamento confirmado",
    );
    expect(botaoComTexto("Cancelar")).toBeUndefined();
    const voltar = botaoComTexto("Voltar");
    expect(voltar).toBeTruthy();

    await act(async () => {
      voltar?.click();
      await esperar();
    });
    // O fechamento em si é do Radix (onOpenChange), fora do dublê: aqui se
    // prova que "Voltar" nunca avança o pedido.
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("a janela do cartão da lista também diz 'Voltar' (e não 'Cancelar') no botão que só fecha", async () => {
    await act(async () => {
      raiz.render(
        <AdminOrderCard
          order={pedidoFake({ id: "pedido-abc123" })}
          viewMode="compact"
          onSelect={vi.fn()}
          onWhatsApp={vi.fn()}
          onRegistrarPagamento={vi.fn()}
          registrandoPagamento={false}
          onStatusChange={vi.fn()}
          onReceberAntesDeAvancar={vi.fn()}
          onAnularVenda={vi.fn()}
          isOffline={false}
          destaquePrimario
        />,
      );
    });
    await act(async () => {
      botaoComTexto("Avançar mesmo assim", hospedeiro)?.click();
      await esperar();
    });

    const janela = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(janela.textContent).toContain(
      "Este pedido não está com o pagamento confirmado",
    );
    expect(botaoComTexto("Voltar", janela)).toBeTruthy();
    expect(botaoComTexto("Cancelar", janela)).toBeUndefined();
  });
});

describe("ficha — alvos de toque das janelas de confirmação", () => {
  it("pagamento não confirmado: 'Voltar' e 'Avançar mesmo assim' têm 44px de altura mínima", async () => {
    await montarFicha(pedidoFake());
    await clicarAvancar();

    expect(botaoComTexto("Voltar")?.className).toContain("min-h-11");
    expect(botaoComTexto("Avançar mesmo assim")?.className).toContain(
      "min-h-11",
    );
  });

  it("pergunta de recebimento: 'Ainda não' e 'Recebi' têm 44px de altura mínima", async () => {
    await montarFicha(
      pedidoFake({
        paymentMethod: "cash",
        paymentStatus: null,
        status: "shipping",
      }),
    );
    await clicarAvancar();

    expect(hospedeiro.textContent).toMatch(/Recebeu os R\$/);
    expect(botaoComTexto("Ainda não")?.className).toContain("min-h-11");
    expect(botaoComTexto("Recebi")?.className).toContain("min-h-11");
  });
});

describe("ficha — o código de rastreio não fala só dos Correios", () => {
  it("sem código: o convite diz 'código da transportadora'", async () => {
    await montarFicha(pedidoFake({ paymentStatus: "pago" }));

    expect(hospedeiro.textContent).toContain("cole o código da transportadora");
    expect(hospedeiro.textContent).not.toContain("código dos Correios");
  });

  it("com código: o link de rastrear se chama 'Rastrear o pacote'", async () => {
    await montarFicha(
      pedidoFake({ paymentStatus: "pago", trackingCode: "AB123456789BR" }),
    );

    const link = hospedeiro.querySelector('a[title="Rastrear o pacote"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toContain("melhorrastreio.com.br");
    expect(hospedeiro.querySelector('a[title*="Correios"]')).toBeNull();
  });
});
