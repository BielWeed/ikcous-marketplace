// @vitest-environment jsdom
//
// Achado 7 da rodada 6: no menu do cartão, "Cancelar pedido" de um pedido já
// entregue dizia "use Anular venda quando disponível" para QUALQUER canal.
// "Anular venda" só existe para venda de balcão (canal presencial) do mesmo
// dia — para o pedido online entregue a frase apontava para uma ação que
// nunca vai estar disponível.
import { AdminOrderCard } from "@/components/admin/orders/AdminOrderCard";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

const pedido = (sobre: Partial<Order> = {}): Order => ({
  id: "pedido-abc123",
  customer: { name: "Maria Aparecida", whatsapp: "11999999999" },
  items: [
    {
      productId: "p1",
      name: "Caneca térmica Inox 500 ml",
      quantity: 2,
      price: 10,
      image: "",
    },
  ],
  subtotal: 20,
  total: 20,
  shipping: 0,
  discount: 0,
  status: "delivered",
  paymentMethod: "online",
  paymentStatus: "pago",
  createdAt: "2026-10-17T12:00:00Z",
  updatedAt: "2026-10-17T12:00:00Z",
  cancelledAfterShipping: false,
  ...sobre,
});

async function abrirMenuDeAcoes(order: Order) {
  act(() =>
    root.render(
      <AdminOrderCard
        order={order}
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
    ),
  );
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        'button[aria-label^="Ações do pedido"]',
      )!
      .click(),
  );
}

/** O texto de apoio do item "Cancelar pedido" no menu de ações. */
function motivoDoCancelar(): string {
  const contexto = document.querySelector('[role="dialog"]') ?? document.body;
  const botao = [...contexto.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === "Cancelar pedido",
  );
  expect(botao, "item Cancelar pedido no menu").toBeTruthy();
  return (botao!.textContent ?? "").replace(/\s+/g, " ").trim();
}

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("cartão do pedido entregue: o motivo de não poder cancelar", () => {
  it("pedido online entregue diz 'Pedido finalizado não se cancela' e não cita Anular venda", async () => {
    await abrirMenuDeAcoes(pedido({ canal: "online" }));

    const motivo = motivoDoCancelar();
    expect(motivo).toContain("Pedido finalizado não se cancela.");
    expect(motivo).not.toContain("Anular venda");
  });

  it("canal ausente (pedido antigo, sem o campo) também é tratado como online", async () => {
    await abrirMenuDeAcoes(pedido({ canal: undefined }));

    const motivo = motivoDoCancelar();
    expect(motivo).toContain("Pedido finalizado não se cancela.");
    expect(motivo).not.toContain("Anular venda");
  });

  it("o limite: venda do balcão finalizada continua apontando para Anular venda", async () => {
    await abrirMenuDeAcoes(
      pedido({ canal: "presencial", paymentMethod: "cash" }),
    );

    expect(motivoDoCancelar()).toContain(
      "Venda finalizada: use Anular venda quando disponível.",
    );
  });

  it("pedido cancelado continua com o seu próprio motivo", async () => {
    await abrirMenuDeAcoes(pedido({ status: "cancelled" }));

    expect(motivoDoCancelar()).toContain("Indisponível: pedido cancelado.");
  });
});
