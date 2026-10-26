// @vitest-environment jsdom
//
// Defeitos 6 e 7 da caçada do balcão:
//  · o PAPEL da venda de balcão imprimia "Frete R$ 0,00" (balcão não tem
//    frete), não dizia como a cliente pagou e, sem cliente, trazia o título
//    "CLIENTE: Venda no balcão";
//  · a tela do recibo mostrava "3 · Recibo" — nenhuma outra etapa do balcão
//    tem número.
//
// Sem @testing-library/react: `createRoot` + `act`, como nos outros testes de
// recibo (recibo-impresso-mostra-o-desconto.test.tsx).
import { OrderReceipt } from "@/components/admin/orders/OrderReceipt";
import { ReciboDaVenda } from "@/components/admin/pdv/ReciboDaVenda";
import type { ReciboDaVendaRegistrada } from "@/hooks/useVendaPresencial";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedido(parcial: Partial<Order> = {}): Order {
  return {
    id: "pedido-1234567890",
    customer: { name: "Maria Teste", whatsapp: "11999999999" },
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
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    status: "delivered",
    createdAt: new Date("2026-10-20T10:00:00Z").toISOString(),
    updatedAt: new Date("2026-10-20T10:00:00Z").toISOString(),
    cancelledAfterShipping: false,
    ...parcial,
  };
}

function reciboDeBalcao(
  parcial: Partial<ReciboDaVendaRegistrada> = {},
): ReciboDaVendaRegistrada {
  return {
    orderId: "pedido-abcdef123456",
    numero: "123456",
    criadoEm: "2026-10-20T15:00:00Z",
    itens: [
      {
        chave: "p1::",
        productId: "p1",
        variantId: null,
        nome: "Camiseta Lisa",
        variacao: null,
        preco: 39.9,
        quantidade: 1,
        estoque: 5,
        imagem: "",
      },
    ],
    subtotal: 39.9,
    desconto: 0,
    total: 39.9,
    pagamento: "card",
    cliente: { tipo: "sem_cliente" },
    jaExistia: false,
    ...parcial,
  };
}

describe("recibo da venda de balcão — papel e título", () => {
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

  const papel = () => hospedeiro.querySelector("[data-tema-fixo]")!;

  it("papel de venda PRESENCIAL: sem linha de Frete e com a forma de pagamento", async () => {
    await act(async () => {
      raiz.render(
        <OrderReceipt order={pedido({ canal: "presencial" })} storeName="L" />,
      );
    });
    expect(papel().textContent).not.toContain("Frete");
    expect(papel().textContent).toContain("Pagamento");
    expect(papel().textContent).toContain("PIX Instantâneo");
  });

  it("papel de venda PRESENCIAL no cartão diz 'na maquininha'", async () => {
    await act(async () => {
      raiz.render(
        <OrderReceipt
          order={pedido({ canal: "presencial", paymentMethod: "card" })}
          storeName="L"
        />,
      );
    });
    expect(papel().textContent).toContain("Cartão na maquininha");
  });

  it("papel de pedido ONLINE não muda: continua com Frete, sem linha de Pagamento", async () => {
    await act(async () => {
      raiz.render(
        <OrderReceipt
          order={pedido({ canal: "online", shipping: 15, total: 115 })}
          storeName="L"
        />,
      );
    });
    expect(papel().textContent).toContain("Frete");
    expect(papel().textContent).toContain("R$ 15,00");
    expect(papel().textContent).not.toContain("Pagamento");
    expect(papel().textContent).toContain("CLIENTE:");
    expect(papel().textContent).toContain("Maria Teste");
  });

  it("recibo SEM cliente: o papel não traz 'CLIENTE: Venda no balcão', mas a tela segue dizendo 'Venda no balcão'", async () => {
    await act(async () => {
      raiz.render(
        <ReciboDaVenda
          recibo={reciboDeBalcao()}
          despachar={vi.fn()}
          limparCupom={vi.fn()}
          storeName="Loja Teste"
        />,
      );
    });
    expect(papel().textContent).not.toContain("CLIENTE:");
    expect(papel().textContent).not.toContain("Venda no balcão");
    expect(papel().textContent).not.toContain("Frete");
    expect(papel().textContent).toContain("Cartão na maquininha");
    // A tela (fora do papel) continua identificando a venda.
    expect(hospedeiro.textContent).toContain("Venda no balcão");
  });

  it("recibo COM cliente: o papel traz o nome e o WhatsApp da cliente", async () => {
    await act(async () => {
      raiz.render(
        <ReciboDaVenda
          recibo={reciboDeBalcao({
            cliente: { tipo: "avulso", nome: "Lia", whatsapp: "11999990000" },
          })}
          despachar={vi.fn()}
          limparCupom={vi.fn()}
          storeName="Loja Teste"
        />,
      );
    });
    expect(papel().textContent).toContain("CLIENTE:");
    expect(papel().textContent).toContain("Lia");
    expect(papel().textContent).toContain("11999990000");
  });

  it("o subtítulo do recibo é só 'Recibo' (sem o número 3 que nenhuma outra etapa tem)", async () => {
    await act(async () => {
      raiz.render(
        <ReciboDaVenda
          recibo={reciboDeBalcao()}
          despachar={vi.fn()}
          limparCupom={vi.fn()}
          storeName="Loja Teste"
        />,
      );
    });
    const subtitulo = hospedeiro.querySelector(
      ".pdv-layer-heading .pdv-muted",
    )!;
    expect(subtitulo.textContent).toBe("Recibo");
    expect(hospedeiro.textContent).not.toContain("3 ·");
  });
});
