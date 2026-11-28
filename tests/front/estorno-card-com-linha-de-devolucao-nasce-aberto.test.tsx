// @vitest-environment jsdom
//
// O cartão "Devolução de dinheiro" (EstornoCard) de pedido pago AINDA EM
// ANDAMENTO nasce recolhido numa linha — só diria "Cancele o pedido antes…".
// Mas se já existe uma LINHA de devolução (em andamento, recusada, concluída),
// há o que ler: o cartão nasce ABERTO, com o histórico à vista.
//
// Buraco achado por mutação (lote 591, 28/11/2026): tirar `linhas.length === 0`
// da condição `recolhivel` não derrubava teste algum. O vizinho
// `ficha-do-pedido-atalho-da-etiqueta-e-estorno-recolhido` prova o "aberto"
// só pelo valor reservado por fora (`reservadoPorFora: 30`), nunca por linha.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LinhaEstornoDoPedido } from "@/hooks/useEstornosDoPedido";
import type { Order, OrderStatus } from "@/types";

const useEstornosDoPedidoMock = vi.fn();
vi.mock("@/hooks/useEstornosDoPedido", () => ({
  useEstornosDoPedido: (orderId: string) => useEstornosDoPedidoMock(orderId),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedido(status: OrderStatus): Order {
  return {
    id: "pedido-teste-591",
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
    status,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: false,
    paymentStatus: "pago",
  };
}

const linhaDeDevolucao: LinhaEstornoDoPedido = {
  id: "refund-teste-1",
  amount: 30,
  status: "em_processamento",
  solicitado_por: "lojista",
  mp_status: null,
  mp_status_detail: null,
  tentativas: 1,
  ultimo_erro: null,
  motivo: null,
  created_at: "2026-09-01T10:00:00.000Z",
  concluido_em: null,
  pode_ter_saido: false,
  por_fora_liberado_em: null,
  por_fora_apos_espera_liberado: false,
  substituida_por_manual: false,
  eh_pix: false,
};

function hook(linhas: LinhaEstornoDoPedido[]) {
  return {
    linhas,
    pago: 100,
    devolvido: 0,
    emCurso: linhas.length > 0 ? 30 : 0,
    emDuvida: 0,
    disponivel: linhas.length > 0 ? 70 : 100,
    reservadoPorFora: 0,
    carregando: false,
    pedidoCarregado: true,
    erro: false,
    recarregar: vi.fn(),
    solicitarEstorno: vi.fn().mockResolvedValue(undefined),
    registrarPorForaAposEspera: vi.fn().mockResolvedValue(true),
    enviando: false,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  useEstornosDoPedidoMock.mockReset();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.clearAllMocks();
});

async function montar(status: OrderStatus) {
  const { EstornoCard } = await import("@/components/admin/orders/EstornoCard");
  await act(async () => {
    raiz.render(<EstornoCard order={pedido(status)} />);
  });
}

const linhaRecolhida = () =>
  Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) =>
      b.getAttribute("aria-expanded") !== null &&
      b.textContent?.includes("Devolução de dinheiro"),
  );

describe("EstornoCard — pedido em andamento com linha de devolução nasce aberto", () => {
  it.each<OrderStatus>(["shipping", "processing"])(
    "pedido %s COM uma linha de devolução: cartão aberto, histórico à vista",
    async (status) => {
      useEstornosDoPedidoMock.mockReturnValue(hook([linhaDeDevolucao]));
      await montar(status);

      expect(linhaRecolhida()).toBeUndefined();
      // O valor vem com espaço inseparável depois do "R$".
      expect(hospedeiro.textContent).toMatch(
        /Devolução de R\$\s30,00 em andamento/,
      );
    },
  );

  it.each<OrderStatus>(["shipping", "processing"])(
    "pedido %s SEM linhas: cartão recolhido numa linha fechada",
    async (status) => {
      useEstornosDoPedidoMock.mockReturnValue(hook([]));
      await montar(status);

      expect(linhaRecolhida()?.getAttribute("aria-expanded")).toBe("false");
      expect(hospedeiro.textContent).not.toContain(
        "Cancele o pedido antes de devolver o dinheiro.",
      );
    },
  );
});
