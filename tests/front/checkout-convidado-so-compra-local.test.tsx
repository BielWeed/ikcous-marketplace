// @vitest-environment jsdom
//
// REGRA DO CONVIDADO (decisão do Gabriel, 30/08/2026 — laudo caça-bugs Savy,
// achado 3): convidado só compra com ENTREGA LOCAL; envio para outra cidade
// exige conta. O que este teste fixa:
//   1. convidado + CEP de fora -> botão Finalizar apagado, aviso visível
//      explicando o porquê e porta para entrar/criar conta;
//   2. convidado + CEP local -> nenhum aviso: a compra segue normal;
//   3. convidado + CEP de 7 dígitos ("1234-678") -> o campo acusa "CEP
//      inválido" (a régua antiga media CARACTERES, não dígitos).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { shippingCoverage: "national", originCep: "38500-000" },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
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
          stock: 10,
          sold: 0,
          isActive: true,
          isBestseller: false,
          freeShipping: false,
          createdAt: new Date().toISOString(),
        },
        quantity: 1,
      },
    ],
    cartTotal: 100,
    shippingFee: 0,
    freteIndefinido: false,
    clearCart: vi.fn(),
    selectedShippingOption: null,
    shippingCep: "",
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn() }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// checkout-guest-cep.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function pegarBotaoFinalizar(): HTMLButtonElement {
  const botao = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Finalizar Pedido"),
  ) as HTMLButtonElement;
  expect(botao).toBeDefined();
  return botao;
}

describe("CheckoutView (convidado) — só compra com entrega local", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.assign(mockConfig, {
      shippingCoverage: "national",
      originCep: "38500-000",
    });
  });

  async function montar() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
  }

  // A barra com o botão "Finalizar Pedido" é renderizada com atraso
  // proposital (useDeferredRender) — microtarefas não bastam, é preciso
  // deixar os timers de deferred rodarem de verdade.
  async function esperarBarra() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });
  }

  it("convidado com CEP DE FORA: Finalizar apagado + aviso + porta para a conta", async () => {
    await montar();

    act(() => {
      digitar("guest-cep", "01310100");
    });
    await esperarBarra();

    // A barra com o botão Finalizar (e o aviso) renderiza via PORTAL no
    // document.body — o hospedeiro fica sem ela.
    const texto = (document.body.textContent ?? "").replace(/\u00A0/g, " ");
    expect(texto).toContain("Entrega fora da cidade é só com conta");
    expect(pegarBotaoFinalizar().disabled).toBe(true);

    const porta = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Entrar ou criar conta"),
    ) as HTMLButtonElement;
    expect(porta).toBeDefined();
    await act(async () => {
      porta.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("auth");
  });

  it("convidado com CEP LOCAL: nenhum aviso de fora da cidade", async () => {
    await montar();

    act(() => {
      digitar("guest-cep", "38500000");
    });
    await esperarBarra();

    const texto = (document.body.textContent ?? "").replace(/\u00A0/g, " ");
    expect(texto).not.toContain("Entrega fora da cidade é só com conta");
  });

  it("CEP de convidado com 7 dígitos ('1234-678') acusa CEP inválido", async () => {
    await montar();

    act(() => {
      digitar("guest-cep", "1234-678");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(hospedeiro.textContent).toContain("CEP inválido");
  });
});
