// @vitest-environment jsdom
//
// Caça 4 (24/10/2026), achado C5: com "Retirar na loja" escolhida, o resumo
// do carrinho no computador dizia "Frete GRÁTIS", "Bônus: Frete Grátis" e
// "Frete grátis aplicado" -- e o rodapé do celular dizia "Frete GRÁTIS" --
// mesmo em loja que desligou o frete grátis. A retirada chega com preço 0 da
// edge por natureza (não é promessa da loja). Agora, com retirada escolhida,
// os dois resumos dizem "Retirada na loja" e somem os selos e avisos de
// frete grátis. Entrega comum com grátis de verdade continua como era.
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

describe("CartView — retirada na loja não diz 'frete grátis' (C5)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estadoDoCarrinho.freteGratis = true;
    estadoDoCarrinho.selectedShippingOption = {
      id: "store-pickup",
      name: "Retirar na loja",
    };
    estadoDoCarrinho.freeShippingMin = 0;
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

  const resumoDoComputador = () =>
    Array.from(hospedeiro.querySelectorAll("h3"))
      .find((h) => h.textContent === "Resumo do Pedido")
      ?.closest(".sticky");
  const rodapeDoCelular = () =>
    document.querySelector(".bottom-docked-navigation");

  it("grátis DESLIGADO + retirada: resumo do computador diz 'Retirada na loja' e nada de frete grátis", async () => {
    await renderizarCarrinho();
    const resumo = resumoDoComputador();
    expect(resumo).toBeTruthy();
    const texto = resumo!.textContent ?? "";
    expect(texto).toContain("Retirada na loja");
    expect(texto).not.toContain("GRÁTIS");
    expect(texto).not.toMatch(/Frete Gr[aá]tis/i);
    expect(texto).not.toContain("Bônus");
    expect(texto).not.toContain("aplicado");
  });

  it("grátis DESLIGADO + retirada: o rodapé do celular diz 'Retirada na loja', não 'GRÁTIS'", async () => {
    await renderizarCarrinho();
    const texto = rodapeDoCelular()?.textContent ?? "";
    expect(texto).toContain("Retirada na loja");
    expect(texto).not.toContain("GRÁTIS");
  });

  it("borda: retirada com meta de valor NÃO batida: o aviso 'Adicione mais... Frete Grátis' também some", async () => {
    estadoDoCarrinho.freeShippingMin = 200; // subtotal é 100
    await renderizarCarrinho();
    const texto = resumoDoComputador()?.textContent ?? "";
    expect(texto).toContain("Retirada na loja");
    expect(texto).not.toContain("Adicione mais");
    expect(texto).not.toMatch(/Frete Gr[aá]tis/i);
  });

  it("controle: entrega local com grátis de verdade continua dizendo GRÁTIS, bônus e 'aplicado'", async () => {
    estadoDoCarrinho.selectedShippingOption = {
      id: "local-delivery",
      name: "Entrega Local",
    };
    estadoDoCarrinho.freeShippingMin = 0.01; // "sempre"
    await renderizarCarrinho();
    const texto = resumoDoComputador()?.textContent ?? "";
    expect(texto).toContain("GRÁTIS");
    expect(texto).toContain("Frete Grátis");
    expect(texto).toContain("Frete grátis aplicado");
    expect(texto).not.toContain("Retirada na loja");
    expect(rodapeDoCelular()?.textContent ?? "").toContain("GRÁTIS");
  });
});
