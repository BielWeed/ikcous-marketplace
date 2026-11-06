// @vitest-environment jsdom
//
// Carrinho EXATAMENTE no limite do frete grátis, com uma opção de entrega que
// NÃO recebe o grátis (alcance "só na mais barata", cliente escolheu o SEDEX):
//
//   - 10,10 + 10,20 dá 20.299999999999997 em ponto flutuante, que é MENOR que
//     a meta 20,30. A barra e o "falta" da CartView comparavam em reais crus
//     (diferente de `atingiuOMinimo`, que o resto do app usa, em centavos) e
//     imprimiam "Adicione mais R$ 0,00 para garantir Frete Grátis!" e "99%"
//     ao lado de "Grátis só na mais barata".
//   - A correção compara em centavos inteiros, igual ao resto do app.
//
// Os limites que este arquivo prende: um centavo ABAIXO da meta (continua
// faltando R$ 0,01 e NÃO chega a 100%), exatamente NA meta (100%, nada falta) e
// uma soma que cai em ponto flutuante para cima da meta (nada falta também).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const estado = vi.hoisted(() => ({
  precos: [10.1, 10.2] as number[],
  meta: 20.3,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingFee: 10,
      freeShippingMin: 0,
      nationalShippingStrategy: "acima_de_valor",
      nationalShippingMin: estado.meta,
      nationalDiscountType: null,
      nationalDiscountValue: 0,
      nationalBenefitScope: "mais_barata",
    },
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ getFreeShippingEligibleProducts: () => [] }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: estado.precos.map((preco, i) => ({
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
    shippingFee: 45,
    freteIndefinido: false,
    freteGratis: false, // a opção escolhida (SEDEX) cobra
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    selectedShippingOption: {
      id: "melhor-envio-sedex",
      name: "Sedex",
      price: 45,
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
// ShippingProgress NÃO é dublê: é o "99%" dela que este arquivo prova.

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CartView — carrinho no limite do frete grátis, opção que não recebe o grátis", () => {
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

  // A tela tem outro "100%" ("Ambiente de pagamento 100% seguro"): o percentual
  // da barra é o que NÃO é seguido de " seguro".
  function percentualDaBarra(): string | null {
    return textoDoCorpo().match(/(\d+)%(?! seguro)/)?.[1] ?? null;
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

  it("10,10 + 10,20 com meta 20,30: nada falta — sem 'Adicione mais', sem 99%, barra cheia", async () => {
    estado.precos = [10.1, 10.2];
    estado.meta = 20.3;

    await renderizarCarrinho();

    const texto = textoDoCorpo();
    expect(texto).not.toContain("Adicione mais");
    expect(texto).not.toContain("R$ 0,00 para garantir");
    expect(percentualDaBarra()).toBe("100");
    expect(texto).toContain("mais barata");
  }, 30_000);

  it("um centavo ABAIXO da meta continua faltando R$ 0,01 e a barra não chega a 100%", async () => {
    estado.precos = [10.1, 10.19]; // 20,29 contra meta 20,30
    estado.meta = 20.3;

    await renderizarCarrinho();

    const texto = textoDoCorpo();
    expect(texto).toContain("Adicione mais");
    expect(texto).toContain("R$ 0,01");
    expect(percentualDaBarra()).toBe("99");
  });

  it("soma que cai ACIMA da meta em ponto flutuante (0,1 + 0,2 contra 0,3): nada falta", async () => {
    estado.precos = [0.1, 0.2]; // 0.30000000000000004 contra meta 0,30
    estado.meta = 0.3;

    await renderizarCarrinho();

    const texto = textoDoCorpo();
    expect(texto).not.toContain("Adicione mais");
    expect(percentualDaBarra()).toBe("100");
  });
});
