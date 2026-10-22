// @vitest-environment jsdom
//
// O botão de imprimir mora na linha do título "Pedido #…", no canto direito;
// a barra de ação (sticky) só existe quando há ação (Avançar / Cancelar).
// O jsdom NÃO faz layout: aqui se prova a estrutura (onde o botão está, se a
// barra existe, classes que impedem empurrar o botão); a aparência real em
// 320px (quebra do título, botão visível) precisa de olho no navegador.
//
// Molde de montagem: ficha-do-pedido-por-tipo-de-entrega.test.tsx.
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

function pedido(parcial: Partial<Order> = {}): Order {
  return {
    id: "8acf17aa-0000-0000-0000-000000000000",
    customer: { name: "Maria", whatsapp: "34999998888", address: "Rua A" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "cash",
    status: "pending",
    paymentStatus: "recebido_na_entrega",
    createdAt: "2026-10-08T14:00:00.000Z",
    updatedAt: "2026-10-08T14:00:00.000Z",
    cancelledAfterShipping: false,
    ...parcial,
  };
}

describe("ficha do pedido — imprimir no cabeçalho", () => {
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
    vi.restoreAllMocks();
  });

  async function renderizar(order: Order) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });
  }

  const imprimir = () =>
    hospedeiro.querySelector(
      'button[title="Imprimir Pedido"]',
    ) as HTMLButtonElement | null;
  const barra = () => hospedeiro.querySelector("div.sticky");

  function textoDoBotao(rotulo: string) {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(rotulo),
    );
  }

  it("pedido finalizado: imprimir está no cabeçalho e não existe barra de ação", async () => {
    await renderizar(pedido({ status: "delivered" }));
    const botao = imprimir();
    expect(botao).not.toBeNull();
    const cabecalho = botao?.closest("header");
    expect(cabecalho).not.toBeNull();
    expect(cabecalho?.querySelector("h1")?.textContent).toContain("#");
    expect(barra()).toBeNull();
    expect(textoDoBotao("Avançar")).toBeUndefined();
    expect(textoDoBotao("Cancelar")).toBeUndefined();
  });

  it("pedido cancelado: sem barra, imprimir no cabeçalho", async () => {
    await renderizar(pedido({ status: "cancelled" }));
    expect(imprimir()?.closest("header")).not.toBeNull();
    expect(barra()).toBeNull();
  });

  it("pedido em andamento: barra com Avançar e Cancelar, imprimir só no cabeçalho", async () => {
    await renderizar(pedido({ status: "pending" }));
    const b = barra();
    expect(b).not.toBeNull();
    expect(b?.textContent).toContain("Avançar");
    expect(b?.textContent).toContain("Cancelar");
    expect(b?.querySelector('button[title="Imprimir Pedido"]')).toBeNull();
    expect(
      hospedeiro.querySelectorAll('button[title="Imprimir Pedido"]'),
    ).toHaveLength(1);
    expect(imprimir()?.closest("header")).not.toBeNull();
  });

  it("o botão chama o print do navegador e tem área de toque de 44px que não encolhe", async () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    await renderizar(pedido({ status: "delivered" }));
    const botao = imprimir();
    expect(botao?.className).toContain("size-11");
    expect(botao?.className).toContain("shrink-0");
    await act(async () => {
      botao?.click();
    });
    expect(print).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("o texto do título pode encolher (min-w-0) sem empurrar o botão", async () => {
    await renderizar(pedido({ status: "delivered" }));
    const linha = imprimir()?.parentElement;
    expect(linha?.className).toContain("justify-between");
    expect(imprimir()?.previousElementSibling?.className).toContain("min-w-0");
  });
});
