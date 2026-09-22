// @vitest-environment jsdom
//
// O carrinho deriva o destino da calculadora do ENDEREÇO CADASTRADO — via
// `useAddresses` REAL, com o fetch do próprio carrinho: sem cache no
// navegador o CEP ainda chega (busca no banco) e, trocando de conta, a
// lista da conta anterior não vira destino da conta nova.
//
// CartView inteira montada (createRoot + act, padrão da casa), dublês
// ESTÁVEIS entre renders (objetos/funções criados uma vez) e o Supabase
// dublê servindo tanto a busca de endereços quanto a cotação de frete.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product } from "@/types";

const { conta, filaDeBusca, dubleCarrinho, invokeCalc } = vi.hoisted(() => {
  const produto: Product = {
    id: "prod-1",
    name: "Blusa Teste",
    description: "",
    price: 128.25,
    images: [],
    category: "Roupas",
    stock: 50,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
  const item: CartItem[] = [{ product: produto, quantity: 2 }];

  return {
    conta: {
      usuario: { id: "conta-a", user_metadata: { name: "Cliente A" } },
    },
    filaDeBusca: [] as Array<{ data: unknown[]; error: null }>,
    dubleCarrinho: {
      cart: item,
      cartTotal: 256.5,
      shippingFee: 0,
      cartCount: 2,
      isLoading: false,
      freteIndefinido: false,
      freteGratis: false,
      selectedShippingOption: null,
      shippingCep: null,
      enderecoSelecionadoId: null,
      updateQuantity: vi.fn(),
      removeFromCart: vi.fn(),
      clearCart: vi.fn(),
      addToCart: vi.fn(),
      getCartTotal: vi.fn(() => 256.5),
      getCartCount: vi.fn(() => 2),
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
      setEnderecoSelecionadoId: vi.fn(),
    },
    invokeCalc: vi.fn(),
  };
});

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
      freeShippingMin: 0,
      enableCoupons: false,
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    getFreeShippingEligibleProducts: vi.fn(() => []),
  }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => dubleCarrinho,
}));

// A ShippingCalculator lê o veredito de grátis direto do contexto.
vi.mock("@/contexts/CartContext", () => ({
  useCartState: () => ({ freteGratis: dubleCarrinho.freteGratis }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    fetchUserOrders: vi.fn(async () => {}),
    orders: [],
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: conta.usuario, profile: null, loading: false }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeCalc(...args) },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            order: () => {
              const proximo = filaDeBusca.shift() ?? { data: [], error: null };
              return Promise.resolve(proximo);
            },
          }),
        }),
      }),
    }),
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ENDERECO_B_NO_BANCO = {
  id: "end-b",
  user_id: "conta-b",
  name: "Casa",
  recipient_name: "Cliente B",
  cep: "38500-000",
  street: "Rua Principal",
  number: "100",
  complement: "",
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: "",
  is_default: true,
};

describe("CartView — o destino da calculadora é o endereço cadastrado (useAddresses real)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    conta.usuario = { id: "conta-a", user_metadata: { name: "Cliente A" } };
    filaDeBusca.length = 0;
    invokeCalc.mockReset();
    invokeCalc.mockResolvedValue({
      data: {
        options: [
          {
            id: "eco",
            name: "Econômico",
            price: 12.34,
            deliveryDays: 4,
            provider: "melhor_envio",
          },
        ],
      },
      error: null,
    });
    armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
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

  function campoCep(): HTMLInputElement {
    return document.getElementById(
      "shipping-calculator-cep",
    ) as HTMLInputElement;
  }

  async function montarCarrinho() {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={vi.fn()} />);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  async function trocarConta(id: string) {
    const { CartView } = await import("@/views/customer/CartView");
    conta.usuario = { id, user_metadata: { name: `Cliente ${id}` } };
    await act(async () => {
      raiz.render(<CartView onNavigate={vi.fn()} />);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  it("sem cache no navegador: o fetch do próprio carrinho traz o endereço e o campo/recotação seguem o CEP dele", async () => {
    // Nada no localStorage: nem CEP antigo, nem cache de endereços.
    filaDeBusca.push({ data: [ENDERECO_B_NO_BANCO], error: null });

    await montarCarrinho();

    expect(campoCep().value).toBe("38500-000");
    expect(invokeCalc).toHaveBeenCalledTimes(1);
    const corpo = invokeCalc.mock.calls[0][1] as { body: { cep: string } };
    expect(corpo.body.cep).toBe("38500000");
  });

  it("troca de conta: a lista/endereço da conta anterior não vira destino da conta nova", async () => {
    // Conta A com endereço no CACHE (07095-005); banco devolve vazio para A.
    armazem.set(
      "ikcous_addresses_cache_conta-a",
      JSON.stringify([
        {
          id: "end-a",
          user_id: "conta-a",
          cep: "07095-005",
          is_default: true,
        },
      ]),
    );
    filaDeBusca.push({ data: [], error: null });

    await montarCarrinho();
    expect(campoCep().value).toBe("07095-005");
    const cotacoesDaContaA = invokeCalc.mock.calls.length;
    expect(cotacoesDaContaA).toBeGreaterThan(0);

    // Troca para a conta B (sem cache; o banco tem 38500-000). A cotação da
    // conta anterior não se repete; o destino converge para o endereço de B.
    filaDeBusca.push({ data: [ENDERECO_B_NO_BANCO], error: null });
    await trocarConta("conta-b");

    expect(campoCep().value).toBe("38500-000");
    const cotacoesAposTroca = invokeCalc.mock.calls.slice(cotacoesDaContaA);
    expect(cotacoesAposTroca).toHaveLength(1);
    const corpo = cotacoesAposTroca[0]?.[1] as { body: { cep: string } };
    expect(corpo.body.cep).toBe("38500000");
  });
});
