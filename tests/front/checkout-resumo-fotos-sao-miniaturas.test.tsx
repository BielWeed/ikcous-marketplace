// @vitest-environment jsdom
//
// Lote 249 (desempenho): as fotos do resumo do pedido no checkout (as bolinhas de
// 24 px do topo e as miniaturas de 48 px do painel) baixavam a foto ORIGINAL da
// loja. Agora usam a miniatura redimensionada do Storage (como o card de
// produto), e se a miniatura falhar volta ao arquivo original. URL que não é do
// Storage fica como está.
import type { CartItem, Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();

const onSetBackOverride = vi.fn();

const { mockValidateCoupon } = vi.hoisted(() => ({
  mockValidateCoupon: vi.fn(),
}));

// `selectedShippingOption`/`freteIndefinido` mutáveis por teste (via
// `vi.hoisted`, porque `vi.mock` é hoisted acima dos imports — mesmo padrão
// de `mockValidateCoupon`): por padrão simula frete JÁ COTADO (opção
// selecionada), para os casos que testam o VALOR da entrega. Um caso
// dedicado zera a opção para provar "a calcular".
const { mockUseCartOverrides } = vi.hoisted(() => ({
  mockUseCartOverrides: {
    selectedShippingOption: { id: "opcao-padrao", name: "Padrão" } as {
      id: string;
      name: string;
    } | null,
    freteIndefinido: false,
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      enableCoupons: true,
    },
    isLoaded: true,
  }),
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

// A barra e o painel são exibidos a partir dos PROPS do componente
// (propCart etc.), não deste mock — mas o componente sempre chama useCart()
// para addToCart/selectedShippingOption/shippingCep, então o dublê precisa
// existir mesmo assim.
vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [],
    cartTotal: 0,
    shippingFee: 0,
    clearCart: vi.fn(),
    addToCart: vi.fn(),
    shippingCep: "",
    setSelectedShippingOption: vi.fn(),
    setShippingCep: vi.fn(),
    ...mockUseCartOverrides,
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: mockValidateCoupon }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn(), updateOrderStatus: vi.fn() }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de CheckoutView.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(overrides: Partial<Product> = {}): Product {
  return {
    id: overrides.id ?? "prod-1",
    name: overrides.name ?? "Produto Teste",
    description: "",
    price: overrides.price ?? 10,
    images: overrides.images ?? [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Espera o `useDeferredRender(380)` do CheckoutView resolver — a barra do
 * total só monta depois disso (mesmo padrão de
 * checkout-view-flag-off.test.tsx:199-203). O gatilho do topo NÃO depende
 * disto (é portado assim que o carrinho existe), mas os testes continuam
 * esperando porque a maioria também confere a barra de baixo. */
async function esperarBarraMontar() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 420));
  });
}

// Foto de fora do Storage: não há como redimensionar, fica como está.
const DE_OUTRO_LUGAR = "https://loja.example/coxinha.jpg";
const DO_STORAGE =
  "https://abc.supabase.co/storage/v1/object/public/product-images/loja/blusa.jpg";

describe("CheckoutView — fotos do resumo do pedido usam a miniatura, não o original", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let slotDoHeader: HTMLDivElement;

  async function abrir(cart: CartItem[]) {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={cart}
          subtotal={10}
          shipping={0}
          total={10}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperarBarraMontar();
  }

  const gatilho = () =>
    [...slotDoHeader.querySelectorAll("button")].find((b) =>
      b.hasAttribute("aria-expanded"),
    ) as HTMLButtonElement;

  beforeEach(async () => {
    onNavigate.mockClear();
    onSetBackOverride.mockClear();
    mockValidateCoupon.mockReset();
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    const { HEADER_CENTER_SLOT_ID } = await import(
      "@/components/ui/custom/Header"
    );
    slotDoHeader = document.createElement("div");
    slotDoHeader.id = HEADER_CENTER_SLOT_ID;
    document.body.appendChild(slotDoHeader);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    slotDoHeader.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("bolinha de 24 px do topo: foto do Storage vira miniatura (/render/image/public/ com width=)", async () => {
    await abrir([{ product: produto({ images: [DO_STORAGE] }), quantity: 1 }]);

    const img = gatilho().querySelector("img")!;
    const src = img.getAttribute("src")!;
    expect(src).toContain("/storage/v1/render/image/public/");
    expect(src).toMatch(/[?&]width=96(&|$)/);
    expect(src).not.toBe(DO_STORAGE);
  });

  it("se a miniatura falha, a bolinha volta ao arquivo original (uma vez)", async () => {
    await abrir([{ product: produto({ images: [DO_STORAGE] }), quantity: 1 }]);

    const img = gatilho().querySelector("img")!;
    expect(img.getAttribute("src")).toContain("/render/image/public/");
    await act(async () => {
      img.dispatchEvent(new Event("error"));
    });
    expect(img.getAttribute("src")).toBe(DO_STORAGE);
  });

  it("foto que não é do Storage fica como está na bolinha", async () => {
    await abrir([
      { product: produto({ images: [DE_OUTRO_LUGAR] }), quantity: 1 },
    ]);

    expect(gatilho().querySelector("img")!.getAttribute("src")).toBe(
      DE_OUTRO_LUGAR,
    );
  });

  it("produto sem foto: continua sem <img> na bolinha", async () => {
    await abrir([{ product: produto({ images: [] }), quantity: 1 }]);

    expect(gatilho().querySelectorAll("img")).toHaveLength(0);
  });

  it("miniatura de 48 px do painel: foto do Storage vira miniatura, e volta ao original se falhar", async () => {
    await abrir([
      {
        product: produto({ name: "Blusa A", images: [DO_STORAGE] }),
        quantity: 1,
      },
    ]);
    await act(async () => {
      gatilho().click();
    });

    const doPainel = [...document.body.querySelectorAll("img")].filter(
      (i) => !slotDoHeader.contains(i),
    );
    expect(doPainel).toHaveLength(1);
    const src = doPainel[0].getAttribute("src")!;
    expect(src).toContain("/storage/v1/render/image/public/");
    expect(src).toMatch(/[?&]width=144(&|$)/);

    await act(async () => {
      doPainel[0].dispatchEvent(new Event("error"));
    });
    expect(doPainel[0].getAttribute("src")).toBe(DO_STORAGE);
  });

  it("painel: produto sem foto não ganha src inventado e foto de fora fica como está", async () => {
    await abrir([
      { product: produto({ id: "a", images: [] }), quantity: 1 },
      {
        product: produto({ id: "b", images: [DE_OUTRO_LUGAR] }),
        quantity: 1,
      },
    ]);
    await act(async () => {
      gatilho().click();
    });

    const doPainel = [...document.body.querySelectorAll("img")].filter(
      (i) => !slotDoHeader.contains(i),
    );
    const srcs = doPainel.map((i) => i.getAttribute("src"));
    expect(srcs).toContain(DE_OUTRO_LUGAR);
    expect(srcs).not.toContain("");
  });
});
