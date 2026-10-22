// @vitest-environment jsdom
//
// Fechar a folha de avaliação (toque fora, Esc ou o X) desmontava o
// formulário e apagava o comentário que a cliente tinha escrito, sem aviso.
// Agora, com texto digitado, fechar pergunta "Descartar o que você escreveu?";
// sem texto (só estrelas) fecha direto, como antes.
//
// Molde de montagem: order-details-cartao-de-avaliacao-em-destaque.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const fetchUserOrders = vi.fn();
const updateOrderStatus = vi.fn();

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

beforeEach(() => {
  fetchUserOrders.mockReset();
  fetchUserOrders.mockResolvedValue([pedido]);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function abrirAFolhaDeAvaliacao() {
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
  expect(estrela).not.toBeNull();
  await act(async () => {
    estrela?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
}

const folha = () =>
  document.body.querySelector<HTMLElement>(
    '[aria-labelledby="titulo-avaliacao"]',
  );
const aviso = () =>
  document.body.querySelector<HTMLElement>('[role="alertdialog"]');

function botao(texto: string, dentro: ParentNode | null | undefined) {
  return Array.from(dentro?.querySelectorAll("button") ?? []).find(
    (b) =>
      b.textContent?.trim() === texto || b.getAttribute("aria-label") === texto,
  );
}

async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

async function digitar(texto: string) {
  const area = folha()?.querySelector("textarea") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(area, texto);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("OrderDetailsView — a folha de avaliação termina acima da barra", () => {
  it("o véu e a folha acabam acima da navegação, não por baixo dela", async () => {
    await abrirAFolhaDeAvaliacao();
    const veu = folha()?.parentElement;
    expect(
      veu?.classList.contains("bottom-[var(--folha-acima-da-barra)]"),
    ).toBe(true);
    expect(veu?.classList.contains("inset-0")).toBe(false);
    expect(
      folha()?.classList.contains(
        "max-h-[calc(100dvh-var(--folha-acima-da-barra)-72px)]",
      ),
    ).toBe(true);
  });
});

describe("OrderDetailsView — fechar a avaliação não joga fora o texto", () => {
  it("só estrelas, sem texto: o X fecha direto", async () => {
    await abrirAFolhaDeAvaliacao();
    await clicar(botao("Fechar avaliação", folha()));

    expect(folha()).toBeNull();
    expect(aviso()).toBeNull();
  });

  it("com texto digitado: o X pergunta e a folha continua aberta", async () => {
    await abrirAFolhaDeAvaliacao();
    await digitar("Chegou rápido e serve certinho");
    await clicar(botao("Fechar avaliação", folha()));

    expect(aviso()?.textContent).toContain("Descartar o que você escreveu?");
    expect(folha()).not.toBeNull();
  });

  it("'Continuar escrevendo' mantém o texto na folha", async () => {
    await abrirAFolhaDeAvaliacao();
    await digitar("Chegou rápido e serve certinho");
    await clicar(botao("Fechar avaliação", folha()));
    await clicar(botao("Continuar escrevendo", aviso()));

    expect(aviso()).toBeNull();
    expect(folha()?.querySelector("textarea")?.value).toBe(
      "Chegou rápido e serve certinho",
    );
  });

  it("'Descartar' fecha a folha", async () => {
    await abrirAFolhaDeAvaliacao();
    await digitar("Chegou rápido e serve certinho");
    await clicar(botao("Fechar avaliação", folha()));
    await clicar(botao("Descartar", aviso()));

    expect(folha()).toBeNull();
    expect(aviso()).toBeNull();
  });

  it("toque no fundo escuro com texto também pergunta", async () => {
    await abrirAFolhaDeAvaliacao();
    await digitar("Chegou rápido e serve certinho");
    const fundo = document.body.querySelector<HTMLElement>(
      '[aria-label="Fechar avaliacao"]',
    );
    await clicar(fundo);

    expect(aviso()?.textContent).toContain("Descartar o que você escreveu?");
    expect(folha()).not.toBeNull();
  });
});
