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
import { numeroDoPedido } from "@/lib/numero-do-pedido";
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

  it.each<[OrderStatus, string, number]>([
    ["pending", "Recebido", 1],
    ["processing", "Separação", 2],
    ["shipping", "A caminho", 3],
  ])(
    "status %s: etapa atual '%s' nomeada, sem corte no bloco neutro",
    async (status, atual, numero) => {
      await renderizar({ ...pedidoBase, status, paymentStatus: "pago" });
      const painel = hospedeiro.querySelector(
        '[data-testid="order-status-panel"]',
      );
      const trilha = painel?.querySelector(
        '[data-testid="order-status-trail"]',
      );
      expect(painel?.classList.contains("bg-zinc-50")).toBe(true);
      expect(painel?.classList.contains("min-h-[136px]")).toBe(true);
      expect(
        painel?.querySelector('[class*="truncate"], [class*="line-clamp"]'),
      ).toBeNull();
      // Os conectores dividem só a sobra: uma coluna flex por etapa
      // espremeria a pílula longa de retirada em 320px.
      expect(trilha?.querySelectorAll("div.contents")).toHaveLength(4);
      expect(trilha?.getAttribute("role")).toBe("progressbar");
      expect(trilha?.getAttribute("aria-valuenow")).toBe(String(numero));
      expect(trilha?.getAttribute("aria-valuetext")).toContain(atual);
      expect(
        trilha?.querySelector("span.h-7.rounded-full.bg-zinc-950")?.textContent,
      ).toBe(atual);
      for (const etapa of ["Recebido", "Separação", "A caminho", "Entregue"]) {
        expect(trilha?.textContent).toContain(etapa);
      }
      expect(painel?.textContent).toContain("Próxima etapa:");
      expect(painel?.textContent).not.toContain("Retomar pagamento");
      const selo = painel?.querySelector(
        '[data-testid="customer-payment-badge"]',
      );
      expect(selo?.classList.contains("h-6")).toBe(true);
      expect(selo?.querySelector("svg")).not.toBeNull();
    },
  );

  it("entregue: bloco compacto sem trilha que já não informa progresso", async () => {
    await renderizar({
      ...pedidoBase,
      status: "delivered",
      paymentStatus: "pago",
    });
    const painel = hospedeiro.querySelector(
      '[data-testid="order-status-panel"]',
    );
    expect(painel?.classList.contains("min-h-[74px]")).toBe(true);
    expect(
      painel?.querySelector('[data-testid="order-status-trail"]'),
    ).toBeNull();
    expect(painel?.textContent).toContain("Pedido entregue");
  });

  it("carregando sem pedidos: dois esqueletos da mesma geometria, sem falso vazio", async () => {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    await act(async () => {
      raiz.render(
        <OrderList orders={[]} isLoadingOrders onNavigate={onNavigate} />,
      );
    });
    expect(hospedeiro.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(
      hospedeiro.querySelectorAll('[data-testid="order-card-skeleton"]'),
    ).toHaveLength(2);
    expect(
      hospedeiro.querySelectorAll(
        '[data-testid="order-card-skeleton"] .min-h-\\[136px\\]',
      ),
    ).toHaveLength(2);
    expect(hospedeiro.textContent).toContain("Carregando pedidos");
    expect(hospedeiro.textContent).not.toContain("Nenhum pedido");
  });

  it.each<[PaymentStatus | undefined, string]>([
    [
      "expirado",
      "O prazo para pagar terminou. Se não pagou, é só comprar de novo.",
    ],
    [
      "aguardando",
      "Se o pagamento ainda estiver aberto no seu banco, não pague.",
    ],
    [
      "pago",
      "Seu pagamento foi recebido. Toque para ver o que acontece com ele.",
    ],
    [
      "recebido_na_entrega",
      "Seu pagamento foi recebido. Fale com a loja para resolver.",
    ],
    [
      "pago_apos_expirar",
      "Seu pagamento foi recebido. Fale com a loja para resolver.",
    ],
    ["recusado", "O pagamento não foi aprovado e o pedido foi cancelado."],
    ["estornado", "O pagamento foi estornado. Fale com a loja."],
    [undefined, "Toque para ver os detalhes do pedido."],
  ])(
    "cancelado com %s: frase do gabarito sem prometer devolução",
    async (paymentStatus, frase) => {
      await renderizar({ ...pedidoBase, status: "cancelled", paymentStatus });
      const painel = hospedeiro.querySelector(
        '[data-testid="order-status-panel"]',
      );
      expect(painel?.textContent).toContain(frase);
      expect(
        painel?.classList.contains(
          paymentStatus ? "min-h-[110px]" : "min-h-[78px]",
        ),
      ).toBe(true);
      expect(
        painel?.querySelector('[class*="truncate"], [class*="line-clamp"]'),
      ).toBeNull();
    },
  );

  it("sem cobrança: altura menor, sem selo e sem botão de pagamento", async () => {
    await renderizar(pedidoBase);
    const painel = hospedeiro.querySelector(
      '[data-testid="order-status-panel"]',
    );
    expect(painel?.classList.contains("min-h-[104px]")).toBe(true);
    expect(
      painel?.querySelector('[data-testid="customer-payment-badge"]'),
    ).toBeNull();
    expect(painel?.querySelector("button")).toBeNull();
  });

  it("rastreio ocupa a legenda, quebra sem corte e não muda o mínimo do andamento", async () => {
    await renderizar({
      ...pedidoBase,
      status: "shipping",
      paymentStatus: "pago",
      trackingCode: "CODIGO-LONGO-1234567890123456789",
    });
    const painel = hospedeiro.querySelector(
      '[data-testid="order-status-panel"]',
    );
    expect(painel?.classList.contains("min-h-[136px]")).toBe(true);
    expect(painel?.querySelector(".break-all")?.textContent).toContain(
      "CODIGO-LONGO",
    );
    expect(painel?.textContent).not.toContain("Próxima etapa:");
  });

  it("pedido sem itens: sem <img> quebrada, mostra o ícone no lugar da foto", async () => {
    await renderizar({ ...pedidoBase, items: [] });

    expect(hospedeiro.querySelector("img")).toBeNull();
    expect(hospedeiro.textContent).toContain("N/A");
  });

  it("cancelado: bloco neutro, ícone rosa e o aviso 'não pague' dentro dele", async () => {
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
    expect(faixa?.classList.contains("bg-zinc-50")).toBe(true);
    expect(faixa?.querySelector("svg.text-rose-700")).not.toBeNull();
    expect(faixa?.textContent).toContain(
      "Se o pagamento ainda estiver aberto no seu banco, não pague.",
    );
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
      (b) => b.textContent?.includes(`#${numeroDoPedido(pedidoBase.id)}`),
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
      (b) => b.textContent?.includes(`#${numeroDoPedido(pedidoBase.id)}`),
    );
    expect(botaoId).toBeTruthy();
    await act(async () => {
      botaoId?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onNavigate).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toContain("Copiado!");
  });
});
