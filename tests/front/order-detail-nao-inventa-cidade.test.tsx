// @vitest-environment jsdom
//
// Tarefa 5 do plano "o app para de inventar endereço": quando o pedido não
// traz cidade, o painel escrevia "Monte Carmelo - MG" no lugar — e é esse
// endereço que quem vende COPIA e abre no Google Maps para entregar. A
// correção é omitir o trecho, nunca substituir por um valor de reserva.
//
// `@/lib/supabase` é mocado porque OrderDetail.tsx importa `supabase` no
// topo (usado no useEffect que busca SKU dos itens do pedido); sem o mock,
// importar o módulo já dispara a leitura de VITE_SUPABASE_URL/ANON_KEY em
// src/lib/env.ts, que explode por design quando ausente. Como os pedidos de
// teste têm `items: []`, o efeito nem chega a chamar `supabase.from(...)` —
// ele cai no ramo "nada para buscar" antes disso.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto (ver
// tests/front/admin-orders-payment-filter.test.tsx): sem ela o React
// reclama "not configured to support act(...)" em todo render, mesmo
// dentro de act().
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedidoFake(overrides: {
  city?: string;
  state?: string;
}): Order {
  return {
    id: "ped-teste",
    customer: {
      name: "Cliente Teste",
      whatsapp: "34999999999",
      address: "Rua das Flores",
      number: "123",
      neighborhood: "Centro",
      city: overrides.city,
      state: overrides.state,
    },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("OrderDetail — não inventa a cidade do pedido", () => {
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

  it("não escreve nenhuma cidade quando o pedido não tem cidade", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const order = pedidoFake({});

    await act(async () => {
      raiz.render(
        <OrderDetail order={order} onStatusChange={vi.fn()} />,
      );
    });

    expect(hospedeiro.textContent).not.toContain("Monte Carmelo");
  });

  it("mostra a cidade do pedido quando ela existe", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const order = pedidoFake({ city: "Patos de Minas", state: "MG" });

    await act(async () => {
      raiz.render(
        <OrderDetail order={order} onStatusChange={vi.fn()} />,
      );
    });

    expect(hospedeiro.textContent).toContain("Patos de Minas");
  });

  it("o link do mapa não leva cidade inventada", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const order = pedidoFake({});

    await act(async () => {
      raiz.render(
        <OrderDetail order={order} onStatusChange={vi.fn()} />,
      );
    });

    const linkMapa = hospedeiro.querySelector<HTMLAnchorElement>(
      'a[title="Ver no Google Maps"]',
    );
    expect(linkMapa).not.toBeNull();
    const query = decodeURIComponent(
      linkMapa?.href.split("query=")[1] ?? "",
    );
    expect(query).not.toContain("Monte Carmelo");
  });
});
