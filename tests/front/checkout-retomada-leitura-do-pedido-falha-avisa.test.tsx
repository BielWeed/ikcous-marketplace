// @vitest-environment jsdom
//
// F4 (fase 3 dos pagamentos, 04/10/2026) — "Retomar pagamento" que não
// consegue LER o pedido.
//
// Antes: o efeito de retomada ignorava `error`, não tinha tempo limite e, sem
// dados, não fazia nada — o cliente que tocou em "Retomar pagamento" caía num
// checkout de carrinho VAZIO, calado, sem saber que o pedido existe. Agora a
// leitura que falha (erro, estouro de tempo, pedido que não volta por RLS)
// mostra uma mensagem com "Tentar de novo" e "Ver meus pedidos". NADA monta
// pagamento nem chama a edge sem a leitura: quem decide a forma e o valor é o
// pedido lido.
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
const { lerPedido } = vi.hoisted(() => ({ lerPedido: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => lerPedido(),
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

describe("CheckoutView — retomada cuja leitura do pedido falha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn();

  beforeEach(() => {
    lerPedido.mockReset();
    onNavigate.mockReset();
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
    vi.unstubAllGlobals();
  });

  async function esvaziar() {
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  async function renderizar() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={() => {}}
          retomarPedidoId={PEDIDO}
        />,
      );
    });
    await esvaziar();
  }

  const botoes = () =>
    Array.from(hospedeiro.querySelectorAll("button")).map((b) =>
      (b.textContent ?? "").trim(),
    );
  const botao = (rotulo: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === rotulo,
    ) as HTMLButtonElement | undefined;
  const texto = () => hospedeiro.textContent ?? "";

  /** O que a tela de falha NUNCA pode ter: pagamento montado ou checkout vazio. */
  function semPagamentoNemCheckoutVazio() {
    expect(propsCapturadasDoPagamento).toBeNull();
    expect(texto()).not.toContain("Finalize o pagamento");
    expect(botoes()).not.toContain("Cancelar pedido");
  }

  it("erro da leitura (rede, 5xx): mensagem na tela com 'Tentar de novo' e 'Ver meus pedidos' — nada de checkout vazio", async () => {
    lerPedido.mockResolvedValue({
      data: null,
      error: { message: "FetchError: Failed to fetch" },
    });
    await renderizar();

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Não foi possível abrir o pagamento deste pedido agora.",
    );
    expect(botoes()).toEqual(["Tentar de novo", "Ver meus pedidos"]);
    semPagamentoNemCheckoutVazio();
  });

  it("pedido que não volta (data nula SEM erro — não existe ou RLS não deixa ler): também avisa, em vez de cair calado", async () => {
    lerPedido.mockResolvedValue({ data: null, error: null });
    await renderizar();

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Não foi possível abrir o pagamento deste pedido agora.",
    );
    expect(botoes()).toEqual(["Tentar de novo", "Ver meus pedidos"]);
    semPagamentoNemCheckoutVazio();
  });

  it("leitura que rejeita (exceção da rede): mesma tela, sem rejeição solta", async () => {
    lerPedido.mockRejectedValue(new Error("rede caiu"));
    await renderizar();

    expect(botoes()).toEqual(["Tentar de novo", "Ver meus pedidos"]);
    semPagamentoNemCheckoutVazio();
  });

  it("leitura que nunca responde: depois do tempo limite a mensagem aparece (a tela não fica presa)", async () => {
    vi.useFakeTimers();
    lerPedido.mockReturnValue(new Promise(() => {}));
    await renderizar();
    // Ainda lendo (dentro do prazo): a mensagem de falha ainda não existe.
    expect(texto()).not.toContain("Não foi possível abrir o pagamento");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(botoes()).toEqual(["Tentar de novo", "Ver meus pedidos"]);
    semPagamentoNemCheckoutVazio();
  });

  it("'Tentar de novo' LÊ de novo, e com o pedido de volta monta o pagamento pelo valor do PEDIDO", async () => {
    lerPedido
      .mockResolvedValueOnce({ data: null, error: { message: "falhou" } })
      .mockResolvedValueOnce(PEDIDO_LIDO);
    await renderizar();
    expect(lerPedido).toHaveBeenCalledTimes(1);

    await act(async () => {
      botao("Tentar de novo")?.click();
    });
    await esvaziar();

    expect(lerPedido).toHaveBeenCalledTimes(2);
    expect(texto()).toContain("Finalize o pagamento");
    expect(propsCapturadasDoPagamento?.orderId).toBe(PEDIDO);
    expect(propsCapturadasDoPagamento?.valor).toBe(149.9);
    expect(texto()).not.toContain("Não foi possível abrir o pagamento");
  });

  it("'Tentar de novo' que falha DE NOVO volta à mensagem (sem laço automático: uma leitura por toque)", async () => {
    lerPedido.mockResolvedValue({ data: null, error: { message: "falhou" } });
    await renderizar();

    await act(async () => {
      botao("Tentar de novo")?.click();
    });
    await esvaziar();

    expect(lerPedido).toHaveBeenCalledTimes(2);
    expect(botoes()).toEqual(["Tentar de novo", "Ver meus pedidos"]);
    semPagamentoNemCheckoutVazio();
  });

  it("'Ver meus pedidos' leva à lista de pedidos", async () => {
    lerPedido.mockResolvedValue({ data: null, error: { message: "falhou" } });
    await renderizar();

    await act(async () => {
      botao("Ver meus pedidos")?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith("orders");
  });

  it("CONTROLE: leitura que dá certo continua indo direto ao pagamento, sem mensagem de falha", async () => {
    lerPedido.mockResolvedValue(PEDIDO_LIDO);
    await renderizar();

    expect(texto()).toContain("Finalize o pagamento");
    expect(propsCapturadasDoPagamento?.orderId).toBe(PEDIDO);
    expect(texto()).not.toContain("Não foi possível abrir o pagamento");
  });

  it("BORDA: a resposta que chega DEPOIS do estouro não monta pagamento por cima da mensagem", async () => {
    vi.useFakeTimers();
    let responder: (v: unknown) => void = () => {};
    lerPedido.mockReturnValue(
      new Promise((resolve) => {
        responder = resolve;
      }),
    );
    await renderizar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(botoes()).toEqual(["Tentar de novo", "Ver meus pedidos"]);

    await act(async () => {
      responder(PEDIDO_LIDO);
    });
    await esvaziar();

    // O cliente decide: a leitura atrasada não liga cobrança sozinha.
    expect(botoes()).toEqual(["Tentar de novo", "Ver meus pedidos"]);
    semPagamentoNemCheckoutVazio();
  });
});
