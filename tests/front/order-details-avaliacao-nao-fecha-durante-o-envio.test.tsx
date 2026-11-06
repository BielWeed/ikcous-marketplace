// @vitest-environment jsdom
//
// Enquanto a avaliação está sendo enviada, a folha não pode ser fechada (X,
// toque no fundo, Esc ou Voltar): fechar e reabrir no meio do envio deixava
// avaliar o mesmo produto duas vezes. Quando o envio confirma, o produto vira
// "Avaliado" e a folha fecha sozinha.
//
// Molde de montagem: order-details-fechar-avaliacao-nao-perde-o-texto.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const fetchUserOrders = vi.fn();
const updateOrderStatus = vi.fn();
const addReview = vi.fn();

const pedido: Order = {
  id: "pedido-avaliacao",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "prod-1",
      name: "Tênis feminino",
      price: 100,
      quantity: 1,
      image: "",
    },
  ],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "cash",
  status: "delivered",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cancelledAfterShipping: false,
};

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedido],
    fetchUserOrders,
    updateOrderStatus,
  }),
}));

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({ addReview }),
}));

const usuario = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true, whatsappNumber: "34999999999" },
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let concluirEnvio!: (valor: { id: string }) => void;

beforeEach(() => {
  fetchUserOrders.mockReset();
  fetchUserOrders.mockResolvedValue([pedido]);
  addReview.mockReset();
  addReview.mockImplementation(
    () =>
      new Promise((resolve) => {
        concluirEnvio = resolve;
      }),
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

const folha = () =>
  document.body.querySelector<HTMLElement>(
    '[aria-labelledby="titulo-avaliacao"]',
  );
const aviso = () =>
  document.body.querySelector<HTMLElement>('[role="alertdialog"]');

async function abrirEPublicar() {
  const { OrderDetailsView } = await import(
    "@/views/customer/OrderDetailsView"
  );
  await act(async () => {
    raiz.render(
      <OrderDetailsView
        orderId="pedido-avaliacao"
        onBack={() => {}}
        onNavigate={() => {}}
      />,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  const estrela = hospedeiro.querySelector<HTMLButtonElement>(
    '[aria-label="Dar 4 estrelas para Tênis feminino"]',
  );
  await act(async () => {
    estrela?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  // com texto: fechar normalmente perguntaria "Descartar?"; no envio, nem isso
  const area = folha()?.querySelector("textarea") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(area, "Chegou rápido e serve certinho");
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    folha()?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
  });
  expect(addReview).toHaveBeenCalledTimes(1);
}

async function clicar(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

describe("OrderDetailsView — a avaliação em envio não deixa fechar a folha", () => {
  it("o X não fecha nem pergunta durante o envio", async () => {
    await abrirEPublicar();
    await clicar(folha()?.querySelector('[aria-label="Fechar avaliação"]'));
    expect(folha()).not.toBeNull();
    expect(aviso()).toBeNull();
  });

  it("toque no fundo escuro e Esc também não fecham durante o envio", async () => {
    await abrirEPublicar();
    await clicar(
      document.body.querySelector('[aria-label="Fechar avaliacao"]'),
    );
    expect(folha()).not.toBeNull();
    await act(async () => {
      folha()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(folha()).not.toBeNull();
    expect(aviso()).toBeNull();
  });

  it("envio confirmado: o produto vira Avaliado e a folha fecha", async () => {
    await abrirEPublicar();
    await act(async () => {
      concluirEnvio({ id: "r-1" });
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(folha()).toBeNull();
    expect(hospedeiro.textContent).toContain("Avaliado");
  });
});
