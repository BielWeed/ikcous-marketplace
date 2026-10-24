// @vitest-environment jsdom
//
// Defeito: quatro textos do cartão de "Meus Pedidos" (rótulo "Total", "R$" do
// preço, data do pedido, linha de metadados) rodavam em tons de zinc claros
// demais sobre o fundo branco do card — abaixo do mínimo AA (4,5:1) do WCAG.
// Medido (Tailwind v3, `bg-white` = #ffffff):
//   "Total"      zinc-300     1,48  REPROVA
//   data         zinc-400/90  2,31  REPROVA
//   "R$"         zinc-400     2,56  REPROVA
//   metadados    zinc-400     2,56  REPROVA
// `zinc-500` é o degrau mais baixo da escala que passa (4,83) e preserva a
// hierarquia contra o texto primário `text-zinc-950` (4,12x, contra 2,57x se
// fosse `zinc-600`).
//
// POR QUE RENDER DE VERDADE: mesmo raciocínio de
// order-list-codigo-de-rastreio.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, PaymentStatus } from "@/types";

vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
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

describe("OrderList — contraste do texto no cartão do pedido (WCAG AA)", () => {
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

  async function renderizar(pedido: Order) {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    await act(async () => {
      raiz.render(<OrderList orders={[pedido]} onNavigate={() => {}} />);
    });
  }

  function acharSpanPorTexto(texto: string): Element | undefined {
    return Array.from(hospedeiro.querySelectorAll("span")).find(
      (el) => el.textContent === texto,
    );
  }

  // Redesenho Tinta (24/10/2026): o cartão deixou os degraus de zinc e passou
  // a ler os tokens do tema. `text-muted-foreground` (#71717a no claro, 4,83
  // sobre `bg-background`) é o mesmo degrau AA que o zinc-500 antigo, e acompanha
  // o escuro. O que importa aqui continua sendo: nenhum texto secundário cai
  // abaixo do AA, e o texto principal segue na cor cheia (`text-foreground`).
  it("'Total': usa text-muted-foreground (contraste AA), nunca um zinc claro", async () => {
    await renderizar(pedidoBase);

    const rotulo = acharSpanPorTexto("Total");
    expect(rotulo).not.toBeUndefined();
    expect(rotulo?.classList.contains("text-muted-foreground")).toBe(true);
    expect(rotulo?.className).not.toMatch(/text-zinc-[1-4]00/);
  });

  it("valor com 'R$': na cor cheia do texto, sem cifrão apagado à parte", async () => {
    await renderizar(pedidoBase);

    const valor = acharSpanPorTexto(
      `R$ ${pedidoBase.total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
    );
    expect(valor).not.toBeUndefined();
    expect(valor?.classList.contains("text-foreground")).toBe(true);
    expect(acharSpanPorTexto("R$")).toBeUndefined();
  });

  it("data do pedido: usa text-muted-foreground (contraste AA), sem opacidade que reprovava", async () => {
    await renderizar(pedidoBase);

    const dataFormatada = new Date(pedidoBase.createdAt).toLocaleDateString(
      "pt-BR",
    );
    const data = acharSpanPorTexto(dataFormatada);
    expect(data).not.toBeUndefined();
    // A cor vive no contêiner do rodapé (número, ponto e data a herdam).
    const rodape = data?.parentElement;
    expect(rodape?.classList.contains("text-muted-foreground")).toBe(true);
    expect(data?.className).not.toMatch(/\/\d+/);
  });

  it("linha de metadados ('1 item'): usa text-muted-foreground (contraste AA)", async () => {
    await renderizar(pedidoBase);

    const linha = Array.from(hospedeiro.querySelectorAll("p")).find((el) =>
      el.textContent?.startsWith("1 item"),
    );
    expect(linha).not.toBeUndefined();
    expect(linha?.classList.contains("text-muted-foreground")).toBe(true);
    expect(linha?.textContent).toBe("1 item · PIX");
  });

  // Controle negativo: o que não devia mudar não mudou.
  it("controle: nome do produto e valor continuam na cor cheia, nenhum dos dois virou secundário", async () => {
    await renderizar(pedidoBase);

    const titulo = hospedeiro.querySelector("h4");
    expect(titulo).not.toBeNull();
    expect(titulo?.classList.contains("text-foreground")).toBe(true);
    expect(titulo?.classList.contains("text-muted-foreground")).toBe(false);

    const valor = acharSpanPorTexto(
      `R$ ${pedidoBase.total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
    );
    expect(valor?.classList.contains("text-foreground")).toBe(true);
    expect(valor?.classList.contains("text-muted-foreground")).toBe(false);
  });

  // O selo de pagamento é compartilhado e tem as suas próprias cores medidas:
  // o rótulo "Total" (secundário) coexiste fora dele sem emprestar classe.
  it("colisão real com o selo 'expirado': o selo segue com text-zinc-600 e o 'Total' fica fora dele", async () => {
    const pedidoExpirado: Order = {
      ...pedidoBase,
      paymentStatus: "expirado" as PaymentStatus,
    };
    await renderizar(pedidoExpirado);

    const rotuloTotal = acharSpanPorTexto("Total");
    expect(rotuloTotal).not.toBeUndefined();
    expect(rotuloTotal?.classList.contains("text-muted-foreground")).toBe(true);
    expect(
      rotuloTotal?.closest('[data-testid="customer-payment-badge"]'),
    ).toBeNull();

    const selo = hospedeiro.querySelector(
      '[data-testid="customer-payment-badge"]',
    );
    expect(selo).not.toBeNull();
    expect(selo?.querySelector(".text-zinc-600")).not.toBeNull();
    expect(selo?.querySelector(".text-muted-foreground")).toBeNull();
  });
});
