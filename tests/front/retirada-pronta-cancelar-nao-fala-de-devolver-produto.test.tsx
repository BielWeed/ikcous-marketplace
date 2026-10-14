// @vitest-environment jsdom
//
// RETIRADA NA LOJA: cancelar um pedido "Pronto para retirar" não fala de
// devolver produto (14/10/2026).
//
// Defeito medido: pedido de retirada pronta é gravado como `shipping` (só o
// texto muda, a regra de status é a mesma). A cliente tocava em "Cancelar
// Pedido" e o aviso dizia "Este pedido já foi enviado... você precisa devolver
// o produto à loja, e o dinheiro é devolvido pela loja depois que o produto
// chegar de volta" -- ela nunca levou produto nenhum. Depois de cancelar, a
// tela dizia "Devolução: a loja faz depois de receber o produto de volta". E
// no Perfil o cartão do pedido mostrava "Em rota" com caminhão.
//
// A VERDADE DO DINHEIRO (supabase/migrations/20261198000000_cancelar_pedido_
// anula_a_cobranca.sql): cancelar em `shipping` NÃO grava estorno sozinho --
// quem confirma é a loja, à mão. Então o texto da retirada pronta não afirma
// estorno automático nem prazo; diz que a loja cuida do reembolso.
//
// SÓ TEXTO e a escolha de qual texto aparece: nenhuma regra de cancelar ou
// reembolsar muda. Pedido de ENTREGA fica idêntico (controle em cada bloco).
//
// Blocos:
//   A. textos PUROS (tabela: entrega x retirada x pago/não pago).
//   B. render de OrderDetailsView: o confirm e a ficha do pedido cancelado.
//   C. render de OrderTimeline (o cartão do Perfil).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrderTimeline } from "@/components/ui/custom/OrderTimeline";
import {
  textoConfirmarCancelamento,
  textoDevolucao,
} from "@/lib/texto-estorno-do-cliente";
import type { Order, PaymentStatus } from "@/types";

const CONFIRM_RETIRADA_PAGA =
  "Este pedido já está pronto para retirar na loja. Se cancelar, a loja cuida do reembolso do seu dinheiro e pode entrar em contato com você. Tem certeza?";
const DEVOLUCAO_RETIRADA =
  "Devolução do dinheiro: a loja cuida disso e pode entrar em contato com você.";

// Palavras que só fazem sentido para quem recebeu um produto em casa.
const FALA_DE_DEVOLVER_PRODUTO =
  /devolver o produto|já foi enviado|chegar de volta|receber o produto|de volta/i;

// ---------------------------------------------------------------------------
// A. Textos puros — a tabela inteira
// ---------------------------------------------------------------------------
describe("textoConfirmarCancelamento — entrega x retirada x pagamento", () => {
  it("retirada pronta + pago online: o texto novo, sem produto para devolver", () => {
    const texto = textoConfirmarCancelamento({
      pagamentoJaEntrou: true,
      jaFoiEnviado: false,
      retiradaPronta: true,
    });
    expect(texto).toBe(CONFIRM_RETIRADA_PAGA);
    expect(texto).not.toMatch(FALA_DE_DEVOLVER_PRODUTO);
    // Honesto: não promete estorno automático nem prazo.
    expect(texto).not.toMatch(/volta sozinho/i);
    expect(texto).not.toMatch(/\bdias?\b|horas?\b|fatura/i);
  });

  it("retirada pronta vence 'já enviado' mesmo se os dois sinais chegarem juntos", () => {
    const texto = textoConfirmarCancelamento({
      pagamentoJaEntrou: true,
      jaFoiEnviado: true,
      retiradaPronta: true,
    });
    expect(texto).toBe(CONFIRM_RETIRADA_PAGA);
  });

  it("retirada pronta + NÃO pago: o texto original de sempre", () => {
    expect(
      textoConfirmarCancelamento({
        pagamentoJaEntrou: false,
        jaFoiEnviado: false,
        retiradaPronta: true,
      }),
    ).toBe(
      "Tem certeza que deseja cancelar este pedido? Esta ação não pode ser desfeita.",
    );
  });

  it("retirada pronta + pago na entrega: combina com a loja, sem produto de volta", () => {
    const texto = textoConfirmarCancelamento({
      pagamentoJaEntrou: true,
      jaFoiEnviado: false,
      retiradaPronta: true,
      pagamentoNaEntrega: true,
    });
    expect(texto).toContain("pagou este pedido na entrega");
    expect(texto).not.toMatch(FALA_DE_DEVOLVER_PRODUTO);
  });

  it("retirada AINDA em separação + pago: segue o texto de 'não enviado' (a retirada ainda não está pronta)", () => {
    const texto = textoConfirmarCancelamento({
      pagamentoJaEntrou: true,
      jaFoiEnviado: false,
      retiradaPronta: false,
    });
    expect(texto).toContain("volta sozinho");
  });

  it("ENTREGA enviada + pago: o texto de sempre, com o produto a devolver (controle)", () => {
    const texto = textoConfirmarCancelamento({
      pagamentoJaEntrou: true,
      jaFoiEnviado: true,
    });
    expect(texto).toBe(
      "Este pedido já foi enviado. Se cancelar, você precisa devolver o produto à loja, e o dinheiro é devolvido pela loja depois que o produto chegar de volta. Tem certeza?",
    );
  });
});

