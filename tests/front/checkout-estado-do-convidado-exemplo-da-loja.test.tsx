// @vitest-environment jsdom
//
// Lote 249 (multiloja): o campo "Estado" do convidado mostrava "MG" como exemplo
// sempre que a loja entrega só localmente — numa loja de São Paulo o exemplo
// era de outro estado. Agora o exemplo é o estado da loja (config.storeState);
// sem ele (ou com entrega nacional) fica o neutro "UF".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

const { estado, produto } = vi.hoisted(() => {
  const produto = {
    id: "prod-1",
    name: "Produto Teste",
    description: "",
    price: 100,
    images: [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
  };
  return {
    produto,
    estado: {
      config: {} as Record<string, unknown>,
    },
  };
});

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config, isLoaded: true }),
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, loading: false }),
}));
vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [{ product: produto, quantity: 1 }],
      cartTotal: 100,
      shippingFee: 0,
      clearCart: vi.fn(),
      removeFromCart: vi.fn(),
      addToCart: vi.fn(),
      selectedShippingOption: null,
      shippingCep: null,
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
    })),
  };
});
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({ createOrder: vi.fn(), updateOrderStatus: vi.fn() }),
  };
});
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CheckoutView — exemplo do campo Estado do convidado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function abrirComConfig(config: Record<string, unknown>) {
    estado.config = {
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
      whatsappNumber: "",
      ...config,
    };
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView onNavigate={vi.fn()} onSetBackOverride={vi.fn()} />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    return document.getElementById("guest-state") as HTMLInputElement;
  }

  beforeEach(() => {
    sessionStorage.clear();
    pararABuscaDeCep();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("entrega só local e a loja é de SP: o exemplo é SP (não MG)", async () => {
    const campo = await abrirComConfig({
      shippingCoverage: "local",
      storeState: "SP",
    });
    expect(campo.placeholder).toBe("SP");
  });

  it("o estado da loja digitado em minúsculas ou com espaço aparece limpo e em maiúsculas", async () => {
    const campo = await abrirComConfig({
      shippingCoverage: "local",
      storeState: " rj ",
    });
    expect(campo.placeholder).toBe("RJ");
  });

  it("entrega só local e a loja não informou o estado: exemplo neutro UF (nunca MG)", async () => {
    const campo = await abrirComConfig({ shippingCoverage: "local" });
    expect(campo.placeholder).toBe("UF");
  });

  it("estado da loja vazio ou nulo: exemplo neutro UF", async () => {
    const campo = await abrirComConfig({
      shippingCoverage: "local",
      storeState: "  ",
    });
    expect(campo.placeholder).toBe("UF");
  });

  it("entrega nacional: o cliente pode morar em qualquer estado, o exemplo segue UF", async () => {
    const campo = await abrirComConfig({
      shippingCoverage: "national",
      storeState: "SP",
    });
    expect(campo.placeholder).toBe("UF");
  });
});
