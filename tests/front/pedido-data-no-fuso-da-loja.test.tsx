// @vitest-environment jsdom
import { OrderReceipt } from "@/components/admin/orders/OrderReceipt";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  // Simula aparelho em UTC sem depender do TZ mutável do processo.
  for (const metodo of [
    "toLocaleString",
    "toLocaleDateString",
    "toLocaleTimeString",
  ] as const) {
    const original = Date.prototype[metodo];
    vi.spyOn(Date.prototype, metodo).mockImplementation(function (
      this: Date,
      locales,
      options,
    ) {
      return original.call(this, locales, { timeZone: "UTC", ...options });
    });
  }
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const base: Order = {
  id: "pedido-teste",
  customer: { name: "Cliente Teste", whatsapp: "" },
  items: [],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "pix",
  status: "pending",
  createdAt: "",
  updatedAt: "",
  cancelledAfterShipping: false,
};

it.each([
  ["2026-11-10T02:30:00Z", "09/11/2026", "23:30"],
  ["2026-11-10T03:30:00Z", "10/11/2026", "00:30"],
])(
  "ficha e recibo usam o calendário de Brasília para %s",
  async (instante, dia, hora) => {
    const pedido = { ...base, createdAt: instante, updatedAt: instante };
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () =>
      raiz.render(<OrderDetail order={pedido} onStatusChange={vi.fn()} />),
    );
    expect(hospedeiro.textContent).toContain(dia);
    expect(hospedeiro.textContent).toContain(hora);
    await act(async () => raiz.render(<OrderReceipt order={pedido} />));
    expect(document.body.textContent).toContain(dia);
    expect(document.body.textContent).toContain(hora);
  },
);
