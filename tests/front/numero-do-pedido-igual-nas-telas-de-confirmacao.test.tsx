// @vitest-environment jsdom
//
// F6 (fase 3 dos pagamentos, 04/10/2026) — as telas de confirmação do
// checkout (pago e pago fora do prazo) mostram o MESMO número do pedido que o
// formulário de pagamento (`numeroDoPedido`: 6 últimos, maiúsculas), e o
// histórico/detalhe do cliente também. Ver
// numero-do-pedido-igual-em-todas-as-telas-de-pagamento.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// Referência ESTÁVEL entre renders (um objeto novo por render reativaria, em
// laço, os efeitos que dependem de `user`).
const { usuario } = vi.hoisted(() => ({ usuario: { id: "user-1" } }));
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
      clearCart: () => {},
      addToCart: () => {},
      selectedShippingOption: null,
      shippingCep: null,
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn(), updateOrderStatus: vi.fn() }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// A leitura do pedido é controlada pelo teste: cada chamada de
// `.maybeSingle()` devolve o que `leituras` mandar (uma fila).
const { lerPedido, lerPoll } = vi.hoisted(() => ({
  lerPedido: vi.fn(),
  lerPoll: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => lerPedido(),
          single: () => lerPoll(),
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

vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: () => null,
}));

vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { ESTADO_PRONTO_SEM_CARTAO } = await import(
    "./duble-use-config-do-cartao"
  );
  return { useConfigDoCartao: () => ESTADO_PRONTO_SEM_CARTAO };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PEDIDO = "c35ce4dd-1234-4abc-8def-1a2b3c3884be";
const PEDIDO_LIDO = {
  data: { total: 149.9, metodo_online: "pix" },
  error: null,
};

describe("CheckoutView — número do pedido nas telas de confirmação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    lerPedido.mockReset().mockResolvedValue(PEDIDO_LIDO);
    lerPoll.mockReset();
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
  });

  async function chegarNaConfirmacao(payment_status: string) {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={() => {}}
          onSetBackOverride={() => {}}
          retomarPedidoId={PEDIDO}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    lerPoll.mockResolvedValue({
      data: {
        payment_status,
        status: "cancelled",
        gateway_payment_id: "pay-1",
        expires_at: null,
      },
      error: null,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
  }

  it("pago: a tela final mostra #3884BE", async () => {
    await chegarNaConfirmacao("pago");
    expect(hospedeiro.textContent).toContain("Pagamento Confirmado");
    expect(hospedeiro.textContent).toContain("#3884BE");
    expect(hospedeiro.textContent).not.toContain("#c35ce4dd");
  });

  it("pago fora do prazo: a tela mostra #3884BE", async () => {
    await chegarNaConfirmacao("pago_apos_expirar");
    expect(hospedeiro.textContent).toContain("prazo de reserva venceu");
    expect(hospedeiro.textContent).toContain("#3884BE");
  });
});
