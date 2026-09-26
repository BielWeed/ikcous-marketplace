// @vitest-environment jsdom
//
// RETIRADA NA LOJA NO CHECKOUT (release 1.5.3, 22/09/2026).
//
// A calculadora é a REAL, dentro do CheckoutView real; o `useCart` é um dublê
// COM ESTADO (useState) — mesmo molde de
// checkout-frete-automatico-troca-de-endereco.test.tsx. O que se prova:
//   1. a retirada NUNCA vem escolhida: a entrega local é a auto-seleção; a
//      cliente clica em "Retirar na loja";
//   2. a escolha EXPLÍCITA chega até o payload do pedido: id `store-pickup`,
//      frete 0, total = subtotal, nota "Retirada na loja: <endereço>" (sem
//      prazo inventado), e o pagamento na entrega/retirada continua valendo
//      (grupo "Na retirada", sem a regra da transportadora);
//   3. trocar para endereço FORA da área derruba a retirada e recota;
//   4. retirada não mostra "economia de frete" (nada foi economizado: ela
//      é grátis por natureza).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Address, CartItem, Product, ShippingOption } from "@/types";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const {
  estadoEnderecos,
  contaEstavel,
  dubleEnderecos,
  invoke,
  espelho,
  createOrder,
  economia,
} = vi.hoisted(() => ({
  estadoEnderecos: { lista: [] as Address[] },
  contaEstavel: {
    user: { id: "user-1", user_metadata: { name: "Cliente Teste" } },
    profile: { full_name: "Cliente Teste", whatsapp: "34999999999" },
  },
  dubleEnderecos: {
    fetchAddresses: vi.fn(async () => {}),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
  },
  invoke: vi.fn(),
  espelho: {
    selecionada: null as ShippingOption | null,
    shippingCep: null as string | null,
  },
  createOrder: vi.fn(),
  // Valor que o hook de EXIBIÇÃO da economia devolveria (frete grátis local
  // com taxa de 10): o checkout decide se o mostra.
  economia: { valor: 0 },
}));

const ENDERECO_FICTICIO = "Rua Fictícia de Teste, 100 — Centro";

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
const TRABALHO: Address = {
  id: "end-trabalho",
  user_id: "user-1",
  name: "Trabalho",
  recipient_name: "Cliente Teste",
  cep: "01001-000",
  street: "Praça da Sé",
  number: "1",
  complement: "",
  neighborhood: "Sé",
  city: "São Paulo",
  state: "SP",
  reference: "",
  is_default: false,
};

