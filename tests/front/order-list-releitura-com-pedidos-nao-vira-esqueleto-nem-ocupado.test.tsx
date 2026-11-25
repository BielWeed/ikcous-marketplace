// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), OrderList. Dois buracos no estado "carregando":
//  - a PRIMEIRA carga (lista vazia + carregando) mostra dois esqueletos, a frase
//    "Carregando pedidos" para o leitor de tela e marca a lista como ocupada;
//  - a RELEITURA com pedidos já na tela (puxar para atualizar, voltar à aba) NÃO
//    troca os cartões por esqueletos nem marca a lista como ocupada: a cliente
//    segue vendo e tocando no que já tinha.
//
// Mutante equivalente anotado (sem teste possível): `falhou && temPedidosEmMemoria ? aviso : null`
// trocado por `falhou ? aviso : null` só muda quando `hasAnyOrders={false}` chega junto de
// `orders` NÃO vazia, combinação que a tela de pedidos nunca monta (`hasAnyOrders` padrão é
// `orders.length > 0`); com props coerentes os dois lados dão o mesmo desenho.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { Order } from "@/types";

vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

const pedido: Order = {
  id: "aaaaaaaa-2222-3333-4444-555555555555",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "prod-1",
      name: "Blusa Teste",
      price: 100,
      quantity: 1,
      image: "",
    },
  ],
  subtotal: 100,
  shipping: 20,
  discount: 0,
  total: 120,
  paymentMethod: "pix",
  status: "pending",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderList: carregando com e sem pedidos na tela", () => {
  // Aquece a tela pesada uma vez (o primeiro import custa vários segundos numa máquina carregada).
  beforeAll(async () => {
    await import("@/components/ui/custom/OrderList");
  }, 60_000);

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
    vi.restoreAllMocks();
  });

  async function renderizar(orders: Order[], isLoadingOrders: boolean) {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    await act(async () => {
      raiz.render(
        <OrderList
          orders={orders}
          isLoadingOrders={isLoadingOrders}
          onNavigate={() => {}}
        />,
      );
    });
  }
  const esqueletos = () =>
    hospedeiro.querySelectorAll('[data-testid="order-card-skeleton"]').length;
  const grade = () =>
    hospedeiro.querySelector<HTMLElement>("div.grid.grid-cols-1");

  it("primeira carga: dois esqueletos, aviso para o leitor de tela, lista ocupada e sem 'Nenhum pedido'", async () => {
    await renderizar([], true);
    expect(esqueletos()).toBe(2);
    expect(hospedeiro.textContent).toContain("Carregando pedidos");
    expect(grade()?.getAttribute("aria-busy")).toBe("true");
    expect(hospedeiro.textContent).not.toContain("Nenhum pedido");
  });

  it("releitura com pedidos na tela: nada de esqueleto, nada de 'Carregando pedidos', lista não ocupada", async () => {
    await renderizar([pedido], true);
    expect(esqueletos()).toBe(0);
    expect(hospedeiro.textContent).not.toContain("Carregando pedidos");
    expect(grade()?.getAttribute("aria-busy")).not.toBe("true");
    expect(hospedeiro.textContent).toContain("Blusa Teste");
  });

  it("carga concluída com pedidos: sem esqueleto e sem ocupado", async () => {
    await renderizar([pedido], false);
    expect(esqueletos()).toBe(0);
    expect(grade()?.getAttribute("aria-busy")).not.toBe("true");
  });
});
