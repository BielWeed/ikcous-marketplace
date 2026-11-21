// @vitest-environment jsdom
import { AdminOrderCard } from "@/components/admin/orders/AdminOrderCard";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const aviso =
  "Sem código salvo, a cliente vê “A caminho”, mas não consegue rastrear. Se já tem o código, salve antes de avançar.";
const pedido: Order = {
  id: "pedido-abc123",
  customer: { name: "Cliente Teste", whatsapp: "" },
  items: [],
  subtotal: 20,
  total: 20,
  shipping: 0,
  discount: 0,
  status: "processing",
  canal: "online",
  retiradaNaLoja: false,
  paymentMethod: "online",
  paymentStatus: "pago",
  createdAt: "2026-10-17T12:00:00Z",
  updatedAt: "2026-10-17T12:00:00Z",
  cancelledAfterShipping: false,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function montar(sobre: Partial<Order> = {}) {
  act(() =>
    root.render(
      <AdminOrderCard
        order={{ ...pedido, ...sobre }}
        viewMode="compact"
        onSelect={vi.fn()}
        onWhatsApp={vi.fn()}
        onRegistrarPagamento={vi.fn()}
        registrandoPagamento={false}
        onStatusChange={vi.fn().mockResolvedValue(undefined)}
      />,
    ),
  );
}

it("avisa quando o próximo passo do pedido pago é o envio sem código salvo", () => {
  montar();

  expect(host.textContent).toContain("Avançar →");
  expect(host.textContent).toContain(aviso);
});

it.each([
  [
    "-",
    "O código de rastreio salvo (“-”) não é válido: a cliente não consegue rastrear. Corrija o código antes de avançar.",
  ],
  ["  ", aviso],
  [
    `  ${"-".repeat(40)}  `,
    `O código de rastreio salvo (“${"-".repeat(29)}…”) não é válido`,
  ],
])(
  "mostra o aviso correspondente ao código salvo %j",
  (trackingCode, mensagem) => {
    montar({ trackingCode });

    expect(host.textContent).toContain(mensagem);
  },
);

it.each([
  ["código já salvo", { trackingCode: "BR123456789BR" }],
  ["retirada na loja", { retiradaNaLoja: true }],
  ["entrega local", { shippingOptionId: "local-delivery" }],
  ["próximo passo diferente de envio", { status: "pending" }],
] as const)("não mostra o aviso de rastreio: %s", (_caso, sobre) => {
  montar(sobre);

  expect(host.textContent).not.toContain("a cliente não consegue rastrear");
  expect(host.textContent).not.toContain(aviso);
});

it("avisa também quando o Avançar fica no menu porque falta registrar o pagamento", () => {
  montar({ paymentMethod: "cash", paymentStatus: null });

  expect(host.textContent).toContain(aviso);
});