const LOCAL: ShippingOption = {
  id: "local-delivery",
  name: "Entrega local",
  price: 5,
  deliveryDays: 1,
  provider: "local",
};
const RETIRADA: ShippingOption = {
  id: "store-pickup",
  name: "Retirar na loja",
  price: 0,
  deliveryDays: 0,
  provider: "pickup",
  pickupAddress: ENDERECO_FICTICIO,
};
const PAC_SP: ShippingOption = {
  id: "melhor-envio-1",
  name: "PAC",
  price: 30,
  deliveryDays: 6,
  provider: "melhor_envio",
};

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
      localDeliveryFee: 5,
      enableCoupons: false,
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: estadoEnderecos.lista,
    fetchAddresses: dubleEnderecos.fetchAddresses,
    addAddress: dubleEnderecos.addAddress,
    updateAddress: dubleEnderecos.updateAddress,
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
      // Mesma regra do CartContext: sem opção escolhida, frete indefinido.
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
  useEconomiaDoFreteExibida: () => economia.valor,
}));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CheckoutView — retirada na loja é escolha explícita e chega inteira ao pedido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estadoEnderecos.lista = [CASA, TRABALHO];
    espelho.selecionada = null;
    espelho.shippingCep = null;
    economia.valor = 0;
    invoke.mockReset();
    invoke.mockImplementation(
      (_nome: string, opts: { body: { cep: string } }) =>
        Promise.resolve({
          data: {
            options:
              opts.body.cep === "38500000" ? [LOCAL, RETIRADA] : [PAC_SP],
            cotacaoIncompleta: false,
          },
          error: null,
        }),
    );
    createOrder.mockReset();
    createOrder.mockResolvedValue({ id: "pedido-retirada-1" });
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
    act(() => {
      raiz.unmount();
    });
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
    return [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    ) as HTMLButtonElement | undefined;
  }

  function botaoFinalizar(): HTMLButtonElement {
    return document.querySelector(
      'button[aria-label="Finalizar pedido"]',
    ) as HTMLButtonElement;
  }

  function regiaoDoFrete(): string {
    return (
      document.querySelector('section[aria-label="Entrega e frete"]')
        ?.textContent ?? ""
    );
  }

  // CHECKOUT COMPACTO (23/09/2026): com opção pronta e escolhida, a
  // ShippingCalculator resume atrás de um botão "Trocar" (prop
  // `modoResumo`, só no checkout) — a lista de opções (incluindo "Retirar
  // na loja") só aparece depois desse clique. Escopado à seção "Entrega e
  // frete" para nunca casar com o "Trocar" do card de dados/endereço.
  function trocarFrete(): HTMLButtonElement | undefined {
    const secao = document.querySelector(
      'section[aria-label="Entrega e frete"]',
    );
    return [...(secao?.querySelectorAll("button") ?? [])].find((b) =>
      b.textContent?.includes("Trocar"),
    ) as HTMLButtonElement | undefined;
  }

  async function clicar(elemento: HTMLElement | undefined) {
    expect(elemento).toBeDefined();
    await act(async () => {
      elemento?.click();
    });
    await drenar();
  }

  it("a retirada não vem escolhida: a entrega local é a auto-seleção", async () => {
    await montar();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(espelho.selecionada?.id).toBe("local-delivery");
    // Opção pronta + escolhida: a calculadora resume atrás de "Trocar" —
    // a lista completa (com "Retirar na loja") só aparece depois do clique.
    await clicar(trocarFrete());
    expect(regiaoDoFrete()).toContain("Retirar na loja");
    expect(regiaoDoFrete()).toContain(`Retire em: ${ENDERECO_FICTICIO}`);
    // Controle dos rótulos: com a entrega local, o pagamento é "na Entrega".
    expect(botao("Dinheiro na Entrega")).toBeDefined();
    expect(botao("Dinheiro na Retirada")).toBeUndefined();
  });

  it("escolha explícita chega ao payload: store-pickup, frete 0, total = subtotal, nota com o endereço e sem prazo; pagamento na retirada", async () => {
    await montar();
    await clicar(trocarFrete());
    await clicar(botao("Retirar na loja"));
    expect(espelho.selecionada?.id).toBe("store-pickup");

    // Modalidade da loja: o grupo de pagamento "na retirada" continua lá,
    // sem a regra da transportadora.
    expect(document.body.textContent).toContain("Na retirada");
    expect(document.body.textContent).not.toContain(
      "exige pagamento antecipado",
    );
    // Só o TEXTO dos meios muda ("na Retirada"); o value continua cash.
    for (const meio of ["Pix", "Cartão", "Dinheiro"]) {
      expect(botao(`${meio} na Retirada`)).toBeDefined();
      expect(botao(`${meio} na Entrega`)).toBeUndefined();
    }
    await clicar(botao("Dinheiro na Retirada"));

    expect(botaoFinalizar().disabled).toBe(false);
    await clicar(botaoFinalizar());

    expect(createOrder).toHaveBeenCalledTimes(1);
    const [pedido, opcoes] = createOrder.mock.calls[0];
    expect(pedido.shippingOptionId).toBe("store-pickup");
    expect(pedido.shippingCost).toBe(0);
    expect(pedido.totalAmount).toBe(256.5);
    expect(pedido.destinationCep).toBe("38500-000");
    expect(pedido.paymentMethod).toBe("cash");
    expect(pedido.notes).toContain(`Retirada na loja: ${ENDERECO_FICTICIO}`);
    expect(pedido.notes).not.toContain("Prazo");
    expect(opcoes).toEqual({ comPagamentoOnline: false });
  });

  it("trocar para endereço FORA da área derruba a retirada e recota: a transportadora do destino novo entra", async () => {
    await montar();
    await clicar(trocarFrete());
    await clicar(botao("Retirar na loja"));
    expect(espelho.selecionada?.id).toBe("store-pickup");

    const cartao = Array.from(
      hospedeiro.querySelectorAll<HTMLElement>('[role="button"]'),
    ).find((el) => el.textContent?.includes("Trabalho"));
    await clicar(cartao);

    expect(invoke).toHaveBeenCalledTimes(2);
    const cepDaSegunda = (invoke.mock.calls[1][1] as { body: { cep: string } })
      .body.cep;
    expect(cepDaSegunda).toBe("01001000");
    expect(espelho.selecionada?.id).toBe("melhor-envio-1");
    expect(regiaoDoFrete()).not.toContain("Retirar na loja");
    expect(document.body.textContent).not.toContain("Na retirada");
  });

  it("retirada não mostra 'economia de frete' inventada (controle: com a entrega local grátis, mostra)", async () => {
    economia.valor = 10;
    await montar();
    expect(espelho.selecionada?.id).toBe("local-delivery");
    expect(
      document.body.querySelector('[aria-label="Desconto de R$ 10,00"]'),
    ).not.toBeNull();

    await clicar(trocarFrete());
    await clicar(botao("Retirar na loja"));
    expect(espelho.selecionada?.id).toBe("store-pickup");
    expect(
      document.body.querySelector('[aria-label^="Desconto de R$"]'),
    ).toBeNull();
  });
});
