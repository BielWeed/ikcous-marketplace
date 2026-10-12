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

  // B1 da revisão da tela: a ficha NÃO é desmontada quando o pedido aberto troca
  // (as abas do painel ficam montadas e a aba Pedidos parada passa direto de A
  // para B). O que A anulou ou digitou não pode vazar para B.
  const pedidoBDoSite = () =>
    pedido({
      id: "ped-site-b",
      canal: "online",
      paymentMethod: "online",
      paymentStatus: "pago",
      total: 80,
      pagamentoRecebidoEm: null,
      customer: {
        name: "Cliente B",
        whatsapp: "34999990000",
        address: "Rua B",
        number: "2",
        neighborhood: "Centro",
        city: "Patos",
        state: "MG",
      },
    });

  it("B1: anulei a venda A; troco para um pedido B do site SEM desmontar a ficha — B não herda o aviso de anulada nem a instrução de devolver dinheiro", async () => {
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
    expect(hospedeiro.textContent).toContain("Venda anulada: o estoque voltou");

    // mesma raiz, outra prop `order`: re-render, sem desmontar
    await renderizar(pedidoBDoSite());
    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toContain("Venda anulada");
    expect(texto).not.toContain("Devolva");
    expect(texto).not.toContain("Anular venda");
    expect(texto).toMatch(/R\$\s*80,00/);
  });

  // R1 da revisão: a guarda por ID (`anuladoId === order.id`) é a única coisa
  // que impede isto. O reset ao trocar de pedido não protege: ele roda na
  // TROCA, e a resposta de A chega DEPOIS dela, gravando `anuladoId = A`
  // com B já na tela. Sem a comparação por id (`anuladoId !== null`), B (do
  // site) ganharia a peça com "Anular venda", que o servidor recusaria.
  it("R1: A em voo, troco para B do site, A responde — B NÃO ganha o botão 'Anular venda' nem o aviso de A", async () => {
    let responder: (v: unknown) => void = () => {};
    // Só a anulação fica pendurada; os outros cartões da ficha também chamam
    // rpc (ao trocar para B) e não podem sequestrar o `responder`.
    rpcMock.mockImplementation((nome: string) =>
      nome === "anular_venda_presencial"
        ? new Promise((resolve) => {
            responder = resolve;
          })
        : Promise.resolve({ data: null, error: null }),
    );
    await renderizar(pedido());
    await act(async () => {
      botao(hospedeiro, "Anular venda")?.click();
    });
    await act(async () => digitarMotivo("engano"));
    await act(async () => {
      botao(hospedeiro, "Confirmar anulação")?.click();
    });
    expect(hospedeiro.textContent).toContain("Anulando");

    await renderizar(pedidoBDoSite());
    expect(hospedeiro.textContent).not.toContain("Anulando");
    // com A ainda em voo, B (do site) também não ganha a peça
    expect(botao(hospedeiro, "Anular venda")).toBeUndefined();

    await act(async () => {
      responder({
        data: { order_id: "ped-balcao-1", ja_anulada: false },
        error: null,
      });
    });
    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toContain("Anular venda");
    expect(texto).not.toContain("Venda anulada");
    expect(texto).not.toContain("Devolva");
    expect(texto).toMatch(/R\$\s*80,00/);
    expect(botao(hospedeiro, "Anular venda")).toBeUndefined();
  });

  it("B1: pergunta aberta e motivo digitado em A NÃO vazam para B (outra venda do balcão do mesmo dia): B começa fechada e nunca é anulada com o motivo de A", async () => {
    await renderizar(pedido());
    await act(async () => {
      botao(hospedeiro, "Anular venda")?.click();
    });
    await act(async () => digitarMotivo("motivo da venda A"));
    expect(document.querySelector("textarea")).not.toBeNull();

    await renderizar(pedido({ id: "ped-balcao-b", total: 55 }));
    expect(document.querySelector("textarea")).toBeNull();
    expect(botao(hospedeiro, "Confirmar anulação")).toBeUndefined();
    expect(botao(hospedeiro, "Anular venda")).toBeDefined();

    // abrindo a pergunta de B, o campo está vazio
    await act(async () => {
      botao(hospedeiro, "Anular venda")?.click();
    });
    expect(
      (document.querySelector("textarea") as HTMLTextAreaElement).value,
    ).toBe("");
    expect(
      rpcMock.mock.calls.filter(([n]) => n === "anular_venda_presencial"),
    ).toHaveLength(0);
  });

  it("B1: A anulada, passo por B e volto para A já cancelada: sem botão de anular", async () => {
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
    await renderizar(pedidoBDoSite());
    await renderizar(
      pedido({ status: "cancelled", paymentStatus: "estornado" }),
    );
    expect(botao(hospedeiro, "Anular venda")).toBeUndefined();
  });

  // (c) da revisão: o aviso de tempo real pode chegar ANTES da resposta da RPC.
  it("(c): o pedido chega cancelado pelo tempo real no meio da chamada — a peça não some nem zera; ao responder, mostra o sucesso", async () => {
    let responder: (v: unknown) => void = () => {};
    rpcMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          responder = resolve;
        }),
    );
    await renderizar(pedido());
    await act(async () => {
      botao(hospedeiro, "Anular venda")?.click();
    });
    await act(async () => digitarMotivo("engano"));
    await act(async () => {
      botao(hospedeiro, "Confirmar anulação")?.click();
    });
    expect(hospedeiro.textContent).toContain("Anulando");

    await renderizar(
      pedido({ status: "cancelled", paymentStatus: "estornado" }),
    );
    // ainda em voo: a peça continua ali, em "Anulando…", sem voltar ao botão
    expect(hospedeiro.textContent).toContain("Anulando");
    expect(botao(hospedeiro, "Anular venda")).toBeUndefined();

    await act(async () => {
      responder({
        data: { order_id: "ped-balcao-1", ja_anulada: false },
        error: null,
      });
    });
    expect(hospedeiro.textContent).toContain("Venda anulada: o estoque voltou");
  });
});
