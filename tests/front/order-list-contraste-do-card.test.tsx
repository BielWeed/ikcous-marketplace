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

  it("'Total': usa text-zinc-500 (contraste AA), não mais text-zinc-300", async () => {
    await renderizar(pedidoBase);

    const rotulo = acharSpanPorTexto("Total");
    expect(rotulo).not.toBeUndefined();
    expect(rotulo?.classList.contains("text-zinc-500")).toBe(true);
    expect(rotulo?.classList.contains("text-zinc-300")).toBe(false);
  });

  it("'R$' do preço: usa text-zinc-500 (contraste AA), não mais text-zinc-400", async () => {
    await renderizar(pedidoBase);

    const cifrao = acharSpanPorTexto("R$");
    expect(cifrao).not.toBeUndefined();
    expect(cifrao?.classList.contains("text-zinc-500")).toBe(true);
    expect(cifrao?.classList.contains("text-zinc-400")).toBe(false);
  });

  it("data do pedido: usa text-zinc-500 (contraste AA), sem a opacidade /90 que ainda reprovava", async () => {
    await renderizar(pedidoBase);

    const dataFormatada = new Date(pedidoBase.createdAt).toLocaleDateString(
      "pt-BR",
    );
    const data = acharSpanPorTexto(dataFormatada);
    expect(data).not.toBeUndefined();
    expect(data?.classList.contains("text-zinc-500")).toBe(true);
    // O token que o Tailwind emite para a classe antiga é com a barra — é ela
    // que carrega o defeito (zinc-500/90 medido = 3,97, ainda reprova).
    expect(data?.classList.contains("text-zinc-400/90")).toBe(false);
  });

  it("linha de metadados ('1 Item'): usa text-zinc-500 (contraste AA), não mais text-zinc-400", async () => {
    await renderizar(pedidoBase);

    // O container da linha de metadados é o pai comum de "1 Item", do
    // separador e do meio de pagamento — é nele que a classe de cor vive.
    const itemTexto = Array.from(hospedeiro.querySelectorAll("span")).find(
      (el) => el.textContent === "1 Item",
    );
    const linha = itemTexto?.closest("div.flex-wrap");
    expect(linha).not.toBeUndefined();
    expect(linha).not.toBeNull();
    expect(linha?.classList.contains("text-zinc-500")).toBe(true);
    expect(linha?.classList.contains("text-zinc-400")).toBe(false);
  });

  // Controle negativo: o que não devia mudar não mudou. Correção de
  // interface vaza para o vizinho com muito mais facilidade do que deixa de
  // funcionar.
  it("controle: nome do produto e valor do preço continuam text-zinc-950, nenhum dos dois virou zinc-500", async () => {
    await renderizar(pedidoBase);

    const titulo = hospedeiro.querySelector("h4");
    expect(titulo).not.toBeNull();
    expect(titulo?.classList.contains("text-zinc-950")).toBe(true);
    expect(titulo?.classList.contains("text-zinc-500")).toBe(false);

    const valor = acharSpanPorTexto(
      pedidoBase.total.toLocaleString("pt-BR", { minimumFractionDigits: 2 }),
    );
    expect(valor).not.toBeUndefined();
    expect(valor?.classList.contains("text-zinc-950")).toBe(true);
    expect(valor?.classList.contains("text-zinc-500")).toBe(false);
  });

  // Prova de que a colisão de classe é real, não hipotética: depois desta
  // mudança, text-zinc-500 passa a existir em vários pontos do cartão. Esta
  // asserção precisa estar ancorada no elemento QUE ESTA TAREFA introduziu
  // (o rótulo "Total") — nunca em "existe algum .text-zinc-500 no cartão",
  // porque o cartão já tinha quatro pontos com essa classe antes desta
  // tarefa (botão do #id, contador "+N", código de rastreio, subtexto do
  // status). Uma asserção de existência genérica seria verdadeira mesmo sem
  // o diff, e continuaria verdadeira se as quatro linhas fossem revertidas —
  // ou seja, não provaria nada sobre esta tarefa.
  it("colisão real com o selo 'expirado': o rótulo 'Total' desta tarefa (text-zinc-500) coexiste fora do selo, que continua com text-zinc-600 (sem text-zinc-500)", async () => {
    const pedidoExpirado: Order = {
      ...pedidoBase,
      paymentStatus: "expirado" as PaymentStatus,
    };
    await renderizar(pedidoExpirado);

    const rotuloTotal = acharSpanPorTexto("Total");
    expect(rotuloTotal).not.toBeUndefined();
    expect(rotuloTotal?.classList.contains("text-zinc-500")).toBe(true);
    expect(
      rotuloTotal?.closest('[data-testid="customer-payment-badge"]'),
    ).toBeNull();

    const selo = hospedeiro.querySelector(
      '[data-testid="customer-payment-badge"]',
    );
    expect(selo).not.toBeNull();
    expect(selo?.querySelector(".text-zinc-600")).not.toBeNull();
    expect(selo?.querySelector(".text-zinc-500")).toBeNull();
  });
});
