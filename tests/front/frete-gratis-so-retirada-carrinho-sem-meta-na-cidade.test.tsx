// @vitest-environment jsdom
//
// A barra de progresso do carrinho (CartView) segue a promessa do CANAL da
// opção escolhida: retirada/entrega local leem a promessa LOCAL, transportadora
// lê a NACIONAL. Em loja "Só retirada" com transportadora, a regra local que
// sobrou de antes (ex.: grátis acima de R$ 150) não pode virar meta "na cidade"
// para quem escolheu retirar — a retirada já é grátis.
//
// ARQUIVO SEPARADO de propósito (mesmo motivo do
// carrinho-retirada-nao-comemora-liberado-sem-gratis.test.tsx): o dublê de
// `ShippingProgress` mede SE a barra monta, sem arrastar a árvore dela.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  opcao: { id: "store-pickup", name: "Retirar" } as {
    id: string;
    name: string;
  } | null,
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ getFreeShippingEligibleProducts: () => [] }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [
      {
        product: {
          id: "prod-1",
          name: "Produto Teste",
          description: "",
          price: 100,
          images: [],
          category: "geral",
          stock: 5,
          sold: 0,
          isActive: true,
          isBestseller: false,
          freeShipping: false,
          createdAt: new Date(0).toISOString(),
        },
        quantity: 1,
      },
    ],
    shippingFee: 0,
    freteIndefinido: false,
    freteGratis: false,
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    selectedShippingOption: estado.opcao,
    setSelectedShippingOption: vi.fn(),
    shippingCep: null,
    setShippingCep: vi.fn(),
    enderecoSelecionadoId: null,
    setEnderecoSelecionadoId: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [],
    fetchUserOrders: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));

vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));

vi.mock("@/components/ui/custom/CartItemsList", () => ({
  CartItemsList: () => <div data-testid="itens" />,
}));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => <div data-testid="calculadora" />,
}));
vi.mock("@/components/ui/custom/ShippingProgress", () => ({
  ShippingProgress: () => <div data-testid="progresso" />,
}));
vi.mock("@/components/ui/custom/CartFooterSummary", () => ({
  CartFooterSummary: () => <div data-testid="rodape" />,
}));
vi.mock("@/components/ui/custom/OrderList", () => ({
  OrderList: () => <div data-testid="pedidos" />,
}));
vi.mock("@/components/ui/custom/OrderSearch", () => ({
  OrderSearch: () => <div data-testid="busca-pedido" />,
}));
vi.mock("@/components/ui/custom/EmptyCart", () => ({
  EmptyCart: () => <div data-testid="carrinho-vazio" />,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Só retirada + transportadora ligada + nacional desligada + regra local sobrada. */
const SO_RETIRADA_COM_TRANSPORTADORA = {
  freeShippingMin: 150,
  localDeliveryEnabled: false,
  shippingCoverage: "national",
  enabledShippingMethods: ["sedex", "store-pickup"],
  nationalShippingStrategy: "desligado",
  nationalShippingMin: 0,
  nationalDiscountType: null,
  nationalDiscountValue: 0,
  nationalBenefitScope: "mais_barata",
};

describe("CartView — barra de frete grátis em loja 'Só retirada' com transportadora", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.config = { ...SO_RETIRADA_COM_TRANSPORTADORA };
    estado.opcao = { id: "store-pickup", name: "Retirar" };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function barra() {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    return hospedeiro.querySelector('[data-testid="progresso"]');
  }

  it("retirada escolhida + regra local sobrada de R$ 150: sem barra de meta", async () => {
    expect(await barra()).toBeNull();
  });

  it("controle: transportadora com a MESMA regra (legado) e retirada escolhida: a barra continua", async () => {
    const { nationalShippingStrategy: _a, ...semNacional } =
      SO_RETIRADA_COM_TRANSPORTADORA;
    estado.config = { ...semNacional };
    expect(await barra()).not.toBeNull();
  });

  it("controle: transportadora escolhida com a meta nacional de R$ 200: a barra aparece", async () => {
    estado.opcao = { id: "sedex", name: "Sedex" };
    estado.config = {
      ...estado.config,
      nationalShippingStrategy: "acima_de_valor",
      nationalShippingMin: 200,
    };
    expect(await barra()).not.toBeNull();
  });

  it("controle: loja que entrega na cidade + entrega local escolhida: a barra aparece", async () => {
    estado.opcao = { id: "local-delivery", name: "Entrega Local" };
    estado.config = {
      ...estado.config,
      localDeliveryEnabled: true,
      enabledShippingMethods: ["sedex"],
    };
    expect(await barra()).not.toBeNull();
  });
});
