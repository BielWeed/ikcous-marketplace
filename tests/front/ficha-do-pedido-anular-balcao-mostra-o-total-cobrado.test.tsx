// @vitest-environment jsdom
//
// Ficha do pedido (`OrderDetail`), venda do balcão do mesmo dia: a pergunta
// "Anular esta venda de R$ X?" tem de mostrar o TOTAL COBRADO (`order.total`,
// com desconto), nunca o subtotal — a lojista lê esse valor para saber quanto
// devolver na mão. Valores onde subtotal ≠ total E onde o float erra:
// `1 - 0.7` = 0.30000000000000004 e `100.1 - 10.2` = 89.89999999999999; a tela
// precisa sair com "0,30" e "89,90".
//
// Molde de montagem: ficha-do-pedido-anular-venda-do-balcao.test.tsx.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: rpcMock,
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 08/10/2026, 15:00 em São Paulo.
const AGORA = new Date("2026-10-08T18:00:00.000Z");

// [subtotal, desconto, total como o float entrega, total esperado na tela]
const CASOS: readonly [number, number, number, string][] = [
  [1, 0.7, 1 - 0.7, "0,30"],
  [100.1, 10.2, 100.1 - 10.2, "89,90"],
];

function pedido(parcial: Partial<Order> = {}): Order {
  return {
    id: "ped-balcao-1",
    customer: {
      name: "Venda no balcão",
      whatsapp: "",
      address: "",
      number: "",
      neighborhood: "",
      city: "",
      state: "",
    },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "cash",
    status: "delivered",
    paymentStatus: "recebido_na_entrega",
    createdAt: "2026-10-08T14:00:00.000Z",
    updatedAt: "2026-10-08T14:00:00.000Z",
    cancelledAfterShipping: false,
    pagamentoRecebidoEm: "2026-10-08T14:00:00.000Z",
    pagamentoRecebidoPor: null,
    canal: "presencial",
    ...parcial,
  };
}

function botao(raiz: ParentNode, texto: string): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("ficha do pedido — a pergunta de anular mostra o TOTAL cobrado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    rpcMock.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(CASOS)(
    "subtotal %s, desconto %s: a pergunta mostra o total cobrado e nunca o subtotal",
    async (subtotal, desconto, total, esperado) => {
      const { OrderDetail } = await import(
        "@/components/admin/orders/OrderDetail"
      );
      await act(async () => {
        raiz.render(
          <OrderDetail
            order={pedido({ subtotal, discount: desconto, total })}
            onStatusChange={vi.fn()}
          />,
        );
      });

      const abrir = botao(hospedeiro, "Anular venda");
      expect(abrir).toBeDefined();
      await act(async () => {
        abrir?.click();
      });

      const pergunta = [...hospedeiro.querySelectorAll("p")].find((p) =>
        p.textContent?.startsWith("Anular esta venda de"),
      );
      expect(pergunta).toBeDefined();
      // `formatCurrency` separa o "R$" do número com espaço não quebrável.
      expect(pergunta?.textContent?.replace(/\s/g, " ")).toBe(
        `Anular esta venda de R$ ${esperado}?`,
      );
      const subtotalNaTela = subtotal.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      expect(pergunta?.textContent).not.toContain(subtotalNaTela);
    },
  );
});
