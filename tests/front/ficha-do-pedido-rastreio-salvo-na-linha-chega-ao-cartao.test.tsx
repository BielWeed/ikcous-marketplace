// @vitest-environment jsdom
//
// Achado 3 da caçada de 26/10/2026: a ficha do pedido mostrava "Código de
// rastreio" em DOIS lugares — a linha da ficha (OrderDetail) e o cartão da
// etiqueta (EtiquetaDoPedidoCard) — e eles podiam discordar: o código ia do
// cartão para a ficha (`onTrackingAtualizado`), nunca da ficha para o cartão.
// Quem corrigia o código na linha continuava vendo o antigo no cartão.
//
// Aqui o OrderDetail e o cartão são os REAIS; só o banco é de mentira.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { linhaDoCartao, atualizacoes } = vi.hoisted(() => ({
  // O que o cartão lê do pedido ao abrir (etiqueta já emitida).
  linhaDoCartao: {
    id: "ped-teste",
    status: "processing",
    payment_status: "pago",
    shipping: 20,
    shipping_cost: null,
    tracking_code: "AAA111BR" as string | null,
    shipping_label_id: "12345",
    shipping_label_url: null,
    notes: null,
    shipping_option_id: "melhor-envio-3",
    cpf: "52998224725",
  },
  atualizacoes: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    from: vi.fn(() => ({
      select: (colunas: string) => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              // Só a leitura do cartão pede estas colunas.
              data: colunas.includes("shipping_label_id")
                ? linhaDoCartao
                : null,
              error: null,
            }),
        }),
      }),
      update: (campos: Record<string, unknown>) => {
        atualizacoes.push(campos);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    })),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
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
    shipping: 20,
    discount: 0,
    total: 120,
    paymentMethod: "pix",
    paymentStatus: "pago",
    status: "processing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelledAfterShipping: false,
    trackingCode: "AAA111BR",
  };
}

function esperar(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function digitarNoInput(el: HTMLInputElement, valor: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el),
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ficha do pedido — o código salvo na linha chega ao cartão da etiqueta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    atualizacoes.length = 0;
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

  const codigoDoCartao = () =>
    hospedeiro.querySelector('[data-testid="codigo-rastreio"]')?.textContent;

  async function montar() {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(
        <OrderDetail order={pedidoFake()} onStatusChange={vi.fn()} />,
      );
      await esperar();
    });
  }

  async function editarESalvar(novo: string) {
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>('button[title="Editar Código"]')
        ?.click();
      await esperar();
    });
    const campo = hospedeiro.querySelector<HTMLInputElement>("#tracking-input");
    expect(campo).toBeTruthy();
    await act(async () => {
      digitarNoInput(campo as HTMLInputElement, novo);
      await esperar();
    });
    await act(async () => {
      [...hospedeiro.querySelectorAll("button")]
        .find((b) => b.textContent?.includes("Salvar"))
        ?.click();
      await esperar();
    });
  }

  it("abre com o mesmo código nos dois lugares", async () => {
    await montar();
    expect(codigoDoCartao()).toBe("AAA111BR");
  });

  it("salvar um código novo na linha atualiza o que o cartão mostra", async () => {
    await montar();
    await editarESalvar("BBB222BR");

    expect(atualizacoes).toEqual([{ tracking_code: "BBB222BR" }]);
    // A linha da ficha mostra o novo...
    expect(hospedeiro.textContent).toContain("BBB222BR");
    // ...e o cartão da etiqueta concorda com ela.
    expect(codigoDoCartao()).toBe("BBB222BR");
  });

  it("apagar o código na linha faz o cartão voltar a dizer que ainda não há código", async () => {
    await montar();
    await editarESalvar("");

    expect(atualizacoes).toEqual([{ tracking_code: null }]);
    expect(codigoDoCartao()).toContain("Ainda sem código");
  });
});
