import type { Order } from "@/types";
// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const salvar = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ update: () => ({ eq: salvar }) }),
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/admin/orders/EtiquetaDoPedidoCard", () => ({
  EtiquetaDoPedidoCard: () => null,
}));
vi.mock("@/components/admin/orders/EstornoCard", () => ({
  EstornoCard: () => null,
}));
vi.mock("@/components/admin/orders/DevolucaoDoPedidoAdminCard", () => ({
  DevolucaoDoPedidoAdminCard: () => null,
}));
import { OrderDetail } from "@/components/admin/orders/OrderDetail";

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedido(id: string, trackingCode: string): Order {
  return {
    id,
    trackingCode,
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    paymentStatus: "pago",
    status: "processing",
    createdAt: "2026-10-16T10:00:00Z",
    updatedAt: "2026-10-16T10:00:00Z",
    cancelledAfterShipping: false,
  };
}

describe("C2 A — resposta do rastreio pertence ao pedido enviado", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  beforeEach(() => {
    salvar.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  it("trocar de A para B durante o envio não aplica o código de A em B", async () => {
    let concluir!: (resposta: { error: null }) => void;
    salvar.mockImplementation(
      () =>
        new Promise((resolve) => {
          concluir = resolve;
        }),
    );
    const props = { onStatusChange: vi.fn() };
    await act(async () => {
      raiz.render(<OrderDetail {...props} order={pedido("A", "CODIGO-A")} />);
    });
    act(() => {
      host
        .querySelector<HTMLButtonElement>('button[title="Editar Código"]')!
        .click();
    });
    act(() => {
      const botao = [...host.querySelectorAll("button")].find(
        (b) => b.textContent === "Salvar",
      );
      expect(botao).toBeDefined();
      botao!.click();
    });
    expect(salvar).toHaveBeenCalledWith("id", "A");
    await act(async () => {
      // Reutiliza a mesma instância, como acontecia no painel.
      raiz.render(<OrderDetail {...props} order={pedido("B", "CODIGO-B")} />);
    });
    await act(async () => {
      concluir({ error: null });
    });
    expect(host.textContent).toContain("CODIGO-B");
    expect(host.textContent).not.toContain("CODIGO-A");
    // B pode editar enquanto a resposta antiga é descartada.
    act(() => {
      host
        .querySelector<HTMLButtonElement>('button[title="Editar Código"]')!
        .click();
    });
    expect(
      host.querySelector<HTMLInputElement>("#tracking-input")?.disabled,
    ).toBe(false);
  });
});
