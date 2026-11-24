// @vitest-environment jsdom
//
// O que a cliente LÊ quando o servidor recusa o cupom sem dizer o motivo, ou
// quando a conferência do cupom não tem resposta (achado por mutação,
// 24/11/2026: trocar `message || "Cupom inválido"` por `message ?? ""` e tirar
// a guarda `!isOffline` passavam com a suíte inteira verde):
//  - recusa SEM texto (aplicando ou conferindo o cupom do rascunho): a tela diz
//    "Cupom inválido" e o cupom sai — nunca um campo vermelho vazio, nem o
//    cupom parado na tela sem explicação;
//  - conferência sem resposta com internet: o aviso "Não deu para conferir o
//    desconto" aparece (o Finalizar está travado e ela precisa saber por quê);
//  - o mesmo, sem internet: o aviso NÃO aparece (a volta da rede repete a
//    conferência sozinha; avisar de "falha" com o aparelho sem rede é ruído.
// DINHEIRO: valores fictícios; o servidor é dublê (rpc).
import {
  rascunhoVazio,
  salvarRascunhoDoCheckout,
} from "@/lib/rascunho-do-checkout";
import type { CartItem } from "@/types";
import { CheckoutView } from "@/views/customer/CheckoutView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RPC = "validate_coupon_secure_v2";
const CODIGO = "PROMO10";
const rpc = vi.fn();
const navegar = vi.fn();
const configurarVoltar = vi.fn();
const nada = vi.fn();
const { rede } = vi.hoisted(() => ({ rede: { offline: false } }));

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
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => rede.offline,
}));
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

/** O que o servidor dublê responde à validação do cupom (a lista volta vazia). */
let aoValidar: () => Promise<{ data: unknown; error: unknown }>;

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  rede.offline = false;
  rpc.mockReset().mockImplementation(async (nome: string) => {
    if (nome === RPC) return aoValidar();
    return { data: [], error: null };
  });
  carrinho = [item("Produto da prova", 50)];
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
  vi.restoreAllMocks();
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

function semearRascunhoComCupom() {
  salvarRascunhoDoCheckout(sessionStorage, {
    ...rascunhoVazio(),
    cupom: CODIGO,
  });
}

const aplicado = () =>
  hospedeiro.querySelector('[data-testid="cupom-aplicado"]');
const campoDoCupom = () => hospedeiro.querySelector("#campo-de-cupom");

describe("checkout — recusa do cupom sem motivo", () => {
  it("ao aplicar: servidor recusa sem texto e a tela diz 'Cupom inválido'", async () => {
    aoValidar = async () => ({
      data: { is_valid: false, discount_value: 0, error_message: "" },
      error: null,
    });
    await abrir();
    await digitarEAplicar();

    expect(aplicado()).toBeNull();
    expect(campoDoCupom()?.hasAttribute("hidden")).toBe(false);
    expect(campoDoCupom()?.textContent).toContain("Cupom inválido");
  });

  it("ao conferir o cupom do rascunho: recusa sem texto tira o cupom e diz 'Cupom inválido'", async () => {
    aoValidar = async () => ({
      data: { is_valid: false, discount_value: 0, error_message: "" },
      error: null,
    });
    semearRascunhoComCupom();
    await abrir();

    expect(aplicado()).toBeNull();
    expect(campoDoCupom()?.textContent).toContain("Cupom inválido");
  });
});

describe("checkout — conferência do cupom sem resposta", () => {
  const SEM_RESPOSTA = /Não deu para conferir o desconto do cupom/;

  it("com internet: o cupom fica e a tela explica que não deu para conferir o desconto", async () => {
    aoValidar = async () => {
      throw new Error("Failed to fetch");
    };
    semearRascunhoComCupom();
    await abrir();

    expect(aplicado()).not.toBeNull();
    expect(hospedeiro.textContent).toMatch(SEM_RESPOSTA);
  });

  it("sem internet: o cupom fica e NÃO aparece aviso de falha (a volta da rede confere sozinha)", async () => {
    rede.offline = true;
    aoValidar = async () => {
      throw new Error("Failed to fetch");
    };
    semearRascunhoComCupom();
    await abrir();

    expect(aplicado()).not.toBeNull();
    expect(hospedeiro.textContent).not.toMatch(SEM_RESPOSTA);
  });
});
