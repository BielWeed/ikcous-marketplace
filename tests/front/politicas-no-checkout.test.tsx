// @vitest-environment jsdom
//
// CHECKOUT: ao lado do botão "Finalizar" a cliente lê "Ao finalizar você
// concorda com os Termos de uso e a Política de Privacidade", com os dois
// links. O que se prova, com o CheckoutView REAL (harness herdado de
// `checkout-retirada-na-loja`):
//   1. a frase está na barra fixa do botão, e NÃO é caixa de marcar: o
//      Finalizar não depende dela;
//   2. abrir um link NÃO navega (o checkout não sai de cena): a folha abre
//      por cima e, ao fechar, a escolha de frete, o meio de pagamento e o
//      carrinho continuam os mesmos — o pedido sai idêntico;
//   3. o fluxo de pedido não muda: Finalizar chama `createOrder` uma vez,
//      com o mesmo payload de antes.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Address, CartItem, Product, ShippingOption } from "@/types";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { estadoEnderecos, contaEstavel, invoke, espelho, createOrder } =
  vi.hoisted(() => ({
    estadoEnderecos: { lista: [] as Address[] },
    contaEstavel: {
      user: { id: "user-1", user_metadata: { name: "Cliente Teste" } },
      // O perfil traz o id da conta: o checkout só usa o perfil cujo id é o
      // da conta logada (dc0d6bab); sem id ele é tratado como "ainda não
      // chegou" e nome/WhatsApp ficam vazios, travando o Finalizar.
      profile: {
        id: "user-1",
        full_name: "Cliente Teste",
        whatsapp: "34999999999",
      },
    },
    invoke: vi.fn(),
    espelho: {
      selecionada: null as ShippingOption | null,
      shippingCep: null as string | null,
    },
    createOrder: vi.fn(),
  }));

const produto: Product = {
  id: "prod-1",
  name: "Blusa Teste",
  description: "",
  price: 128.25,
  images: [],
  category: "Roupas",
  stock: 50,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
};
const CARRINHO: CartItem[] = [{ product: produto, quantity: 2 }];

const CASA: Address = {
  id: "end-casa",
  user_id: "user-1",
  name: "Casa",
  recipient_name: "Cliente Teste",
  cep: "38500-000",
  street: "Rua Principal",
  number: "100",
  complement: "",
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: "",
  is_default: true,
};

