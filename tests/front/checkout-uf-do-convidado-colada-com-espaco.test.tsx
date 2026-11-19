// @vitest-environment jsdom
//
// Colar uma UF ou nome no checkout de convidado não deve truncar o texto.
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

describe("CheckoutView — UF do convidado colada com espaço", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function abrir() {
    estado.config = {
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
      whatsappNumber: "",
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

  async function digitar(campo: HTMLInputElement, valor: string) {
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
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

  it.each([
    [" sp ", "SP"],
    ["SP ", "SP"],
    [" SP", "SP"],
    ["s p", "SP"],
    ["Mato Grosso do Sul", "MS"],
  ])("colar %j deixa %s no campo", async (colado, sigla) => {
    const campo = await abrir();
    await act(async () => {
      const evento = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(evento, "clipboardData", {
        value: { getData: () => colado },
      });
      expect(campo.dispatchEvent(evento)).toBe(false);
    });
    expect(campo.value).toBe(sigla);
  });

  it.each([
    ["Mato Grosso do Sul", "MS"],
    ["Paraíba", "PB"],
    ["Paraná", "PR"],
  ])(
    "preserva %s durante a digitação e mostra %s ao sair",
    async (nome, sigla) => {
      const campo = await abrir();
      await act(async () => campo.focus());
      for (const letra of nome) {
        await digitar(campo, campo.value + letra);
        expect(document.getElementById("erro-guest-state")).toBeNull();
      }
      expect(campo.value).toBe(nome);
      await act(async () => campo.blur());
      expect(campo.value).toBe(sigla);
      expect(document.getElementById("erro-guest-state")).toBeNull();
    },
  );

  it("o campo não tem `maxLength`: o navegador cortaria o texto colado ANTES da limpeza (o jsdom não reproduz esse corte, por isso a trava é no atributo)", async () => {
    const campo = await abrir();
    expect(campo.hasAttribute("maxlength")).toBe(false);
    expect(campo.getAttribute("autocomplete")).toBe("address-level1");
  });
});
