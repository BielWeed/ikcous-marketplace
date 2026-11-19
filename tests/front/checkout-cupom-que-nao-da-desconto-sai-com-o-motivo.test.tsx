// @vitest-environment jsdom

import {
  lerRascunhoDoCheckout,
  rascunhoVazio,
  salvarRascunhoDoCheckout,
} from "@/lib/rascunho-do-checkout";
import type { CartItem } from "@/types";
import { CheckoutView } from "@/views/customer/CheckoutView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RPC = "validate_coupon_secure_v2";
const CODIGO = "UMPC";
const MOTIVO = "Este cupom não dá desconto em uma compra deste valor.";
const rpc = vi.fn();
const navegar = vi.fn();
const configurarVoltar = vi.fn();
const nada = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    profile: null,
    loading: false,
    isAdmin: false,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: nada,
    addAddress: nada,
    updateAddress: nada,
    loading: false,
  }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: nada, updateOrderStatus: nada }),
}));
vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => false,
  lerFlagPagamentoOnline: (valor: string | undefined) => valor === "true",
}));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));
vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: () => null,
}));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

const config = {
  shippingCoverage: "local",
  originCep: "38500-000",
  localCepRange: "01310-100",
  enableCoupons: true,
};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config, isLoaded: true }),
}));

let carrinho: CartItem[];
vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: carrinho,
      cartTotal: carrinho.reduce(
        (soma, i) => soma + i.product.price * i.quantity,
        0,
      ),
      shippingFee: 0,
      clearCart: nada,
      addToCart: nada,
      shippingCep: null,
      setSelectedShippingOption: nada,
      setShippingCep: nada,
    })),
  };
});

const item = (id: string, price: number): CartItem => ({
  quantity: 1,
  product: {
    id,
    name: id,
    price,
    description: "",
    images: [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-11-19T00:00:00Z",
  },
});

function resposta(nome: string, args?: { p_subtotal: number }) {
  if (nome !== RPC) return { data: [], error: null };
  return {
    data:
      args?.p_subtotal === 0.5
        ? { is_valid: true, discount_value: 0.01, error_message: "" }
        : { is_valid: false, discount_value: 0, error_message: MOTIVO },
    error: null,
  };
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  rpc
    .mockReset()
    .mockImplementation(async (nome, args) => resposta(nome, args));
  carrinho = [item("Produto da prova", 0.49)];
  sessionStorage.clear();
  localStorage.clear();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  sessionStorage.clear();
  localStorage.clear();
  vi.useRealTimers();
});

async function abrir() {
  await act(async () => {
    raiz.render(
      <CheckoutView
        onNavigate={navegar}
        onSetBackOverride={configurarVoltar}
      />,
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(450);
  });
}

async function digitarEAplicar() {
  const abrirCampo = hospedeiro.querySelector<HTMLButtonElement>(
    '[aria-controls="campo-de-cupom"]',
  );
  expect(abrirCampo).not.toBeNull();
  await act(async () => abrirCampo?.click());

  const campo =
    hospedeiro.querySelector<HTMLInputElement>("#coupon-code-input");
  expect(campo).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, CODIGO);
    campo?.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const aplicar = campo?.form?.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  );
  expect(aplicar?.disabled).toBe(false);
  await act(async () => aplicar?.click());
}

const aplicado = () =>
  hospedeiro.querySelector('[data-testid="cupom-aplicado"]');
const subtotaisValidados = () =>
  rpc.mock.calls
    .filter(([nome]) => nome === RPC)
    .map(([, argumentos]) => argumentos.p_subtotal);

function conferirRecusaNaTela() {
  const campo = hospedeiro.querySelector("#campo-de-cupom");
  expect(campo?.hasAttribute("hidden")).toBe(false);
  expect(campo?.textContent).toContain(MOTIVO);
  expect(aplicado()).toBeNull();
  expect(hospedeiro.textContent).not.toContain("Cupom aplicado");
}

describe("checkout — cupom que não dá desconto", () => {
  it("mostra o motivo da recusa sem mostrar cupom aplicado", async () => {
    await abrir();
    await digitarEAplicar();

    expect(subtotaisValidados()).toEqual([0.49]);
    conferirRecusaNaTela();
  });

  it("tira o cupom aplicado e mostra o motivo quando o carrinho encolhe", async () => {
    carrinho = [...carrinho, item("Um centavo a mais", 0.01)];
    await abrir();
    await digitarEAplicar();
    expect(aplicado()?.textContent).toContain("Você economiza");

    carrinho = carrinho.slice(0, 1);
    await abrir();

    expect(subtotaisValidados()).toEqual([0.5, 0.49]);
    conferirRecusaNaTela();
    expect(lerRascunhoDoCheckout(sessionStorage)?.cupom ?? null).toBeNull();
  });

  it("confere o cupom do rascunho com o valor real do carrinho que tem itens", async () => {
    carrinho = [...carrinho, item("Um centavo a mais", 0.01)];
    salvarRascunhoDoCheckout(sessionStorage, {
      ...rascunhoVazio(),
      cupom: CODIGO,
    });
    await abrir();

    expect(subtotaisValidados()).toEqual([0.5]);
    expect(aplicado()?.textContent).toContain("Você economiza");
  });
});
