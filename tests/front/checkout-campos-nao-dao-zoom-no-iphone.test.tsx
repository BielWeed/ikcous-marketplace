// @vitest-environment jsdom
//
// O SAFARI DO IPHONE AMPLIA A TELA QUANDO UM CAMPO COM FONTE MENOR QUE 16 px
// GANHA FOCO. Os campos do checkout usavam `text-sm` (14 px): ao tocar no nome,
// no CEP ou no cupom a tela dava zoom e a barra fixa com "Finalizar Pedido"
// saía de vista. A correção NÃO trava o zoom do usuário (`maximum-scale` e
// `user-scalable=no` ferem a acessibilidade): o campo é que passa a ter 16 px
// no celular (`text-base`) e volta aos 14 px de sempre a partir de `md`
// (768 px) — o visual de desktop não muda.
//
// O CSS do Tailwind não existe no jsdom, então o que se prova é a classe no
// elemento renderizado: `text-base` + `md:text-sm`, e nunca o `text-sm` solto
// (ele valeria em TODA largura e o `md:` não teria o que desfazer).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { shippingCoverage: "national", originCep: "38500-000" },
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig, isLoaded: true }),
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
    // Transportadora escolhida: é ela que faz o campo de CPF aparecer.
    selectedShippingOption: {
      id: "melhorenvio-pac",
      name: "PAC",
      price: 20,
      deliveryDays: 5,
      provider: "melhor_envio",
    },
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Os campos de texto do checkout do convidado, pelo id. */
const CAMPOS_DO_CHECKOUT = [
  "checkout-name",
  "checkout-tel",
  "checkout-cpf",
  "guest-cep",
  "guest-number",
  "guest-street",
  "guest-neighborhood",
  "guest-city",
  "guest-state",
  "guest-complement",
  "order-notes",
] as const;

/** Passa no iPhone: 16 px no celular, 14 px de `md` para cima. */
function naoDaZoomNoIphone(el: Element | null): boolean {
  if (!el) return false;
  const c = el.classList;
  return (
    c.contains("text-base") &&
    c.contains("md:text-sm") &&
    !c.contains("text-sm")
  );
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
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
});

describe("checkout — campos de texto não dão zoom no iPhone", () => {
  async function montarCheckout() {
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

  it("a âncora: todos os campos existem na tela do convidado", async () => {
    await montarCheckout();
    for (const id of CAMPOS_DO_CHECKOUT) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
  });

  it("cada campo tem 16 px no celular e 14 px de md para cima", async () => {
    await montarCheckout();
    const reprovados = CAMPOS_DO_CHECKOUT.filter(
      (id) => !naoDaZoomNoIphone(document.getElementById(id)),
    );
    expect(reprovados).toEqual([]);
  });

  it("o campo do cupom também (digitar o código não dá zoom)", async () => {
    const { CouponInput } = await import("@/components/ui/custom/CouponInput");
    await act(async () => {
      raiz.render(
        <CouponInput
          onApply={vi.fn()}
          onRemove={vi.fn()}
          appliedCoupon={null}
        />,
      );
    });
    expect(
      naoDaZoomNoIphone(document.getElementById("coupon-code-input")),
    ).toBe(true);
  });
});

describe("viewport — o zoom do usuário continua livre", () => {
  it("index.html não trava o zoom (acessibilidade)", async () => {
    const { readFileSync } = await import("node:fs");
    const html = readFileSync("index.html", "utf8");
    const viewport = /<meta\s+name="viewport"[^>]*>/i.exec(html)?.[0] ?? "";
    expect(viewport).not.toBe("");
    expect(viewport).not.toMatch(/maximum-scale/i);
    expect(viewport).not.toMatch(/user-scalable/i);
  });
});
