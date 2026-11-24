// @vitest-environment jsdom
// Cartão do pedido na lista do painel: o que a lojista LÊ sem abrir a ficha —
// o resumo dos itens (singular/plural), a conta de unidades, o valor e o
// "e mais N" do modo detalhado. São regras de fronteira (1, 2, 3 e 4 linhas;
// quantidade zerada; total sem centavos) que o teste de redesenho do cartão
// não cobre: ele só usa 1 linha com 2 unidades e 5 linhas no detalhado.
import { AdminOrderCard } from "@/components/admin/orders/AdminOrderCard";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useDevolucoesDoPedidoAdmin", () => ({
  useDevolucoesDoPedidoAdmin: () => ({
    devolucoes: [],
    carregando: false,
    erro: false,
    recarregar: vi.fn(),
  }),
}));

class ObserverStub {
  private callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  disconnect() {}
  unobserve() {}
}

function linhas(quantidade: number, unidadesPorLinha = 1): Order["items"] {
  return Array.from({ length: quantidade }, (_, i) => ({
    productId: `p${i}`,
    name: `Produto ${String.fromCharCode(65 + i)}`,
    price: 10,
    quantity: unidadesPorLinha,
    image: "",
  }));
}

function pedido(sobre: Partial<Order> = {}): Order {
  return {
    id: "bbbbbbbb-0000-0000-0000-0000000a1b2c",
    customer: { name: "Cliente de Teste", whatsapp: "34999999999" },
    items: linhas(1),
    subtotal: 10,
    shipping: 0,
    discount: 0,
    total: 10,
    paymentMethod: "cash",
    status: "pending",
    paymentStatus: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelledAfterShipping: false,
    pagamentoRecebidoEm: null,
    ...sobre,
  } as Order;
}

describe("AdminOrderCard — resumo dos itens, unidades e valor", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  function desenhar(order: Order, modo: "compact" | "detailed" = "compact") {
    act(() => {
      raiz.render(
        <AdminOrderCard
          order={order}
          viewMode={modo}
          onSelect={vi.fn()}
          onWhatsApp={vi.fn()}
          onRegistrarPagamento={vi.fn()}
          registrandoPagamento={false}
        />,
      );
    });
  }

  /** O texto do resumo (nome do 1º item + "+ N item(ns)") no modo compacto. */
  function resumo(): string {
    return (
      hospedeiro
        .querySelector("[data-abrir-pedido] span.block")
        ?.textContent?.trim() ?? ""
    );
  }

  it.each([
    [0, "Pedido vazio"],
    [1, "Produto A"],
    [2, "Produto A + 1 item"],
    [3, "Produto A + 2 itens"],
    [4, "Produto A + 3 itens"],
  ])("pedido com %i linha(s) resume como %j", (quantas, esperado) => {
    desenhar(pedido({ items: linhas(quantas) }));

    expect(resumo()).toBe(esperado);
  });

  it("conta UNIDADES, não linhas: 3 linhas de 2 peças = 6 un.", () => {
    desenhar(pedido({ items: linhas(3, 2) }));

    expect(hospedeiro.textContent).toContain("6 un.");
  });

  it("linha com quantidade zerada conta como 1 peça (nunca some do total)", () => {
    // Dado antigo ou importado pode trazer quantity 0; a lojista não pode ver
    // "0 un." num pedido que tem produto.
    const itens = [...linhas(1, 3), ...linhas(1, 0)];
    desenhar(pedido({ items: itens }));

    expect(hospedeiro.textContent).toContain("4 un.");
  });

  it("pedido sem nenhuma linha mostra 0 un. e não quebra", () => {
    desenhar(pedido({ items: [] }));

    expect(hospedeiro.textContent).toContain("0 un.");
  });

  it.each([
    [1234.5, "1.234,50"],
    [7, "7,00"],
    [0.1 + 0.2, "0,30"],
  ])("o valor %d aparece em reais como %s", (total, esperado) => {
    desenhar(pedido({ total }));

    expect(hospedeiro.textContent).toContain(`R$ ${esperado}`);
  });

  it("pedido sem total (zero) mostra R$ 0,00, não 'NaN' nem vazio", () => {
    desenhar(pedido({ total: 0 }));

    expect(hospedeiro.textContent).toContain("R$ 0,00");
    expect(hospedeiro.textContent).not.toContain("NaN");
  });

  it("cliente sem nome aparece como 'Cliente'", () => {
    desenhar(
      pedido({ customer: { name: "", whatsapp: "34999999999" } as never }),
    );

    expect(hospedeiro.querySelector("h4")?.textContent).toBe("Cliente");
  });

  describe("modo detalhado", () => {
    function itensListados(): string[] {
      return [...hospedeiro.querySelectorAll("li")].map(
        (li) => li.textContent ?? "",
      );
    }

    it("com exatamente 3 linhas mostra as 3 e NÃO diz 'e mais'", () => {
      desenhar(pedido({ items: linhas(3) }), "detailed");

      const texto = hospedeiro.textContent ?? "";
      expect(texto).toContain("Produto A");
      expect(texto).toContain("Produto B");
      expect(texto).toContain("Produto C");
      expect(texto).not.toContain("e mais");
    });

    it("com 4 linhas mostra 3 e 'e mais 1' (a quarta, não 'e mais 2')", () => {
      desenhar(pedido({ items: linhas(4) }), "detailed");

      const texto = hospedeiro.textContent ?? "";
      expect(texto).toContain("Produto C");
      expect(texto).not.toContain("Produto D");
      expect(itensListados().some((t) => t.trim() === "e mais 1")).toBe(true);
    });

    it("com 2 linhas mostra as 2 e nada a mais", () => {
      desenhar(pedido({ items: linhas(2) }), "detailed");

      const texto = hospedeiro.textContent ?? "";
      expect(texto).toContain("Produto B");
      expect(texto).not.toContain("e mais");
    });
  });
});