const LOCAL: ShippingOption = {
  id: "local-delivery",
  name: "Entrega local",
  price: 5,
  deliveryDays: 1,
  provider: "local",
};

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
      localDeliveryFee: 5,
      enableCoupons: false,
      storeName: "Loja da Ana",
    },
    isLoaded: true,
  }),
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: estadoEnderecos.lista,
    fetchAddresses: vi.fn(async () => {}),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: contaEstavel.user,
    profile: contaEstavel.profile,
    loading: false,
  }),
}));
vi.mock("@/hooks/useCart", async () => {
  const { useEffect, useState } = await import("react");
  function useCartComEstado() {
    const [selecionada, setSelecionada] = useState<ShippingOption | null>(null);
    const [shippingCep, setShippingCep] = useState<string | null>(null);
    const [enderecoSelecionadoId, setEnderecoSelecionadoId] = useState<
      string | null
    >(null);
    useEffect(() => {
      espelho.selecionada = selecionada;
      espelho.shippingCep = shippingCep;
    }, [selecionada, shippingCep]);
    return {
      cart: CARRINHO,
      cartTotal: 256.5,
      shippingFee: selecionada?.price ?? 0,
      freteIndefinido: !selecionada,
      freteGratis: false,
      clearCart: vi.fn(),
      addToCart: vi.fn(),
      selectedShippingOption: selecionada,
      shippingCep,
      enderecoSelecionadoId,
      setEnderecoSelecionadoId,
      setSelectedShippingOption: setSelecionada,
      setShippingCep,
    };
  }
  return { useCart: useCartComEstado };
});
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
}));
vi.mock("@/hooks/useEconomiaDoFreteExibida", () => ({
  useEconomiaDoFreteExibida: () => 0,
}));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    // A folha das trocas lê `politica_devolucao`; aqui o banco responde erro
    // (a leitura é tolerante: cai no mínimo da lei).
    from: () => {
      const cadeia = {
        select: () => cadeia,
        eq: () => cadeia,
        maybeSingle: () =>
          Promise.resolve({ data: null, error: { message: "fora do ar" } }),
      };
      return cadeia;
    },
  },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CheckoutView — termos e privacidade ao lado do Finalizar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estadoEnderecos.lista = [CASA];
    espelho.selecionada = null;
    espelho.shippingCep = null;
    onNavigate.mockClear();
    invoke.mockReset();
    invoke.mockResolvedValue({
      data: { options: [LOCAL], cotacaoIncompleta: false },
      error: null,
    });
    createOrder.mockReset();
    createOrder.mockResolvedValue({ id: "pedido-1" });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => void armazem.set(c, v),
      removeItem: (c: string) => void armazem.delete(c),
    });
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function drenar() {
    await act(async () => {
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });
  }

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
    await drenar();
  }

  function botao(texto: string): HTMLButtonElement | undefined {
    return [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    ) as HTMLButtonElement | undefined;
  }

  const finalizar = () =>
    document.querySelector(
      'button[aria-label="Finalizar pedido"]',
    ) as HTMLButtonElement;

  const frase = () =>
    document.querySelector('[data-testid="frase-de-aceite"]') as HTMLElement;

  async function aguardarFolha(): Promise<Element> {
    for (let i = 0; i < 80; i++) {
      const f = document.querySelector('[data-testid="folha-politica"]');
      if (f) return f;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 25));
      });
    }
    throw new Error("a folha da política não abriu");
  }

  async function clicar(el: HTMLElement | undefined) {
    expect(el).toBeDefined();
    await act(async () => {
      el?.click();
    });
    await drenar();
  }

  it("a frase está na MESMA barra fixa do botão Finalizar, com os dois links, sem caixa de marcar", async () => {
    await montar();
    expect(frase()).not.toBeNull();
    expect(frase().textContent).toBe(
      "Ao finalizar você concorda com os Termos de uso e a Política de Privacidade.",
    );
    const barra = finalizar().closest(".fixed");
    expect(barra).not.toBeNull();
    expect(barra?.contains(frase())).toBe(true);
    expect(frase().querySelectorAll("button")).toHaveLength(2);
    expect(frase().querySelector("br")).toBeNull();
    expect(barra?.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("não trava o Finalizar: com frete e pagamento escolhidos ele está livre sem 'aceitar' nada", async () => {
    await montar();
    expect(espelho.selecionada?.id).toBe("local-delivery");
    await clicar(botao("Dinheiro na Entrega"));
    expect(finalizar().disabled).toBe(false);
  });

  it("abrir os termos não tira a cliente do checkout nem muda a compra; o pedido sai igual", async () => {
    await montar();
    await clicar(botao("Dinheiro na Entrega"));

    await clicar(botao("Termos de uso"));
    const folha = await aguardarFolha();
    expect(folha.textContent).toContain("Termos de uso");
    // O checkout continua de pé, com a escolha de frete intacta.
    expect(onNavigate).not.toHaveBeenCalled();
    expect(finalizar()).not.toBeNull();
    expect(espelho.selecionada?.id).toBe("local-delivery");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(createOrder).not.toHaveBeenCalled();

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Fechar"]')
        ?.click();
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(document.querySelector('[data-testid="folha-politica"]')).toBeNull();

    // Mesma compra: frete local, dinheiro, total do carrinho + frete.
    expect(espelho.selecionada?.id).toBe("local-delivery");
    await clicar(finalizar());
    expect(createOrder).toHaveBeenCalledTimes(1);
    const [pedido] = createOrder.mock.calls[0];
    expect(pedido.shippingOptionId).toBe("local-delivery");
    expect(pedido.paymentMethod).toBe("cash");
    expect(pedido.shippingCost).toBe(5);
    expect(pedido.totalAmount).toBe(261.5);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("Voltar do aparelho com a folha aberta: fecha só a folha, o checkout não sai de cena e o pedido sai igual", async () => {
    // O roteador do App (handler de popstate) registrado ANTES da folha. Se
    // ele acordasse, a cliente sairia do checkout e perderia pagamento e frete.
    globalThis.history.replaceState({ view: "checkout" }, "", "/checkout");
    const roteadorDoApp = vi.fn();
    globalThis.addEventListener("popstate", roteadorDoApp);
    try {
      await montar();
      await clicar(botao("Dinheiro na Entrega"));
      expect(espelho.selecionada?.id).toBe("local-delivery");

      await clicar(botao("Política de Privacidade"));
      await aguardarFolha();
      expect(globalThis.history.state).toMatchObject({
        view: "checkout",
        folhaDePolitica: true,
      });

      await act(async () => {
        globalThis.history.back();
        await new Promise((r) => setTimeout(r, 60));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });

      expect(
        document.querySelector('[data-testid="folha-politica"]'),
      ).toBeNull();
      expect(roteadorDoApp).not.toHaveBeenCalled();
      expect(onNavigate).not.toHaveBeenCalled();
      expect(globalThis.location.pathname).toBe("/checkout");
      // Frete e pagamento como estavam; o pedido sai com o mesmo payload.
      expect(espelho.selecionada?.id).toBe("local-delivery");
      expect(finalizar().disabled).toBe(false);
      await clicar(finalizar());
      expect(createOrder).toHaveBeenCalledTimes(1);
      const [pedido] = createOrder.mock.calls[0];
      expect(pedido.shippingOptionId).toBe("local-delivery");
      expect(pedido.paymentMethod).toBe("cash");
      expect(pedido.totalAmount).toBe(261.5);
    } finally {
      globalThis.removeEventListener("popstate", roteadorDoApp);
    }
  });

  it("a Política de Privacidade abre o texto certo, por cima do checkout", async () => {
    await montar();
    await clicar(botao("Política de Privacidade"));
    const folha = await aguardarFolha();
    expect(folha.textContent).toContain("Que dados pedimos");
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
