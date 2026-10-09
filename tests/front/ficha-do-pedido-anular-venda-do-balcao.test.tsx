// @vitest-environment jsdom
//
// Anular venda do balcão (migration 20261204000000) na FICHA DO PEDIDO: só o
// botão, só para venda do balcão do mesmo dia da loja, sem mexer em nenhum
// outro bloco da ficha. Quem decide de verdade é o banco (a RPC); aqui se
// prova que a ficha convida ao clique certo, manda o pedido e o motivo certos
// e não perde o aviso de sucesso quando o pedido muda para cancelado.
//
// Molde de montagem: ficha-do-pedido-mesa-do-lojista.test.tsx (OrderDetail
// direto, com @/lib/supabase mocado e `items: []` para não precisar do
// IntersectionObserver do LazyImage).
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: rpcMock,
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 08/10/2026, 15:00 em São Paulo.
const AGORA = new Date("2026-10-08T18:00:00.000Z");

function pedido(parcial: Partial<Order> = {}): Order {
  return {
    id: "ped-balcao-1",
    customer: {
      name: "Venda no balcão",
      whatsapp: "",
      address: "",
      number: "",
      neighborhood: "",
      city: "",
      state: "",
    },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "cash",
    status: "delivered",
    paymentStatus: "recebido_na_entrega",
    createdAt: "2026-10-08T14:00:00.000Z",
    updatedAt: "2026-10-08T14:00:00.000Z",
    cancelledAfterShipping: false,
    pagamentoRecebidoEm: "2026-10-08T14:00:00.000Z",
    pagamentoRecebidoPor: null,
    canal: "presencial",
    ...parcial,
  };
}

function botao(raiz: ParentNode, texto: string): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function digitarMotivo(texto: string): void {
  const campo = document.querySelector("textarea") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(campo, texto);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ficha do pedido — Anular venda do balcão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    rpcMock.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function renderizar(order: Order) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });
  }

  it("venda do balcão do mesmo dia, entregue e recebida: o botão aparece DENTRO do bloco do dinheiro", async () => {
    await renderizar(pedido());
    const bloco = hospedeiro.querySelector('[data-testid="bloco-dinheiro"]');
    expect(bloco).not.toBeNull();
    expect(botao(bloco as HTMLElement, "Anular venda")).toBeDefined();
    // e em mais lugar nenhum da ficha
    expect(
      [...hospedeiro.querySelectorAll("button")].filter((b) =>
        b.textContent?.includes("Anular venda"),
      ),
    ).toHaveLength(1);
  });

  it("pedido do site (canal online ou ausente) não mostra o botão", async () => {
    for (const canal of ["online", undefined] as const) {
      await renderizar(
        pedido({ canal, paymentStatus: "pago", paymentMethod: "online" }),
      );
      expect(hospedeiro.textContent).not.toContain("Anular venda");
    }
  });

  it("venda de ontem, cancelada, sem recebimento carimbado ou já estornada: sem botão", async () => {
    for (const parcial of [
      { pagamentoRecebidoEm: "2026-10-07T14:00:00.000Z" },
      { status: "cancelled" as const },
      { pagamentoRecebidoEm: null },
      { paymentStatus: "estornado" as const },
    ]) {
      await renderizar(pedido(parcial));
      expect(hospedeiro.textContent).not.toContain("Anular venda");
    }
  });

  it("fluxo: abre, exige o motivo, anula com o pedido e o motivo certos e conta o que fazer com o dinheiro", async () => {
    rpcMock.mockResolvedValue({
      data: { order_id: "ped-balcao-1", ja_anulada: false },
      error: null,
    });
    await renderizar(pedido({ paymentMethod: "card" }));
    await act(async () => {
      botao(hospedeiro, "Anular venda")?.click();
    });
    expect(botao(hospedeiro, "Confirmar anulação")?.disabled).toBe(true);
    await act(async () => digitarMotivo("cliente desistiu na hora"));
    await act(async () => {
      botao(hospedeiro, "Confirmar anulação")?.click();
    });
    // (outros cartões da ficha também leem o banco: conta só a anulação)
    expect(
      rpcMock.mock.calls.filter(([n]) => n === "anular_venda_presencial"),
    ).toHaveLength(1);
    expect(rpcMock).toHaveBeenCalledWith("anular_venda_presencial", {
      p_order_id: "ped-balcao-1",
      p_motivo: "cliente desistiu na hora",
    });
    expect(hospedeiro.textContent).toContain("Venda anulada: o estoque voltou");
    expect(hospedeiro.textContent).toMatch(
      /Faça o estorno de R\$\s100,00 na maquininha\./,
    );
  });

  it("depois de anular, o pedido chega CANCELADO pelo tempo real e o aviso de sucesso NÃO some", async () => {
    rpcMock.mockResolvedValue({
      data: { order_id: "ped-balcao-1", ja_anulada: false },
      error: null,
    });
    await renderizar(pedido());
    await act(async () => {
      botao(hospedeiro, "Anular venda")?.click();
    });
    await act(async () => digitarMotivo("engano"));
    await act(async () => {
      botao(hospedeiro, "Confirmar anulação")?.click();
    });
    await renderizar(
      pedido({ status: "cancelled", paymentStatus: "estornado" }),
    );
    expect(hospedeiro.textContent).toContain("Venda anulada: o estoque voltou");
    expect(botao(hospedeiro, "Anular venda")).toBeUndefined();
  });

  it("a recusa do banco aparece em português, a ficha continua com o botão e nada é dado como anulado", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "22023",
        message:
          "Só dá para anular no mesmo dia da venda. Para outro dia, registre uma devolução.",
      },
    });
    await renderizar(pedido());
    await act(async () => {
      botao(hospedeiro, "Anular venda")?.click();
    });
    await act(async () => digitarMotivo("engano"));
    await act(async () => {
      botao(hospedeiro, "Confirmar anulação")?.click();
    });
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "registre uma devolução",
    );
    expect(hospedeiro.textContent).not.toContain("Venda anulada");
  });

  it("venda ligada a uma conta de cliente avisa que ele pode ler o motivo", async () => {
    await renderizar(pedido({ userId: "cliente-1" }));
    await act(async () => {
      botao(hospedeiro, "Anular venda")?.click();
    });
    expect(hospedeiro.textContent).toContain("ele pode ler o motivo");
  });

  it("a ficha não perde o botão de 'Desfazer' do recebimento nem o resto do bloco do dinheiro", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(
        <OrderDetail
          order={pedido()}
          onStatusChange={vi.fn()}
          onRegistrarPagamento={vi.fn()}
        />,
      );
    });
    expect(botao(hospedeiro, "Desfazer")).toBeDefined();
    expect(botao(hospedeiro, "Anular venda")).toBeDefined();
    expect(hospedeiro.textContent).toContain("Total do pedido");
  });
});
