// @vitest-environment jsdom
//
// Bordas do recibo IMPRESSO (OrderReceipt.tsx) que nenhum teste prendia, achadas
// trocando o código por versões erradas e vendo que a suíte seguia verde:
//   - a linha "Subtotal" mostra o SUBTOTAL (e não o total, nem a soma dos itens);
//   - pedido cancelado não imprime "Devolvido ao cliente (manual)" nem vira
//     "Estornado": o reembolso manual só conta em pedido vivo;
//   - pedido de R$ 0,00 (cupom de 100%) segue dizendo "Sem valor a cobrar", mesmo
//     que alguém tenha lançado um reembolso manual por engano;
//   - forma de pagamento desconhecida com pagamento recusado não afirma "recusado"
//     (só pedido pelo site pode dizer isso);
//   - o nome literal da venda de balcão sem cliente, com espaço nas pontas;
//   - as linhas de reembolso do papel mantêm o espaço entre rótulo e valor e o
//     valor numa linha só (rótulo comprido não esmaga o dinheiro).
import { OrderReceipt } from "@/components/admin/orders/OrderReceipt";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function pedido(extra: Partial<Order> = {}): Order {
  return {
    id: "pedido-1234567890",
    customer: {
      name: "Maria Teste",
      whatsapp: "11999999999",
      address: "Rua das Flores",
      number: "120",
      neighborhood: "Centro",
    },
    items: [
      { productId: "p1", name: "Camiseta", price: 30, quantity: 1, image: "" },
      { productId: "p2", name: "Calça", price: 50, quantity: 1, image: "" },
    ],
    subtotal: 80,
    shipping: 7.5,
    discount: 12.3,
    total: 75.2,
    paymentMethod: "pix",
    status: "pending",
    createdAt: new Date("2026-08-20T10:00:00Z").toISOString(),
    updatedAt: new Date("2026-08-20T10:00:00Z").toISOString(),
    cancelledAfterShipping: false,
    ...extra,
  };
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderReceipt — bordas dos totais e da situação do pagamento", () => {
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
    return papel!;
  }

  function linhaDe(papel: HTMLElement, rotulo: string): HTMLElement {
    const span = Array.from(papel.querySelectorAll("span")).find(
      (s) => s.textContent === rotulo,
    );
    expect(span, `linha "${rotulo}"`).toBeDefined();
    return span!.parentElement!;
  }

  it("cada linha de totais traz o seu valor: subtotal não é o total nem a soma dos itens", async () => {
    // Itens somam 80; subtotal gravado 95 (de propósito diferente de ambos).
    const papel = await imprimir(
      pedido({ subtotal: 95, shipping: 7.5, discount: 12.3, total: 90.2 }),
    );
    expect(linhaDe(papel, "Subtotal").textContent).toBe("SubtotalR$ 95,00");
    expect(linhaDe(papel, "Frete").textContent).toBe("FreteR$ 7,50");
    expect(linhaDe(papel, "Desconto").textContent).toBe("Desconto- R$ 12,30");
    expect(linhaDe(papel, "TOTAL").textContent).toBe("TOTALR$ 90,20");
  });

  it("pedido cancelado não imprime reembolso manual nem diz 'Estornado'", async () => {
    const papel = await imprimir(pedido({ status: "cancelled", total: 75.2 }), {
      valorReembolsadoManual: 75.2,
    });
    expect(papel.textContent).not.toContain("Devolvido ao cliente");
    expect(papel.textContent).not.toContain("Estornado");
    expect(papel.textContent).toContain("Cancelado · nada a receber");
  });

  it("controle: o mesmo reembolso manual em pedido vivo aparece, e o integral vira 'Estornado'", async () => {
    const papel = await imprimir(pedido({ total: 75.2 }), {
      valorReembolsadoManual: 75.2,
    });
    expect(papel.textContent).toContain("Devolvido ao cliente (manual):");
    expect(papel.textContent).toContain("R$ 75,20");
    expect(papel.textContent).toContain("Estornado");
  });

  it("pedido de R$ 0,00 com reembolso manual lançado por engano segue 'Sem valor a cobrar'", async () => {
    const papel = await imprimir(
      pedido({ subtotal: 80, discount: 80, shipping: 0, total: 0 }),
      { valorReembolsadoManual: 10 },
    );
    expect(papel.textContent).toContain("Sem valor a cobrar");
    expect(papel.textContent).not.toContain("Estornado");
  });

  it("forma de pagamento desconhecida com pagamento recusado diz 'pendente', não 'recusado'", async () => {
    const papel = await imprimir(
      pedido({
        // Valor fora da lista (dado antigo ou de outro canal): o papel não
        // pode afirmar que "o pagamento foi recusado" do que não conhece.
        paymentMethod: "boleto" as unknown as Order["paymentMethod"],
        paymentStatus: "recusado",
      }),
    );
    expect(papel.textContent).toContain("Pagamento: Outro");
    expect(papel.textContent).toContain("Pagamento pendente");
    expect(papel.textContent).not.toContain("Pagamento recusado");
  });

  it("PIX que expirou e foi pago depois sai 'Pago' no papel — o entregador não cobra de novo", async () => {
    const papel = await imprimir(
      pedido({ paymentMethod: "pix", paymentStatus: "pago_apos_expirar" }),
    );
    expect(papel.textContent).toContain("Pagamento: PIX Instantâneo");
    expect(papel.textContent).toContain("Pago");
    expect(papel.textContent).not.toContain("Cobrar");
  });

  it.each([
    ["pix", "PIX Instantâneo"],
    ["card", "Cartão na entrega"],
  ] as const)(
    "%s ainda não pago na entrega: o papel manda cobrar o total, com o nome da forma",
    async (paymentMethod, forma) => {
      const papel = await imprimir(
        pedido({ paymentMethod, paymentStatus: "aguardando", total: 75.2 }),
      );
      expect(papel.textContent).toContain(
        `Cobrar na entrega: R$ 75,20 (${forma})`,
      );
    },
  );

  it("venda de balcão com o nome literal e espaço nas pontas também some do papel", async () => {
    const papel = await imprimir(
      pedido({
        canal: "presencial",
        customer: {
          name: "  Venda no balcão  ",
          whatsapp: "",
          address: "",
          number: "",
          neighborhood: "",
        },
      }),
    );
    expect(papel.textContent).not.toContain("CLIENTE:");
    expect(papel.textContent).not.toContain("Venda no balcão");
  });

  it("as linhas de reembolso mantêm espaço entre rótulo e valor e o valor numa linha só", async () => {
    const papel = await imprimir(pedido({ total: 75.2 }), {
      valorEstornado: 20,
      valorReembolsadoManual: 5,
    });
    for (const rotulo of [
      "Reembolsado pelo Mercado Pago:",
      "Total menos reembolso do Mercado Pago:",
      "Devolvido ao cliente (manual):",
    ]) {
      const linha = linhaDe(papel, rotulo);
      expect(linha.classList.contains("gap-2"), rotulo).toBe(true);
      const valor = linha.lastElementChild!;
      expect(valor.classList.contains("shrink-0"), rotulo).toBe(true);
      expect(valor.classList.contains("whitespace-nowrap"), rotulo).toBe(true);
    }
  });
});
