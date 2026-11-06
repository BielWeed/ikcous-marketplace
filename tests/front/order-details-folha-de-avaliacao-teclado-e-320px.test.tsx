// @vitest-environment jsdom
//
// Folha "Avaliação do Produto" do pedido, por teclado e em tela de 320 px:
//  1. Shift+Tab logo ao abrir (o foco está na própria folha, não no primeiro
//     botão) escapava para o fundo da tela apesar do aria-modal. Agora volta
//     para o último botão da folha.
//  2. Depois de Publicar o produto vira "Avaliado" e o botão de estrela que
//     abriu a folha some: o foco caía em <body>. Agora vai para o título do
//     cartão "O que achou da compra?". Fechando sem publicar, volta ao botão
//     de origem, como antes.
//  3. O botão de fechar (✕) era espremido quando o nome do produto é de
//     tamanho normal: o bloco do título precisa poder encolher (min-w-0) e o
//     botão manter os 32 px (shrink-0). jsdom não mede layout; a trava é nas
//     classes que fazem o navegador encolher o título e não o botão.
//
// Molde de montagem: order-details-avaliacao-nao-fecha-durante-o-envio.test.tsx.
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

beforeEach(() => {
  fetchUserOrders.mockReset();
  fetchUserOrders.mockResolvedValue([pedido]);
  addReview.mockReset();
  addReview.mockResolvedValue({ id: "r-1" });
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
const estrela = () =>
  hospedeiro.querySelector<HTMLButtonElement>(
    '[aria-label="Dar 4 estrelas para Tênis feminino"]',
  );

async function abrirAFolha() {
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
  // Como o teclado: o foco está na estrela quando ela é acionada.
  estrela()?.focus();
  await act(async () => {
    estrela()?.click();
  });
  expect(folha()).not.toBeNull();
}

function tab(alvo: Element | null, shift: boolean): boolean {
  const evento = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    alvo?.dispatchEvent(evento);
  });
  return evento.defaultPrevented;
}

async function assentar() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}

describe("Folha de avaliação — Tab preso dentro da folha", () => {
  it("ao abrir, o foco está na folha e Shift+Tab vai para o último botão dela, sem escapar", async () => {
    await abrirAFolha();
    expect(document.activeElement).toBe(folha());

    const impediu = tab(folha(), true);

    expect(impediu).toBe(true);
    const ativo = document.activeElement;
    expect(ativo).not.toBe(folha());
    expect(ativo).not.toBe(document.body);
    expect(folha()?.contains(ativo)).toBe(true);
  });

  it("Shift+Tab no primeiro botão (o ✕) continua indo ao último, e Tab no último volta ao primeiro", async () => {
    await abrirAFolha();
    const fechar = folha()?.querySelector<HTMLElement>(
      '[aria-label="Fechar avaliação"]',
    ) as HTMLElement;
    fechar.focus();
    expect(tab(fechar, true)).toBe(true);
    const ultimo = document.activeElement as HTMLElement;
    expect(ultimo).not.toBe(fechar);
    expect(folha()?.contains(ultimo)).toBe(true);

    expect(tab(ultimo, false)).toBe(true);
    expect(document.activeElement).toBe(fechar);
  });
});

describe("Folha de avaliação — o foco depois de fechar", () => {
  it("fechar sem publicar devolve o foco à estrela que abriu a folha", async () => {
    await abrirAFolha();
    await act(async () => {
      folha()
        ?.querySelector<HTMLElement>('[aria-label="Fechar avaliação"]')
        ?.click();
    });
    await assentar();

    expect(folha()).toBeNull();
    expect(document.activeElement).toBe(estrela());
  });

  it("depois de Publicar (a estrela some) o foco vai para o título do cartão, não para o <body>", async () => {
    await abrirAFolha();
    await act(async () => {
      folha()
        ?.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.click();
    });
    await assentar();

    expect(addReview).toHaveBeenCalledTimes(1);
    expect(folha()).toBeNull();
    expect(hospedeiro.textContent).toContain("Avaliado");
    expect(estrela()).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.textContent).toBe("O que achou da compra?");
  });
});

describe("Folha de avaliação — cabeçalho em 320 px", () => {
  it("o bloco do título pode encolher e o ✕ mantém os 32 px", async () => {
    await abrirAFolha();
    const fechar = folha()?.querySelector<HTMLElement>(
      '[aria-label="Fechar avaliação"]',
    ) as HTMLElement;
    const titulo = folha()?.querySelector<HTMLElement>("#titulo-avaliacao");

    expect(fechar.className).toContain("shrink-0");
    expect(fechar.className).toContain("size-8");
    expect(titulo?.parentElement?.className).toContain("min-w-0");
    // O título continua cortando com reticências dentro do bloco que encolhe.
    expect(titulo?.className).toContain("truncate");
  });
});
