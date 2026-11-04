// @vitest-environment jsdom
//
// RETIRADA NA LOJA pronta e CANCELADA, lado do cartão de devolução e da fila
// (04/11/2026). Complementa `retirada-pronta-cancelada-painel-e-avisos.test.ts`.
//
// O cartão "Devolução de dinheiro" bloqueado dizia "confirme que o produto
// voltou" a quem nunca despachou nada. O texto agora diz o que é verdade: a
// cliente não levou o produto, e o toque em "O produto voltou" continua
// necessário porque o servidor (`solicitar_estorno`) recusa a devolução até lá
// e só esse toque repõe o estoque.
//
// E a FILA não muda: retirada pronta cancelada continua em
// "esperando_o_produto" (mandá-la para "devolver_agora" daria um botão que o
// servidor recusa). O teste existe para quem for "consertar" isso só no
// front enxergar a trava antes de mexer.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true, updateConfig: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [],
    loadOrders: vi.fn(),
    updateOrderStatus: vi.fn(),
    confirmarRetornoDoProduto: vi.fn(),
    totalOrders: 0,
    isLoaded: true,
    loading: false,
    pedidosCancelados: [],
    carregandoPedidosCancelados: false,
    fetchPedidosCancelados: vi.fn().mockResolvedValue([]),
    pedidosCanceladosIncompleto: false,
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));
vi.mock("@/hooks/useEstornosDoPedido", () => ({
  useEstornosDoPedido: () => ({
    linhas: [],
    pago: 100,
    devolvido: 0,
    emCurso: 0,
    emDuvida: 0,
    disponivel: 100,
    reservadoPorFora: 0,
    carregando: false,
    pedidoCarregado: true,
    erro: false,
    recarregar: vi.fn(),
    solicitarEstorno: vi.fn(),
    registrarPorForaAposEspera: vi.fn(),
    enviando: false,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const retiradaPronta: Order = {
  id: "pedido-retirada-1",
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
  paymentMethod: "online",
  status: "cancelled",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: true,
  returnedToSellerAt: null,
  paymentStatus: "pago",
  retiradaNaLoja: true,
};

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

async function montar(order: Order) {
  const { EstornoCard } = await import("@/components/admin/orders/EstornoCard");
  await act(async () => {
    raiz.render(<EstornoCard order={order} />);
  });
}

function texto(): string {
  return (hospedeiro.textContent ?? "").replace(/\s+/g, " ");
}

describe("EstornoCard — retirada pronta cancelada, produto ainda não 'voltou'", () => {
  it("diz que a cliente não levou o produto e que o toque em 'O produto voltou' ainda é o passo", async () => {
    await montar(retiradaPronta);
    expect(texto()).toContain("A cliente não levou o produto");
    expect(texto()).toContain("O produto voltou");
    expect(texto()).toContain("repõe o estoque e libera a devolução");
    // O servidor recusa a devolução até lá: o botão fica bloqueado.
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Devolver R$"),
    );
    expect(botao?.disabled).toBe(true);
  });

  it("ENTREGA cancelada depois de enviada (controle): o texto de sempre", async () => {
    await montar({ ...retiradaPronta, retiradaNaLoja: false });
    expect(texto()).toContain(
      "Para devolver o dinheiro, primeiro confirme que o produto voltou, no aviso de pedidos cancelados (ícone ao lado do título Pedidos).",
    );
    expect(texto()).not.toContain("A cliente não levou");
  });
});

describe("baldeDeEstorno — retirada pronta cancelada", () => {
  it("segue em 'esperando_o_produto' (o servidor só libera a devolução depois de 'O produto voltou')", async () => {
    const { baldeDeEstorno } = await import("@/views/admin/AdminOrdersView");
    expect(baldeDeEstorno(retiradaPronta)).toBe("esperando_o_produto");
  });

  it("depois de 'O produto voltou' vai para 'devolver_agora', retirada ou não", async () => {
    const { baldeDeEstorno } = await import("@/views/admin/AdminOrdersView");
    expect(
      baldeDeEstorno({
        ...retiradaPronta,
        returnedToSellerAt: "2026-11-04T10:00:00Z",
      }),
    ).toBe("devolver_agora");
  });
});
