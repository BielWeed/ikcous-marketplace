// @vitest-environment jsdom
// Rotina de despachar pelo celular (28/11/2026):
// - o pedido sem conta não recebe aviso automático de status, e nada no cartão
//   dizia isso: ganha a marca discreta "sem conta" (a venda do balcão também
//   não tem conta, mas ali não há aviso a dar — sem marca);
// - o WhatsApp do menu "Ações" abria a conversa com a folha ainda aberta por
//   baixo: fecha a folha antes.
import { AdminOrderCard } from "@/components/admin/orders/AdminOrderCard";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const chamarNoWhatsapp = vi.fn();
const pedido = (sobre: Partial<Order> = {}): Order => ({
  id: "pedido-fic-571",
  customer: { name: "Cliente Fictícia", whatsapp: "11988887777" },
  items: [
    {
      productId: "p1",
      name: "Produto de teste",
      quantity: 1,
      price: 10,
      image: "",
    },
  ],
  subtotal: 10,
  total: 10,
  shipping: 0,
  discount: 0,
  status: "processing",
  paymentMethod: "online",
  paymentStatus: "pago",
  createdAt: "2026-11-27T12:00:00Z",
  updatedAt: "2026-11-27T12:00:00Z",
  cancelledAfterShipping: false,
  ...sobre,
});
function montar(order: Order) {
  act(() =>
    root.render(
      <AdminOrderCard
        order={order}
        viewMode="compact"
        onSelect={vi.fn()}
        onWhatsApp={chamarNoWhatsapp}
        onRegistrarPagamento={vi.fn()}
        registrandoPagamento={false}
        onStatusChange={vi.fn()}
        isOffline={false}
      />,
    ),
  );
}
const marcaSemConta = () =>
  host.querySelector('[data-testid="selo-sem-conta"]');

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("pedido online sem conta mostra a marca 'sem conta'", () => {
  montar(pedido({ userId: undefined }));
  expect(marcaSemConta()?.textContent).toContain("sem conta");
});

it("pedido de cliente com conta não mostra a marca", () => {
  montar(pedido({ userId: "usuario-fic-1" }));
  expect(marcaSemConta()).toBeNull();
});

it("venda do balcão sem conta não mostra a marca", () => {
  montar(pedido({ userId: undefined, canal: "presencial" }));
  expect(marcaSemConta()).toBeNull();
});

it("WhatsApp do menu Ações fecha a folha antes de abrir a conversa", async () => {
  montar(pedido({ userId: "usuario-fic-1" }));
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        'button[aria-label^="Ações do pedido"]',
      )!
      .click(),
  );
  const dialogo = document.querySelector('[role="dialog"]');
  expect(dialogo).toBeTruthy();
  const whatsapp = [...dialogo!.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === "WhatsApp",
  );
  await act(async () => whatsapp!.click());
  expect(chamarNoWhatsapp).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
