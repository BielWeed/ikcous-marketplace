// @vitest-environment jsdom
//
// A barra de frete do carrinho (CartView) decide "meta batida" comparando o
// subtotal com o mínimo do canal. Com 10.10 + 10.20 = 20.299999999999997 contra
// R$ 20,30, a meta ficava "não batida" por um resquício binário (16/10/2026).
//
// Duas camadas: a função pura `estadoDaBarraDeFrete` e a CartView inteira com
// retirada escolhida (o ramo `retiradaComMetaNaoBatida`, dentro do useMemo,
// que só a tela alcança).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Importar a CartView arrasta `@/lib/supabase` — mesmo mock dos testes irmãos.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
// A CartView lê os endereços da cliente; sem este mock o hook real chama
// `supabase.from` (inexistente acima), cai no catch e polui o console.
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: async () => {},
    loading: false,
  }),
}));

import { estadoDaBarraDeFrete } from "@/views/customer/CartView";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SOMA_QUE_ERRA = 10.1 + 10.2;

describe("estadoDaBarraDeFrete — meta por valor em centavos", () => {
  const base = {
    freteGratis: false,
    ehRetirada: false,
    estrategiaDoCanal: "acima_de_valor" as const,
    minimoDoCanal: 20.3,
    nationalBenefitScope: "todas" as const,
    precoDaOpcaoEscolhida: 10,
  };

  it("subtotal 10.10 + 10.20, meta 20.30, opção ainda cobra: meta BATIDA -> 'meta_atingida_sem_gratis'", () => {
    expect(estadoDaBarraDeFrete({ ...base, subtotal: SOMA_QUE_ERRA })).toBe(
      "meta_atingida_sem_gratis",
    );
  });

  it("valor exato (20.30): meta batida", () => {
    expect(estadoDaBarraDeFrete({ ...base, subtotal: 20.3 })).toBe(
      "meta_atingida_sem_gratis",
    );
  });

  it("CONTROLE: um centavo abaixo (20.29): continua 'meta'", () => {
    expect(estadoDaBarraDeFrete({ ...base, subtotal: 20.29 })).toBe("meta");
  });

  it("retirada com meta batida pela soma que erra: 'liberado' (a entrega sairia grátis)", () => {
    expect(
      estadoDaBarraDeFrete({
        ...base,
        freteGratis: true,
        ehRetirada: true,
        precoDaOpcaoEscolhida: 0,
        subtotal: SOMA_QUE_ERRA,
      }),
    ).toBe("liberado");
  });

  it("CONTROLE: retirada, um centavo abaixo: 'meta'", () => {
    expect(
      estadoDaBarraDeFrete({
        ...base,
        freteGratis: true,
        ehRetirada: true,
        precoDaOpcaoEscolhida: 0,
        subtotal: 20.29,
      }),
    ).toBe("meta");
  });
});

// ───────────────────────────────────────────────────────────────────────
// A CartView inteira: carrinho com DOIS itens (10.10 e 10.20), retirada.
// ───────────────────────────────────────────────────────────────────────
const estadoDoCarrinho = vi.hoisted(() => ({
  precos: [10.1, 10.2] as number[],
  config: {
    shippingFee: 10,
    freeShippingMin: 20.3,
    nationalShippingStrategy: "desligado" as const,
    nationalShippingMin: 0,
    nationalDiscountType: null as "percentual" | "fixo" | null,
    nationalDiscountValue: 0,
    nationalBenefitScope: "todas" as "mais_barata" | "todas",
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estadoDoCarrinho.config }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ getFreeShippingEligibleProducts: () => [] }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: estadoDoCarrinho.precos.map((preco, i) => ({
      product: {
        id: `prod-${i}`,
        name: `Produto ${i}`,
        description: "",
        price: preco,
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
    })),
    shippingFee: 0,
    freteIndefinido: false,
    // Retirada sempre chega com preço 0 da edge.
    freteGratis: true,
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    selectedShippingOption: {
      id: "store-pickup",
      name: "Retirar na loja",
      price: 0,
    },
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

describe("CartView — retirada escolhida, meta de R$ 20,30, itens 10.10 + 10.20", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  function textoDoCorpo(): string {
    return (hospedeiro.textContent ?? "").replaceAll(
      String.fromCharCode(160),
      " ",
    );
  }

  async function renderizarCarrinho() {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("meta batida pela soma que erra: 'Frete Grátis Liberado', sem 'Faltam'", async () => {
    estadoDoCarrinho.precos = [10.1, 10.2];

    await renderizarCarrinho();

    const texto = textoDoCorpo();
    expect(texto).toContain("Frete Grátis Liberado");
    expect(texto).not.toContain("Faltam");
  });

  it("CONTROLE: um centavo abaixo (10.10 + 10.19): continua mostrando a meta, nunca 'Liberado'", async () => {
    estadoDoCarrinho.precos = [10.1, 10.19];

    await renderizarCarrinho();

    const texto = textoDoCorpo();
    expect(texto).not.toContain("Frete Grátis Liberado");
    expect(texto).toContain("Faltam");
  });
});
