// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

const { produto } = vi.hoisted(() => ({
  produto: {
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
    createdAt: "2026-01-01T00:00:00.000Z",
  },
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingCoverage: "national", originCep: "38500-000" },
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
vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [{ product: produto, quantity: 1 }],
      cartTotal: 100,
      shippingFee: 0,
      clearCart: vi.fn(),
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
vi.mock("@/hooks/useOrders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useOrders")>()),
  useOrders: () => ({ createOrder: vi.fn() }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const aviso = "Buscando o endereço do CEP…";
const barra = () => document.querySelector(".bottom-docked-navigation");

let raiz: Root;
let hospedeiro: HTMLDivElement;
let buscaPendente: ReturnType<typeof pararABuscaDeCep>;

beforeEach(() => {
  sessionStorage.clear();
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
  buscaPendente = pararABuscaDeCep();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

async function montar() {
  const { CheckoutView } = await import("@/views/customer/CheckoutView");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await act(async () => {
    raiz.render(
      <CheckoutView onNavigate={vi.fn()} onSetBackOverride={vi.fn()} />,
    );
  });
}

async function avancarAteABarra() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
}

it("anuncia a espera do CEP do convidado na mesma região do início ao fim da busca", async () => {
  const { TIMEOUT_BUSCA_CEP_MS } = await import("@/hooks/useBuscaCep");
  await montar();
  await avancarAteABarra();

  const regiaoDeAnuncio = () =>
    hospedeiro.querySelector(
      '[data-testid="checkout-etapas"] > [role="status"]',
    );
  const avisoVisual = () =>
    [...document.querySelectorAll(".bottom-docked-navigation p")].find(
      (p) => p.textContent === aviso,
    );
  const regiao = regiaoDeAnuncio();
  expect(regiao).not.toBeNull();
  expect(regiao?.textContent).not.toContain(aviso);
  expect(avisoVisual()).toBeUndefined();

  const campo = hospedeiro.querySelector<HTMLInputElement>("#guest-cep")!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(campo, "38500000");
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });

  expect(campo.getAttribute("aria-busy")).toBe("true");
  const visual = avisoVisual();
  expect(visual?.isConnected).toBe(true);
  expect(regiaoDeAnuncio()).toBe(regiao);
  expect(regiao?.textContent).toContain(aviso);
  expect(visual?.getAttribute("aria-hidden")).toBe("true");
  expect(visual?.hasAttribute("role")).toBe(false);

  // O dublê não responde. O relógio simulado deixa a busca real atingir seu teto.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(TIMEOUT_BUSCA_CEP_MS);
  });

  expect(campo.getAttribute("aria-busy")).toBe("false");
  expect(regiaoDeAnuncio()).toBe(regiao);
  expect(regiao?.textContent).not.toContain(aviso);
  expect(avisoVisual()).toBeUndefined();
});

it("anuncia a busca do CEP salvo numa região que já existia vazia antes da consulta", async () => {
  localStorage.setItem("ikcous_last_shipping_cep", "38500-000");
  const regioesAoIniciar = new Map<Element, string | null>();
  const aguardarResposta = buscaPendente.getMockImplementation() as (
    url: string,
    init?: RequestInit,
  ) => Promise<Response>;
  buscaPendente.mockImplementationOnce((url, init) => {
    // A consulta começa no efeito da montagem. Aqui vemos o que já foi
    // montado, antes de o estado de busca pintar o texto.
    for (const regiao of document.querySelectorAll('[role="status"]')) {
      regioesAoIniciar.set(regiao, regiao.textContent);
    }
    return aguardarResposta(url, init);
  });
  const regiaoComAviso = () =>
    [...document.querySelectorAll('[role="status"]')].find(
      (regiao) => regiao.textContent === aviso,
    );

  await montar();
  expect(
    hospedeiro.querySelector("#guest-cep")?.getAttribute("aria-busy"),
  ).toBe("true");
  expect(barra()).toBeNull();
  const regiaoAntesDaBarra = regiaoComAviso();

  await avancarAteABarra();

  expect(barra()).not.toBeNull();
  const regiao = regiaoComAviso();
  expect(regiao).toBeDefined();
  expect(regioesAoIniciar.get(regiao!)).toBe("");
  expect(regiaoAntesDaBarra).toBe(regiao);
});
