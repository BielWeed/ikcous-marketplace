// @vitest-environment jsdom
//
// CAÇA 4 (24/10/2026), achado C3 do checkout: a cliente escolhe um endereço e
// depois o apaga (pela conta, em outra tela ou em outro aparelho). O id do
// endereço escolhido mora no CartContext e continuava lá: a tela mostrava e
// cotava o frete de OUTRO endereço (o principal), mas o pedido saía com o id
// do apagado — e o servidor recusava ("Endereço inválido ou não pertence ao
// usuário"). Agora o id que não está mais na lista cede o lugar à escolha
// automática (principal, ou o primeiro da lista).
import type { CartItem, Product, ShippingOption } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    shippingCoverage: "national" as "national" | "local",
    originCep: "38500-000",
    localCepRange: undefined as string | undefined,
    localDeliveryFee: 12.9 as number | undefined,
    freeShippingMin: 0,
    enableCoupons: false as boolean | undefined,
    formasPagamentoEntrega: ["pix", "card", "cash"] as string[],
  },
}));

const LOCAL: ShippingOption = {
  id: "local-delivery",
  name: "Entrega Local",
  price: 0,
  deliveryDays: 1,
  provider: "local",
};

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => false,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig, isLoaded: true }),
}));

function endereco(id: string, cep: string, principal: boolean) {
  return {
    id,
    user_id: "user-1",
    name: id,
    recipient_name: "Cliente Teste",
    cep,
    street: "Rua Teste",
    number: "10",
    neighborhood: "Centro",
    city: "São Paulo",
    state: "SP",
    is_default: principal,
  };
}

// A lista que a conta tem AGORA: o teste a troca no meio (endereço apagado).
const { lista } = vi.hoisted(() => ({
  lista: { atual: [] as Array<Record<string, unknown>> },
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: lista.atual,
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

// Referência ESTÁVEL de `user` (um objeto novo por render reabriria efeitos).
const USUARIA = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: USUARIA, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [],
      cartTotal: 0,
      shippingFee: 0,
      clearCart: vi.fn(),
      addToCart: vi.fn(),
      shippingCep: null,
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
      freteGratis: false,
      selectedShippingOption: LOCAL,
      freteIndefinido: false,
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PRODUTO: Product = {
  id: "prod-1",
  name: "Camiseta",
  description: "",
  price: 80,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
};
const CART: CartItem[] = [{ product: PRODUTO, quantity: 1 }];

async function esperar(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function botaoFinalizar() {
  return [...document.body.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === "Finalizar pedido",
  ) as HTMLButtonElement | undefined;
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CheckoutView — endereço escolhido que foi apagado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let slotDoHeader: HTMLDivElement;

  const desenhar = async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={CART}
          subtotal={80}
          shipping={0}
          total={80}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
  };

  const finalizar = async () => {
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      digitar("checkout-tel", "34999999999");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(botaoFinalizar()!.disabled).toBe(false);
    await act(async () => {
      botaoFinalizar()!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  beforeEach(async () => {
    const { _limparCacheDeEconomiaDoFreteParaTeste } = await import(
      "@/hooks/useEconomiaDoFreteExibida"
    );
    _limparCacheDeEconomiaDoFreteParaTeste();
    const { HEADER_CENTER_SLOT_ID } = await import(
      "@/components/ui/custom/Header"
    );
    slotDoHeader = document.createElement("div");
    slotDoHeader.id = HEADER_CENTER_SLOT_ID;
    document.body.appendChild(slotDoHeader);
    createOrder.mockReset();
    createOrder.mockResolvedValue({ id: "ped-1", totalAmount: 80 });
    onNavigate.mockClear();
    onSetBackOverride.mockClear();
    globalThis.sessionStorage.clear();
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
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    slotDoHeader.remove();
    const { _limparCacheDeEconomiaDoFreteParaTeste } = await import(
      "@/hooks/useEconomiaDoFreteExibida"
    );
    _limparCacheDeEconomiaDoFreteParaTeste();
    globalThis.sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("o endereço escolhido sai da lista: o pedido vai com o principal que sobrou, nunca com o id apagado", async () => {
    lista.atual = [
      endereco("addr-apagado", "01310-100", true),
      endereco("addr-que-fica", "38500-000", false),
    ];
    await desenhar();
    await esperar(420);

    // A conta apaga o endereço que estava escolhido; a lista agora é só o outro.
    lista.atual = [endereco("addr-que-fica", "38500-000", true)];
    await desenhar();
    await esperar(50);

    await finalizar();

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].addressId).toBe("addr-que-fica");
  });

  it("a lista muda mas o endereço escolhido continua nela (entra um novo, sem principal): o pedido segue com o escolhido", async () => {
    lista.atual = [endereco("addr-1", "01310-100", true)];
    await desenhar();
    await esperar(420);

    // Entra um segundo endereço; o escolhido não saiu da lista.
    lista.atual = [
      endereco("addr-1", "01310-100", true),
      endereco("addr-novo", "30100-000", false),
    ];
    await desenhar();
    await esperar(50);

    await finalizar();

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].addressId).toBe("addr-1");
  });

  it("a lista de endereços ainda não carregou (vazia): a escolha guardada não é apagada", async () => {
    // Lista vazia é "ainda não sei", nunca "o endereço foi apagado": a
    // escolha só cede quando há lista e o id não está nela.
    lista.atual = [endereco("addr-1", "01310-100", true)];
    await desenhar();
    await esperar(420);
    lista.atual = [];
    await desenhar();
    await esperar(50);
    lista.atual = [endereco("addr-1", "01310-100", true)];
    await desenhar();
    await esperar(50);

    await finalizar();

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].addressId).toBe("addr-1");
  });
});
