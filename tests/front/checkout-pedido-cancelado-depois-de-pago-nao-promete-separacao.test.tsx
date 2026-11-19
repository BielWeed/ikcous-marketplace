// @vitest-environment jsdom

import { lerReciboDoCheckout } from "@/lib/recibo-do-checkout";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { usuario, lerPoll, tempoReal } = vi.hoisted(() => ({
  usuario: { id: "user-1" },
  lerPoll: vi.fn(),
  tempoReal: { avisar: null as null | ((evento: unknown) => void) },
}));

const PEDIDO = "99999999-9999-4999-8999-999999999999";
const irPara = vi.fn();

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      enableCoupons: false,
      whatsappNumber: "34999998888",
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [],
      cartTotal: 0,
      shippingFee: 0,
      clearCart: vi.fn(),
      addToCart: vi.fn(),
      selectedShippingOption: null,
      shippingCep: null,
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: (
    _ligado: boolean,
    _admin: boolean,
    opcoes?: { onRealtimeEvent?: (evento: unknown) => void },
  ) => {
    if (opcoes?.onRealtimeEvent) tempoReal.avisar = opcoes.onRealtimeEvent;
    return { createOrder: vi.fn(), updateOrderStatus: vi.fn() };
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: (colunas: string) => ({
        eq: (_coluna: string, id: string) => ({
          maybeSingle: () =>
            Promise.resolve({
              data: { total: 149.9, metodo_online: "pix" },
              error: null,
            }),
          single: async () => {
            if (id !== PEDIDO)
              return { data: null, error: { message: "not found" } };
            const linha = await lerPoll();
            // Como no servidor, só devolve as colunas pedidas na consulta.
            const data = Object.fromEntries(
              colunas.split(",").map((coluna) => {
                const chave = coluna.trim();
                // eslint-disable-next-line security/detect-object-injection -- Projeção de uma linha fictícia, pelas colunas pedidas pelo componente.
                return [chave, linha[chave]];
              }),
            );
            return { data, error: null };
          },
          in: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

vi.mock("@/components/checkout/PagamentoOnline", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("@/components/checkout/PagamentoOnline")
    >();
  return { ...real, PagamentoOnline: () => null };
});

vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { ESTADO_PRONTO_SEM_CARTAO } = await import(
    "./duble-use-config-do-cartao"
  );
  return { useConfigDoCartao: () => ESTADO_PRONTO_SEM_CARTAO };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CheckoutView — Pix pago em pedido cancelado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    lerPoll.mockReset();
    irPara.mockClear();
    tempoReal.avisar = null;
    sessionStorage.clear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    sessionStorage.clear();
    vi.useRealTimers();
  });

  async function montarNaTelaDoPix() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={irPara}
          onSetBackOverride={() => {}}
          retomarPedidoId={PEDIDO}
        />,
      );
    });
    expect(hospedeiro.textContent).toContain("Finalize o pagamento");
  }

  async function consultaMostraPixPago(status: string) {
    lerPoll.mockResolvedValue({ status, payment_status: "pago" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
  }

  function conferirAvisoSemPromessaDeSeparacao() {
    expect(hospedeiro.textContent).not.toContain("Pagamento Confirmado!");
    expect(hospedeiro.textContent).not.toContain("separação");
    expect(hospedeiro.textContent).toContain("Pedido cancelado");
    expect(hospedeiro.textContent).not.toMatch(/estorno|devolução/i);
  }

  it("a consulta mostra o cancelamento antes de considerar o Pix pago", async () => {
    await montarNaTelaDoPix();
    await consultaMostraPixPago("cancelled");

    conferirAvisoSemPromessaDeSeparacao();
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /ver meus pedidos/i.test(b.textContent ?? ""),
    );
    expect(botao).toBeDefined();
    act(() => botao!.click());
    expect(irPara).toHaveBeenCalledWith("orders");
  });

  it("a consulta continua confirmando o Pix pago de um pedido ativo", async () => {
    await montarNaTelaDoPix();
    await consultaMostraPixPago("pending");

    expect(hospedeiro.textContent).toContain("Pagamento Confirmado!");
    expect(hospedeiro.textContent).toContain("separação");
  });

  it("o evento de cancelamento ao vivo também substitui a confirmação e invalida seu recibo", async () => {
    await montarNaTelaDoPix();
    await consultaMostraPixPago("pending");
    expect(hospedeiro.textContent).toContain("Pagamento Confirmado!");
    expect(lerReciboDoCheckout(usuario.id)).toBe(PEDIDO);

    await act(async () => {
      tempoReal.avisar?.({
        eventType: "UPDATE",
        new: { id: PEDIDO, status: "cancelled", payment_status: "pago" },
      });
    });

    conferirAvisoSemPromessaDeSeparacao();
    expect(lerReciboDoCheckout(usuario.id)).toBeNull();
  });

  it("uma resposta antiga da consulta não desfaz um cancelamento recebido ao vivo", async () => {
    await montarNaTelaDoPix();
    let responder: (linha: Record<string, string>) => void = () => {};
    lerPoll.mockReturnValue(
      new Promise((resolve) => {
        responder = resolve;
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(lerPoll).toHaveBeenCalled();

    await act(async () => {
      tempoReal.avisar?.({
        eventType: "UPDATE",
        new: { id: PEDIDO, status: "cancelled", payment_status: "pago" },
      });
      responder({ status: "pending", payment_status: "pago" });
    });

    conferirAvisoSemPromessaDeSeparacao();
  });
});
