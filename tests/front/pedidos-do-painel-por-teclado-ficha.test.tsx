// @vitest-environment jsdom
//
// Ficha do pedido usada só com teclado ou leitor de tela (lote 487):
//  1) a pergunta "Recebeu os R$ X deste pedido?" não tem "Voltar"; o Radix
//     foca o Cancel ao abrir e, sem ele, o foco ficava atrás do véu;
//  2) abrir a ficha (o botão da lista some) deixava o foco no <body>: o
//     título "Pedido #N" é quem recebe;
//  3) "Avançar" virava `disabled` enquanto gravava (o Chrome joga o foco no
//     <body>) e, ao finalizar, a barra some com o botão focado dentro.
// AlertDialog REAL do Radix aqui: o defeito do item 1 mora no foco dele.
import type { Order, OrderStatus } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn((nome: string) =>
      nome === "devolucoes_do_pedido" ? { data: [], error: null } : undefined,
    ),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedido(parcial: Partial<Order> = {}): Order {
  return {
    id: "8acf17aa-0000-0000-0000-000000000000",
    customer: { name: "Maria", whatsapp: "34999998888" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "cash",
    status: "shipping",
    paymentStatus: null,
    createdAt: "2026-10-08T14:00:00.000Z",
    updatedAt: "2026-10-08T14:00:00.000Z",
    cancelledAfterShipping: false,
    returnedToSellerAt: null,
    pagamentoRecebidoEm: null,
    pagamentoRecebidoPor: null,
    ...parcial,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
});

type Props = {
  order: Order;
  onStatusChange?: (
    id: string,
    status: OrderStatus,
    esperado?: OrderStatus,
  ) => Promise<void> | void;
  onRegistrarPagamento?: (id: string, recebido: boolean) => Promise<unknown>;
};

async function renderizar({
  order,
  onStatusChange,
  onRegistrarPagamento,
}: Props) {
  const { OrderDetail } = await import("@/components/admin/orders/OrderDetail");
  await act(async () => {
    raiz.render(
      <OrderDetail
        order={order}
        onStatusChange={onStatusChange ?? vi.fn()}
        onRegistrarPagamento={onRegistrarPagamento}
      />,
    );
  });
}

const avancar = () =>
  [...hospedeiro.querySelectorAll("button")].find(
    (b) =>
      b.textContent?.includes("Avançar") ||
      b.textContent?.includes("Processando"),
  ) as HTMLButtonElement | undefined;
const titulo = () => hospedeiro.querySelector("h1") as HTMLHeadingElement;

describe("ficha do pedido por teclado", () => {
  it("a pergunta 'Recebeu?' abre com o foco DENTRO dela, sem mudar o que os botões fazem", async () => {
    const onStatusChange = vi.fn();
    await renderizar({
      order: pedido(),
      onStatusChange,
      onRegistrarPagamento: vi.fn().mockResolvedValue({}),
    });
    const botao = avancar();
    expect(botao?.textContent).toContain("Finalizado");
    botao?.focus();
    await act(async () => {
      botao?.click();
    });

    const pergunta = document.querySelector('[role="alertdialog"]');
    expect(pergunta?.textContent).toContain("Recebeu os R$");
    expect(pergunta?.contains(document.activeElement)).toBe(true);
    // Nenhum dos dois botões de dinheiro recebe o foco sozinho: um Enter
    // distraído não registra nem finaliza nada.
    expect(document.activeElement?.tagName).not.toBe("BUTTON");
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("ao abrir com o foco perdido no <body>, o título 'Pedido #N' recebe o foco", async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    await renderizar({ order: pedido({ status: "pending" }) });
    expect(document.activeElement).toBe(titulo());
  });

  it("ao abrir com o foco num lugar que existe, não o rouba", async () => {
    const fora = document.createElement("button");
    document.body.appendChild(fora);
    fora.focus();
    await renderizar({ order: pedido({ status: "pending" }) });
    expect(document.activeElement).toBe(fora);
    fora.remove();
  });

  it("enquanto grava, Avançar fica aria-disabled (não disabled) e o foco continua nele", async () => {
    let soltar: () => void = () => {};
    const onStatusChange = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          soltar = resolve;
        }),
    );
    await renderizar({ order: pedido({ status: "pending" }), onStatusChange });
    const botao = avancar() as HTMLButtonElement;
    botao.focus();
    await act(async () => {
      botao.click();
    });
    expect(onStatusChange).toHaveBeenCalledTimes(1);
    const gravando = avancar() as HTMLButtonElement;
    expect(gravando.textContent).toContain("Processando");
    expect(gravando.disabled).toBe(false);
    expect(gravando.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(gravando);
    // O clique repetido para na guarda.
    await act(async () => {
      gravando.click();
    });
    expect(onStatusChange).toHaveBeenCalledTimes(1);
    await act(async () => {
      soltar();
    });
  });

  it("ao finalizar, a barra some e o foco vai para o título da ficha", async () => {
    const order = pedido({ status: "shipping", paymentMethod: "online" });
    let atual = order;
    const onStatusChange = vi.fn(async (_id: string, status: OrderStatus) => {
      atual = { ...atual, status };
      const { OrderDetail } = await import(
        "@/components/admin/orders/OrderDetail"
      );
      raiz.render(
        <OrderDetail order={atual} onStatusChange={onStatusChange} />,
      );
    });
    await renderizar({ order, onStatusChange });
    const botao = avancar() as HTMLButtonElement;
    botao.focus();
    await act(async () => {
      botao.click();
    });
    expect(avancar()).toBeUndefined();
    expect(document.activeElement).toBe(titulo());
  });
});
