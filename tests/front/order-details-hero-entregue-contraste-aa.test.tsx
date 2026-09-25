// @vitest-environment jsdom
//
// BLOQUEIA B2 (revisor Opus, rodada 2 do redesenho, 25/09/2026): o cartão de
// status do pedido ENTREGUE usava um degradê emerald-400→600→700 com o texto
// (título, descrição, rótulo e código de rastreio) em `text-white`,
// `text-white/80` e `text-white/60`. Medido (Tailwind, luminância relativa
// WCAG): branco sobre emerald-600 dá 3,77:1 — abaixo do mínimo AA de 4,5:1
// para texto normal — e emerald-400 (o canto onde o título e o ícone
// sentavam) é ainda mais claro. A correção: o degradê fica inteiro entre
// emerald-700 e emerald-900 (branco sobre emerald-700 mede 5,48:1) e todo
// texto vira branco SÓLIDO — opacidade de texto é o que reabre a reprovação
// mesmo com o tom certo por baixo.
//
// Este arquivo prova a AUSÊNCIA das classes que causavam a reprovação —
// mesmo padrão de shipping-progress-contraste-aa.test.tsx e
// order-details-view-financeiro-contraste-aa.test.tsx: a classe de cor vive
// no elemento renderizado, não em dado estático, então só render de verdade
// prova alguma coisa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const pedidoEntregue: Order = {
  id: "pedido-entregue-aa",
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
  paymentMethod: "pix",
  status: "delivered",
  paymentStatus: "pago",
  trackingCode: "AA123456789BR",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cancelledAfterShipping: false,
};

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoEntregue],
    fetchUserOrders: vi.fn().mockResolvedValue([pedidoEntregue]),
    updateOrderStatus: vi.fn(),
  }),
}));

const usuario = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, whatsappNumber: "34999999999" },
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderDetailsView — cartão de status do pedido entregue passa no contraste AA", () => {
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

  async function renderizar() {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-entregue-aa"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const cartao = hospedeiro.querySelector('[data-testid="cartao-status"]');
    expect(cartao).not.toBeNull();
    return cartao as HTMLElement;
  }

  it("o degradê do cartão nunca fica mais claro que emerald-700 (branco sobre 600/400 reprova AA)", async () => {
    const cartao = await renderizar();

    expect(cartao.className).not.toContain("emerald-400");
    expect(cartao.className).not.toContain("emerald-500");
    expect(cartao.className).not.toContain("emerald-600");
    // Revisão Opus rodada 2: proibir três nomes deixava passar
    // `from-emerald-300` ou `from-green-400`. Toda cor do degradê tem de ser
    // de tom 700 ou mais escuro, seja qual for a família.
    const paradas = cartao.className.match(/\b(?:from|via|to)-[a-z]+-(\d+)\b/g);
    expect(paradas?.length).toBe(3);
    for (const parada of paradas ?? []) {
      expect(Number(parada.split("-").pop())).toBeGreaterThanOrEqual(700);
    }
  });

  it("a descrição do status usa text-white sólido, nunca text-white/80 (3,77:1 sobre o tom antigo)", async () => {
    const cartao = await renderizar();

    const descricao = Array.from(cartao.querySelectorAll("p")).find((el) =>
      el.textContent?.includes("entregue com sucesso"),
    );
    expect(descricao).not.toBeUndefined();
    expect(descricao?.classList.contains("text-white")).toBe(true);
    expect(descricao?.className).not.toContain("text-white/");
  });

  it("o rótulo 'Código de rastreio' usa text-white sólido, nunca text-white/60", async () => {
    const cartao = await renderizar();

    const rotulo = Array.from(cartao.querySelectorAll("span")).find(
      (el) => el.textContent === "Código de rastreio",
    );
    expect(rotulo).not.toBeUndefined();
    expect(rotulo?.classList.contains("text-white")).toBe(true);
    expect(rotulo?.className).not.toContain("text-white/");
  });

  it("o botão de copiar o rastreio usa ícone branco sólido, nunca text-white/80", async () => {
    const cartao = await renderizar();

    const botaoCopiar = Array.from(cartao.querySelectorAll("button")).find(
      (b) => b.getAttribute("title") === "Copiar código de rastreio",
    );
    expect(botaoCopiar).not.toBeUndefined();
    expect(botaoCopiar?.classList.contains("text-white")).toBe(true);
    expect(botaoCopiar?.className).not.toContain("text-white/");
  });
});