describe("textoDevolucao — entrega x retirada, depois de cancelar", () => {
  it("retirada cancelada depois de pronta, sem linha de estorno: a loja cuida, sem produto de volta", () => {
    const texto = textoDevolucao({
      linhas: [],
      cancelledAfterShipping: true,
      returnedToSellerAt: null,
      retiradaNaLoja: true,
    });
    expect(texto).toBe(DEVOLUCAO_RETIRADA);
    expect(texto).not.toMatch(FALA_DE_DEVOLVER_PRODUTO);
  });

  it("retirada com 'produto voltou' marcado pela loja: o mesmo texto neutro (não há produto levado pela cliente)", () => {
    const texto = textoDevolucao({
      linhas: [],
      cancelledAfterShipping: true,
      returnedToSellerAt: "2026-10-14T10:00:00Z",
      retiradaNaLoja: true,
    });
    expect(texto).toBe(DEVOLUCAO_RETIRADA);
  });

  it("retirada cancelada ANTES de ficar pronta (não 'enviado'), sem linha: nada a mostrar, como sempre", () => {
    expect(
      textoDevolucao({
        linhas: [],
        cancelledAfterShipping: false,
        returnedToSellerAt: null,
        retiradaNaLoja: true,
      }),
    ).toBeNull();
  });

  it("retirada COM linha de estorno em andamento: o texto de sempre (esse já é verdade)", () => {
    expect(
      textoDevolucao({
        linhas: [
          {
            amount: 100,
            status: "em_processamento",
            solicitado_por: "cliente",
            concluido_em: null,
          },
        ],
        cancelledAfterShipping: true,
        returnedToSellerAt: null,
        retiradaNaLoja: true,
      }),
    ).toBe(
      "Devolução: em andamento — o dinheiro volta sozinho (PIX na conta; cartão na fatura).",
    );
  });

  it("ENTREGA cancelada depois do envio, sem linha: o texto de sempre (controle)", () => {
    expect(
      textoDevolucao({
        linhas: [],
        cancelledAfterShipping: true,
        returnedToSellerAt: null,
        retiradaNaLoja: false,
      }),
    ).toBe("Devolução: a loja faz depois de receber o produto de volta.");
    expect(
      textoDevolucao({
        linhas: [],
        cancelledAfterShipping: true,
        returnedToSellerAt: null,
      }),
    ).toBe("Devolução: a loja faz depois de receber o produto de volta.");
    expect(
      textoDevolucao({
        linhas: [],
        cancelledAfterShipping: true,
        returnedToSellerAt: "2026-10-14T10:00:00Z",
        retiradaNaLoja: false,
      }),
    ).toBe("Devolução: a loja já recebeu o produto e vai devolver o dinheiro.");
  });
});

// ---------------------------------------------------------------------------
// B. Render de OrderDetailsView
// ---------------------------------------------------------------------------
const pedidoBase: Order = {
  id: "pedido-retirada",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "prod-1",
      name: "Blusa Teste",
      price: 100,
      quantity: 1,
      image: "",
    },
  ],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "pix",
  status: "pending",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

let pedidoAtual: Order = pedidoBase;
const updateOrderStatusMock = vi.fn();

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoAtual],
    fetchUserOrders: vi.fn().mockResolvedValue([pedidoAtual]),
    updateOrderStatus: updateOrderStatusMock,
  }),
}));

const usuario = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, whatsappNumber: "34999999999" },
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "order_refunds") {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
        }),
      };
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedido(
  status: Order["status"],
  paymentStatus: PaymentStatus | null | undefined,
  extra: Partial<Order> = {},
): Order {
  return { ...pedidoBase, status, paymentStatus, ...extra };
}

