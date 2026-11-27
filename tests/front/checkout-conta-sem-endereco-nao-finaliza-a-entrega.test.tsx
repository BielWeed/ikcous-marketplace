// @vitest-environment jsdom
//
// CONTA SEM ENDEREÇO NA ENTREGA (27/11/2026, dois achados da mesma raiz):
//
// (1) MÉDIA — a cliente apaga o ÚNICO endereço em outro aparelho e volta ao
// checkout. A lista relida vem vazia, o campo de CEP aparece com o último CEP,
// o frete de ENTREGA é cotado e o Finalizar acende: o pedido saía com o id do
// endereço apagado e o banco recusava ("Endereço inválido ou não pertence ao
// usuário"). O #1960 limpava o id com a lista CONFIRMADA vazia; o #1966 tirou
// esse bloco junto com o endereço da retirada.
//
// (2) BAIXA — conta sem endereço digita o CEP (para poder retirar), e na
// ENTREGA o Finalizar acendia para uma casa que ela não cadastrou; o toque só
// devolvia "adicione ou selecione um endereço de entrega".
//
// Esperado: na ENTREGA, conta sem endereço válido na lista confirmada fica com
// o Finalizar apagado e o resumo pedindo "Cadastre um endereço de entrega";
// o id velho sai. A RETIRADA não muda (só o CEP). Harness de
// checkout-retirada-com-conta-so-pede-cep.test.tsx.
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
    enderecoId: null as string | null,
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
      espelho.enderecoId = enderecoSelecionadoId;
    }, [selecionada, shippingCep, enderecoSelecionadoId]);
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

describe("CheckoutView — conta sem endereço salvo não finaliza a ENTREGA", () => {
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
    espelho.enderecoId = null;
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

  it("(1) o único endereço é apagado em outro aparelho: a lista relida vem vazia, o id velho sai e o Finalizar da ENTREGA apaga", async () => {
    estadoEnderecos.lista = [CASA];
    await montar();
    expect(espelho.enderecoId).toBe("end-casa");
    expect(espelho.selecionada?.id).toBe("local-delivery");
    await clicar(botao("Dinheiro na Entrega"));
    expect(botaoFinalizar().disabled).toBe(false);

    // Outro aparelho apagou: a releitura confirma a lista vazia.
    estadoEnderecos.lista = [];
    await montar();

    expect(espelho.enderecoId).toBeNull();
    expect(
      document.querySelector("[data-testid='checkout-resumo-falta-endereco']")
        ?.textContent,
    ).toContain("Cadastre um endereço de entrega");
    expect(botaoFinalizar().disabled).toBe(true);
    await clicar(botaoFinalizar());
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("(1) limite — depois do endereço apagado, a RETIRADA continua fechando só com o CEP, sem endereço no pedido", async () => {
    estadoEnderecos.lista = [CASA];
    await montar();
    estadoEnderecos.lista = [];
    await montar();
    await abrirSecaoDosDados();
    await digitar("checkout-cep-conta", "38500000");
    await escolherRetiradaEPagarNaRetirada();

    expect(botaoFinalizar().disabled).toBe(false);
    await clicar(botaoFinalizar());
    expect(createOrder).toHaveBeenCalledTimes(1);
    const [pedido] = createOrder.mock.calls[0];
    expect(pedido.shippingOptionId).toBe("store-pickup");
    expect(pedido.addressId).toBeNull();
  });

  it("(2) conta sem endereço: com o CEP digitado a ENTREGA não acende o Finalizar; a retirada acende; voltar à entrega apaga de novo", async () => {
    await montar();
    await abrirSecaoDosDados();
    await digitar("checkout-cep-conta", "38500000");
    expect(espelho.selecionada?.id).toBe("local-delivery");
    await clicar(botao("Dinheiro na Entrega"));
    expect(botaoFinalizar().disabled).toBe(true);

    await escolherRetiradaEPagarNaRetirada();
    expect(botaoFinalizar().disabled).toBe(false);

    await clicar(trocarFrete());
    await clicar(botao("Entrega local"));
    expect(espelho.selecionada?.id).toBe("local-delivery");
    expect(botaoFinalizar().disabled).toBe(true);
    // A seção está aberta (o CEP foi digitado nela): o pedido de cadastro é o
    // da ajuda do campo.
    expect(
      document.getElementById("ajuda-checkout-cep-conta")?.textContent,
    ).toBe("Para receber em casa, toque em Novo e cadastre o endereço.");
    await clicar(botaoFinalizar());
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("controle — conta COM endereço na entrega: o Finalizar acende e o pedido leva o endereço", async () => {
    estadoEnderecos.lista = [CASA];
    await montar();
    await clicar(botao("Dinheiro na Entrega"));
    expect(botaoFinalizar().disabled).toBe(false);
    await clicar(botaoFinalizar());
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].addressId).toBe("end-casa");
  });
});
