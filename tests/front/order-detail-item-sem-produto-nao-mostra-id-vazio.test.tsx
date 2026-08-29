// @vitest-environment jsdom
//
// Achado 15 da auditoria de 20/08/2026: na ficha do pedido, um item sem
// produto vinculado (`product_id` nulo no banco — `mapOrderFromDB` mapeia
// para `""`) renderizava "ID: #" — o rótulo e o cerquilha, sem nada depois.
// Isso parece um campo quebrado. Quando não há id, o campo inteiro não deve
// aparecer; quando há, continua mostrando "ID: #<6 últimos dígitos>".
//
// `@/lib/supabase` é mocado com um builder encadeável porque, com itens que
// TÊM productId, o efeito de busca de SKU (OrderDetail.tsx) chama de verdade
// `supabase.from(...).select(...).in(...)` — diferente dos vizinhos deste
// diretório que usam `items: []` e nunca chegam a chamar a consulta.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => {
  const builder: any = {
    select: vi.fn(() => builder),
    // Sempre devolve lista vazia: nenhum SKU cadastrado para os produtos de
    // teste, então o fallback de ID é o único caminho renderizado.
    in: vi.fn(() => Promise.resolve({ data: [], error: null })),
  };
  return {
    supabase: {
      from: vi.fn(() => builder),
      rpc: vi.fn(),
      functions: { invoke: vi.fn() },
      channel: vi.fn(),
      removeChannel: vi.fn(),
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedidoComDoisItens(): Order {
  return {
    id: "ped-215",
    customer: {
      name: "Cliente Teste",
      whatsapp: "34999999999",
      address: "Rua das Flores",
      number: "123",
      neighborhood: "Centro",
      city: "Patos de Minas",
      state: "MG",
    },
    items: [
      {
        productId: "", // item sem produto vinculado (product_id nulo no banco)
        name: "Item Sem Vínculo",
        price: 10,
        quantity: 1,
        image: "",
      },
      {
        productId: "abcdef123456",
        name: "Item Com Vínculo",
        price: 20,
        quantity: 1,
        image: "",
      },
    ],
    subtotal: 30,
    shipping: 0,
    discount: 0,
    total: 30,
    paymentMethod: "pix",
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelledAfterShipping: false,
  };
}

// LazyImage (usada no cartão de cada item) chama `new IntersectionObserver`
// direto no mount — ausente no jsdom deste projeto.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("OrderDetail — item sem produto vinculado não mostra 'ID: #' vazio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
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
  });

  it("não renderiza 'ID: #' para o item sem productId", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const order = pedidoComDoisItens();

    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });

    // "ID: #" sozinho (sem os 6 dígitos que viriam depois) não pode
    // sobrar em lugar nenhum da ficha.
    expect(hospedeiro.textContent).not.toMatch(/ID:\s*#(?![0-9a-f])/i);
  });

  it("continua mostrando 'ID: #<6 últimos dígitos>' para o item que TEM productId", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const order = pedidoComDoisItens();

    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });

    expect(hospedeiro.textContent).toContain("ID: #123456");
  });
});
