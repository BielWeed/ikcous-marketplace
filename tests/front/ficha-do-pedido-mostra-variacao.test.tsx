// @vitest-environment jsdom
//
// A lojista que separa o pedido não sabia se a cliente comprou P ou M, azul
// ou preto: o pedido GUARDA a variação (`marketplace_order_items.variant_id`),
// mas `product_name` traz só o nome do produto e a ficha nunca mostrou a
// escolha. Aqui se prova o que ela passa a ler, na ficha da tela e no recibo
// impresso, e que item SEM variação continua exatamente como era.
//
// Molde de montagem: ficha-do-pedido-redesenho.test.tsx (createRoot + act).
// Cada teste usa ids de variação próprios: a ficha guarda o que já leu num
// cache do módulo, e um id repetido esconderia a leitura.
import { OrderReceipt } from "@/components/admin/orders/OrderReceipt";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O que o "banco" devolve para `product_variants` (id, sku, name, value). Um
// id que não está na lista simula variação apagada depois da compra.
const { variacoesNoBanco, consultasDeVariacao } = vi.hoisted(() => ({
  variacoesNoBanco: [] as Array<{
    id: string;
    sku?: string | null;
    name: string;
    value: string;
  }>,
  consultasDeVariacao: [] as string[],
}));

vi.mock("@/lib/supabase", () => {
  function construtorDa(tabela: string) {
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn((colunas: string) => {
      if (tabela === "product_variants") consultasDeVariacao.push(colunas);
      return builder;
    });
    builder.eq = vi.fn(() => builder);
    builder.in = vi.fn((_coluna: string, ids: string[]) =>
      Promise.resolve({
        data:
          tabela === "product_variants"
            ? variacoesNoBanco.filter((v) => ids.includes(v.id))
            : [],
        error: null,
      }),
    );
    builder.maybeSingle = vi.fn(() =>
      Promise.resolve({ data: null, error: null }),
    );
    builder.update = vi.fn(() => builder);
    return builder;
  }
  return {
    supabase: {
      from: vi.fn((tabela: string) => construtorDa(tabela)),
      rpc: vi.fn(),
      functions: { invoke: vi.fn() },
      channel: vi.fn(),
      removeChannel: vi.fn(),
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

type ItemDoPedido = Order["items"][number];

function item(overrides: Partial<ItemDoPedido> = {}): ItemDoPedido {
  return {
    productId: "prod-camiseta",
    name: "Camiseta Básica",
    price: 50,
    quantity: 1,
    image: "",
    ...overrides,
  };
}

function pedidoFake(items: ItemDoPedido[]): Order {
  const subtotal = items.reduce((acc, i) => acc + i.price * i.quantity, 0);
  return {
    id: "ped-variacao-123456",
    customer: {
      name: "Cliente Teste",
      whatsapp: "349998888777",
      address: "Rua das Flores",
      number: "123",
      neighborhood: "Centro",
      city: "Patos de Minas",
      state: "MG",
    },
    items,
    subtotal,
    shipping: 0,
    discount: 0,
    total: subtotal,
    paymentMethod: "cash",
    status: "pending",
    paymentStatus: null,
    createdAt: "2026-09-01T14:32:00.000Z",
    updatedAt: "2026-09-01T14:32:00.000Z",
    cancelledAfterShipping: false,
    pagamentoRecebidoEm: null,
    pagamentoRecebidoPor: null,
  };
}

describe("ficha do pedido e recibo — mostram a variação de cada item", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    variacoesNoBanco.length = 0;
    consultasDeVariacao.length = 0;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function renderizarFicha(order: Order) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });
    // As leituras do código interno e da variação são promessas: deixa assentar.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  const blocoDeItens = () =>
    hospedeiro.querySelector<HTMLElement>('[data-testid="bloco-itens"]');
  const variacoesDaFicha = () =>
    Array.from(
      blocoDeItens()?.querySelectorAll<HTMLElement>(
        '[data-testid="variacao-do-item"]',
      ) ?? [],
    ).map((el) => el.textContent);
  const papelDoRecibo = () =>
    Array.from(hospedeiro.querySelectorAll<HTMLElement>("div")).find((d) =>
      d.classList.contains("print:block"),
    );

  it("combinação (cor e tamanho): a linha do item diz 'Cor Azul · Tamanho M'", async () => {
    variacoesNoBanco.push({
      id: "var-azul-m-1",
      name: "Cor / Tamanho",
      value: "Azul / M",
    });

    await renderizarFicha(pedidoFake([item({ variantId: "var-azul-m-1" })]));

    expect(variacoesDaFicha()).toEqual(["Cor Azul · Tamanho M"]);
    // O nome do produto e a conta continuam onde estavam.
    expect(blocoDeItens()?.textContent).toContain("Camiseta Básica");
    expect(blocoDeItens()?.textContent).toContain("1 × R$ 50,00");
  });

  it("variação de um atributo só: 'Cor Rosa'", async () => {
    variacoesNoBanco.push({ id: "var-rosa-2", name: "Cor", value: "Rosa" });

    await renderizarFicha(pedidoFake([item({ variantId: "var-rosa-2" })]));

    expect(variacoesDaFicha()).toEqual(["Cor Rosa"]);
  });

  it("o mesmo produto em dois tamanhos: cada linha diz o SEU tamanho", async () => {
    variacoesNoBanco.push(
      { id: "var-tam-p-3", name: "Tamanho", value: "P" },
      { id: "var-tam-m-3", name: "Tamanho", value: "M" },
    );

    await renderizarFicha(
      pedidoFake([
        item({ variantId: "var-tam-p-3" }),
        item({ variantId: "var-tam-m-3", quantity: 2 }),
      ]),
    );

    expect(variacoesDaFicha()).toEqual(["Tamanho P", "Tamanho M"]);
  });

  it("item SEM variação fica como era: nenhuma linha de variação", async () => {
    await renderizarFicha(pedidoFake([item()]));

    expect(variacoesDaFicha()).toEqual([]);
    expect(blocoDeItens()?.textContent).toContain("Camiseta Básica");
  });

  it("pedido antigo cuja variação foi apagada do catálogo: não quebra e não inventa", async () => {
    // Nenhuma linha no banco para este id.
    await renderizarFicha(pedidoFake([item({ variantId: "var-apagada-4" })]));

    expect(variacoesDaFicha()).toEqual([]);
    expect(blocoDeItens()?.textContent).toContain("Camiseta Básica");
  });

  it("a ficha pede ao banco o nome e o valor da variação, não só o código", async () => {
    variacoesNoBanco.push({ id: "var-pede-5", name: "Cor", value: "Verde" });

    await renderizarFicha(pedidoFake([item({ variantId: "var-pede-5" })]));

    const pedido = consultasDeVariacao.join(" | ");
    expect(pedido).toMatch(/\bname\b/);
    expect(pedido).toMatch(/\bvalue\b/);
  });

  it("o recibo impresso dentro da ficha também leva a variação", async () => {
    variacoesNoBanco.push({
      id: "var-recibo-6",
      name: "Cor / Tamanho",
      value: "Preto / G",
    });

    await renderizarFicha(pedidoFake([item({ variantId: "var-recibo-6" })]));

    const papel = papelDoRecibo();
    expect(papel).toBeDefined();
    expect(papel?.textContent).toContain("1x Camiseta Básica");
    expect(papel?.textContent).toContain("Cor Preto · Tamanho G");
  });

  describe("OrderReceipt sozinho", () => {
    async function renderizarRecibo(
      order: Order,
      variacoes?: Record<string, string>,
    ) {
      await act(async () => {
        raiz.render(<OrderReceipt order={order} variacoes={variacoes} />);
      });
    }

    it("com o rótulo da variação do item, ele aparece logo abaixo do nome", async () => {
      await renderizarRecibo(pedidoFake([item({ variantId: "v-1" })]), {
        "v-1": "Tamanho M",
      });

      const texto = papelDoRecibo()?.textContent ?? "";
      expect(texto).toContain("Camiseta Básica");
      expect(texto).toContain("Tamanho M");
    });

    it("sem a informação (recibo do balcão, que já leva a variação no nome) não repete nada", async () => {
      await renderizarRecibo(
        pedidoFake([
          item({ variantId: "v-2", name: "Camiseta Básica - Tamanho M" }),
        ]),
      );

      const texto = papelDoRecibo()?.textContent ?? "";
      expect(texto.match(/Tamanho M/g)).toHaveLength(1);
    });
  });
});
