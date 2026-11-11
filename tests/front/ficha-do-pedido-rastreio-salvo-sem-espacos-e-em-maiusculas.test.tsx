// @vitest-environment jsdom
/**
 * Código de rastreio salvo na ficha do pedido: o que VAI AO BANCO.
 *
 * A cliente copia o código da tela e o cola em outros sites de rastreio, que
 * recusam espaço; por isso o que se salva é o código SEM espaços (inclusive do
 * meio) e em MAIÚSCULAS. E campo apagado grava NULL (e não "" — o pedido volta
 * a ficar "sem código", que é o que a tela e o resto do app testam).
 *
 * Os testes de prazo (`pedido-rastreio-e-nota-com-prazo.test.tsx`) digitam um
 * código que já é maiúsculo e sem espaço, então não pegam se a limpeza some ou
 * se o `|| null` vira `""`.
 */
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { atualizar } = vi.hoisted(() => ({ atualizar: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data:
                tabela === "config_mototaxi"
                  ? { whatsapp: null, nome: null }
                  : null,
              error: null,
            }),
        }),
      }),
      update: (valores: unknown) => {
        atualizar(tabela, valores);
        // `.select("id")` devolve a linha gravada (0 linhas = não gravou).
        return {
          eq: () => ({
            select: () => Promise.resolve({ data: [{ id: "A" }], error: null }),
          }),
        };
      },
    }),
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/admin/orders/EtiquetaDoPedidoCard", () => ({
  EtiquetaDoPedidoCard: () => null,
}));
vi.mock("@/components/admin/orders/EstornoCard", () => ({
  EstornoCard: () => null,
}));
vi.mock("@/components/admin/orders/DevolucaoDoPedidoAdminCard", () => ({
  DevolucaoDoPedidoAdminCard: () => null,
}));

import { OrderDetail } from "@/components/admin/orders/OrderDetail";
import { toast } from "sonner";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedido(trackingCode: string): Order {
  return {
    id: "A",
    notes: "",
    trackingCode,
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    paymentStatus: "pago",
    status: "processing",
    createdAt: "2026-10-16T10:00:00Z",
    updatedAt: "2026-10-16T10:00:00Z",
    cancelledAfterShipping: false,
  };
}

describe("ficha do pedido — rastreio salvo: sem espaços, em maiúsculas, vazio vira NULL", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;
  const onStatusChange = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
  });

  async function mostrar(order: Order) {
    await act(async () => {
      raiz.render(
        <OrderDetail order={order} onStatusChange={onStatusChange} />,
      );
    });
  }

  function clicar(texto: string) {
    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === texto || b.getAttribute("title") === texto,
    );
    if (!botao) throw new Error(`Botão ausente: ${texto}`);
    act(() => botao.click());
  }

  function digitarNoCampoDoCodigo(texto: string) {
    const elemento =
      hospedeiro.querySelector<HTMLInputElement>("#tracking-input");
    if (!elemento) throw new Error("Campo ausente: #tracking-input");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("Campo sem setter de valor");
    act(() => {
      setter.call(elemento, texto);
      elemento.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // o campo já põe em maiúsculas ao digitar, mas deixa os espaços passarem
    expect(
      hospedeiro.querySelector<HTMLInputElement>("#tracking-input")?.value,
    ).toBe(texto.toUpperCase());
  }

  it("digitado com espaços e minúsculas: o banco recebe o código sem espaços e em maiúsculas", async () => {
    await mostrar(pedido("CODIGO-ANTIGO"));
    clicar("Editar Código");
    digitarNoCampoDoCodigo("aa 123 456 789 br");
    await act(async () => clicar("Salvar"));

    expect(atualizar).toHaveBeenCalledTimes(1);
    expect(atualizar).toHaveBeenCalledWith("marketplace_orders", {
      tracking_code: "AA123456789BR",
    });
    expect(toast.success).toHaveBeenCalledWith("Código de rastreio salvo!");
    // a ficha mostra o mesmo código limpo que foi para o banco
    expect(hospedeiro.textContent).toContain("AA123456789BR");
  });

  it("campo apagado (ou só espaços) em pedido que já tinha código: o banco recebe NULL, não string vazia", async () => {
    for (const apagado of ["", "   "]) {
      atualizar.mockClear();
      await mostrar(pedido("AA123456789BR"));
      clicar("Editar Código");
      digitarNoCampoDoCodigo(apagado);
      await act(async () => clicar("Salvar"));

      expect(atualizar).toHaveBeenCalledTimes(1);
      expect(atualizar).toHaveBeenCalledWith("marketplace_orders", {
        tracking_code: null,
      });
      // remonta para o próximo valor começar de um pedido com código
      act(() => raiz.unmount());
      raiz = createRoot(hospedeiro);
    }
  });
});
