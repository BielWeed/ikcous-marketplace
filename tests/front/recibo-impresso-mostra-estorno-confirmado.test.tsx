// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { OrderReceipt } from "@/components/admin/orders/OrderReceipt";
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pedido: Order = {
  id: "8acf17aa-0000-0000-0000-000000000000",
  customer: { name: "Cliente Teste", whatsapp: "" },
  items: [],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  metodoOnline: "pix",
  status: "delivered",
  paymentStatus: "pago",
  createdAt: "",
  updatedAt: "",
  cancelledAfterShipping: false,
};

describe("recibo impresso — somente o estorno confirmado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  const papel = () => document.querySelector("[data-tema-fixo]");

  function renderizar(order: Order, valorEstornado?: number) {
    const props = { order, valorEstornado, storeName: "Loja Teste" };
    act(() => raiz.render(<OrderReceipt {...props} />));
  }

  function conferirTotais(reembolsado: string, retido: string) {
    const rotulo = [...(papel()?.querySelectorAll("span") ?? [])].find(
      (elemento) => elemento.textContent === "TOTAL",
    );
    const totais = rotulo?.parentElement?.parentElement;
    expect(totais?.classList.contains("print:break-inside-avoid")).toBe(true);
    const linhas = [...(totais?.children ?? [])].map((linha) =>
      [...linha.childNodes]
        .map((parte) => parte.textContent)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    );
    expect(linhas.slice(linhas.indexOf("TOTAL R$ 100,00"), -2)).toEqual([
      "TOTAL R$ 100,00",
      `Reembolsado: R$ ${reembolsado}`,
      `Valor retido: R$ ${retido}`,
    ]);
  }

  it("reimprime pela ficha com o total original, R$ 30,00 reembolsados e R$ 70,00 retidos", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(
        <OrderDetail
          order={{ ...pedido, retiradaNaLoja: true, valorEstornado: 30 }}
          onStatusChange={vi.fn()}
        />,
      );
    });
    conferirTotais("30,00", "70,00");
  });

  it.each([
    [33.33, "33,33", "66,67"],
    [100, "100,00", "0,00"],
    [130, "100,00", "0,00"],
  ])(
    "de R$ 100,00 com estorno de %s, imprime R$ %s e retém R$ %s",
    (estorno, reembolsado, retido) => {
      renderizar(pedido, estorno);
      conferirTotais(reembolsado, retido);
    },
  );

  it("não imprime os valores de reembolso nem de retenção em pedido cancelado", () => {
    renderizar({ ...pedido, status: "cancelled" }, 30);
    expect(papel()?.textContent).toContain("Cancelado · nada a receber");
    expect(papel()?.textContent).not.toMatch(/Reembolsado:|Valor retido:/);
  });

  it.each([undefined, 0])(
    "mantém HTML e CSS de impressão byte a byte com estorno %s, mesmo havendo devolução manual",
    (estorno) => {
      renderizar({ ...pedido, valorDevolvidoPorDevolucao: 45 }, estorno);
      // Capturado no recibo anterior à correção (0acb3ef4c), incluindo o CSS.
      const recibo = createHash("sha256")
        .update(document.body.innerHTML)
        .digest("hex");
      expect(recibo).toBe(
        "542a1e389e13b6ec7b02354a7115a6d580969ebb7efda5c124da5421be20d40e",
      );
    },
  );
});