describe("OrderDetailsView — retirada pronta: cancelar e ficha do pedido cancelado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    updateOrderStatusMock.mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizar() {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-retirada"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function textoDoConfirmAoCancelar(): Promise<string> {
    const confirmMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmMock);
    await renderizar();
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Cancelar Pedido"),
    );
    expect(botao).toBeDefined();
    await act(async () => {
      botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(confirmMock).toHaveBeenCalledTimes(1);
    return confirmMock.mock.calls[0][0] as string;
  }

  it("retirada pronta (shipping) e paga: o aviso do cancelamento é o texto novo", async () => {
    pedidoAtual = pedido("shipping", "pago", { retiradaNaLoja: true });
    const texto = await textoDoConfirmAoCancelar();
    expect(texto).toBe(CONFIRM_RETIRADA_PAGA);
    expect(texto).not.toMatch(FALA_DE_DEVOLVER_PRODUTO);
  });

  it("retirada pronta e NÃO paga: o aviso original, sem falar de dinheiro", async () => {
    pedidoAtual = pedido("shipping", "aguardando", { retiradaNaLoja: true });
    const texto = await textoDoConfirmAoCancelar();
    expect(texto).toBe(
      "Tem certeza que deseja cancelar este pedido? Esta ação não pode ser desfeita.",
    );
  });

  it("retirada pronta e paga na entrega: combina com a loja, sem produto de volta", async () => {
    pedidoAtual = pedido("shipping", "recebido_na_entrega", {
      retiradaNaLoja: true,
    });
    const texto = await textoDoConfirmAoCancelar();
    expect(texto).toContain("pagou este pedido na entrega");
    expect(texto).not.toMatch(FALA_DE_DEVOLVER_PRODUTO);
  });

  it("retirada em separação (processing) e paga: segue 'volta sozinho' (ainda não está pronta)", async () => {
    pedidoAtual = pedido("processing", "pago", { retiradaNaLoja: true });
    const texto = await textoDoConfirmAoCancelar();
    expect(texto).toContain("volta sozinho");
  });

  it("ENTREGA enviada (shipping) e paga: o aviso de sempre, com o produto a devolver (controle)", async () => {
    pedidoAtual = pedido("shipping", "pago", { retiradaNaLoja: false });
    const texto = await textoDoConfirmAoCancelar();
    expect(texto).toContain("já foi enviado");
    expect(texto).toContain("devolver o produto à loja");
    expect(texto).toContain("depois que o produto chegar de volta");
  });

  it("retirada cancelada depois de pronta e paga: a ficha diz que a loja cuida, sem 'produto de volta'", async () => {
    pedidoAtual = pedido("cancelled", "pago", {
      retiradaNaLoja: true,
      cancelledAfterShipping: true,
    });
    await renderizar();
    const tela = hospedeiro.textContent ?? "";
    expect(tela).toContain(DEVOLUCAO_RETIRADA);
    expect(tela).not.toContain("depois de receber o produto de volta");
    expect(tela).not.toContain("recebeu o produto");
    expect(tela).not.toMatch(/volta sozinho/i);
  });

  it("ENTREGA cancelada depois do envio e paga: a ficha de sempre (controle)", async () => {
    pedidoAtual = pedido("cancelled", "pago", {
      retiradaNaLoja: false,
      cancelledAfterShipping: true,
    });
    await renderizar();
    expect(hospedeiro.textContent ?? "").toContain(
      "Devolução: a loja faz depois de receber o produto de volta.",
    );
  });
});

// ---------------------------------------------------------------------------
// C. OrderTimeline — o cartão "Pedidos em andamento" do Perfil
// ---------------------------------------------------------------------------
describe("OrderTimeline — retirada pronta não é 'Em rota'", () => {
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
  });

  function etapas(): string[] {
    return Array.from(hospedeiro.querySelectorAll("li")).map((li) =>
      (li.querySelector("span.text-center")?.textContent ?? "").trim(),
    );
  }

  it("retirada pronta (shipping): a etapa se chama 'Pronto para retirar', sem 'Em rota'", async () => {
    await act(async () => {
      raiz.render(<OrderTimeline status="shipping" retiradaNaLoja={true} />);
    });
    expect(etapas()).toEqual([
      "Recebido",
      "Preparando",
      "Pronto para retirar",
      "Entregue",
    ]);
    expect(hospedeiro.textContent).not.toContain("Em rota");
  });

  it("retirada ainda em preparo: a etapa futura já tem o nome da retirada (igual à ficha do pedido)", async () => {
    await act(async () => {
      raiz.render(<OrderTimeline status="processing" retiradaNaLoja={true} />);
    });
    expect(etapas()[2]).toBe("Pronto para retirar");
    expect(hospedeiro.textContent).not.toContain("Em rota");
  });

  it("ENTREGA a caminho: 'Em rota', como sempre (controle)", async () => {
    await act(async () => {
      raiz.render(<OrderTimeline status="shipping" />);
    });
    expect(etapas()).toEqual([
      "Recebido",
      "Preparando",
      "Em rota",
      "Entregue",
    ]);
    await act(async () => {
      raiz.render(<OrderTimeline status="shipping" retiradaNaLoja={false} />);
    });
    expect(etapas()[2]).toBe("Em rota");
  });
});
