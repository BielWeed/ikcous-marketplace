// @vitest-environment jsdom
//
// O bloco "Comprar como Convidado" do carrinho só promete o que vale (lote 238,
// caça 11-D #3).
//
// DEFEITO MEDIDO: o texto dizia a todo visitante "Finalize sua compra
// instantaneamente sem precisar criar senha ou cadastro". É falso: numa loja
// sem nenhuma forma de pagamento na entrega/retirada o pedido só fecha pagando
// pelo app, e isso exige conta (política P6, aviso do painel "precisa ter conta
// para isso"); e fora da cidade a entrega também exige conta. O visitante
// preenchia nome, WhatsApp e CEP e só no fim achava o botão travado.
//
// Render de verdade (react-dom/client + jsdom), medindo o texto NA ÁRVORE.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem } from "@/types";

const itemNoCarrinho: CartItem = {
  product: {
    id: "prod-1",
    name: "Blusa Teste",
    description: "",
    price: 100,
    images: [],
    category: "Roupas",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  },
  quantity: 1,
};

// A fábrica roda no momento do import (dentro de cada `it`), e `useStore` é
// chamada no render — o valor corrente de `configDaLoja` é o da vez.
let configDaLoja: {
  shippingFee: number;
  freeShippingMin: number;
  formasPagamentoEntrega: ("pix" | "card" | "cash")[];
} = {
  shippingFee: 10,
  freeShippingMin: 0,
  formasPagamentoEntrega: ["pix", "card", "cash"],
};

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configDaLoja }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ getFreeShippingEligibleProducts: () => [] }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [itemNoCarrinho],
    shippingFee: 10,
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    selectedShippingOption: null,
    setSelectedShippingOption: vi.fn(),
    setShippingCep: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ fetchUserOrders: vi.fn().mockResolvedValue([]) }),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// cart-view-promessas-que-a-loja-nao-cumpre.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CartView — o convidado só lê promessa que vale", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    configDaLoja = {
      shippingFee: 10,
      freeShippingMin: 0,
      formasPagamentoEntrega: ["pix", "card", "cash"],
    };
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

  async function renderizarCarrinho() {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    return hospedeiro.textContent ?? "";
  }

  it("loja com pagamento na entrega: não jura 'sem cadastro'; diz que muitas compras dispensam conta e que avisa antes de finalizar", async () => {
    const texto = await renderizarCarrinho();

    // Âncora: o bloco montou.
    expect(texto).toContain("Continuar como Convidado");

    expect(texto).not.toContain("sem precisar criar senha");
    expect(texto).not.toContain("instantaneamente");
    expect(texto).toContain("Você pode comprar como visitante em muitos casos");
    expect(texto).toContain("avisamos antes de finalizar");
  });

  it("loja que só recebe pelo app (nenhuma forma na entrega): diz a verdade — é preciso entrar na conta", async () => {
    configDaLoja = {
      shippingFee: 10,
      freeShippingMin: 0,
      formasPagamentoEntrega: [],
    };
    const texto = await renderizarCarrinho();

    expect(texto).toContain("Continuar como Convidado");

    expect(texto).not.toContain("sem precisar criar senha");
    expect(texto).not.toContain("em muitos casos");
    expect(texto).toContain("o pagamento é feito pelo app");
    expect(texto).toContain("entrar na sua conta");
  });

  it("loja com só UMA forma na entrega ligada: ainda é a frase de 'muitos casos', não a de só-app", async () => {
    configDaLoja = {
      shippingFee: 10,
      freeShippingMin: 0,
      formasPagamentoEntrega: ["cash"],
    };
    const texto = await renderizarCarrinho();

    expect(texto).toContain("Você pode comprar como visitante em muitos casos");
    expect(texto).not.toContain("o pagamento é feito pelo app");
  });
});
