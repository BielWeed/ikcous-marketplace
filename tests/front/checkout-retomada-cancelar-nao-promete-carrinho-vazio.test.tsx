// @vitest-environment jsdom
//
// Quem volta para PAGAR um pedido depois (Perfil -> pedido -> "Retomar
// pagamento", ou recarregou a página) e vê o pagamento falhar encontrava o
// botão "Cancelar pedido e voltar ao carrinho". Mas a lista de itens que ele
// devolve ao carrinho só é preenchida quando o pedido NASCE nesta tela
// (handleSubmitEvent) — na retomada ela está vazia, o cancelamento percorria
// uma lista vazia e a cliente chegava a um carrinho VAZIO depois de o botão
// prometer "voltar ao carrinho".
//
// A saída mínima e honesta: sem itens para devolver, o botão diz só "Cancelar
// pedido". (Ler os itens do pedido e recolocá-los no carrinho é outra peça —
// produto que saiu da vitrine voltaria ao carrinho.)
//
// Harness copiado de checkout-retomada-metodo-atrasado.test.tsx (retomada com
// leitura do pedido) e checkout-view-cancelar-pagamento-falho.test.tsx
// (a tela de erro do pagamento e o cancelamento).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateOrderStatus = vi.fn();
// Referências ESTÁVEIS por fora dos mocks: literal novo a cada render muda de
// identidade e põe efeitos do CheckoutView em loop (mesma nota de
// checkout-chave-de-idempotencia-muda-com-o-eixo-do-pagamento.test.tsx).
const configDaLoja = {
  shippingCoverage: "local",
  originCep: "38500-000",
  enableCoupons: false,
  whatsappNumber: "34999998888",
};
const nenhumEndereco: unknown[] = [];
const usuarioLogado = { id: "user-1" };
const carrinhoVazio: unknown[] = [];
const addToCart = vi.fn();
const onNavigate = vi.fn();

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: configDaLoja,
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: nenhumEndereco,
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioLogado, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: carrinhoVazio,
      cartTotal: 0,
      shippingFee: 0,
      clearCart: () => {},
      addToCart: (...args: unknown[]) => addToCart(...args),
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
    useOrders: () => ({ createOrder: vi.fn(), updateOrderStatus }),
  };
});

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: { total: 149.9, metodo_online: "pix" },
              error: null,
            }),
          single: () =>
            Promise.resolve({
              data: {
                status: "cancelled",
                payment_status: "aguardando",
                expires_at: null,
              },
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

const aoErrarOPagamento: Array<
  (msg: string, categoria: "recuperavel" | "terminal") => void
> = [];
vi.mock("@/components/checkout/PagamentoOnline", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/checkout/PagamentoOnline")
  >()),
  PagamentoOnline: (props: {
    onErro: (msg: string, categoria: "recuperavel" | "terminal") => void;
  }) => {
    aoErrarOPagamento.push(props.onErro);
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

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function botaoQueComeca(texto: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.trim().startsWith(texto),
  ) as HTMLButtonElement | undefined;
}

describe("CheckoutView — retomar pagamento e cancelar: o botão não promete um carrinho que não vai ter itens", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    aoErrarOPagamento.length = 0;
    updateOrderStatus.mockReset();
    updateOrderStatus.mockResolvedValue(undefined);
    addToCart.mockReset();
    onNavigate.mockReset();
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

  async function retomarEFalharOPagamento() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={() => {}}
          retomarPedidoId="ped-777"
        />,
      );
    });
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await esperarMicrotarefas();
      });
    }
    expect(aoErrarOPagamento.length).toBeGreaterThan(0);
    await act(async () => {
      aoErrarOPagamento[0](
        "Este pagamento foi recusado e não pode ser tentado novamente.",
        "terminal",
      );
    });
  }

  it("na retomada (lista de itens vazia) o botão diz só 'Cancelar pedido'", async () => {
    await retomarEFalharOPagamento();

    const botao = botaoQueComeca("Cancelar pedido");
    expect(botao).toBeDefined();
    expect(botao!.textContent).not.toContain("voltar ao carrinho");
  });

  it("cancelar na retomada cancela o pedido e NÃO inventa item no carrinho", async () => {
    await retomarEFalharOPagamento();

    await act(async () => {
      botaoQueComeca("Cancelar pedido")!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(updateOrderStatus).toHaveBeenCalledWith(
      "ped-777",
      "cancelled",
      undefined,
      true,
    );
    expect(addToCart).not.toHaveBeenCalled();
  });
});
