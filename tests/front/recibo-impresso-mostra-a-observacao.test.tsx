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

  it("só frete automático não gera observação", async () => {
    const papel = await imprimir(
      pedidoBase({ notes: "Frete Escolhido: PAC (Prazo: 5 dias)" }),
    );
    expect(papel.textContent).not.toContain("OBSERVAÇÃO:");
  });

  it("separa a instrução da cliente da linha automática de frete", async () => {
    const papel = await imprimir(
      pedidoBase({
        notes: "Não tocar a campainha\n\nFrete Escolhido: PAC (Prazo: 5 dias)",
      }),
    );
    const rotulo = Array.from(papel.querySelectorAll("p")).find(
      (p) => p.textContent === "OBSERVAÇÃO:",
    );
    expect(rotulo?.nextElementSibling?.textContent).toBe(
      "Não tocar a campainha",
    );
    expect(papel.textContent).not.toContain("Frete Escolhido:");
  });

  it.each(["Retirada na loja", "Retirada na loja: Rua X, 10"])(
    "retirada automática (%s) não duplica endereço na observação",
    async (notes) => {
      const papel = await imprimir(
        pedidoBase({
          notes,
          retiradaNaLoja: true,
          enderecoDeRetirada: "Rua X, 10",
        }),
      );
      expect(papel.textContent).not.toContain("OBSERVAÇÃO:");
      expect(papel.textContent?.split("Rua X, 10")).toHaveLength(2);
      expect(papel.textContent).toContain("RETIRADA NA LOJA:");
    },
  );

  it.each([false, true])(
    "sem endereço gravado (retirada: %s), mantém o filtro antigo",
    async (retiradaNaLoja) => {
      const papel = await imprimir(
        pedidoBase({
          retiradaNaLoja,
          notes: "Retirada na loja: Rua X, 10\n\n  Retirada na loja  ",
        }),
      );
      expect(papel.textContent).not.toContain("OBSERVAÇÃO:");
      expect(papel.textContent).not.toContain("Rua X, 10");
    },
  );

  it.each(["", "\n\nRetirada na loja: Rua X, 10"])(
    "retirada: preserva a instrução da cliente com ou sem nota automática (%s)",
    async (sufixo) => {
      const instrucao = "Retirada na loja: minha irmã busca às 17h 🧾";
      const papel = await imprimir(
        pedidoBase({
          notes: instrucao + sufixo,
          retiradaNaLoja: true,
          enderecoDeRetirada: "Rua X, 10",
        }),
      );
      const rotulo = Array.from(papel.querySelectorAll("p")).find(
        (p) => p.textContent === "OBSERVAÇÃO:",
      );
      expect(rotulo?.nextElementSibling?.textContent).toBe(instrucao);
      expect(papel.textContent?.split("Rua X, 10")).toHaveLength(2);
    },
  );

  it("mantém linhas da cliente e variação legada, sem espaços vazios excessivos", async () => {
    const papel = await imprimir(
      pedidoBase({
        notes:
          "  Não tocar a campainha\r\nEntregar após 18h\r\n\r\n\r\n  Frete Escolhido: PAC (Prazo: 5 dias)\r\n\r\nProduto: azul · M  ",
      }),
    );
    const rotulo = Array.from(papel.querySelectorAll("p")).find(
      (p) => p.textContent === "OBSERVAÇÃO:",
    );
    expect(rotulo?.nextElementSibling?.textContent).toBe(
      "Não tocar a campainha\nEntregar após 18h\n\nProduto: azul · M",
    );
  });

  it("preserva frases livres sobre retirada que não são a nota automática", async () => {
    const notes =
      "Retirada na loja somente após me ligar\nPrefiro Frete Escolhido: PAC";
    const papel = await imprimir(pedidoBase({ notes }));
    expect(papel.textContent).toContain(notes);
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
