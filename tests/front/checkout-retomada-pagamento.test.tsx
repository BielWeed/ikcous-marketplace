// @vitest-environment jsdom
//
// FRETE 10 (frente 10 da missão de pagamentos, 29/09/2026) — retomada do
// pagamento: o CheckoutView com `retomarPedidoId` nasce DIRETO na tela de
// pagamento do pedido existente, mesmo com o carrinho VAZIO (o carrinho é
// limpo quando o pedido nasce — é exatamente o estado de quem sai do
// checkout e volta pelo card do pedido).
//
// O que este teste prende:
//   1. A tela de pagamento ("Finalize o pagamento") aparece com carrinho
//      vazio e o PagamentoOnline recebe o orderId retomado.
//   2. O valor exibido vem do PEDIDO (busca total/metodo_online), não do
//      carrinho (que está zerado).
//   3. Sem `retomarPedidoId`, nada disso acontece (o fluxo normal do
//      carrinho segue intacto).
//
// A segurança de NÃO duplicar cobrança é do SERVIDOR e já tem suíte própria
// (reconsulta devolve o MESMO QR; chave por tentativa; 409 terminal) — aqui
// só se prova que a porta da frente abre no lugar certo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn();
const updateOrderStatus = vi.fn();

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

let mockUser: { id: string } | null = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
}));

// Carrinho VAZIO — o estado real de quem já criou o pedido e voltou.
let mockCart: unknown[] = [];
let mockCartTotal = 0;

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: mockCart,
      cartTotal: mockCartTotal,
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
  useOrders: () => ({ createOrder, updateOrderStatus }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// Dublê do supabase: a RETOMADA consulta `total, metodo_online` com
// `.maybeSingle()`; o polling da tela consulta `payment_status, expires_at`
// com `.single()`. Os dois são servidos pelo mesmo `from`.
const respostasMaybeSingle: Record<
  string,
  { data: Record<string, unknown> | null }
> = {
  "ped-999": { data: { total: 149.9, metodo_online: "pix" } },
};
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (_tabela: string) => ({
      select: (_colunas: string) => ({
        eq: (_coluna: string, valor: string) => ({
          maybeSingle: () =>
            Promise.resolve(respostasMaybeSingle[valor] ?? { data: null }),
          single: () =>
            Promise.resolve({
              data: { payment_status: "aguardando", expires_at: null },
              error: null,
            }),
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

// O dublê CAPTURA as props — é assim que o teste prova que a tela de
// pagamento recebeu o pedido retomado e o valor do banco (não do carrinho).
let propsCapturadasDoPagamento: Record<string, unknown> | null = null;
vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: (props: Record<string, unknown>) => {
    propsCapturadasDoPagamento = props;
    return null;
  },
}));

vi.mock("@/hooks/useConfigDoCartao", () => ({
  useConfigDoCartao: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CheckoutView — retomada do pagamento (frente 10)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    propsCapturadasDoPagamento = null;
    mockCart = [];
    mockCartTotal = 0;
    mockUser = { id: "user-1" };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizar(retomarPedidoId?: string) {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={() => {}}
          onSetBackOverride={() => {}}
          retomarPedidoId={retomarPedidoId}
        />,
      );
    });
    // Dois ticks: o efeito de retomada roda no mount e a consulta do valor
    // resolve no microtask seguinte.
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("com retomarPedidoId: nasce na tela de pagamento com o pedido certo, mesmo com carrinho vazio", async () => {
    await renderizar("ped-999");

    expect(
      hospedeiro.textContent?.includes("Finalize o pagamento"),
    ).toBe(true);
    expect(propsCapturadasDoPagamento).not.toBeNull();
    expect(propsCapturadasDoPagamento?.orderId).toBe("ped-999");
    // O valor vem do PEDIDO (149.9), não do carrinho (zerado).
    expect(propsCapturadasDoPagamento?.valor).toBe(149.9);
  });

  it("sem retomarPedidoId: fluxo normal — nada de tela de pagamento nem consulta de retomada", async () => {
    await renderizar(undefined);

    expect(
      hospedeiro.textContent?.includes("Finalize o pagamento"),
    ).toBe(false);
    expect(propsCapturadasDoPagamento).toBeNull();
  });
});
