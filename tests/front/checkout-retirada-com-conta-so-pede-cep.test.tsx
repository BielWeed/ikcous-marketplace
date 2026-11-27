// @vitest-environment jsdom
//
// RETIRADA NA LOJA COM CONTA E SEM ENDEREÇO SALVO (decisão do sócio a pedido
// do dono, 26/11/2026): quem tem conta e ainda não cadastrou endereço não via
// a opção de retirar — o frete só era cotado pelo endereço salvo, e a tela
// mandava "Cadastre ou escolha um endereço de entrega". Agora ela informa só
// o CEP, como a visitante já faz: a cotação aparece, ela escolhe retirar e
// finaliza, e o pedido de retirada não leva endereço de casa nenhum (a RPC
// grava o endereço da LOJA). A entrega continua exigindo endereço cadastrado.
//
// Mesmo molde de checkout-retirada-na-loja.test.tsx: calculadora REAL dentro
// do CheckoutView real, `useCart` com estado. O dublê de `useAddresses` faz o
// que o hook real faz quando a leitura do servidor dá certo: chama `aoLer`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Address, CartItem, Product, ShippingOption } from "@/types";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const {
  estadoEnderecos,
  conta,
  invoke,
  espelho,
  inicial,
  createOrder,
  toastError,
} = vi.hoisted(() => ({
  estadoEnderecos: {
    lista: [] as Address[],
    // false = a leitura do servidor não respondeu (lista vazia NÃO prova
    // que a conta não tem endereço).
    leituraConfirma: true,
  },
  conta: {
    user: { id: "user-1", user_metadata: { name: "Cliente Teste" } } as {
      id: string;
      user_metadata: { name: string };
    } | null,
    profile: {
      id: "user-1",
      full_name: "Cliente Teste",
      whatsapp: "34999999999",
    } as { id: string; full_name: string; whatsapp: string } | null,
  },
  invoke: vi.fn(),
  espelho: {
    selecionada: null as ShippingOption | null,
    shippingCep: null as string | null,
  },
  // Estado com que o carrinho CHEGA ao checkout (escolha feita no carrinho).
  inicial: {
    selecionada: null as ShippingOption | null,
    shippingCep: null as string | null,
  },
  createOrder: vi.fn(),
  toastError: vi.fn(),
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
const RETIRADA: ShippingOption = {
  id: "store-pickup",
  name: "Retirar na loja",
  price: 0,
  deliveryDays: 0,
  provider: "pickup",
  pickupAddress: "Rua Fictícia de Teste, 100 — Centro",
};

const AVISO_ENDERECO_DE_ENTREGA =
  "Por favor, adicione ou selecione um endereço de entrega.";

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: async () => true,
}));

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
    fetchAddresses: async (opcoes?: {
      aoLer?: (enderecos: Address[]) => void;
    }) => {
      if (estadoEnderecos.leituraConfirma) {
        opcoes?.aoLer?.(estadoEnderecos.lista);
      }
    },
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: conta.user,
    profile: conta.profile,
    loading: false,
  }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { useEffect, useState } = await import("react");
  function useCartComEstado() {
    const [selecionada, setSelecionada] = useState<ShippingOption | null>(
      inicial.selecionada,
    );
    const [shippingCep, setShippingCep] = useState<string | null>(
      inicial.shippingCep,
    );
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
  },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CheckoutView — retirada com conta pede só o CEP", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    estadoEnderecos.lista = [];
    estadoEnderecos.leituraConfirma = true;
    conta.user = { id: "user-1", user_metadata: { name: "Cliente Teste" } };
    conta.profile = {
      id: "user-1",
      full_name: "Cliente Teste",
      whatsapp: "34999999999",
    };
    espelho.selecionada = null;
    espelho.shippingCep = null;
    inicial.selecionada = null;
    inicial.shippingCep = null;
    invoke.mockReset();
    invoke.mockImplementation(
      (_nome: string, opts: { body: { cep: string } }) =>
        Promise.resolve({
          data: {
            options: opts.body.cep === "38500000" ? [LOCAL, RETIRADA] : [],
            cotacaoIncompleta: false,
          },
          error: null,
        }),
    );
    createOrder.mockReset();
    createOrder.mockResolvedValue({ id: "pedido-retirada-1" });
    toastError.mockReset();
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

  function trocarFrete(): HTMLButtonElement | undefined {
    const secao = document.querySelector(
      'section[aria-label="Entrega e frete"]',
    );
    return [...(secao?.querySelectorAll("button") ?? [])].find((b) =>
      b.textContent?.includes("Trocar"),
    ) as HTMLButtonElement | undefined;
  }

  async function clicar(elemento: HTMLElement | undefined | null) {
    expect(elemento).toBeTruthy();
    await act(async () => {
      elemento?.click();
    });
    await drenar();
  }

  async function digitar(id: string, valor: string) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    expect(el, `campo #${id} na tela`).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(el, valor);
      el?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await drenar();
  }

  async function abrirSecaoDosDados() {
    await clicar(
      document.querySelector<HTMLElement>(
        "[data-testid='checkout-resumo-falta-endereco']",
      ) ?? document.getElementById("resumo-trocar-endereco"),
    );
  }

  async function escolherRetiradaEPagarNaRetirada() {
    await clicar(trocarFrete());
    await clicar(botao("Retirar na loja"));
    expect(espelho.selecionada?.id).toBe("store-pickup");
    await clicar(botao("Dinheiro na Retirada"));
  }

  it("conta sem endereço: digita o CEP, vê a retirada e finaliza; o pedido não leva endereço de casa", async () => {
    await montar();

    // Antes do CEP: nada cotado, e a tela pede o CEP (não um endereço).
    expect(invoke).not.toHaveBeenCalled();
    expect(regiaoDoFrete()).not.toContain("Cadastre ou escolha um endereço");

    await abrirSecaoDosDados();
    await digitar("checkout-cep-conta", "38500000");

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(
      (invoke.mock.calls[0][1] as { body: { cep: string } }).body.cep,
    ).toBe("38500000");
    await escolherRetiradaEPagarNaRetirada();

    expect(botaoFinalizar().disabled).toBe(false);
    await clicar(botaoFinalizar());

    expect(toastError).not.toHaveBeenCalled();
    expect(createOrder).toHaveBeenCalledTimes(1);
    const [pedido] = createOrder.mock.calls[0];
    expect(pedido.shippingOptionId).toBe("store-pickup");
    expect(pedido.destinationCep).toBe("38500-000");
    expect(pedido.addressId).toBeNull();
    expect(pedido.addressData).toBeNull();
  });

  it("conta sem endereço, retirada marcada e CEP apagado: o Finalizar trava, como na visitante", async () => {
    await montar();
    await abrirSecaoDosDados();
    await digitar("checkout-cep-conta", "38500000");
    await escolherRetiradaEPagarNaRetirada();
    expect(botaoFinalizar().disabled).toBe(false);

    await digitar("checkout-cep-conta", "");
    expect(botaoFinalizar().disabled).toBe(true);
  });

  it("limite — retirada que já veio escolhida do carrinho e CEP vazio: o Finalizar espera o CEP, como na visitante", async () => {
    inicial.selecionada = RETIRADA;
    inicial.shippingCep = "38500-000";
    await montar();
    expect(espelho.selecionada?.id).toBe("store-pickup");
    expect(botaoFinalizar().disabled).toBe(true);

    // Com o CEP, a cotação sai (e escolhe sozinha a entrega local, que é a
    // auto-seleção); voltar à retirada libera o Finalizar.
    await digitar("checkout-cep-conta", "38500000");
    await escolherRetiradaEPagarNaRetirada();
    expect(botaoFinalizar().disabled).toBe(false);
  });

  it("controle — conta sem endereço que escolhe ENTREGA: continua precisando cadastrar o endereço", async () => {
    await montar();
    await abrirSecaoDosDados();
    await digitar("checkout-cep-conta", "38500000");
    // A entrega local é a auto-seleção da cotação.
    expect(espelho.selecionada?.id).toBe("local-delivery");
    await clicar(botao("Dinheiro na Entrega"));

    await clicar(botaoFinalizar());

    expect(createOrder).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(AVISO_ENDERECO_DE_ENTREGA);
  });

  it("controle — conta COM endereço: sem campo de CEP, a cotação segue o CEP do endereço (mesmo com outro CEP guardado no aparelho)", async () => {
    estadoEnderecos.lista = [CASA];
    armazem.set("ikcous_last_shipping_cep", "01001-000");
    await montar();

    expect(document.getElementById("checkout-cep-conta")).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(
      (invoke.mock.calls[0][1] as { body: { cep: string } }).body.cep,
    ).toBe("38500000");

    await escolherRetiradaEPagarNaRetirada();
    await clicar(botaoFinalizar());

    expect(createOrder).toHaveBeenCalledTimes(1);
    const [pedido] = createOrder.mock.calls[0];
    expect(pedido.destinationCep).toBe("38500-000");
    // Na retirada o pedido não anexa mais o endereço de casa.
    expect(pedido.addressId).toBeNull();
    expect(pedido.addressData).toBeNull();
  });

  it("controle — conta COM endereço que escolhe entrega: o pedido leva o endereço escolhido, como antes", async () => {
    estadoEnderecos.lista = [CASA];
    await montar();
    expect(espelho.selecionada?.id).toBe("local-delivery");
    await clicar(botao("Dinheiro na Entrega"));
    await clicar(botaoFinalizar());

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].addressId).toBe("end-casa");
  });

  it("limite — lista de endereços que NÃO foi confirmada pelo servidor: nada de campo de CEP, a tela segue pedindo o endereço", async () => {
    estadoEnderecos.leituraConfirma = false;
    armazem.set("ikcous_last_shipping_cep", "38500-000");
    await montar();

    expect(document.getElementById("checkout-cep-conta")).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    expect(regiaoDoFrete()).toContain("Cadastre ou escolha um endereço");
  });

  it("controle — visitante: continua informando só o CEP na retirada, sem endereço no pedido", async () => {
    conta.user = null;
    conta.profile = null;
    await montar();
    await digitar("checkout-name", "Cliente Teste");
    await digitar("checkout-tel", "34999999999");
    await digitar("guest-cep", "38500000");
    expect(document.getElementById("checkout-cep-conta")).toBeNull();

    await escolherRetiradaEPagarNaRetirada();
    expect(botaoFinalizar().disabled).toBe(false);
    await clicar(botaoFinalizar());

    expect(createOrder).toHaveBeenCalledTimes(1);
    const [pedido] = createOrder.mock.calls[0];
    expect(pedido.addressId).toBeNull();
    expect(pedido.addressData).toBeNull();
    expect(pedido.destinationCep).toBe("38500-000");
  });
});
