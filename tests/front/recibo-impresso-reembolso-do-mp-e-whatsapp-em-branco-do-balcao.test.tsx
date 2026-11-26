// @vitest-environment jsdom
//
// Caça por mutação no recibo IMPRESSO (OrderReceipt.tsx): duas bordas que
// nenhum teste prendia.
//  1) Reembolso integral pelo Mercado Pago, sem reembolso manual nenhum, NÃO
//     troca a situação do papel para "Estornado": só a soma "manual + MP" cobrindo
//     o total, com manual de verdade lançado, faz isso. O papel segue dizendo a
//     situação real do pedido e mostra as duas linhas do reembolso do MP.
//  2) Venda de balcão sem cliente: o WhatsApp só com espaços não é WhatsApp, então
//     o papel não imprime o nome genérico "Venda no balcão" como se fosse gente.
import { OrderReceipt } from "@/components/admin/orders/OrderReceipt";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function pedido(extra: Partial<Order> = {}): Order {
  return {
    id: "pedido-9876543210",
    customer: {
      name: "Maria Teste",
      whatsapp: "11999999999",
      address: "Rua das Flores",
      number: "120",
      neighborhood: "Centro",
    },
    items: [
      { productId: "p1", name: "Camiseta", price: 100, quantity: 1, image: "" },
    ],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "online",
    paymentStatus: "pago",
    status: "processing",
    createdAt: new Date("2026-08-20T10:00:00Z").toISOString(),
    updatedAt: new Date("2026-08-20T10:00:00Z").toISOString(),
    cancelledAfterShipping: false,
    ...extra,
  };
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderReceipt — reembolso do Mercado Pago e balcão sem cliente", () => {
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

  async function imprimir(
    order: Order,
    props: {
      valorEstornado?: number;
      valorReembolsadoManual?: number | null;
    } = {},
  ): Promise<HTMLElement> {
    await act(async () => {
      raiz.render(<OrderReceipt order={order} {...props} />);
    });
    const papel = document.querySelector<HTMLElement>("[data-tema-fixo]");
    expect(papel).not.toBeNull();
    return papel as HTMLElement;
  }
  const texto = (papel: HTMLElement) =>
    (papel.textContent ?? "").replace(/\p{Zs}/gu, " ");

  it.each([undefined, 0, null])(
    "reembolso integral só pelo Mercado Pago (manual %s) mantém a situação 'Pago'",
    async (manual) => {
      const papel = await imprimir(pedido(), {
        valorEstornado: 100,
        valorReembolsadoManual: manual,
      });
      const t = texto(papel);
      expect(t).toContain("Reembolsado pelo Mercado Pago:");
      expect(t).toContain("Total menos reembolso do Mercado Pago:");
      expect(t).not.toContain("Devolvido ao cliente (manual)");
      // A situação do pagamento é a do pedido, não "Estornado".
      expect(t).toContain("Pagamento: Pagamento pelo sitePago");
      expect(t).not.toContain("Estornado");
    },
  );

  it("controle: com um reembolso manual de verdade que fecha o total, o papel diz 'Estornado'", async () => {
    const papel = await imprimir(pedido(), {
      valorEstornado: 60,
      valorReembolsadoManual: 40,
    });
    const t = texto(papel);
    expect(t).toContain("Devolvido ao cliente (manual):");
    expect(t).toContain("Estornado");
  });

  describe("venda de balcão sem cliente", () => {
    const balcao = (whatsapp: string, userId?: string) =>
      pedido({
        canal: "presencial",
        paymentMethod: "cash",
        paymentStatus: "recebido_na_entrega",
        userId,
        customer: { name: "Venda no balcão", whatsapp },
      });

    it("WhatsApp só com espaços: não imprime o nome genérico nem o bloco do cliente", async () => {
      const papel = await imprimir(balcao("   "));
      const t = texto(papel);
      expect(t).not.toContain("CLIENTE:");
      expect(t).not.toContain("Venda no balcão");
    });

    it("WhatsApp de verdade: o bloco do cliente aparece com o nome digitado", async () => {
      const papel = await imprimir(balcao(" 11988887777 "));
      const t = texto(papel);
      expect(t).toContain("CLIENTE:");
      expect(t).toContain("Venda no balcão");
    });

    it("cliente com conta: o papel diz só 'Cliente'", async () => {
      const papel = await imprimir(balcao("   ", "user-1"));
      const t = texto(papel);
      expect(t).toContain("CLIENTE:");
      expect(t).not.toContain("Venda no balcão");
    });
  });
});
