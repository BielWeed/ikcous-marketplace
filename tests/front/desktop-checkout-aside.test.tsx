import type { CartItem } from "@/types";
// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";
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

vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));

let root: Root;
let host: HTMLDivElement;
let slot: HTMLDivElement;
const cart: CartItem[] = [
  {
    product: {
      id: "p1",
      name: "Produto",
      price: 20,
      images: [],
      description: "",
      category: "geral",
      stock: 10,
      sold: 0,
      isActive: true,
      isBestseller: false,
      freeShipping: false,
      createdAt: "2026-09-28",
    },
    quantity: 1,
  },
];
beforeEach(() => {
  mockUseCartOverrides.selectedShippingOption = null;
  mockUseCartOverrides.freteIndefinido = true;
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  });
  vi.stubGlobal("matchMedia", undefined);
  host = document.createElement("div");
  slot = document.createElement("div");
  slot.id = "checkout-header-center-slot";
  document.body.append(host, slot);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  slot.remove();
  vi.unstubAllGlobals();
});
async function montar(computador = false, onSetBackOverride = vi.fn()) {
  if (computador)
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q === "(min-width: 1024px)",
    }));
  const { CheckoutView } = await import("@/views/customer/CheckoutView");
  await act(async () =>
    root.render(
      <CheckoutView
        cart={cart}
        subtotal={20}
        shipping={0}
        total={20}
        onNavigate={vi.fn()}
        onSetBackOverride={onSetBackOverride}
      />,
    ),
  );
}
it("desktop tem um resumo lateral com itens e a única finalização", async () => {
  await montar(true);
  const aside = host.querySelector('aside[aria-label="Resumo do pedido"]');
  expect(aside).not.toBeNull();
  expect(aside?.querySelector("li")?.textContent).toContain("Produto");
  const botoes = document.querySelectorAll('[aria-label="Finalizar pedido"]');
  expect(botoes).toHaveLength(1);
  expect(aside?.contains(botoes[0])).toBe(true);
  expect(aside?.querySelector('[role="alert"]')).not.toBeNull();
});
it("celular mantém portal no body, classes do formulário e espaçadores", async () => {
  await montar();
  expect(host.querySelector("aside")).toBeNull();
  const botao = document.querySelector('[aria-label="Finalizar pedido"]');
  expect(botao).not.toBeNull();
  expect(host.contains(botao)).toBe(false);
  const formulario = host.querySelector(".space-y-4.px-3\\.5") as HTMLElement;
  expect(classesDoCelular(formulario.className)).toBe(
    "mx-auto w-full max-w-md space-y-4 px-3.5",
  );
  expect(formulario.className).toContain("lg:max-w-[1120px]");
  for (const el of host.querySelectorAll<HTMLElement>(
    'div[aria-hidden="true"][style*="height"]',
  ))
    expect(el.className).toContain("lg:hidden");
  const gatilho = slot.querySelector("button")!;
  expect(classesDoCelular(gatilho.className)).toBe(
    "flex min-w-0 max-w-full items-center gap-1 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-zinc-50 active:scale-95",
  );
  expect(gatilho.className).toContain("lg:hidden");
});

it("ao reduzir a janela a barra volta ao body sem perder o formulário", async () => {
  await montar(true);
  const nome = document.getElementById("checkout-name") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(nome, "Cliente de teste");
    nome.dispatchEvent(new Event("input", { bubbles: true }));
  });
  vi.stubGlobal("matchMedia", undefined);
  await montar();
  expect(host.querySelector("aside")).toBeNull();
  expect(
    document.querySelectorAll('[aria-label="Finalizar pedido"]'),
  ).toHaveLength(1);
  expect(
    host.contains(document.querySelector('[aria-label="Finalizar pedido"]')),
  ).toBe(false);
  expect(document.getElementById("checkout-name")).toBe(nome);
  expect(nome.value).toBe("Cliente de teste");
});

it("fecha o painel ao crescer para computador sem voltar ao focar o formulário", async () => {
  let computador = false;
  const ouvintes = new Set<() => void>();
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return computador;
    },
    addEventListener: (_evento: string, ouvinte: () => void) =>
      ouvintes.add(ouvinte),
    removeEventListener: (_evento: string, ouvinte: () => void) =>
      ouvintes.delete(ouvinte),
  }));

  let override: (() => void) | null = null;
  const onSetBackOverride = vi.fn((proximo: unknown) => {
    override =
      typeof proximo === "function" ? (proximo as () => () => void)() : null;
  });
  const voltar = vi.spyOn(globalThis.history, "back").mockImplementation(() => {
    override?.();
  });
  await montar(false, onSetBackOverride);

  await act(async () => {
    slot.querySelector("button")!.click();
  });
  expect(slot.querySelector("button")?.getAttribute("aria-expanded")).toBe(
    "true",
  );

  await act(async () => {
    computador = true;
    for (const notificar of ouvintes) notificar();
  });
  expect(voltar).toHaveBeenCalledTimes(1);
  expect(slot.querySelector("button")?.getAttribute("aria-expanded")).toBe(
    "false",
  );

  await act(async () => {
    document.getElementById("checkout-name")!.focus();
  });
  expect(voltar).toHaveBeenCalledTimes(1);
});
