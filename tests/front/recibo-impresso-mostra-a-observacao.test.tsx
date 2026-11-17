// @vitest-environment jsdom
import { OrderReceipt } from "@/components/admin/orders/OrderReceipt";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function pedidoBase(overrides: Partial<Order> = {}): Order {
  return {
    id: "pedido-1234567890",
    customer: {
      name: "Cliente Teste",
      whatsapp: "11999999999",
      address: "Rua das Flores",
      number: "100",
      neighborhood: "Centro",
    },
    items: [
      {
        productId: "prod-1",
        name: "Produto Teste",
        price: 100,
        quantity: 1,
        image: "",
      },
    ],
    subtotal: 100,
    shipping: 15,
    discount: 0,
    total: 115,
    paymentMethod: "pix",
    status: "pending",
    createdAt: "2026-08-20T10:00:00Z",
    updatedAt: "2026-08-20T10:00:00Z",
    cancelledAfterShipping: false,
    ...overrides,
  };
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderReceipt — a observação vai no papel", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function imprimir(pedido: Order): Promise<HTMLElement> {
    await act(async () => {
      raiz.render(<OrderReceipt order={pedido} />);
    });
    const papel = document.body.querySelector<HTMLElement>(".print\\:block");
    expect(papel).not.toBeNull();
    return papel!;
  }

  it("entrega: imprime a instrução exata antes dos itens e com o mesmo rótulo", async () => {
    const notes = "Não tocar a campainha. Entregar na portaria após 18h.";
    const papel = await imprimir(pedidoBase({ notes }));
    const rotulos = Array.from(papel.querySelectorAll("p"));
    const rotulo = rotulos.find((p) => p.textContent === "OBSERVAÇÃO:");
    expect(rotulo).toBeDefined();
    expect(rotulo?.className).toBe("mb-1 border-b border-black font-bold");
    expect(rotulo?.nextElementSibling?.textContent).toBe(notes);
    expect(papel.textContent?.indexOf("OBSERVAÇÃO:")).toBeLessThan(
      papel.textContent?.indexOf("ITENS:") ?? -1,
    );
  });

  it.each(["", "   ", undefined])(
    "sem observação (%s): não imprime rótulo vazio",
    async (notes) => {
      const papel = await imprimir(pedidoBase({ notes }));
      expect(papel.textContent).not.toContain("OBSERVAÇÃO:");
    },
  );

  it("preserva as quebras de linha e permite quebrar palavras longas", async () => {
    const notes = "Não tocar a campainha.\nEntregar na portaria após 18h.";
    const papel = await imprimir(pedidoBase({ notes }));
    const texto = Array.from(papel.querySelectorAll("p")).find(
      (p) => p.textContent === notes,
    );
    expect(texto).toBeDefined();
    expect(texto?.classList.contains("text-xs")).toBe(true);
    expect(texto?.classList.contains("whitespace-pre-line")).toBe(true);
    expect(texto?.classList.contains("break-words")).toBe(true);
  });

  it("balcão antigo com nota interna não imprime a observação nem seu texto", async () => {
    const notes = "Desconto autorizado por peça de mostruário";
    const papel = await imprimir(
      pedidoBase({ canal: "presencial", notes, shipping: 0, total: 100 }),
    );
    expect(papel.textContent).not.toContain("OBSERVAÇÃO:");
    expect(papel.textContent).not.toContain(notes);
  });

  it("balcão sem observação continua sem bloco novo, sem frete e com pagamento", async () => {
    const papel = await imprimir(
      pedidoBase({ canal: "presencial", shipping: 0, total: 100 }),
    );
    expect(papel.textContent).not.toContain("OBSERVAÇÃO:");
    expect(papel.textContent).not.toContain("Frete");
    expect(papel.textContent).toContain("ITENS:");
    expect(papel.textContent).toContain("Pagamento:");
    expect(papel.textContent).toContain("R$ 100,00");
  });
});
