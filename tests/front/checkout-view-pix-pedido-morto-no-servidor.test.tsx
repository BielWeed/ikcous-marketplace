// @vitest-environment jsdom
//
// F1 (fase 3 dos pagamentos, 04/10/2026) — o CheckoutView entrega ao
// PagamentoOnline o fato "o SERVIDOR gravou este pedido como morto"
// (`payment_status = 'expirado'`, ou `aguardando` + `status = 'cancelled'`),
// lido pela verificação periódica que já existia. Quem troca o QR pelo aviso
// é o PagamentoOnline (pix-codigo-morto-no-servidor-nao-aparece-como-valido).
// O polling NÃO para: o pagamento que chega depois ainda vira "pago fora do
// prazo". O relógio do aparelho não participa (`expires_at` nem é lido para
// isso).
//
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

let propsCapturadasDoPagamento: Record<string, unknown> | null = null;
vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: (props: Record<string, unknown>) => {
    propsCapturadasDoPagamento = props;
    return null;
  },
}));

vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { ESTADO_PRONTO_SEM_CARTAO } = await import(
    "./duble-use-config-do-cartao"
  );
  return { useConfigDoCartao: () => ESTADO_PRONTO_SEM_CARTAO };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PEDIDO = "ped-999";
const PEDIDO_LIDO = {
  data: { total: 149.9, metodo_online: "pix" },
  error: null,
};

describe("CheckoutView — pedido morto no servidor chega ao PagamentoOnline", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    lerPedido.mockReset().mockResolvedValue(PEDIDO_LIDO);
    lerPoll.mockReset();
    propsCapturadasDoPagamento = null;
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

  async function montarNaTelaDoPix() {
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
    expect(propsCapturadasDoPagamento?.orderId).toBe(PEDIDO);
  }

  async function lerOServidor(resposta: Record<string, unknown>) {
    lerPoll.mockResolvedValue({
      data: { gateway_payment_id: "pay-1", expires_at: null, ...resposta },
      error: null,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
  }

  it("antes de qualquer leitura do servidor: pedidoMortoNoServidor é falso", async () => {
    await montarNaTelaDoPix();
    expect(propsCapturadasDoPagamento?.pedidoMortoNoServidor).toBe(false);
  });

  it("payment_status 'expirado': liga pedidoMortoNoServidor, e a verificação continua (pago fora do prazo depois ainda troca a tela)", async () => {
    await montarNaTelaDoPix();

    await lerOServidor({ payment_status: "expirado", status: "cancelled" });
    expect(propsCapturadasDoPagamento?.pedidoMortoNoServidor).toBe(true);
    expect(hospedeiro.textContent).not.toContain("prazo de reserva venceu");

    lerPoll.mockClear();
    await lerOServidor({
      payment_status: "pago_apos_expirar",
      status: "cancelled",
    });
    expect(lerPoll).toHaveBeenCalled(); // não parou de consultar
    expect(hospedeiro.textContent).toContain("prazo de reserva venceu");
  });

  it("'aguardando' + status 'cancelled' (cancelado pelo cliente/loja): liga pedidoMortoNoServidor", async () => {
    await montarNaTelaDoPix();
    await lerOServidor({ payment_status: "aguardando", status: "cancelled" });
    expect(propsCapturadasDoPagamento?.pedidoMortoNoServidor).toBe(true);
  });

  it("CONTROLE: 'aguardando' + 'pending' (pedido vivo) mantém falso", async () => {
    await montarNaTelaDoPix();
    await lerOServidor({ payment_status: "aguardando", status: "pending" });
    expect(propsCapturadasDoPagamento?.pedidoMortoNoServidor).toBe(false);
  });

  it("CONTROLE: o relógio do aparelho não decide — expires_at no passado com o servidor dizendo 'aguardando' + 'pending' segue falso", async () => {
    await montarNaTelaDoPix();
    await lerOServidor({
      payment_status: "aguardando",
      status: "pending",
      expires_at: new Date(Date.now() - 3_600_000).toISOString(),
    });
    expect(propsCapturadasDoPagamento?.pedidoMortoNoServidor).toBe(false);
  });
});
