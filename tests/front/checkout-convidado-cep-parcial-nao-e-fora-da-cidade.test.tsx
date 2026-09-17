// @vitest-environment jsdom
//
// Achado CheckoutView-1381: `convidadoForaDaCidade` julgava com o valor CRU
// do campo — um único dígito digitado ("3") já fazia `cepEhLocal` comparar
// "38500" (origem) com "3" (destino), devolver false, e acender "Entrega
// fora da cidade é só com conta" antes mesmo do convidado terminar de
// digitar o CEP. A mesma ressalva ("CEP parcial é digitação em curso — não
// dá pra decidir 'local' ou 'fora da cidade' no primeiro dígito") já existia
// no efeito irmão de reconciliação de CEP (CheckoutView.tsx:832,
// `soDigitos(cepDeEntrega).length < 8`) e faltava aqui. Este teste fixa: com
// CEP incompleto, nenhum julgamento é feito — nem aviso, nem bloqueio pela
// regra do convidado; só com os 8 dígitos fechados é que a régua entra em
// ação (mesmos casos completos de checkout-convidado-so-compra-local.test.tsx).
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

describe("CheckoutView (convidado) — CEP parcial não decide 'fora da cidade'", () => {
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
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
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

  // A barra com o botão "Finalizar Pedido" (e o aviso âmbar) renderiza via
  // PORTAL, com atraso proposital (useDeferredRender) — microtarefas não
  // bastam, é preciso deixar os timers do deferred rodarem de verdade.
  async function esperarBarra() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });
  }

  it("convidado da própria cidade digitando o primeiro dígito ('3') não vê o aviso de fora da cidade", async () => {
    await montar();

    act(() => {
      digitar("guest-cep", "3");
    });
    await esperarBarra();

    const texto = (document.body.textContent ?? "").replace(/\u00A0/g, " ");
    expect(texto).not.toContain("Entrega fora da cidade é só com conta");
  });

  it("CEP com 4 dígitos ('3850') ainda em digitação também não acusa fora da cidade", async () => {
    await montar();

    act(() => {
      digitar("guest-cep", "3850");
    });
    await esperarBarra();

    const texto = (document.body.textContent ?? "").replace(/\u00A0/g, " ");
    expect(texto).not.toContain("Entrega fora da cidade é só com conta");
  });

  it("CEP fechado (8 dígitos) de fora da cidade continua acusando o aviso", async () => {
    await montar();

    act(() => {
      digitar("guest-cep", "01310100");
    });
    await esperarBarra();

    const texto = (document.body.textContent ?? "").replace(/\u00A0/g, " ");
    expect(texto).toContain("Entrega fora da cidade é só com conta");
  });
});
