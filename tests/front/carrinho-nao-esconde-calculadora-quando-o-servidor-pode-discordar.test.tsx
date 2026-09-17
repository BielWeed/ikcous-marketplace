// @vitest-environment jsdom
//
// CartView-495: o carrinho escondia a `ShippingCalculator` sempre que
// `freteGratis` (o veredito do CartContext) dava `true` — inclusive no
// preset "por_produto", cujo `freteGratis` lê o SNAPSHOT do carrinho
// (`item.product.freeShipping`, gravado no carrinho/localStorage), NÃO o
// banco. A RPC do pedido lê `produtos.frete_gratis` FRESCO na hora de
// fechar (supabase/migrations/20261081000000..., linhas 294-318) e, quando
// discorda do snapshot, recusa o pedido com "Escolha uma opção de entrega
// antes de finalizar o pedido." (linhas 324-326) — instrução impossível de
// cumprir, porque esta tela escondeu a calculadora assim que achou que era
// grátis e o cliente nunca teve como escolher nada.
//
// Correção: a calculadora fica montada mesmo com `freteGratis=true`. Ela já
// sabe se rotular sozinha como GRÁTIS (o próprio `ShippingCalculator` lê o
// MESMO veredito `freteGratis` do CartContext via `useCartState`, provado em
// shipping-calculator-frete-gratis-fonte-unica.test.tsx) — então sempre
// existe um `shipping_option_id` pronto para mandar quando o servidor
// discordar do que o carrinho achava.
//
// POR QUE O DUBLÊ DE ShippingCalculator: o que este arquivo prova é que o
// CartView MONTA o componente — não o que a calculadora desenha por dentro
// (isso já é coberto pelo teste citado acima). Mesmo padrão de
// cart-view-promessas-que-a-loja-nao-cumpre.test.tsx: os subcomponentes são
// dublês simples para manter a prova sobre a árvore do CartView, sem
// arrastar Supabase/Web Worker/cotação de frete para dentro dela.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem } from "@/types";

const itemMarcadoFreteGratis: CartItem = {
  product: {
    id: "prod-1",
    name: "Produto com frete grátis marcado",
    description: "",
    price: 100,
    images: [],
    category: "Roupas",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: true,
    createdAt: new Date(0).toISOString(),
  },
  quantity: 1,
};

// Estado mutável POR TESTE, lido pelo dublê de `useCart` abaixo a cada
// chamada (a fábrica do `vi.mock` roda de novo a cada render).
let freteGratisDoContexto = true;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    // Sentinela -1 = preset "por_produto" (FRETE_GRATIS_POR_PRODUTO,
    // presets-de-frete-gratis.ts) — exatamente o preset cujo `freteGratis`
    // lê a marcação do PRODUTO NO SNAPSHOT do carrinho, não o banco.
    config: { shippingFee: 10, freeShippingMin: -1 },
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ getFreeShippingEligibleProducts: () => [] }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [itemMarcadoFreteGratis],
    shippingFee: 0,
    freteIndefinido: false,
    freteGratis: freteGratisDoContexto,
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
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

// Dublê que só prova SE o CartView montou o componente — a asserção é sobre
// a árvore do CartView, não sobre o que a calculadora desenha por dentro
// (ver cabeçalho do arquivo).
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => <div data-testid="calculadora-de-frete" />,
}));
vi.mock("@/components/ui/custom/ShippingProgress", () => ({
  ShippingProgress: () => <div data-testid="progresso" />,
}));
vi.mock("@/components/ui/custom/CartItemsList", () => ({
  CartItemsList: () => <div data-testid="itens" />,
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

describe("CartView — a calculadora de frete não some quando o carrinho ACHA que é grátis", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    freteGratisDoContexto = true;
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
    return hospedeiro;
  }

  it("freteGratis=true (preset por_produto, snapshot do carrinho): a calculadora continua montada", async () => {
    freteGratisDoContexto = true;
    const raizDom = await renderizarCarrinho();

    // Âncora: sem ela, a asserção abaixo passaria mesmo com a tela em branco.
    expect(raizDom.textContent).toContain("Finalizar Compra");

    // Se a calculadora sumir daqui, o cliente chega ao Finalizar sem
    // `shipping_option_id` — e se o servidor discordar do snapshot (o
    // produto deixou de estar marcado no banco), a RPC recusa pedindo uma
    // opção que esta tela nunca ofereceu
    // (supabase/migrations/20261081000000...:315-326).
    expect(
      raizDom.querySelector('[data-testid="calculadora-de-frete"]'),
    ).not.toBeNull();
  });

  it("freteGratis=false: a calculadora continua montada (comportamento que já existia)", async () => {
    freteGratisDoContexto = false;
    const raizDom = await renderizarCarrinho();

    expect(
      raizDom.querySelector('[data-testid="calculadora-de-frete"]'),
    ).not.toBeNull();
  });
});
