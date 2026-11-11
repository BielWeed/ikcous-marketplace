// @vitest-environment jsdom
//
// Onda 111 (checkout-front, achado 1): a cliente COM CONTA só pode enviar o
// pedido com um endereço de entrega escolhido. Essa é a única barreira: o
// botão "Finalizar pedido" NÃO olha o endereço (o schema do formulário só
// exige endereço do convidado) e, com a cotação de frete ainda guardada do
// carrinho, ele fica aceso mesmo sem endereço. Quem recusa é o
// `handleSubmitEvent` (`user && !selectedAddressId`). Sem essa guarda o pedido
// nasce sem `addressId`: estoque (e cupom de uso único) consumidos num pedido
// que a lojista não tem para onde enviar.
//
// Harness: o mesmo de checkout-endereco-apagado-assume-o-principal.test.tsx.
import type { CartItem, Product, ShippingOption } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FRASE_DA_GUARDA =
  "Por favor, adicione ou selecione um endereço de entrega.";

const { mockConfig, createOrder, toastErro, lista } = vi.hoisted(() => ({
  mockConfig: {
    shippingCoverage: "national" as "national" | "local",
    originCep: "38500-000",
    localCepRange: undefined as string | undefined,
    localDeliveryFee: 12.9 as number | undefined,
    freeShippingMin: 0,
    enableCoupons: false as boolean | undefined,
    formasPagamentoEntrega: ["pix", "card", "cash"] as string[],
  },
  createOrder: vi.fn(),
  toastErro: vi.fn(),
  // A lista de endereços que a conta tem AGORA: o teste a troca no meio.
  lista: { atual: [] as Array<Record<string, unknown>> },
}));

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const LOCAL: ShippingOption = {
  id: "local-delivery",
  name: "Entrega Local",
  price: 0,
  deliveryDays: 1,
  provider: "local",
};

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: async () => true,
}));

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

// Cotação de frete e CEP JÁ guardados no carrinho (o cenário do achado): a
// opção de entrega está selecionada e o CEP de cotação existe, então nenhuma
// outra guarda do Finalizar apaga o botão.
vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [],
      cartTotal: 0,
      shippingFee: 0,
      clearCart: vi.fn(),
      addToCart: vi.fn(),
      shippingCep: "38500-000",
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
  toast: { error: toastErro, success: vi.fn(), info: vi.fn() },
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

describe("CheckoutView — conta sem endereço escolhido não finaliza a entrega", () => {
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

  const preencherDados = async () => {
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      digitar("checkout-tel", "34999999999");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const clicarFinalizar = async () => {
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
    toastErro.mockReset();
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

  it("conta SEM nenhum endereço: o botão está aceso, o clique não cria pedido, avisa e a trava de envio é liberada", async () => {
    lista.atual = [];
    await desenhar();
    await esperar(420);
    await preencherDados();

    // Controle: o botão NÃO barra a falta de endereço — a única barreira é o
    // handler. Se este controle falhar, a guarda do botão mudou e o teste
    // precisa ser relido, não afrouxado.
    expect(botaoFinalizar()!.disabled).toBe(false);

    await clicarFinalizar();

    expect(createOrder).not.toHaveBeenCalled();
    expect(toastErro).toHaveBeenCalledTimes(1);
    expect(toastErro).toHaveBeenCalledWith(FRASE_DA_GUARDA);

    // Trava de envio liberada: o botão voltou e um segundo clique é tratado de
    // novo (se a trava ficasse fechada, `tentarEntrar` recusaria em silêncio e
    // o aviso não repetiria).
    expect(botaoFinalizar()!.disabled).toBe(false);
    await clicarFinalizar();
    expect(createOrder).not.toHaveBeenCalled();
    expect(toastErro).toHaveBeenCalledTimes(2);

    // E, assim que a conta passa a ter endereço (a lista chega), o MESMO botão
    // finaliza: a recusa não deixou nada preso.
    lista.atual = [endereco("addr-novo", "38500-000", true)];
    await desenhar();
    await esperar(50);
    await clicarFinalizar();

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].addressId).toBe("addr-novo");
  });

  it("conta COM endereço escolhido: o pedido sai uma vez, com o addressId do principal (não o primeiro da lista)", async () => {
    lista.atual = [
      endereco("addr-primeiro", "01310-100", false),
      endereco("addr-principal", "38500-000", true),
    ];
    await desenhar();
    await esperar(420);
    await preencherDados();

    expect(botaoFinalizar()!.disabled).toBe(false);
    await clicarFinalizar();

    expect(toastErro).not.toHaveBeenCalledWith(FRASE_DA_GUARDA);
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].addressId).toBe("addr-principal");
  });
});
