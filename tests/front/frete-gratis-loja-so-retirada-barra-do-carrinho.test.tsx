// @vitest-environment jsdom
//
// Loja em "Só retirada" e sem transportadora: o carrinho não anuncia meta de
// frete grátis. Antes, a barra de progresso (logada, com retirada escolhida e a
// meta salva ainda não batida) dizia "Meta Frete Grátis / Faltam R$ X", e o
// convidado via o aviso da Home no carrinho, para uma entrega que a loja não
// faz — a retirada já é grátis.
//
// O que este arquivo prende:
//   1. só retirada + sem transportadora: nem a barra (logada) nem o aviso
//      (convidada) aparecem;
//   2. só retirada COM transportadora, e lojas que entregam na cidade: a barra
//      e o aviso continuam como antes.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  total: 100,
  user: null as { id: string } | null,
  freteIndefinido: true,
  selectedShippingOption: null as { id: string; name: string } | null,
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config, isLoaded: true }),
}));

// O bloco da HOME lê o total daqui; o carrinho lê o mesmo total via useCart().
vi.mock("@/contexts/CartContext", () => ({
  useCartContext: () => ({ cartTotal: estado.total }),
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
          price: estado.total,
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
    shippingFee: 10,
    freteIndefinido: estado.freteIndefinido,
    freteGratis: false,
    // o carrinho agora le o total do contexto (mesma fonte da home e da regra real de frete)
    cartTotal: estado.total,
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    selectedShippingOption: estado.selectedShippingOption,
    setSelectedShippingOption: vi.fn(),
    shippingCep: null,
    setShippingCep: vi.fn(),
    enderecoSelecionadoId: null,
    setEnderecoSelecionadoId: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({ addresses: [], fetchAddresses: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [],
    fetchUserOrders: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: estado.user }),
}));

vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));

vi.mock("@/components/ui/custom/CartItemsList", () => ({
  CartItemsList: () => <div data-testid="itens" />,
}));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => <div data-testid="calculadora" />,
}));
vi.mock("@/components/ui/custom/ShippingProgress", () => ({
  ShippingProgress: () => <div data-testid="progresso">progresso antigo</div>,
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

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replaceAll(String.fromCharCode(160), " ").replace(/\s+/g, " ");

const SO_RETIRO_SEM_TRANSPORTADORA = {
  freeShippingMin: 150,
  localDeliveryEnabled: false,
  shippingCoverage: "local",
  enabledShippingMethods: ["store-pickup"],
};

describe("CartView — loja só com retirada não anuncia meta de frete grátis", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.config = { ...SO_RETIRO_SEM_TRANSPORTADORA };
    estado.total = 100;
    estado.user = null;
    estado.freteIndefinido = true;
    estado.selectedShippingOption = null;
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
    return normalizar(hospedeiro.textContent);
  }

  function logadaComRetiradaEscolhida() {
    estado.user = { id: "u1" };
    estado.freteIndefinido = false;
    estado.selectedShippingOption = { id: "store-pickup", name: "Retirar" };
  }

  it("convidada: o carrinho não mostra o aviso de meta da Home", async () => {
    const texto = await renderizarCarrinho();
    // Âncora: o carrinho montou (o bloco do convidado está na árvore).
    expect(texto).toContain("Comprar como Convidado");
    expect(texto).not.toContain("Falta pouquinho");
    expect(texto).not.toContain("R$ 50,00");
  });

  it("logada, retirada escolhida e meta salva não batida: a barra de progresso não aparece", async () => {
    logadaComRetiradaEscolhida();
    const texto = await renderizarCarrinho();
    expect(texto).not.toContain("progresso antigo");
    expect(texto).not.toContain("Falta pouquinho");
  });

  it("só retirada COM transportadora ligada: a barra de progresso continua", async () => {
    estado.config = {
      ...estado.config,
      shippingCoverage: "national",
      enabledShippingMethods: ["sedex", "pac", "store-pickup"],
    };
    logadaComRetiradaEscolhida();
    expect(await renderizarCarrinho()).toContain("progresso antigo");
  });

  it("entrega na cidade ligada: a barra continua para a logada e o aviso para a convidada", async () => {
    estado.config = {
      ...estado.config,
      localDeliveryEnabled: true,
      enabledShippingMethods: ["sedex", "store-pickup"],
    };
    estado.user = { id: "u1" };
    estado.freteIndefinido = false;
    estado.selectedShippingOption = { id: "local-delivery", name: "Entrega" };
    expect(await renderizarCarrinho()).toContain("progresso antigo");

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    estado.user = null;
    estado.freteIndefinido = true;
    estado.selectedShippingOption = null;
    const texto = await renderizarCarrinho();
    expect(texto).toContain("Falta pouquinho");
    expect(texto).toContain("R$ 50,00");
  });
});
