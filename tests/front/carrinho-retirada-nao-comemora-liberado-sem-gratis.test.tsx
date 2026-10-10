// @vitest-environment jsdom
//
// MENOR (revisão Opus, pós-T3, 23/09/2026): a retirada na loja
// (`store-pickup`) SEMPRE chega a R$ 0 da edge — o preço zero dela não é a
// promessa da loja tendo batido (ver `precoFinalDaOpcao`,
// estrategias-de-frete.ts: a regra local aplicada a um preço já 0 continua
// 0, com QUALQUER preset). Sem a guarda em CartView.tsx (o argumento que a
// tela passa para `deveExibirMetaDeFreteGratis`), uma loja com o grátis
// DESLIGADO ainda comemorava "Frete Grátis Liberado" assim que a cliente
// escolhia retirar — a mesma família de bug de
// carrinho-nao-anuncia-meta-de-frete-gratis-desligado.test.tsx, mas pela
// via da RETIRADA em vez do preset puro.
//
// ARQUIVO SEPARADO de propósito: um `vi.mock` de `ShippingProgress` aqui
// (necessário para medir SE ela monta, sem arrastar toda a árvore de
// progresso) substituiria o módulo REAL no arquivo irmão também, se
// estivesse no mesmo arquivo — os dois testes de
// "ShippingProgress — rede de segurança" dele fazem RENDER DE VERDADE do
// componente e quebrariam com o dublê.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estadoDoCarrinho = vi.hoisted(() => ({
  freteGratis: true,
  selectedShippingOption: { id: "store-pickup", name: "Retirar na loja" } as {
    id: string;
    name: string;
  } | null,
  freeShippingMin: 0,
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingFee: 10,
      freeShippingMin: estadoDoCarrinho.freeShippingMin,
    },
  }),
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
    freteGratis: estadoDoCarrinho.freteGratis,
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    selectedShippingOption: estadoDoCarrinho.selectedShippingOption,
    setSelectedShippingOption: vi.fn(),
    shippingCep: null,
    setShippingCep: vi.fn(),
    enderecoSelecionadoId: null,
    setEnderecoSelecionadoId: vi.fn(),
  }),
}));

// `orders: []` é o que falta para o `useMemo` de contadores de aba
// (CartView.tsx, `activeOrdersCount`/`historyOrdersCount`) não quebrar em
// `.forEach` de `undefined` — o dublê de cart-view-promessas-que-a-loja-nao-
// cumpre.test.tsx passa `user: null` e por isso nunca chega nesse `useMemo`
// com o usuário logado; aqui a cliente está logada de propósito.
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// tests/front/cart-view-promessas-que-a-loja-nao-cumpre.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CartView — retirada na loja não comemora 'Liberado' quando a loja não configurou grátis nenhum", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estadoDoCarrinho.freteGratis = true;
    estadoDoCarrinho.selectedShippingOption = {
      id: "store-pickup",
      name: "Retirar na loja",
    };
    estadoDoCarrinho.freeShippingMin = 0; // desligado
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
  }

  it("retirada escolhida + grátis DESLIGADO: nunca monta o cartão de progresso ('Liberado')", async () => {
    await renderizarCarrinho();

    expect(hospedeiro.querySelector('[data-testid="progresso"]')).toBeNull();
  });

  it("controle positivo: entrega local escolhida + preset 'sempre' (a loja tem um grátis real): o cartão continua aparecendo", async () => {
    estadoDoCarrinho.selectedShippingOption = {
      id: "local-delivery",
      name: "Entrega Local",
    };
    estadoDoCarrinho.freeShippingMin = 0.01; // sentinela "sempre"
    await renderizarCarrinho();

    expect(
      hospedeiro.querySelector('[data-testid="progresso"]'),
    ).not.toBeNull();
  });
});
