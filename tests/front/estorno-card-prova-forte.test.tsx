// @vitest-environment jsdom
//
// Prova forte do cartão "Devolução de dinheiro" (EstornoCard): a faixa que a
// lojista lê ao digitar "outro valor" tem de ser o que AINDA pode ser devolvido
// (disponível), nunca o total pago. Quando uma parte já foi devolvida, os dois
// números são diferentes — é aí que a mensagem errada deixaria a lojista
// digitar um valor que o servidor vai recusar (ou, pior, acreditar que pode
// devolver o pedido inteiro de novo). Valores escritos à mão.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const useEstornosDoPedidoMock = vi.fn();
vi.mock("@/hooks/useEstornosDoPedido", () => ({
  useEstornosDoPedido: (orderId: string) => useEstornosDoPedidoMock(orderId),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pedido: Order = {
  id: "pedido-estorno-1",
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
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  status: "cancelled",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
  paymentStatus: "pago",
};

function hook(extra: Record<string, unknown> = {}) {
  return {
    linhas: [],
    pago: 100,
    devolvido: 54.23,
    emCurso: 0,
    emDuvida: 0,
    disponivel: 45.77,
    reservadoPorFora: 0,
    carregando: false,
    pedidoCarregado: true,
    erro: false,
    recarregar: vi.fn(),
    solicitarEstorno: vi.fn().mockResolvedValue(undefined),
    registrarPorForaAposEspera: vi.fn().mockResolvedValue(true),
    enviando: false,
    ...extra,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  useEstornosDoPedidoMock.mockReset();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

const normalizar = (s: string | null) => (s ?? "").replace(/\s+/g, " ");

async function montar() {
  const { EstornoCard } = await import("@/components/admin/orders/EstornoCard");
  await act(async () => {
    raiz.render(<EstornoCard order={pedido} />);
  });
}

async function digitarOutroValor(texto: string) {
  const abrir = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    normalizar(b.textContent).includes("devolver outro valor"),
  ) as HTMLButtonElement;
  await act(async () => abrir.click());
  const campo = hospedeiro.querySelector<HTMLInputElement>(
    `#valor-outro-estorno-${pedido.id}`,
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return campo;
}

describe("EstornoCard — a faixa do 'outro valor' é o que ainda dá para devolver", () => {
  it("com R$ 54,23 já devolvidos de R$ 100,00, digitar 50 mostra 'entre R$ 0,01 e R$ 45,77' (nunca R$ 100,00)", async () => {
    useEstornosDoPedidoMock.mockReturnValue(hook());
    await montar();
    const campo = await digitarOutroValor("50");

    expect(campo.getAttribute("aria-invalid")).toBe("true");
    const aviso = hospedeiro.querySelector(
      `#valor-outro-estorno-aviso-${pedido.id}`,
    );
    expect(normalizar(aviso?.textContent ?? null)).toBe(
      "O valor tem de ficar entre R$ 0,01 e R$ 45,77",
    );
  });

  it("o valor que cabe (45,77) some com o aviso e vira o rótulo do botão", async () => {
    useEstornosDoPedidoMock.mockReturnValue(hook());
    await montar();
    const campo = await digitarOutroValor("45,77");

    expect(campo.getAttribute("aria-invalid")).toBe("false");
    expect(hospedeiro.textContent).not.toContain("O valor tem de ficar entre");
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      normalizar(b.textContent).startsWith("Devolver R$"),
    ) as HTMLButtonElement;
    expect(normalizar(botao.textContent)).toBe("Devolver R$ 45,77");
    expect(botao.disabled).toBe(false);
  });
});
