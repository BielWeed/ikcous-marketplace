// @vitest-environment jsdom
//
// Achado 1 do lote 1 (caça-defeitos): pedido com subtotal R$ 100,00, frete
// R$ 15,00 e cupom de R$ 10,00 -> o banco grava total = 105,00. A ficha na
// tela (OrderDetail.tsx) mostra as quatro linhas e fecha. O recibo IMPRESSO
// (OrderReceipt.tsx) mostrava só três: "Subtotal R$ 100,00 / Frete R$ 15,00
// / TOTAL R$ 105,00" — 100 + 15 = 115, não 105. Quem recebe o papel é a
// cliente; quem responde "por que não bate?" é a lojista.
//
// Sem @testing-library/react (não instalado neste projeto) — mesmo padrão
// de render direto com createRoot + act usado nos demais testes de
// componente (ex.: admin-orders-filtro-que-filtra.test.tsx).
import { OrderReceipt } from "@/components/admin/orders/OrderReceipt";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function pedidoBase(overrides: Partial<Order> = {}): Order {
  return {
    id: "pedido-1234567890",
    customer: {
      name: "Maria Teste",
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
    createdAt: new Date("2026-08-20T10:00:00Z").toISOString(),
    updatedAt: new Date("2026-08-20T10:00:00Z").toISOString(),
    ...overrides,
  };
}

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderReceipt — o recibo impresso mostra o desconto", () => {
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

  it("pedido com cupom: mostra a linha de Desconto e a conta fecha (100 + 15 - 10 = 105)", async () => {
    const pedido = pedidoBase({
      subtotal: 100,
      shipping: 15,
      discount: 10,
      total: 105,
      couponCode: "PROMO10",
    });

    await act(async () => {
      raiz.render(<OrderReceipt order={pedido} />);
    });

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Desconto");
    expect(texto).toContain("10,00");
    expect(texto).toContain("105,00");
  });

  it("controle negativo: pedido SEM desconto não ganha linha nova", async () => {
    const pedido = pedidoBase({
      subtotal: 100,
      shipping: 15,
      discount: 0,
      total: 115,
    });

    await act(async () => {
      raiz.render(<OrderReceipt order={pedido} />);
    });

    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toContain("Desconto");
  });

  // O recibo e o unico documento desta tela que sai IMPRESSO. Ate a linha de
  // desconto entrar, ele usava `.toFixed(2)` (ponto) em tudo; a linha nova
  // veio em pt-BR (virgula), e a folha ficou com "R$ 100.00" ao lado de
  // "R$ 10,00". Duas notacoes na mesma folha parecem erro para quem le.
  it("a folha inteira usa UMA notacao de dinheiro, nao duas", async () => {
    const pedido = pedidoBase({
      subtotal: 100,
      shipping: 15,
      discount: 10,
      total: 105,
    });

    await act(async () => {
      raiz.render(<OrderReceipt order={pedido} />);
    });

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("R$ 100,00");
    expect(texto).toContain("R$ 15,00");
    expect(texto).toContain("R$ 105,00");
    // E nenhum resquicio da notacao antiga com ponto.
    expect(texto).not.toContain("R$ 100.00");
    expect(texto).not.toContain("R$ 105.00");
  });
});
