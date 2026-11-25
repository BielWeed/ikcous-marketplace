// @vitest-environment jsdom
//
// Dois números da barra de frete grátis do carrinho que o teste de tela já
// existente (`carrinho-barra-de-frete-fala-da-opcao-escolhida.test.tsx`) não
// prendia com a precisão que o defeito pede. Cada um foi achado trocando a
// regra no `CartView` e vendo toda a vizinhança continuar verde:
//
//  1. RETIRADA com a meta ainda longe: o teste antigo conferia só que "Faltam"
//     e "R$ 50,00" apareciam em algum lugar da tela — e "R$ 50,00" é também o
//     valor do próprio produto, então o texto continuava passando mesmo com a
//     barra mostrando "100% · Faltam R$ 0,00" (o atalho do "frete grátis já
//     garantido" liberava a retirada, que sempre chega a R$ 0, como se a meta
//     tivesse sido batida). Aqui o que se lê é o par exato: 50% e Faltam R$ 50,00.
//  2. O aviso "quase lá" (barra âmbar) começa EM 70% da meta, não acima dela: com
//     R$ 70 de R$ 100 a cliente já vê o empurrão para completar o carrinho.
//
// A `ShippingProgress` não é dublê de propósito: o texto e a cor dela são o que
// se prova. Mesmo molde de `carrinho-barra-de-frete-fala-da-opcao-escolhida`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Importar a CartView arrasta `@/lib/supabase` (via AuthContext/useAddresses).
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { CartView } from "@/views/customer/CartView";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const estadoDoCarrinho = vi.hoisted(() => ({
  freteGratis: false,
  shippingFee: 12,
  selectedShippingOption: null as {
    id: string;
    name: string;
    price: number;
  } | null,
  produtoPreco: 50,
}));

const CONFIG_META_LOCAL_DE_100 = {
  shippingFee: 10,
  freeShippingMin: 100,
  nationalShippingStrategy: "desligado",
  nationalShippingMin: 0,
  nationalDiscountType: null,
  nationalDiscountValue: 0,
  nationalBenefitScope: "todas",
};

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: CONFIG_META_LOCAL_DE_100 }),
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
          price: estadoDoCarrinho.produtoPreco,
          images: [],
          category: "geral",
          stock: 500,
          sold: 0,
          isActive: true,
          isBestseller: false,
          freeShipping: false,
          createdAt: new Date(0).toISOString(),
        },
        quantity: 1,
      },
    ],
    shippingFee: estadoDoCarrinho.shippingFee,
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

describe("CartView — números exatos da barra de frete grátis", () => {
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
    await act(async () => {
      raiz.render(<CartView onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("retirada escolhida, meta de R$ 100 e produto de R$ 50: a barra diz 50% e Faltam R$ 50,00 (não 100% e R$ 0,00)", async () => {
    estadoDoCarrinho.freteGratis = true; // a retirada sempre chega a R$ 0
    estadoDoCarrinho.shippingFee = 0;
    estadoDoCarrinho.selectedShippingOption = {
      id: "store-pickup",
      name: "Retirar na loja",
      price: 0,
    };
    estadoDoCarrinho.produtoPreco = 50;

    await renderizarCarrinho();

    const texto = textoDoCorpo();
    expect(texto).toContain("Meta Frete Grátis");
    // O par colado da barra (o rodapé também diz "100% seguro", por isso não se
    // procura "100%" solto).
    expect(texto).toMatch(/50%\s*Faltam\s*R\$\s*50,00/);
    expect(texto).not.toMatch(/Faltam\s*R\$\s*0,00/);
    expect(texto).not.toMatch(/100%\s*Faltam/);
  });

  describe("o aviso 'quase lá' (barra âmbar) da entrega local", () => {
    function barraAmbar() {
      // Só a BARRA (um div): o marcador do recado "Adicione mais R$ X" também é âmbar.
      return hospedeiro.querySelector("div.rounded-full.bg-amber-500");
    }

    beforeEach(() => {
      estadoDoCarrinho.freteGratis = false;
      estadoDoCarrinho.shippingFee = 12;
      estadoDoCarrinho.selectedShippingOption = {
        id: "local-delivery",
        name: "Entrega Local",
        price: 12,
      };
    });

    it("com 70% da meta (R$ 70 de R$ 100) a barra já fica âmbar", async () => {
      estadoDoCarrinho.produtoPreco = 70;

      await renderizarCarrinho();

      expect(textoDoCorpo()).toContain("70%");
      expect(barraAmbar()).not.toBeNull();
    });

    it("com 69% da meta ainda não é 'quase lá'", async () => {
      estadoDoCarrinho.produtoPreco = 69;

      await renderizarCarrinho();

      expect(textoDoCorpo()).toContain("69%");
      expect(barraAmbar()).toBeNull();
    });

    it("com a meta batida (R$ 100) deixa de ser 'quase lá'", async () => {
      estadoDoCarrinho.produtoPreco = 100;

      await renderizarCarrinho();

      expect(barraAmbar()).toBeNull();
    });
  });
});
