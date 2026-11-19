// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const PEDIDO = "ped-cartao-confirmado";
const USUARIO = { id: "user-1" };
const AVISO_DE_JUROS = "Juros do parcelamento, se houver, vêm na fatura.";

let linha: Record<string, unknown>;
let receberAtualizacao: ((evento: unknown) => void) | undefined;

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      enableCoupons: false,
    },
    isLoaded: true,
  }),
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: vi.fn(),
    loading: false,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: USUARIO, profile: null, loading: false }),
}));
vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [],
      cartTotal: 0,
      shippingFee: 0,
      clearCart: vi.fn(),
      selectedShippingOption: null,
      shippingCep: null,
    })),
  };
});
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: (
      _enabled: boolean,
      _isAdmin: boolean,
      options: { onRealtimeEvent?: (evento: unknown) => void },
    ) => {
      receberAtualizacao = options.onRealtimeEvent;
      return { createOrder: vi.fn(), updateOrderStatus: vi.fn() };
    },
  };
});
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { estadoPronto } = await import("./duble-use-config-do-cartao");
  return {
    useConfigDoCartao: () =>
      estadoPronto({ credito: true, debito: true, parcelasMax: 2 }),
  };
});
vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));
vi.mock("@/components/checkout/PagamentoOnline", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("@/components/checkout/PagamentoOnline")
    >();
  // Nenhuma chamada ao gateway: o que confirma a compra é o dado do pedido.
  return { ...real, PagamentoOnline: () => null };
});
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: (colunas: string) => ({
        eq: (coluna: string, valor: string) => {
          const consultar = async () => ({
            data:
              tabela === "marketplace_orders" &&
              coluna === "id" &&
              valor === PEDIDO
                ? Object.fromEntries(
                    Object.entries(linha).filter(([nome]) =>
                      colunas.split(",").some((c) => c.trim() === nome),
                    ),
                  )
                : null,
            error: null,
          });
          return { maybeSingle: consultar, single: consultar };
        },
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  linha = {
    id: PEDIDO,
    user_id: USUARIO.id,
    total: 37.27,
    status: "pending",
    payment_status: "aguardando",
    gateway_payment_id: null,
    metodo_online: "credito",
    parcelas: null,
    expires_at: "2999-01-01T00:00:00Z",
  };
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.useFakeTimers();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  localStorage.clear();
  sessionStorage.clear();
  receberAtualizacao = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function abrirCheckout(retomadaDaRecarga = false) {
  const { CheckoutView } = await import("@/views/customer/CheckoutView");
  await act(async () => {
    raiz.render(
      <CheckoutView
        onNavigate={vi.fn()}
        onSetBackOverride={vi.fn()}
        retomarPedidoId={PEDIDO}
        retomadaDaRecarga={retomadaDaRecarga}
      />,
    );
  });
}

function confirmar(
  metodo: string,
  parcelas: number | null,
  foraDoPrazo = false,
) {
  linha = {
    ...linha,
    status: foraDoPrazo ? "cancelled" : "pending",
    payment_status: foraDoPrazo ? "pago_apos_expirar" : "pago",
    metodo_online: metodo,
    parcelas,
  };
}

function textoDaConfirmacao() {
  expect(hospedeiro.textContent).toContain("Pagamento Confirmado!");
  return hospedeiro.textContent?.replace(/\s+/g, " ");
}

it.each(["ao vivo", "consulta periódica", "recarga"])(
  "mostra total do pedido e aviso de juros no crédito parcelado (%s)",
  async (origem) => {
    if (origem === "recarga") {
      confirmar("credito", 2);
      await abrirCheckout(true);
    } else {
      await abrirCheckout();
      expect(hospedeiro.textContent).toContain("Finalize o pagamento");
      confirmar("credito", 2);
      await act(async () => {
        if (origem === "ao vivo") {
          receberAtualizacao?.({ eventType: "UPDATE", new: linha });
        } else {
          await vi.advanceTimersByTimeAsync(10_000);
        }
      });
    }

    const texto = textoDaConfirmacao();
    expect(texto).toContain("Total do pedido: R$ 37,27");
    expect(texto).not.toContain("R$ 37,27 recebido");
    expect(texto).toContain(`Parcelado em 2x no cartão. ${AVISO_DE_JUROS}`);
  },
);

it.each([
  { metodo: "credito", parcelas: 1 },
  { metodo: "debito", parcelas: null },
  { metodo: "pix", parcelas: null },
])(
  "mantém o valor recebido para $metodo sem parcelamento",
  async ({ metodo, parcelas }) => {
    // O fluxo começa em cartão; o Pix aprovado não deve herdar esse rótulo.
    await abrirCheckout();
    confirmar(metodo, parcelas);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    const texto = textoDaConfirmacao();
    expect(texto).toContain("R$ 37,27 recebido");
    expect(texto).not.toContain(AVISO_DE_JUROS);
  },
);

it("avisa de juros eventuais sem inventar o número de parcelas", async () => {
  confirmar("credito", null);
  await abrirCheckout(true);

  const texto = textoDaConfirmacao();
  expect(texto).toContain("Total do pedido: R$ 37,27");
  expect(texto).toContain(AVISO_DE_JUROS);
  expect(texto).not.toContain("Parcelado em");
});

function textoDoPagamentoForaDoPrazo() {
  const texto = hospedeiro.textContent?.replace(/\s+/g, " ");
  expect(texto).toContain(
    "Recebemos seu pagamento, mas o prazo de reserva venceu. A loja vai te contatar em breve para confirmar ou devolver o valor.",
  );
  return texto;
}

it.each(["ao vivo", "consulta periódica", "recarga"])(
  "mostra total e juros quando o crédito parcelado é aprovado fora do prazo (%s)",
  async (origem) => {
    if (origem === "recarga") {
      confirmar("credito", 2, true);
      await abrirCheckout(true);
    } else {
      await abrirCheckout();
      expect(hospedeiro.textContent).toContain("Finalize o pagamento");
      confirmar("credito", 2, true);
      await act(async () => {
        if (origem === "ao vivo") {
          receberAtualizacao?.({ eventType: "UPDATE", new: linha });
        } else {
          await vi.advanceTimersByTimeAsync(10_000);
        }
      });
    }

    const texto = textoDoPagamentoForaDoPrazo();
    expect(texto).toContain("Total do pedido: R$ 37,27");
    expect(texto).not.toContain("R$ 37,27 recebido");
    expect(texto).toContain(`Parcelado em 2x no cartão. ${AVISO_DE_JUROS}`);
  },
);

it("avisa de juros eventuais no crédito tardio sem número de parcelas", async () => {
  confirmar("credito", null, true);
  await abrirCheckout(true);

  const texto = textoDoPagamentoForaDoPrazo();
  expect(texto).toContain("Total do pedido: R$ 37,27");
  expect(texto).toContain(AVISO_DE_JUROS);
  expect(texto).not.toContain("Parcelado em");
});

it.each([
  { metodo: "credito", parcelas: 1 },
  { metodo: "debito", parcelas: null },
  { metodo: "pix", parcelas: null },
])(
  "mantém o valor recebido para $metodo fora do prazo sem parcelamento",
  async ({ metodo, parcelas }) => {
    confirmar(metodo, parcelas, true);
    await abrirCheckout(true);

    const texto = textoDoPagamentoForaDoPrazo();
    expect(texto).toContain("R$ 37,27 recebido");
    expect(texto).not.toContain(AVISO_DE_JUROS);
  },
);
