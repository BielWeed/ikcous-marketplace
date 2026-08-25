// @vitest-environment jsdom
//
// O bloco "Opções de Compra" do carrinho (visível para convidado com itens)
// não pode prometer o que a loja não cumpre — irmão do
// cart-view-promessas-que-a-loja-nao-cumpre.test.tsx, que prendeu os selos do
// rodapé e deixou este texto passar.
//
// Até 25/08/2026 o bloco dizia à convidada: "Faça login para salvar seus
// itens, acumular pontos e ativar o frete grátis (acima de R$ 0,00)". Dois
// problemas: (1) não existe programa de pontos em lugar nenhum do app; (2)
// com a regra de frete grátis DESLIGADA (freeShippingMin = 0 — "zero ou
// menos = regra desligada", ver regra-de-frete.ts), o login não ativa frete
// nenhum, e o texto ainda imprimia "(acima de R$ 0,00)". As outras peças do
// carrinho têm a guarda (FreeShippingBlock retorna null; CartReminder checa
// hasFreeShippingGoal; ShippingProgress só ativa com freeShippingMin > 0) —
// este bloco não tinha.
//
// Render de verdade (react-dom/client + jsdom), medindo o texto NA ÁRVORE
// renderizada, com a âncora provando que o bloco montou.
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
let configDaLoja: { shippingFee: number; freeShippingMin: number } = {
  shippingFee: 10,
  freeShippingMin: 0,
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

describe("CartView — bloco do convidado não promete pontos nem frete grátis desligado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    configDaLoja = { shippingFee: 10, freeShippingMin: 0 };
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

  it("com a regra DESLIGADA: não menciona frete grátis nem pontos — e o bloco montou", async () => {
    configDaLoja = { shippingFee: 10, freeShippingMin: 0 };
    const texto = await renderizarCarrinho();

    // Âncora: sem ela, as ausências abaixo passariam com o bloco inteiro
    // fora da árvore.
    expect(texto).toContain("Identificar-se e Entrar");
    expect(texto).toContain("Comprar como Convidado");

    expect(texto).not.toContain("acumular pontos");
    expect(texto).not.toContain("frete grátis");
  });

  it("com a regra LIGADA: a promessa de frete grátis aparece (com o valor de cima)", async () => {
    configDaLoja = { shippingFee: 10, freeShippingMin: 100 };
    const texto = await renderizarCarrinho();

    expect(texto).toContain("Identificar-se e Entrar");
    expect(texto).toContain("frete grátis");
    expect(texto).toContain("100,00");
  });
});
