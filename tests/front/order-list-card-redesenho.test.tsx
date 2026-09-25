// @vitest-environment jsdom
//
// Redesenho do card de "Meus Pedidos" (25/09/2026). O card antigo repetia o
// status três vezes (selo, rodapé e uma barrinha na beirada) e ainda assim não
// dizia em que ponto o pedido estava. O novo tem UMA faixa de status com a
// trilha das 4 etapas nomeadas, e o card inteiro abre o pedido.
//
// O que este arquivo guarda:
//   - a trilha mostra as etapas e marca a atual; cancelado não tem trilha;
//   - o selo de pagamento continua dentro da faixa (é ele que diz "não pague");
//   - o card inteiro abre o pedido, e tocar no número só copia.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, OrderStatus, PaymentStatus, View } from "@/types";

vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/copiar-para-clipboard", () => ({
  copiarParaClipboard: vi.fn().mockResolvedValue(true),
}));

const pedidoBase: Order = {
  id: "11111111-2222-3333-4444-555555555555",
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

describe("OrderList — card do pedido redesenhado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onNavigate: ReturnType<typeof vi.fn<(view: View, id?: string) => void>>;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    onNavigate = vi.fn();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizar(pedido: Order) {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    await act(async () => {
      raiz.render(<OrderList orders={[pedido]} onNavigate={onNavigate} />);
    });
  }

  function etapaAtual(): string | undefined {
    const trilha = hospedeiro.querySelector(
      '[data-testid="order-status-trail"]',
    );
    // A etapa atual é a única com a cor do status em vez de zinc-500.
    return (
      Array.from(trilha?.querySelectorAll("span.truncate") ?? []).find(
        (el) => !el.classList.contains("text-zinc-500"),
      )?.textContent ?? undefined
    );
  }

  it.each<[OrderStatus, string]>([
    ["pending", "Recebido"],
    ["processing", "Separação"],
    ["shipping", "A caminho"],
    ["delivered", "Entregue"],
  ])(
    "status %s: trilha com as 4 etapas e '%s' marcada",
    async (status, atual) => {
      await renderizar({ ...pedidoBase, status });

      const trilha = hospedeiro.querySelector(
        '[data-testid="order-status-trail"]',
      );
      expect(trilha).not.toBeNull();
      for (const etapa of ["Recebido", "Separação", "A caminho", "Entregue"]) {
        expect(trilha?.textContent).toContain(etapa);
      }
      expect(etapaAtual()).toBe(atual);
    },
  );

  it("cancelado: sem trilha, faixa vermelha e o aviso 'não pague' dentro dela", async () => {
    await renderizar({
      ...pedidoBase,
      status: "cancelled",
      paymentStatus: "aguardando" as PaymentStatus,
    });

    expect(
      hospedeiro.querySelector('[data-testid="order-status-trail"]'),
    ).toBeNull();
    const faixa = hospedeiro.querySelector(
      '[data-testid="order-status-panel"]',
    );
    expect(faixa?.classList.contains("bg-rose-50")).toBe(true);
    expect(faixa?.textContent).toContain("Este pedido foi cancelado");
    const selo = faixa?.querySelector('[data-testid="customer-payment-badge"]');
    expect(selo?.textContent).toContain("Cancelado — não pague");
  });

  // O toque no card inteiro vem do `after:` do botão esticado sobre o card
  // (jsdom não desenha pseudo-elemento, então o que se prova aqui é a
  // montagem: o card é o `relative` que contém a camada, e o #id fica acima).
  it("o card inteiro é área de toque do 'Ver Detalhes', e o número fica por cima", async () => {
    await renderizar(pedidoBase);

    const botao = hospedeiro.querySelector('[data-testid="order-card-open"]');
    expect(botao?.classList.contains("after:absolute")).toBe(true);
    expect(botao?.classList.contains("after:inset-0")).toBe(true);
    expect(botao?.classList.contains("relative")).toBe(false);

    const card = botao?.closest(".rounded-2xl");
    expect(card?.classList.contains("relative")).toBe(true);

    const botaoId = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.includes(`#${pedidoBase.id.slice(0, 8)}`),
    );
    expect(botaoId?.classList.contains("relative")).toBe(true);
    expect(botaoId?.classList.contains("z-10")).toBe(true);
  });

  it("'Ver Detalhes' abre o pedido uma vez só (sem somar com o clique do card)", async () => {
    await renderizar(pedidoBase);

    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Ver Detalhes"),
    );
    await act(async () => {
      botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("tocar no número copia e NÃO abre o pedido", async () => {
    await renderizar(pedidoBase);

    const botaoId = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.includes(`#${pedidoBase.id.slice(0, 8)}`),
    );
    expect(botaoId).toBeTruthy();
    await act(async () => {
      botaoId?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onNavigate).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toContain("Copiado!");
  });
});
