// @vitest-environment jsdom
//
// P1 da revisão independente da PR #711 (29/09/2026) + ordem do dono sobre o
// SENTINELA: a retomada setava `orderId` + `aguardandoPagamento` ANTES da
// leitura de `metodo_online` resolver — com `metodoDoPedido` nascendo "pix",
// o `PagamentoComPix` montava e disparava `criarPagamento` PIX para um
// pedido de CARTÃO em desafio 3DS; a edge interpreta como troca de método e
// CANCELA a order de cartão no Mercado Pago. E `metodo_online` NULL com
// `gateway_payment_id` "verificando:..." é cartão ambíguo em reconciliação —
// também não pode montar PIX. Este teste prende a correção em três casos:
//   1. CARTÃO (credito) atrasado: nada monta antes do método real; depois
//      monta UMA vez já em "cartao" — nunca PIX.
//   2. SENTINELA (null + verificando:): NADA monta, nunca; tela informativa.
//   3. PIX legítimo atrasado: retoma normalmente DEPOIS da leitura.
//
// A prova de ausência de POST PIX prematuro é por montagem: o único lugar
// que dispara PIX é o efeito de montagem do PagamentoComPix, que só existe
// dentro do PagamentoOnline montado com método "pix". Montagem bloqueada
// até o método real = disparo bloqueado. (O comportamento da edge diante
// de um POST de troca tem suíte própria no servidor.)
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

// A leitura da retomada é ATRASADA por um resolve manual — é a janela em que
// o bug montava o pagamento em PIX por padrão. Vários chamadores podem ter
// `.maybeSingle()` pendente; TODOS são resolvidos juntos com o MESMO wrapper
// `{ data }` que o supabase-js usa (o `.then(({ data }) => ...)` da
// retomada destrutura `data` — resolver com o objeto cru dava data=undefined).
type LinhaDePedido = {
  total: number;
  metodo_online: string | null;
  gateway_payment_id?: string | null;
};
const resolversPendentes = new Set<
  (resposta: { data: LinhaDePedido | null }) => void
>();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (_tabela: string) => ({
      select: (_colunas: string) => ({
        eq: (_coluna: string, _valor: string) => ({
          maybeSingle: () =>
            new Promise((resolve) => {
              resolversPendentes.add(resolve);
            }),
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
function resolverALeitura(linha: LinhaDePedido) {
  for (const resolve of resolversPendentes) resolve({ data: linha });
  resolversPendentes.clear();
}

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

let montagensDoPagamento = 0;
let propsCapturadasDoPagamento: Record<string, unknown> | null = null;
vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: (props: Record<string, unknown>) => {
    montagensDoPagamento += 1;
    propsCapturadasDoPagamento = props;
    return null;
  },
}));

vi.mock("@/hooks/useConfigDoCartao", () => ({
  useConfigDoCartao: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CheckoutView — retomada não monta pagamento antes do método real (P1)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    montagensDoPagamento = 0;
    propsCapturadasDoPagamento = null;
    resolversPendentes.clear();
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

  async function renderizarRetomada() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={() => {}}
          onSetBackOverride={() => {}}
          retomarPedidoId="ped-777"
        />,
      );
    });
    // Vários ticks: a leitura continua pendente (só resolve manualmente).
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  it("pedido de CARTÃO com leitura atrasada: nada monta em PIX enquanto o método real não chega", async () => {
    await renderizarRetomada();

    // ANTES da leitura resolver: nenhuma tela de pagamento, nenhuma
    // montagem — o disparo PIX prematuro era daqui.
    expect(hospedeiro.textContent?.includes("Finalize o pagamento")).toBe(
      false,
    );
    expect(montagensDoPagamento).toBe(0);

    await act(async () => {
      resolverALeitura({ total: 210.0, metodo_online: "credito" });
    });
    await act(async () => {
      await Promise.resolve();
    });

    // DEPOIS: montou UMA vez, já no método certo (cartão — sem POST PIX).
    expect(montagensDoPagamento).toBe(1);
    expect(propsCapturadasDoPagamento?.metodo).toBe("cartao");
    expect(propsCapturadasDoPagamento?.orderId).toBe("ped-777");
    expect(propsCapturadasDoPagamento?.valor).toBe(210.0);
  });

  it("SENTINELA (metodo_online null + gateway verificando:): cartão ambíguo — nada monta, nunca", async () => {
    await renderizarRetomada();

    expect(montagensDoPagamento).toBe(0);

    await act(async () => {
      resolverALeitura({
        total: 320.5,
        metodo_online: null,
        gateway_payment_id: "verificando:ped-777:c1:1695900000000",
      });
    });
    // Muitos ticks depois: continua sem montar nada.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(montagensDoPagamento).toBe(0);
    expect(propsCapturadasDoPagamento).toBeNull();
    // Tela informativa no lugar do pagamento — nunca "Finalize o pagamento".
    expect(hospedeiro.textContent?.includes("Pagamento em verificação")).toBe(
      true,
    );
    expect(hospedeiro.textContent?.includes("Finalize o pagamento")).toBe(
      false,
    );
  });

  it("pedido de DÉBITO com leitura atrasada: mesma proteção — nada antes da leitura, depois já em 'cartao'", async () => {
    await renderizarRetomada();

    expect(montagensDoPagamento).toBe(0);

    await act(async () => {
      resolverALeitura({ total: 88.25, metodo_online: "debito" });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(montagensDoPagamento).toBe(1);
    expect(propsCapturadasDoPagamento?.metodo).toBe("cartao");
    expect(propsCapturadasDoPagamento?.orderId).toBe("ped-777");
  });

  it("pedido de PIX com leitura atrasada: retoma normalmente DEPOIS da leitura", async () => {
    await renderizarRetomada();

    expect(montagensDoPagamento).toBe(0);

    await act(async () => {
      resolverALeitura({ total: 149.9, metodo_online: "pix" });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(montagensDoPagamento).toBe(1);
    expect(propsCapturadasDoPagamento?.metodo).toBe("pix");
    expect(propsCapturadasDoPagamento?.orderId).toBe("ped-777");
  });
});
