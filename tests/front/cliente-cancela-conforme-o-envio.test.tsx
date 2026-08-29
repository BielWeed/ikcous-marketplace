// @vitest-environment jsdom
//
// Regra do Gabriel (24/08/2026, plano
// docs/superpowers/plans/2026-08-24-cancelamento-com-estorno.md, Task 4): o
// divisor de "pode cancelar?" NÃO é "pagou?", é "o produto SAIU?".
//
//   pending, processing (não enviado) -> pode cancelar
//   shipping (já enviado)             -> pode cancelar, mas o dinheiro só
//                                         volta DEPOIS que o produto voltar
//   delivered (entregue)              -> fora da regra, é devolução
//
// Antes desta correção o botão "Cancelar Pedido" só aparecia em `pending`
// (OrderDetailsView.tsx:557, condição `order.status === "pending" && user`).
// Este teste cobre os três status que decidem a regra, um caso por vez, cada
// um com asserção própria — é o que faz a sabotagem de UM caso não derrubar
// os outros dois.
//
// POR QUE RENDER DE VERDADE: mesmo raciocínio de
// cancelar-pedido-pago-avisa-do-dinheiro.test.tsx, cujo dublê de hooks este
// arquivo reaproveita.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const pedidoBase: Order = {
  id: "pedido-envio",
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
  shipping: 20,
  discount: 0,
  total: 120,
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
    from: () => ({
      select: () => ({
        eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderDetailsView — o cancelamento segue se o produto SAIU, não se foi pago", () => {
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
          orderId="pedido-envio"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function botaoCancelar() {
    return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Cancelar Pedido"),
    );
  }

  it("pedido em preparação (processing): o botão Cancelar aparece", async () => {
    pedidoAtual = { ...pedidoBase, status: "processing" };

    await renderizar();

    expect(botaoCancelar()).toBeDefined();
  });

  it("pedido já enviado (shipping) e pago: o botão aparece e o aviso NÃO promete estorno automático", async () => {
    // Achado da auditoria de 26/08/2026 (PEDIDO-03): a redação antiga —
    // "o dinheiro volta depois que ele chegar de volta" — descrevia uma
    // automação que não existe em lugar nenhum do repositório. A tela
    // precisa dizer o que o sistema FAZ (nada sozinho; alguém combina com a
    // loja), não o que seria bom que fizesse. Cada `expect` abaixo mata um
    // jeito diferente de a promessa falsa voltar disfarçada:
    //   - "toContain('já foi enviado')": ainda fala do envio (não virou o
    //     texto genérico do ramo "não enviado", que perderia essa distinção).
    //   - "toContain('NÃO volta automaticamente')": nega a automação de
    //     forma explícita — sem isto, "o dinheiro volta depois" ainda passa.
    //   - "toContain('combinar a devolução com a loja')": diz QUEM resolve
    //     (a pessoa falando com a loja), não "sozinho".
    //   - "not.toContain('automaticamente' logo após 'volta ')" via regex:
    //     a frase antiga tinha "dinheiro volta depois" sem o "NÃO" — testar
    //     só a AUSÊNCIA da frase antiga inteira garante que ela não
    //     sobrevive escondida atrás de um texto extra.
    const confirmMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmMock);
    pedidoAtual = {
      ...pedidoBase,
      status: "shipping",
      paymentStatus: "pago",
    };

    await renderizar();
    const botao = botaoCancelar();
    expect(botao).toBeDefined();

    await act(async () => {
      botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    const texto = confirmMock.mock.calls[0][0] as string;
    expect(texto).toContain("já foi enviado");
    expect(texto).toContain("NÃO volta automaticamente");
    expect(texto).toContain("combinar a devolução com a loja");
    expect(texto).not.toMatch(/dinheiro volta depois/i);
  });

  it("pedido cancelado depois de enviado e pago: o texto da ficha NÃO contradiz o aviso de confirmação — nenhum dos dois promete estorno automático", async () => {
    // A auditoria flagrou DUAS telas com DUAS promessas opostas: o `confirm`
    // (teste acima) dizia que o dinheiro "volta" sozinho; a ficha do pedido
    // já cancelado (`cancelledDescription`, OrderDetailsView.tsx:146) diz
    // "Fale com a loja para resolver" — que já era a versão HONESTA, sem
    // afirmar automação. Este teste prova que, depois da correção do
    // `confirm`, as duas superfícies contam a MESMA história: nenhuma cita
    // devolução automática, e as duas mandam a pessoa falar com a loja.
    pedidoAtual = {
      ...pedidoBase,
      status: "cancelled",
      paymentStatus: "pago",
      cancelledAfterShipping: true,
    };

    await renderizar();

    const textoDaTela = hospedeiro.textContent || "";
    expect(textoDaTela).toContain("pagamento foi recebido");
    expect(textoDaTela).toContain("Fale com a loja");
    expect(textoDaTela).not.toMatch(/dinheiro volta/i);
    expect(textoDaTela).not.toMatch(/estorno automático/i);
  });

  it("pedido entregue (delivered): o botão Cancelar NÃO aparece", async () => {
    pedidoAtual = { ...pedidoBase, status: "delivered" };

    await renderizar();

    expect(botaoCancelar()).toBeUndefined();
  });
});
